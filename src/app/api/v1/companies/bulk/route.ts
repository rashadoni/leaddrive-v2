import { NextRequest, NextResponse } from "next/server"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"

/**
 * Bulk-actions endpoint for the companies list page.
 *
 * Roadmap #19 Phase D — mirrors `/api/v1/leads/bulk` and
 * `/api/v1/deals/bulk` so the front-end's `<EntityBulkBar>` stays
 * consistent across entities.
 *
 * Supported actions (v1):
 *   - delete         — bulk delete (re-checks companies:delete permission)
 *   - update_status  — bulk-set status (active/inactive/prospect)
 *   - update_category — bulk-set category (client/partner/prospect/inactive)
 *
 * Reassign deliberately omitted — Company has no direct `assignedTo` FK
 * (ownership is via the user's territory / sharing rules, not a column).
 * If per-account ownership is added later (e.g. accountOwnerId), wire it
 * here alongside an `_assigned` action.
 */

const STATUS_VALUES = ["active", "inactive", "prospect"] as const
const CATEGORY_VALUES = ["client", "partner", "prospect", "inactive"] as const

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["delete", "update_status", "update_category"]),
  value: z.string().optional(),
})

export const POST = withRlsAuth("companies", "write", async (req: NextRequest, authResult) => {
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
        // RBAC-equivalent to the prior inner requireAuth(…,"companies","delete");
        // outer withRlsAuth already did authenticate/org/module/2FA — only the
        // delete-action gate is new. 403 shape matches requireAuth verbatim.
        if (!checkPermission(authResult.role, "companies", "delete")) {
          return NextResponse.json(
            { error: "Forbidden", message: `Role "${authResult.role}" cannot "delete" on "companies"` },
            { status: 403 },
          )
        }
        const result = await prisma.company.deleteMany({ where })
        logAudit(orgId, "bulk_delete", "company", ids.join(","), `Deleted ${result.count} companies`)
        await clearTaskRelationsMany(orgId, "company", ids)
        break
      }

      case "update_status": {
        if (!value || !STATUS_VALUES.includes(value as typeof STATUS_VALUES[number])) {
          return NextResponse.json(
            { error: `value must be one of: ${STATUS_VALUES.join(", ")}` },
            { status: 400 },
          )
        }
        const result = await prisma.company.updateMany({ where, data: { status: value } })
        logAudit(orgId, "bulk_update", "company", ids.join(","), `Updated ${result.count} companies to status "${value}"`)
        break
      }

      case "update_category": {
        if (!value || !CATEGORY_VALUES.includes(value as typeof CATEGORY_VALUES[number])) {
          return NextResponse.json(
            { error: `value must be one of: ${CATEGORY_VALUES.join(", ")}` },
            { status: 400 },
          )
        }
        const result = await prisma.company.updateMany({ where, data: { category: value } })
        logAudit(orgId, "bulk_update", "company", ids.join(","), `Updated ${result.count} companies to category "${value}"`)
        break
      }
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Companies Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
