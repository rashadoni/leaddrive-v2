import { NextResponse } from "next/server"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"

/**
 * @deprecated Use POST `/api/v1/contacts/bulk` with `{ action: "delete", ids }`
 * for new integrations — the new endpoint supports the full action set
 * (delete / update_category / update_source / set_active / add_tag /
 * remove_tag) and is the one the UI calls. This route stays as a
 * backward-compat alias so any external scripts hitting the old URL
 * keep working. Will be removed once we've verified no external callers
 * remain (telemetry first; do not delete blindly).
 */

const schema = z.object({
  ids: z.array(z.string()).min(1, "Select at least one contact"),
})

export const POST = withRls(async (req, { orgId }) => {
  // Deprecation telemetry — log every call so we can later assess whether
  // any external integration still depends on this URL before removing it.
  // Architect P2 from Phase E/F review.
  const caller = req.headers.get("x-forwarded-for") || req.headers.get("user-agent") || "unknown"
  console.warn(`[deprecated] POST /api/v1/contacts/bulk-delete called by ${caller} — migrate to /api/v1/contacts/bulk with {action:"delete"}`)

  try {
    const body = await req.json()
    const { ids } = schema.parse(body)

    const result = await prisma.contact.deleteMany({
      where: {
        id: { in: ids },
        organizationId: orgId,
      },
    })
    // Null out tasks linked to the deleted contacts (no FK → not auto-nulled).
    await clearTaskRelationsMany(orgId, "contact", ids)

    return NextResponse.json({
      success: true,
      data: { deleted: result.count },
    })
  } catch (e: any) {
    if (e.name === "ZodError") {
      return NextResponse.json({ error: e.issues?.[0]?.message || "Validation error" }, { status: 400 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
