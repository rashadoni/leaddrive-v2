import { NextRequest, NextResponse } from "next/server"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"

/**
 * Bulk-actions endpoint for the contacts list page.
 *
 * Roadmap #19 Phase E — extends the multi-action shape used by deals,
 * leads, and companies bulk endpoints. Supersedes the older
 * `/api/v1/contacts/bulk-delete` (kept for backward compat — any
 * external integration still hitting the old URL keeps working).
 *
 * Supported actions:
 *   - delete           — bulk delete (re-checks contacts:delete permission)
 *   - update_category  — vip | regular | partner | prospect | inactive
 *   - update_source    — website | referral | cold_call | sms | email
 *                        | social | event | other
 *   - set_active       — true/false (value="true"|"false")
 *   - add_tag          — append a string to tags[] (idempotent — no dup)
 *   - remove_tag       — remove a string from tags[]
 *
 * Reassign deliberately omitted — Contact has no `assignedTo` FK (just
 * like Company; ownership comes via sharing rules / company FK).
 */

const CATEGORY_VALUES = ["vip", "regular", "partner", "prospect", "inactive"] as const
const SOURCE_VALUES = [
  "website", "referral", "cold_call", "sms", "email", "social", "event", "other",
] as const

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum([
    "delete",
    "update_category",
    "update_source",
    "set_active",
    "add_tag",
    "remove_tag",
  ]),
  value: z.string().optional(),
})

export const POST = withRlsAuth("contacts", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { ids, action, value } = parsed.data

  try {
    const where = { id: { in: ids }, organizationId: orgId }

    switch (action) {
      case "delete": {
        // RBAC-equivalent to the prior inner requireAuth(…,"contacts","delete");
        // outer withRlsAuth already did authenticate/org/module/2FA — only the
        // delete-action gate is new. 403 shape matches requireAuth verbatim.
        if (!checkPermission(authResult.role, "contacts", "delete")) {
          return NextResponse.json(
            { error: "Forbidden", message: `Role "${authResult.role}" cannot "delete" on "contacts"` },
            { status: 403 },
          )
        }
        const result = await prisma.contact.deleteMany({ where })
        logAudit(orgId, "bulk_delete", "contact", ids.join(","), `Deleted ${result.count} contacts`)
        await clearTaskRelationsMany(orgId, "contact", ids)
        break
      }

      case "update_category": {
        if (!value || !CATEGORY_VALUES.includes(value as typeof CATEGORY_VALUES[number])) {
          return NextResponse.json(
            { error: `value must be one of: ${CATEGORY_VALUES.join(", ")}` },
            { status: 400 },
          )
        }
        const result = await prisma.contact.updateMany({ where, data: { category: value } })
        logAudit(orgId, "bulk_update", "contact", ids.join(","), `Updated ${result.count} contacts to category "${value}"`)
        break
      }

      case "update_source": {
        if (!value || !SOURCE_VALUES.includes(value as typeof SOURCE_VALUES[number])) {
          return NextResponse.json(
            { error: `value must be one of: ${SOURCE_VALUES.join(", ")}` },
            { status: 400 },
          )
        }
        const result = await prisma.contact.updateMany({ where, data: { source: value } })
        logAudit(orgId, "bulk_update", "contact", ids.join(","), `Updated ${result.count} contacts to source "${value}"`)
        break
      }

      case "set_active": {
        if (value !== "true" && value !== "false") {
          return NextResponse.json(
            { error: "value must be \"true\" or \"false\"" },
            { status: 400 },
          )
        }
        const isActive = value === "true"
        const result = await prisma.contact.updateMany({ where, data: { isActive } })
        logAudit(orgId, "bulk_update", "contact", ids.join(","), `Set ${result.count} contacts active=${isActive}`)
        break
      }

      case "add_tag": {
        if (!value || value.trim().length === 0) {
          return NextResponse.json({ error: "value (tag) required" }, { status: 400 })
        }
        const tag = value.trim()
        // Atomic idempotent append: `array_append(array_remove(...))` is
        // the textbook race-safe form. The previous `NOT (… = ANY(tags))`
        // guard had a race where two parallel writes could both pass the
        // check and both append, producing a duplicate (architect P2).
        // The remove-then-append form runs inside a single UPDATE
        // expression, so the row is locked for the duration — no window
        // for a concurrent writer to slip in.
        await prisma.$executeRaw`
          UPDATE contacts
          SET tags = array_append(array_remove(tags, ${tag}), ${tag})
          WHERE id = ANY(${ids}::text[])
            AND "organizationId" = ${orgId}
        `
        logAudit(orgId, "bulk_update", "contact", ids.join(","), `Added tag "${tag}" to ${ids.length} contacts`)
        break
      }

      case "remove_tag": {
        if (!value || value.trim().length === 0) {
          return NextResponse.json({ error: "value (tag) required" }, { status: 400 })
        }
        const tag = value.trim()
        await prisma.$executeRaw`
          UPDATE contacts
          SET tags = array_remove(tags, ${tag})
          WHERE id = ANY(${ids}::text[])
            AND "organizationId" = ${orgId}
        `
        logAudit(orgId, "bulk_update", "contact", ids.join(","), `Removed tag "${tag}" from ${ids.length} contacts`)
        break
      }
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Contacts Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
