import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { runWithTenant } from "@/lib/rls-context"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

const formSubmitSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
  orgId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  // Accept flat fields OR nested formData object
  name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
  formData: z.record(z.string(), z.any()).optional(),
}).passthrough().refine(data => data.orgId || data.organizationId, {
  message: "orgId or organizationId is required",
})

export async function POST(req: NextRequest) {
  // F-34: unauthenticated write with no ceiling. Every call writes a lead into a tenant's CRM and can trigger assignment rules.
  //
  // Same guard and same fail-closed choice as public/leads, which the 2026-08
  // pentest hardened: if the limiter cannot answer, the request is refused
  // rather than waved through. An abuse guard that opens when its backing store
  // blinks is an abuse guard an attacker takes down first.
  const ip = clientIp(req)
  const ipLimit = await consumePublicRateLimit("form-submit:ip", ip, { maxRequests: 20, windowSeconds: 600 })
  // CORS headers on these two exits as well: this endpoint is embedded on
  // customer websites with Allow-Origin *, and a 429 without them reaches the
  // visitor's browser as an opaque network failure rather than "slow down".
  if (ipLimit.unavailable) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503, headers: corsHeaders })
  }
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(ipLimit.retryAfterSeconds) } },
    )
  }

  try {
    const body = await req.json()
    const parsed = formSubmitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400, headers: corsHeaders }
      )
    }

    const raw = parsed.data
    // Normalize: accept orgId or organizationId
    const orgId = raw.orgId || raw.organizationId!
    const pageId = raw.pageId
    // Normalize: accept flat fields or nested formData
    const fd = raw.formData || {}
    const name = raw.name || fd.name
    const email = raw.email || fd.email
    const phone = raw.phone || fd.phone
    const company = raw.company || fd.company
    const extra = { ...fd }
    delete extra.name; delete extra.email; delete extra.phone; delete extra.company

    // RLS: orgId arrives in the payload, so the whole handler (including the
    // page-existence check, which validates pageId WITHIN that org) runs
    // tenant-scoped — a bogus orgId simply finds no page → 404.
    return await runWithTenant(orgId, async () => {
    // Validate page exists and is published
    const page = await prisma.landingPage.findFirst({
      where: { id: pageId, organizationId: orgId, status: "published" },
    })
    if (!page) {
      return NextResponse.json(
        { error: "Page not found or not published" },
        { status: 404, headers: corsHeaders }
      )
    }

    // Reuse the trusted address the rate limiter already decided on, rather
    // than re-reading a header the submitter controls — otherwise the row we
    // keep as evidence records whatever the caller claimed.
    const recordedIp = ip === "unknown" ? undefined : ip

    // Use transaction to create submission + lead atomically
    const result = await prisma.$transaction(async (tx: any) => {
      // Create FormSubmission
      const submission = await tx.formSubmission.create({
        data: {
          organizationId: page.organizationId,
          landingPageId: page.id,
          formData: { name, email, phone, company, ...extra },
          source: "landing_page",
          ipAddress: recordedIp,
        },
      })

      // Create Lead
      const lead = await tx.lead.create({
        data: {
          organizationId: page.organizationId,
          contactName: name || email || "Unknown",
          companyName: company || undefined,
          email: email || undefined,
          phone: phone || undefined,
          source: "landing_page",
          notes: `From landing page: ${page.name}`,
          status: "new",
          priority: "medium",
        },
      })

      // Link submission to lead
      await tx.formSubmission.update({
        where: { id: submission.id },
        data: { leadId: lead.id },
      })

      // Increment page totalSubmissions
      await tx.landingPage.update({
        where: { id: page.id },
        data: { totalSubmissions: { increment: 1 } },
      })

      return { submission, lead }
    })

    // Apply lead assignment rules (non-blocking, outside transaction)
    applyLeadAssignmentRules(page.organizationId, result.lead).catch((e) => {
      console.error("[FORM-SUBMIT] Assignment rules error:", e?.message)
    })

    // Auto-enroll into sequences watching source='landing_page' (never throws;
    // awaited inside the tenant scope). No authenticated user → owner from assignee.
    const { autoEnrollLeadIntoSequences } = await import("@/lib/sequences-auto-enroll")
    await autoEnrollLeadIntoSequences({ organizationId: page.organizationId, userId: null, leadId: result.lead.id, source: result.lead.source })

    return NextResponse.json(
      { success: true },
      { status: 201, headers: corsHeaders }
    )
    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e: any) {
    console.error("[FORM-SUBMIT] error:", e?.message)
    return NextResponse.json(
      { error: "Failed to submit form" },
      { status: 500, headers: corsHeaders }
    )
  }
}
