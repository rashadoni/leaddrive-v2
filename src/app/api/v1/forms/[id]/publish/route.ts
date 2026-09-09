import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { validateFormDefinition } from "@/lib/form-builder/validate-definition"

/**
 * P8 No-Code Form Builder — slice-2 publish gate.
 *
 * POST /api/v1/forms/[id]/publish
 *   Flips status: draft → published. Enforces:
 *     - fields is a non-empty array (publishing an empty form
 *       would create a useless public URL)
 *     - fields passes the full `validateFormDefinition` check
 *       (prevents publishing a form that would 500 on submit)
 *
 *   On success stamps `publishedAt` if first publish.
 *
 *   Idempotent on already-published rows — returns 200 with the
 *   row, no changes.
 *
 *   Auth: session-only (withRls keeps an explicit `if (!session)` gate).
 */

export const POST = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const existing = await prisma.formDefinition.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Already-published is idempotent.
  if (existing.status === "published") {
    return NextResponse.json({ success: true, data: existing })
  }

  // Archived → published is a re-publish; we allow it but log.
  if (existing.status === "archived") {
    console.log(`[forms/publish] re-publishing archived form ${id} for org ${orgId}`)
  }

  // Validate fields.
  const result = validateFormDefinition(existing.fields)
  if (!result.ok) {
    return NextResponse.json(
      { error: "Form fields are invalid; fix and retry", details: result.errors },
      { status: 400 },
    )
  }

  try {
    const updated = await prisma.formDefinition.update({
      where: { id },
      data: {
        status: "published",
        publishedAt: existing.publishedAt ?? new Date(),
      },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[forms/publish] POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
