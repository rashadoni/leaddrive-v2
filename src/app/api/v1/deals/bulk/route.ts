import { NextRequest, NextResponse } from "next/server"
import { clearTaskRelationsMany } from "@/lib/tasks/clear-task-relations"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { fireWebhooks } from "@/lib/webhooks"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { recordStageTransitionsForDeals } from "@/lib/revenue-intelligence/transition-recorder"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"

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
        // Stage values are pipeline-defined, free-form text — no enum to
        // check here. The Deal model uses `stage: String`.
        //
        // Only touch deals NOT already in the target stage so (a) we don't
        // bump stageChangedAt on no-op moves and (b) result.count reflects
        // the deals that genuinely moved.
        const moveWhere = { ...where, stage: { not: value } }
        // Snapshot prior state BEFORE the write so A12 can emit one
        // pipeline_stage_transitions row per real move (single-deal PUT
        // path does the same — keep bulk + single in parity so the
        // waterfall / velocity dashboards see every movement).
        const moving = await prisma.deal.findMany({
          where: moveWhere,
          select: {
            id: true,
            stage: true,
            valueAmount: true,
            currency: true,
            pipelineId: true,
            stageChangedAt: true,
            contactId: true,
          },
        })
        const result = await prisma.deal.updateMany({
          where: moveWhere,
          data: { stage: value, stageChangedAt: new Date() },
        })
        logAudit(orgId, "bulk_update", "deal", ids.join(","), `Moved ${result.count} deals to stage "${value}"`)
        // A12 Revenue Intelligence — record transitions (fire-and-forget).
        // Errors are logged inside the helper; never block the response.
        recordStageTransitionsForDeals(prisma, {
          organizationId: orgId,
          toStage: value,
          actorUserId: authResult.userId,
          deals: moving.map(
            (d: {
              id: string
              stage: string
              valueAmount: unknown
              currency: string | null
              pipelineId: string | null
              stageChangedAt: Date | null
            }) => ({
              id: d.id,
              fromStage: d.stage,
              amount: decimalToNumber(d.valueAmount),
              currency: d.currency ?? "AZN",
              pipelineId: d.pipelineId,
              priorStageChangedAt: d.stageChangedAt,
            }),
          ),
        }).catch(() => {
          /* fire-and-forget — recordStageTransitionsForDeals logs internally */
        })
        // Cadence auto-exit: bulk move into a closed (won/lost) stage — stop
        // sequence enrollments of the moved deals' contacts. Same semantics as
        // the single-deal PUT hook; fire-and-forget, never blocks the response.
        try {
          const [wonSet, lostSet] = await Promise.all([wonStageNames(orgId), lostStageNames(orgId)])
          const closed = new Set([...wonSet, ...lostSet])
          if (closed.has(value)) {
            const contactIds: string[] = [...new Set<string>(
              moving
                .filter((d: { stage: string; contactId: string | null }) => !closed.has(d.stage) && d.contactId)
                .map((d: { contactId: string | null }) => d.contactId as string),
            )]
            for (const contactId of contactIds) {
              autoExitSequenceEnrollments({ organizationId: orgId, trigger: "deal_closed", contactId })
                .catch((e) => console.error("[deals/bulk] cadence auto-exit failed:", e))
            }
          }
        } catch (e) {
          console.warn("[deals/bulk] cadence auto-exit hook failed:", e)
        }
        break
      }

      case "reassign": {
        // `value === ""` → unassign (clear assignedTo). The Deal model has
        // `assignedTo: String?`, so null is the correct unset.
        const newOwner = value && value.length > 0 ? value : null
        const result = await prisma.deal.updateMany({
          where,
          data: { assignedTo: newOwner },
        })
        logAudit(orgId, "bulk_update", "deal", ids.join(","), `Reassigned ${result.count} deals to ${newOwner ?? "unassigned"}`)
        break
      }
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Deals Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
