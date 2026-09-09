import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { validateFormDefinition } from "@/lib/form-builder/validate-definition"
import { FORM_STATUSES, type FormStatus } from "@/lib/form-builder/types"

/**
 * P8 No-Code Form Builder — slice-2 form CRUD list/create.
 *
 * GET /api/v1/forms — list org's forms (newest first).
 * POST /api/v1/forms — create a new draft form. Validates fields via
 *   `validateFormDefinition` before insert. Returns 201 with row.
 *
 * Auth: session-only (the builder UI is dashboard-bound; API-key
 * clients use a separate route in slice-3 if needed). withRls would
 * resolve a non-session principal via getOrgId fallback, so each
 * handler keeps an explicit `if (!session)` gate to stay session-only.
 *
 * Slug uniqueness is per-org (DB unique index); a 409 is returned on
 * conflict.
 */

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

// Length caps for free-text columns. Slice-2 lacks `@db.VarChar(n)`
// in the schema (everything is `String?`), so the route is the only
// gate against runaway payloads. 2048 is generous for description /
// message text but blocks a malicious 100MB blob.
const MAX_DESCRIPTION = 2048
const MAX_MESSAGE = 2048
const MAX_URL = 2048
const MAX_NOTIFY_EMAILS = 1024

function isValidUrl(s: string): boolean {
  if (s.length === 0) return true // optional field — empty is fine
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  if (status && !FORM_STATUSES.includes(status as FormStatus)) {
    return NextResponse.json(
      { error: `Unknown status "${status}". Use one of: ${FORM_STATUSES.join(", ")}` },
      { status: 400 },
    )
  }

  try {
    const rows = await prisma.formDefinition.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status: status as FormStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json({ success: true, data: { forms: rows } })
  } catch (e) {
    console.error("[forms] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const name = typeof b.name === "string" ? b.name.trim() : ""
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
  if (name.length > 255) return NextResponse.json({ error: "name exceeds 255 chars" }, { status: 400 })

  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : ""
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      {
        error:
          "slug must be lowercase alphanumeric with optional dashes, 1-64 chars total, starts and ends with alphanumeric (e.g. 'contact', 'lead-form-2026')",
      },
      { status: 400 },
    )
  }

  const description = typeof b.description === "string" ? b.description : null
  if (description !== null && description.length > MAX_DESCRIPTION) {
    return NextResponse.json({ error: `description exceeds ${MAX_DESCRIPTION} chars` }, { status: 400 })
  }
  const successMessage = typeof b.successMessage === "string" ? b.successMessage : null
  if (successMessage !== null && successMessage.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `successMessage exceeds ${MAX_MESSAGE} chars` }, { status: 400 })
  }
  const redirectUrl = typeof b.redirectUrl === "string" ? b.redirectUrl : null
  if (redirectUrl !== null) {
    if (redirectUrl.length > MAX_URL) {
      return NextResponse.json({ error: `redirectUrl exceeds ${MAX_URL} chars` }, { status: 400 })
    }
    if (!isValidUrl(redirectUrl)) {
      return NextResponse.json({ error: "redirectUrl must be a valid http(s) URL" }, { status: 400 })
    }
  }
  const notifyEmails = typeof b.notifyEmails === "string" ? b.notifyEmails : null
  if (notifyEmails !== null && notifyEmails.length > MAX_NOTIFY_EMAILS) {
    return NextResponse.json({ error: `notifyEmails exceeds ${MAX_NOTIFY_EMAILS} chars` }, { status: 400 })
  }
  const leadAutoCreate = b.leadAutoCreate === true

  // fields: optional on create; draft can be empty fields. But if
  // provided, validate up-front.
  let fieldsToStore: unknown = []
  if (b.fields !== undefined) {
    const result = validateFormDefinition(b.fields)
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid fields", details: result.errors }, { status: 400 })
    }
    fieldsToStore = result.cleanFields
  }

  try {
    const created = await prisma.formDefinition.create({
      data: {
        organizationId: orgId,
        name,
        slug,
        description,
        fields: fieldsToStore as never, // JSONB
        status: "draft",
        successMessage,
        redirectUrl,
        notifyEmails,
        leadAutoCreate,
        createdBy: session.userId || "system",
      },
    })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "slug already exists in this organization" }, { status: 409 })
    }
    console.error("[forms] POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
