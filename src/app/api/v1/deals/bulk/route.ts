import { NextRequest, NextResponse } from "next/server"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { fireWebhooks } from "@/lib/webhooks"
import { updateDealCommand } from "@/lib/crm-commands/deal/update-deal"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"

/**
 * Bulk-actions endpoint for the deals list page.
 *
 * Roadmap #19 Phase B — mirrors the shape of `/api/v1/tasks/bulk` so
 * the front-end's `<EntityBulkBar>` can stay consistent across entities.
 *
 * Supported actions (v1):
 *   - delete         — bulk-delete selected deals
 *   - update_stage   — bulk-move to a new stage
 *   - reassign       — bulk-assign a new owner (value = userId; "" = unassign)
 *
 * Org-scoped via `requireAuth` ➜ caller's `orgId` is the only org touched.
 * The `id IN (...)` clauses are further constrained by `organizationId`
 * so a forged id from another tenant is silently dropped (no error leak).
 */

type BulkFailure = { id: string; code: string }

/** Run one command per deal, and report honestly what happened to each. */
async function applyToEach(
  ids: readonly string[],
  actor: ReturnType<typeof createRestActorContext>,
  data: Record<string, unknown>,
): Promise<{ updated: number; failures: BulkFailure[] }> {
  let updated = 0
  const failures: BulkFailure[] = []
  for (const id of ids) {
    try {
      await updateDealCommand(actor, id, data)
      updated += 1
    } catch (error) {
      const code = error instanceof CrmCommandError ? error.code : "INTERNAL"
      if (!(error instanceof CrmCommandError)) console.error("[Deals Bulk]", id, error)
      failures.push({ id, code })
    }
  }
  return { updated, failures }
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["delete", "update_stage", "reassign"]),
  value: z.string().optional(),
})

export const POST = withRlsAuth("deals", "write", async (req: NextRequest, authResult) => {
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
    const where = { id: { in: ids }, organizationId: orgId }

    switch (action) {
      case "delete": {
        // Separate permission re-check — bulk-delete is destructive and a
        // tenant might allow `deals:write` to sales but require `deals:delete`
        // for actually erasing records. Same pattern as `/tasks/bulk`.
        // RBAC-equivalent to the prior inner requireAuth(…,"deals","delete");
        // outer withRlsAuth already did authenticate/org/module/2FA — only the
        // delete-action gate is new. 403 shape matches requireAuth verbatim.
        if (!checkPermission(authResult.role, "deals", "delete")) {
          return NextResponse.json(
            { error: "Forbidden", message: `Role "${authResult.role}" cannot "delete" on "deals"` },
            { status: 403 },
          )
        }
        const result = await prisma.deal.deleteMany({ where })
        logAudit(orgId, "bulk_delete", "deal", ids.join(","), `Deleted ${result.count} deals`)
        fireWebhooks(orgId, "deal.deleted", { ids, count: result.count }).catch(() => {})
        await clearTaskRelationsMany(orgId, "deal", ids)
        break
      }

      case "update_stage": {
        if (!value) {
          return NextResponse.json({ error: "value (stage) is required for update_stage" }, { status: 400 })
        }
        // Roadmap C1.13, 2026-09-28: one `updateDealCommand` per deal, the
        // same command the single-deal PUT and a voice receipt run.
        //
        // The bespoke version recorded stage transitions and exited cadences,
        // and stopped there. Moving twenty deals into the won stage therefore
        // paid no cashback, sent no satisfaction survey, awarded no loyalty
        // points, notified nobody, marked no attribution model for recompute
        // and wrote no activity row — all of which one deal moved by hand
        // does. A bulk action that is a different feature from the button
        // beside it is the defect; the command is the fix.
        const { updated, failures } = await applyToEach(ids, actor, { stage: value })
        logAudit(orgId, "bulk_update", "deal", ids.join(","), `Moved ${updated} deals to stage "${value}"`, {
          userId: authResult.userId ?? undefined,
        })
        return NextResponse.json({ success: true, affected: updated, failed: failures })
      }

      case "reassign": {
        // `value === ""` → unassign (clear assignedTo). The Deal model has
        // `assignedTo: String?`, so null is the correct unset.
        const newOwner = value && value.length > 0 ? value : null
        const { updated, failures } = await applyToEach(ids, actor, { assignedTo: newOwner })
        logAudit(orgId, "bulk_update", "deal", ids.join(","), `Reassigned ${updated} deals to ${newOwner ?? "unassigned"}`, {
          userId: authResult.userId ?? undefined,
        })
        return NextResponse.json({ success: true, affected: updated, failed: failures })
      }
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Deals Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
