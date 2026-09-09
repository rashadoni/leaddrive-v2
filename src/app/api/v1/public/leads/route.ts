import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { sanitizeForPrompt } from "@/lib/sanitize"
import { clientIp } from "@/lib/request-ip"
import {
  consumePublicRateLimit,
  releasePublicActionReservation,
  reservePublicAction,
  type PublicActionReservation,
} from "@/lib/public-abuse-guard"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const LEAD_IP_LIMIT = { maxRequests: 10, windowSeconds: 60 }
const LEAD_TENANT_LIMIT = { maxRequests: 100, windowSeconds: 60 * 60 }
const LEAD_DEDUP_POLICY = { cooldownSeconds: 10 * 60, maxActions: 1, windowSeconds: 10 * 60 }
const MAX_LEAD_BODY_SIZE = 16 * 1024

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" }

function leadJson(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...headers } })
}

function acceptedLead() {
  return leadJson({
    success: true,
    data: {
      status: "new",
      message: "Lead submitted successfully",
    },
  }, 201)
}

function rateLimited(retryAfterSeconds: number) {
  return leadJson(
    { success: false, error: "Too many requests. Please try again later." },
    429,
    { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
  )
}

function guardUnavailable() {
  return leadJson(
    { success: false, error: "Service temporarily unavailable. Please try again later." },
    503,
    { "Retry-After": "1" },
  )
}

function hasFilledHoneypot(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false
  const value = (body as Record<string, unknown>).website
  return typeof value === "string" ? value.trim().length > 0 : value != null
}

/**
 * Unauthenticated endpoint: every field here is attacker-controlled. `phone`,
 * `company` and `source` had no upper bound at all, and `contactName`/
 * `companyName` are read back by the AI paths — so the two display fields are
 * also stripped of newlines and control characters, the carriers a prompt
 * injection needs to look like a new instruction.
 */
const WebLeadSchema = z.object({
  // min(1) BEFORE sanitising would accept "\n\n\n" and store an empty name, so the
  // length check is re-applied to the sanitised value.
  name: z
    .string()
    .min(1)
    .max(200)
    .transform((v) => sanitizeForPrompt(v, 200))
    .refine((v) => v.length > 0, { message: "name is required" }),
  email: z.string().trim().max(320).email(),
  phone: z.string().max(50).optional(),
  company: z
    .string()
    .max(200)
    .optional()
    .transform((v) => {
      const clean = v ? sanitizeForPrompt(v, 200) : undefined
      return clean || undefined
    }),
  message: z.string().max(2000).optional(),
  source: z.string().trim().max(100).default("web_form"),
  org_slug: z.string().trim().min(1).max(200),
  // Hidden field emitted by the CRM's embed snippet. Humans never fill it.
  website: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  const ip = clientIp(request)
  const ipLimit = await consumePublicRateLimit("web-lead:ip", ip, LEAD_IP_LIMIT)
  if (ipLimit.unavailable) return guardUnavailable()
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds)

  let reservation: PublicActionReservation | null = null
  let keepReservation = false
  const requestBody = await readJsonRequestWithinLimit(request, MAX_LEAD_BODY_SIZE)
  if (!requestBody.ok) {
    return leadJson(
      { success: false, error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      requestBody.reason === "too_large" ? 413 : 400,
    )
  }
  const body = requestBody.value

  try {
    // Silently accept bot-filled honeypots so automated submitters cannot tune
    // around the trap by comparing status codes or response bodies.
    if (hasFilledHoneypot(body)) return acceptedLead()

    const data = WebLeadSchema.parse(body)

    // A second, endpoint-specific bucket prevents a distributed flood from
    // filling one tenant while still behaving identically for unknown slugs.
    const tenantLimit = await consumePublicRateLimit(
      "web-lead:tenant",
      data.org_slug.trim().toLowerCase(),
      LEAD_TENANT_LIMIT,
    )
    if (tenantLimit.unavailable) return guardUnavailable()
    if (!tenantLimit.allowed) return rateLimited(tenantLimit.retryAfterSeconds)

    const dedupIdentity = JSON.stringify([
      data.org_slug.trim().toLowerCase(),
      data.name.trim().toLowerCase(),
      data.email.trim().toLowerCase(),
      data.phone?.trim() ?? "",
      data.company?.trim().toLowerCase() ?? "",
      data.message?.trim() ?? "",
      data.source.trim().toLowerCase(),
    ])
    reservation = await reservePublicAction("web-lead:dedup", dedupIdentity, LEAD_DEDUP_POLICY)
    if (reservation.unavailable) return guardUnavailable()
    if (!reservation.allowed) return acceptedLead()

    // RLS phase 1 — org resolution by slug. `organizations` is a global
    // table (no policy), so no bypass needed.
    // Look up organization by slug only (exact match to prevent enumeration)
    const org = await prisma.organization.findFirst({
      where: { slug: data.org_slug, isActive: true },
    })

    if (!org) {
      // Generic response to prevent organization enumeration
      keepReservation = true
      return acceptedLead()
    }

    // RLS phase 2 — lead creation + assignment rules run tenant-scoped
    // (the fire-and-forget rules call starts inside the scope and inherits it).
    return await runWithTenant(org.id, async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: org.id,
        contactName: data.name,
        email: data.email,
        phone: data.phone,
        companyName: data.company,
        source: data.source,
        status: "new",
        priority: "medium",
        notes: data.message,
      },
    })
    // The durable side effect now exists. Keep the dedup reservation even if a
    // downstream best-effort enrolment unexpectedly fails.
    keepReservation = true

    applyLeadAssignmentRules(org.id, lead).catch(() => {})

    // Auto-enroll into sequences that watch this lead source (never throws;
    // awaited inside the tenant scope). No authenticated user on this public
    // path → owner resolves from the lead's assignee (may be null until the
    // async assignment rules run, in which case the touch is initially unowned).
    const { autoEnrollLeadIntoSequences } = await import("@/lib/sequences-auto-enroll")
    await autoEnrollLeadIntoSequences({ organizationId: org.id, userId: null, leadId: lead.id, source: lead.source })

    // Keep the success envelope independent of tenant existence. Returning the
    // database id only for a real slug turned the old "generic" response into
    // an organization-enumeration oracle.
    return acceptedLead()
    }) // end runWithTenant (tenant-scoped handler body)
  } catch (error) {
    if (reservation?.allowed && !keepReservation) {
      await releasePublicActionReservation(reservation)
    }
    if (error instanceof z.ZodError) {
      return leadJson({
        success: false,
        error: "Validation failed",
        details: error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      }, 400)
    }
    return leadJson({ success: false, error: "Internal server error" }, 500)
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
