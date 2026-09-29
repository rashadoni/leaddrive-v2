import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { fireWebhooks } from "@/lib/webhooks"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { updateLeadCommand } from "@/lib/crm-commands/lead/update-lead"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"

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
 *
 * Roadmap C1.13, 2026-09-28: the two write actions run `updateLeadCommand`
 * once per lead — the same command the single-lead route and a voice receipt
 * run. Before that this endpoint wrote through `updateMany` directly, and the
 * difference was not cosmetic:
 *
 *  - it ignored the record filter, so a seller could change leads that are not
 *    theirs and that they cannot even open;
 *  - it accepted any string as the new owner, including a user of another
 *    organisation, because nothing checked membership;
 *  - it wrote no author into the audit row, fired no workflow, notified no new
 *    owner, re-scored nothing and sent no webhook, so an integration never
 *    learned that fifty leads had changed hands;
 *  - it answered `affected: ids.length` without looking at how many rows were
 *    actually written.
 *
 * A hundred leads therefore cost a hundred small transactions. That is the
 * price of the guarantees above, and the endpoint is capped at a hundred ids.
 */

// Lead.status enum from the model docstring. `converted` excluded from
// bulk-set because the dedicated convert endpoint creates the deal record.
const STATUS_VALUES = ["new", "contacted", "qualified", "lost"] as const

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["delete", "update_status", "reassign"]),
  value: z.string().optional(),
})

type BulkFailure = { id: string; code: string }

/** Run one command per lead, and report honestly what happened to each. */
async function applyToEach(
  ids: readonly string[],
  actor: ReturnType<typeof createRestActorContext>,
  data: Record<string, unknown>,
): Promise<{ updated: number; failures: BulkFailure[] }> {
  let updated = 0
  const failures: BulkFailure[] = []
  for (const id of ids) {
    try {
      await updateLeadCommand(actor, id, data)
      updated += 1
    } catch (error) {
      // A lead the caller may not see is `NOT_FOUND`, exactly as it is on the
      // single-lead route. One unreachable lead does not abandon the rest.
      const code = error instanceof CrmCommandError ? error.code : "INTERNAL"
      if (!(error instanceof CrmCommandError)) console.error("[Leads Bulk]", id, error)
      failures.push({ id, code })
    }
  }
  return { updated, failures }
}

export const POST = withRlsAuth("leads", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { ids, action, value } = parsed.data
  const actor = createRestActorContext({
    organizationId: orgId,
    userId: authResult.userId,
    role: authResult.role,
    requestId: req.headers.get("x-request-id"),
  })

  try {
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
        // The same record filter the single-lead DELETE applies: without it a
        // seller could delete leads they cannot see.
        const where = await applyRecordFilter(orgId, authResult.userId ?? "", authResult.role, "lead", {
          id: { in: ids },
          organizationId: orgId,
        })
        const deletable = await prisma.lead.findMany({
          where,
          select: { id: true, contactName: true },
        })
        const deletableIds = deletable.map((lead: { id: string }) => lead.id)
        if (deletableIds.length === 0) {
          return NextResponse.json({ success: true, affected: 0, failed: ids.map((id) => ({ id, code: "NOT_FOUND" })) })
        }
        const result = await prisma.lead.deleteMany({
          where: { id: { in: deletableIds }, organizationId: orgId },
        })
        logAudit(orgId, "bulk_delete", "lead", deletableIds.join(","), `Deleted ${result.count} leads`, {
          userId: authResult.userId ?? undefined,
        })
        // The single-lead route announces each deletion; an integration that
        // only hears about one-by-one deletions has an incomplete picture.
        for (const lead of deletable) {
          fireWebhooks(orgId, "lead.deleted", { id: lead.id, contactName: lead.contactName }).catch(() => {})
        }
        // Drop social-mention back-references to the deleted leads (no FK → not auto-nulled).
        await clearDeletedMentionRefs(orgId, "leadId", deletableIds)
        await clearTaskRelationsMany(orgId, "lead", deletableIds)
        return NextResponse.json({
          success: true,
          affected: result.count,
          failed: ids.filter((id) => !deletableIds.includes(id)).map((id) => ({ id, code: "NOT_FOUND" })),
        })
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
        const { updated, failures } = await applyToEach(ids, actor, { status: value })
        logAudit(orgId, "bulk_update", "lead", ids.join(","), `Updated ${updated} leads to status "${value}"`, {
          userId: authResult.userId ?? undefined,
        })
        return NextResponse.json({ success: true, affected: updated, failed: failures })
      }

      case "reassign": {
        // `value === ""` clears the assignedTo FK (lead.assignedTo: String?).
        // A non-empty value is checked against active members of this
        // organisation inside the command, so a foreign user id is refused
        // rather than written.
        const newOwner = value && value.length > 0 ? value : null
        const { updated, failures } = await applyToEach(ids, actor, { assignedTo: newOwner })
        logAudit(orgId, "bulk_update", "lead", ids.join(","), `Reassigned ${updated} leads to ${newOwner ?? "unassigned"}`, {
          userId: authResult.userId ?? undefined,
        })
        return NextResponse.json({ success: true, affected: updated, failed: failures })
      }
    }

    return NextResponse.json({ success: true, affected: 0 })
  } catch (e) {
    console.error("[Leads Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
