import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"

/**
 * Bulk-actions endpoint for the leads list page.
 *
 * Roadmap #19 Phase C — mirrors `/api/v1/deals/bulk` shape so the
 * front-end's `<EntityBulkBar>` stays consistent across entities.
 *
 * Supported actions (v1):
 *   - delete         — bulk delete (re-checks leads:delete permission)
 *   - update_status  — bulk-set status (new/contacted/qualified/lost; for
 *                      converted use the lead → deal conversion endpoint,
 *                      not bulk)
 *   - reassign       — bulk-assign owner (value = userId; "" = unassign)
 *
 * Convert-to-deal is intentionally NOT a bulk action — each conversion
 * needs a deal record with its own value/probability/stage, which can't
 * be derived bulk-safely without per-lead context. Use the per-row
 * convert button (existing UX).
 */

// Lead.status enum from the model docstring. `converted` excluded from
// bulk-set because the dedicated convert endpoint creates the deal record.
const STATUS_VALUES = ["new", "contacted", "qualified", "lost"] as const

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["delete", "update_status", "reassign"]),
  value: z.string().optional(),
})

export const POST = withRlsAuth("leads", "write", async (req: NextRequest, authResult) => {
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
        // RBAC-equivalent to the prior inner requireAuth(…,"leads","delete");
        // outer withRlsAuth already did authenticate/org/module/2FA — only the
        // delete-action gate is new. 403 shape matches requireAuth verbatim.
        if (!checkPermission(authResult.role, "leads", "delete")) {
          return NextResponse.json(
            { error: "Forbidden", message: `Role "${authResult.role}" cannot "delete" on "leads"` },
            { status: 403 },
          )
        }
        const result = await prisma.lead.deleteMany({ where })
        logAudit(orgId, "bulk_delete", "lead", ids.join(","), `Deleted ${result.count} leads`)
        // Drop social-mention back-references to the deleted leads (no FK → not auto-nulled).
        await clearDeletedMentionRefs(orgId, "leadId", ids)
        await clearTaskRelationsMany(orgId, "lead", ids)
        break
      }

      case "update_status": {
        // Reject `converted` with a hand-holding message — the
        // conversion endpoint per row creates the deal with its own
        // value/probability/stage, which can't be derived bulk-safely.
        if (value === "converted") {
          return NextResponse.json(
            { error: "Use POST /api/v1/leads/[id]/convert per row to set status=converted (creates a deal record)." },
            { status: 400 },
          )
        }
        if (!value || !STATUS_VALUES.includes(value as typeof STATUS_VALUES[number])) {
          return NextResponse.json(
            { error: `value must be one of: ${STATUS_VALUES.join(", ")}` },
            { status: 400 },
          )
        }
        const result = await prisma.lead.updateMany({ where, data: { status: value } })
        logAudit(orgId, "bulk_update", "lead", ids.join(","), `Updated ${result.count} leads to status "${value}"`)
        break
      }

      case "reassign": {
        // `value === ""` clears the assignedTo FK (lead.assignedTo: String?)
        const newOwner = value && value.length > 0 ? value : null
        const result = await prisma.lead.updateMany({
          where,
          data: { assignedTo: newOwner },
        })
        logAudit(orgId, "bulk_update", "lead", ids.join(","), `Reassigned ${result.count} leads to ${newOwner ?? "unassigned"}`)
        break
      }
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Leads Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
