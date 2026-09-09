import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { validateFormDefinition } from "@/lib/form-builder/validate-definition"
import { FORM_STATUSES, type FormStatus } from "@/lib/form-builder/types"

/**
 * P8 No-Code Form Builder — slice-2 individual form route.
 *
 * GET /api/v1/forms/[id] — fetch one (org-scoped).
 * PUT /api/v1/forms/[id] — update name/description/fields/etc.
 *   When `fields` is set, validates via `validateFormDefinition`.
 *   `status` here only supports draft ↔ archived transitions; use
 *   POST /publish to flip draft→published (publish enforces
 *   non-empty fields).
 *   **slug is immutable after create** — embeds + published URLs
 *   pin to the slug, so a rename would break every external link.
 *   To "rename" a form, archive the current row and create a new
 *   one with the desired slug.
 * DELETE /api/v1/forms/[id] — archive (soft) the form. Hard-delete
 *   would orphan FormSubmission rows even with SetNull cascade and
 *   loses the audit trail; archive is the safe default.
 *
 * Auth: session-only (withRls keeps an explicit `if (!session)` gate —
 * see forms/route.ts). Cross-tenant safety: every query uses
 * `findFirst({ where: { id, organizationId } })` so a mismatched
 * org silently 404s instead of leaking the existence of another
 * tenant's form.
 */

const MAX_DESCRIPTION = 2048
const MAX_MESSAGE = 2048
const MAX_URL = 2048
const MAX_NOTIFY_EMAILS = 1024

function isValidUrl(s: string): boolean {
  if (s.length === 0) return true
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  try {
    const row = await prisma.formDefinition.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: row })
  } catch (e) {
    console.error("[forms/:id] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  // Cross-tenant guard.
  const existing = await prisma.formDefinition.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 })
    }
    data.name = b.name.trim()
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") {
      return NextResponse.json({ error: "description must be a string or null" }, { status: 400 })
    }
    if (typeof b.description === "string" && b.description.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: `description exceeds ${MAX_DESCRIPTION} chars` }, { status: 400 })
    }
    data.description = b.description
  }
  if (b.successMessage !== undefined) {
    if (b.successMessage !== null && typeof b.successMessage !== "string") {
      return NextResponse.json({ error: "successMessage must be a string or null" }, { status: 400 })
    }
    if (typeof b.successMessage === "string" && b.successMessage.length > MAX_MESSAGE) {
      return NextResponse.json({ error: `successMessage exceeds ${MAX_MESSAGE} chars` }, { status: 400 })
    }
    data.successMessage = b.successMessage
  }
  if (b.redirectUrl !== undefined) {
    if (b.redirectUrl !== null && typeof b.redirectUrl !== "string") {
      return NextResponse.json({ error: "redirectUrl must be a string or null" }, { status: 400 })
    }
    if (typeof b.redirectUrl === "string") {
      if (b.redirectUrl.length > MAX_URL) {
        return NextResponse.json({ error: `redirectUrl exceeds ${MAX_URL} chars` }, { status: 400 })
      }
      if (!isValidUrl(b.redirectUrl)) {
        return NextResponse.json({ error: "redirectUrl must be a valid http(s) URL" }, { status: 400 })
      }
    }
    data.redirectUrl = b.redirectUrl
  }
  if (b.notifyEmails !== undefined) {
    if (b.notifyEmails !== null && typeof b.notifyEmails !== "string") {
      return NextResponse.json({ error: "notifyEmails must be a string or null" }, { status: 400 })
    }
    if (typeof b.notifyEmails === "string" && b.notifyEmails.length > MAX_NOTIFY_EMAILS) {
      return NextResponse.json({ error: `notifyEmails exceeds ${MAX_NOTIFY_EMAILS} chars` }, { status: 400 })
    }
    data.notifyEmails = b.notifyEmails
  }
  if (b.leadAutoCreate !== undefined) {
    if (typeof b.leadAutoCreate !== "boolean") {
      return NextResponse.json({ error: "leadAutoCreate must be a boolean" }, { status: 400 })
    }
    data.leadAutoCreate = b.leadAutoCreate
  }
  // C9 #15 — link the form to a campaign (or null to unlink). A submission on a
  // campaign-linked form records a `form_submitted` attribution touchpoint.
  if (b.campaignId !== undefined) {
    if (b.campaignId !== null && typeof b.campaignId !== "string") {
      return NextResponse.json({ error: "campaignId must be a string or null" }, { status: 400 })
    }
    if (typeof b.campaignId === "string") {
      // Org-ownership guard: only link to a campaign in this org.
      const camp = await prisma.campaign.findFirst({
        where: { id: b.campaignId, organizationId: orgId },
        select: { id: true },
      })
      if (!camp) return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 })
    }
    data.campaignId = b.campaignId
  }
  if (b.status !== undefined) {
    if (!FORM_STATUSES.includes(b.status as FormStatus)) {
      return NextResponse.json({ error: `status must be one of: ${FORM_STATUSES.join(", ")}` }, { status: 400 })
    }
    // Block direct draft → published via PUT; require POST /publish so
    // the field-validation gate is mandatory.
    if (b.status === "published" && existing.status !== "published") {
      return NextResponse.json(
        { error: "Use POST /api/v1/forms/:id/publish to publish a form (validates fields)" },
        { status: 400 },
      )
    }
    data.status = b.status as FormStatus
  }
  if (b.fields !== undefined) {
    const result = validateFormDefinition(b.fields)
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid fields", details: result.errors }, { status: 400 })
    }
    data.fields = result.cleanFields
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No updatable fields in body" }, { status: 400 })
  }

  try {
    const updated = await prisma.formDefinition.update({
      where: { id },
      data,
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[forms/:id] PUT error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  // Cross-tenant guard.
  const existing = await prisma.formDefinition.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    // Archive (soft delete) — preserves submissions analytics +
    // re-publish path. Hard delete would orphan FormSubmission
    // rows even with SetNull cascade and lose the audit trail.
    const archived = await prisma.formDefinition.update({
      where: { id },
      data: { status: "archived" },
    })
    return NextResponse.json({ success: true, data: archived })
  } catch (e) {
    console.error("[forms/:id] DELETE error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
