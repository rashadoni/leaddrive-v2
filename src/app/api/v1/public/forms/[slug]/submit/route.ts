import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { runWithTenant } from "@/lib/rls-context"
import { validateSubmission } from "@/lib/form-builder/validate-submission"
import type { FormFieldSchema } from "@/lib/form-builder/types"
import { ipFromRequest } from "@/lib/audit/compliance-audit"
import { recordTouchpointsSafe, touchpointSourceKey } from "@/lib/marketing-attribution/touchpoint-recorder"
import { isValidVisitorId } from "@/lib/web-tracking"
import { stitchByEmail } from "@/lib/web-tracking-identity"
import { normalizeEmail } from "@/lib/activity-capture/matcher"

/**
 * P8 No-Code Form Builder — slice-2 public submission endpoint.
 *
 * POST /api/v1/public/forms/[slug]/submit?org=<organizationId>
 *
 *   Body: { values: Record<string, unknown> }
 *
 *   1) Look up the form by (org, slug). Must be PUBLISHED.
 *   2) Validate `values` against the form's fields via slice-1
 *      `validateSubmission`.
 *   3) Persist a `FormSubmission` row with `formDefinitionId` set
 *      and `landingPageId` null (XOR enforced at DB + here).
 *   4) Increment totalSubmissions atomically.
 *   5) If `leadAutoCreate`, create a Lead with name + email + phone
 *      mapped from normalized data (best-effort; missing email/phone
 *      doesn't block the submission).
 *
 *   Public route — no auth. Rate-limiting deferred to slice-3 (per
 *   the rate-limit-policy.md backlog).
 *
 * Returns:
 *   { success: true, data: { submissionId, redirectUrl?, successMessage? } }
 *   200 on success. 400 on validation failure (errors array included).
 *   404 on missing/unpublished form.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  // F-34: unauthenticated write with no ceiling. Every call writes a form submission and records marketing touchpoints.
  //
  // Same guard and same fail-closed choice as public/leads, which the 2026-08
  // pentest hardened: if the limiter cannot answer, the request is refused
  // rather than waved through. An abuse guard that opens when its backing store
  // blinks is an abuse guard an attacker takes down first.
  const ip = clientIp(req)
  const ipLimit = await consumePublicRateLimit("form-builder-submit:ip", ip, { maxRequests: 20, windowSeconds: 600 })
  if (ipLimit.unavailable) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 })
  }
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
    )
  }

  const { slug } = await ctx.params
  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("org") || ""

  if (!organizationId) {
    return NextResponse.json({ error: "org parameter is required" }, { status: 400 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
  }
  const values = (body as { values?: unknown }).values
  if (!values || typeof values !== "object") {
    return NextResponse.json({ error: "Body must include a 'values' object" }, { status: 400 })
  }
  // C2: the snippet may include its anonymous visitorId so the submitter's prior
  // web sessions stitch onto the contact this form resolves. Optional + ignored
  // if malformed — form submission never depends on it.
  const rawVisitorId = (body as { visitorId?: unknown }).visitorId
  const visitorId = isValidVisitorId(rawVisitorId) ? rawVisitorId : null

  try {
    // RLS: org id arrives as a query param and the form lookup is already
    // org-scoped — the whole handler runs tenant-scoped.
    return await runWithTenant(organizationId, async () => {
    const form = await prisma.formDefinition.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    })
    if (!form || form.status !== "published") {
      return NextResponse.json({ error: "Form not found" }, { status: 404 })
    }

    const fields = form.fields as unknown as FormFieldSchema[]
    if (!Array.isArray(fields) || fields.length === 0) {
      // This shouldn't happen — publish gate enforces non-empty
      // fields. Returning 409 (not 500): a published form with no
      // fields is a data-integrity drift, not a server fault from
      // the caller's perspective. 5xx would page on-call for what
      // is really an admin-side fix.
      return NextResponse.json({ error: "Form is misconfigured (no fields)" }, { status: 409 })
    }

    const result = validateSubmission(fields, values)
    if (!result.ok) {
      return NextResponse.json({ error: "Validation failed", details: result.errors }, { status: 400 })
    }

    // IP capture mirrors `ipFromRequest` convention used in audit
    // logging — falls back to x-real-ip when x-forwarded-for is
    // absent (nginx-only deployments). Plain xff-only would record
    // null IP for every submission in those topologies.
    const ipAddress = ipFromRequest(req)

    // Persist + counter in a transaction (atomic pair). Auto-Lead
    // is intentionally OUTSIDE the transaction — Lead creation can
    // fail (e.g. validation on lead-engine downstream) and we
    // explicitly do NOT want a Lead failure to roll back the
    // submission. Putting the Lead try/catch inside the tx was a
    // Prisma footgun (post-failure tx work is undefined behavior).
    const submission = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const sub = await tx.formSubmission.create({
        data: {
          organizationId,
          formDefinitionId: form.id,
          formData: result.normalizedData as never,
          ipAddress,
          source: "form_builder",
        },
      })
      await tx.formDefinition.update({
        where: { id: form.id },
        data: { totalSubmissions: { increment: 1 } },
      })
      return sub
    })

    // Optional auto-Lead, outside the transaction.
    //
    // Key mapping contract: form field keys MUST be one of
    // {email | phone | name | fullName} for auto-Lead to pick them
    // up. Forms using {first_name, mobile, e_mail} will succeed at
    // the submission layer but produce no Lead — this is a known
    // limitation, callers see it in the Lead-count vs Submission-
    // count delta. Slice-3 may add a per-FormDefinition
    // `leadFieldMap` to make the mapping configurable.
    if (form.leadAutoCreate) {
      const nd = result.normalizedData
      const email = pickString(nd.email)
      const phone = pickString(nd.phone)
      const name = pickString(nd.name) || pickString(nd.fullName)
      // Lead requires at least an email or a phone — skip silently
      // if neither is present (don't fail on a name-only form).
      if (email || phone) {
        try {
          const lead = await prisma.lead.create({
            data: {
              organizationId,
              contactName: name || email || phone || "Form lead",
              email: email || null,
              phone: phone || null,
              source: `form:${form.slug}`,
              status: "new",
            },
          })
          await prisma.formSubmission.update({
            where: { id: submission.id },
            data: { leadId: lead.id },
          })
        } catch (leadErr) {
          // Lead-creation failure does NOT abort the submission.
          // User gets a successful confirmation; ops sees the warn
          // in logs.
          console.warn(`[public/forms/:slug/submit] lead auto-create failed for form ${form.slug}:`, leadErr)
        }
      }
    }

    // C9 #15 — attribution touchpoint for a campaign-linked form. Needs the
    // form tied to a campaign + a known contact (anonymous submitters whose
    // email matches no contact produce no touchpoint, mirroring the event hook).
    // Idempotent via sourceKey; never blocks the user-facing submission.
    if (form.campaignId) {
      const email = pickString(result.normalizedData.email)
      if (email) {
        try {
          const contact = await prisma.contact.findFirst({
            where: { organizationId, email },
            select: { id: true },
          })
          if (contact) {
            void recordTouchpointsSafe(organizationId, [{
              contactId: contact.id,
              campaignId: form.campaignId,
              channel: "web",
              touchpointType: "form_submitted",
              occurredAt: submission.createdAt ?? new Date(),
              sourceKey: touchpointSourceKey.formSubmitted(submission.id),
              metadata: { formDefinitionId: form.id, slug: form.slug },
            }])
          }
        } catch (tpErr) {
          console.warn(`[public/forms/:slug/submit] touchpoint record failed for form ${form.slug}:`, tpErr)
        }
      }
    }

    // C2 identity stitching — server-trusted path (the submitter typed their own
    // email, so no enumeration risk). Bind the visitor's anonymous history to a
    // contact matched by email. No contact match (e.g. only a Lead was created)
    // → nothing to stitch, silently skipped. Fire-and-forget like the C9
    // touchpoint above — bookkeeping must not delay the submitter's response
    // (the promise is created inside the runWithTenant scope, so it inherits
    // the ALS tenant context).
    if (visitorId) {
      const normalized = normalizeEmail(pickString(result.normalizedData.email))
      if (normalized) {
        void stitchByEmail(prisma, { organizationId, visitorId, email: normalized }).catch((stitchErr) => {
          console.warn(`[public/forms/:slug/submit] web-tracking stitch failed for form ${form.slug}:`, stitchErr)
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        submissionId: submission.id,
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
      },
    })
    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e) {
    console.error("[public/forms/:slug/submit] POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

function pickString(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}
