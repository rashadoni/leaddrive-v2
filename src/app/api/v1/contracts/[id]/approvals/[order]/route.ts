/**
 * Approval-stage decision — CLM slice-2 / slice-3e-2 (parallel levels).
 *
 * POST /api/v1/contracts/:id/approvals/:order
 *
 * Advances the approval chain by approving or rejecting a specific stage
 * in the current level. Supports parallel levels (multiple stages at the
 * same `order`).
 *
 * Body:
 *   { decision: "approve" | "reject", stageId?: string }
 *
 *   `stageId` is OPTIONAL but recommended for parallel levels (when the
 *   current level has multiple pending stages). If stageId is omitted the
 *   route resolves the acting user's pending stage at the given order by
 *   assignee identity (userId / originalAssigneeUserId / assigneeRole match).
 *   For single-stage levels this always works. For parallel levels it is
 *   unambiguous only when the user is the assignee of exactly one pending
 *   stage at that order — otherwise a 409 is returned with a hint to supply
 *   stageId.
 *
 * Authorization:
 *   • If the stage has assigneeUserId set  → only that user may decide
 *     (superadmin and admin are exempt — they can unblock any stage).
 *     Also allows the originalAssigneeUserId (delegate returning early).
 *   • If the stage has assigneeRole set    → user's role must match
 *     (again, admin/superadmin are always exempt).
 *   • If neither is set                   → any admin or manager may decide.
 *   • Superadmin bypasses all checks.
 *
 * CAS (3-hardened):
 *   Stage CAS:    updateMany(where: { id: actedStageId, status:"pending" }) count===1
 *   Contract CAS: updateMany(where: { id, status:"pending_approval", currentApprovalStage: stageOrder }) count===1
 *   If either misses → 409 (concurrent request already acted, entire tx rolls back).
 *
 * On chain approved  → Contract.status = "approved",  currentApprovalStage = null
 * On chain rejected  → Contract.status = "rejected",  currentApprovalStage = null
 * On partial advance → Contract.currentApprovalStage = nextPendingOrder + set next level dueAt
 * On level undecided → no pointer change (parallel "all"/"quorum" still in progress)
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { routeApproval } from "@/lib/contract-lifecycle/approval-router"
import { createNotification } from "@/lib/notifications"
import { sendContractAlert } from "@/lib/integrations/contract-alerts"
import type { ApprovalStageState } from "@/lib/contract-lifecycle/types"

const decideSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  /** Optional: the specific stage to decide in a parallel level. */
  stageId: z.string().optional(),
  /** Optional decision note (the UI requires it on reject) — stored on the acted
   *  stage's `comments` for the audit trail. */
  reason: z.string().max(2000).optional(),
})

/** Thrown inside the $transaction when a contract-state updateMany returns count===0.
 *  This rolls back the entire tx (including the stage CAS) and is caught outside
 *  to emit a 409 response. */
class ContractPointerMissError extends Error {
  constructor() {
    super("Contract state changed concurrently, retry")
    this.name = "ContractPointerMissError"
  }
}

/**
 * Check whether `userId` is authorized to act on a stage.
 * Returns true if authorized; does not throw.
 */
function isAuthorizedForStage(
  stage: {
    assigneeUserId: string | null
    originalAssigneeUserId: string | null
    assigneeRole: string | null
  },
  userId: string,
  role: string,
): boolean {
  // Superadmin and admin bypass all assignee constraints
  if (role === "superadmin" || role === "admin") return true

  if (stage.assigneeUserId) {
    const isDelegate = stage.assigneeUserId === userId
    const isOriginal =
      stage.originalAssigneeUserId !== null && stage.originalAssigneeUserId === userId
    if (!isDelegate && !isOriginal) return false
  }

  if (stage.assigneeRole && stage.assigneeRole !== role) return false

  // Neither assigneeUserId nor assigneeRole set → require at least manager
  if (!stage.assigneeUserId && !stage.assigneeRole && role !== "manager") return false

  return true
}

export const POST = withRlsAuth(undefined, undefined, async (req, session, { params }: { params: Promise<{ id: string; order: string }> }) => {
  const { orgId, userId, role } = session
  const { id, order: orderStr } = await params

  const stageOrder = parseInt(orderStr, 10)
  if (!Number.isInteger(stageOrder) || stageOrder < 1) {
    return NextResponse.json({ error: "Invalid stage order" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = decideSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { decision, stageId: requestedStageId, reason } = parsed.data

  try {
    // ── Pre-flight auth check (outside tx): contract existence + status ────────
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, title: true, contractNumber: true, status: true },
    })
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (contract.status !== "pending_approval") {
      return NextResponse.json(
        { error: `Contract is not pending approval (current: "${contract.status}")` },
        { status: 409 },
      )
    }

    // ── Pre-flight: read stages at the requested order ─────────────────────────
    const prefetchStages = await prisma.contractApprovalStage.findMany({
      where: { contractId: id, organizationId: orgId },
      orderBy: { order: "asc" },
    })
    if (prefetchStages.length === 0) {
      return NextResponse.json(
        { error: "No approval stages found for this contract" },
        { status: 409 },
      )
    }

    const stagesAtOrder = prefetchStages.filter((s: (typeof prefetchStages)[number]) => s.order === stageOrder)
    if (stagesAtOrder.length === 0) {
      return NextResponse.json(
        { error: `Stage with order ${stageOrder} not found` },
        { status: 404 },
      )
    }

    // ── Resolve the acted-on stage ─────────────────────────────────────────────
    // Priority:
    //   1. If stageId provided → use it directly (must exist at this order + be pending).
    //   2. Otherwise → find the pending stage(s) at this order that the user is authorized for.
    //      If exactly one → that's the acted stage.
    //      If zero → 403 (not authorized for any stage at this level).
    //      If multiple → 409 with hint to supply stageId.
    let actedStage: (typeof prefetchStages)[number]

    if (requestedStageId) {
      const found = stagesAtOrder.find((s: (typeof stagesAtOrder)[number]) => s.id === requestedStageId)
      if (!found) {
        return NextResponse.json(
          { error: `Stage with id "${requestedStageId}" not found at order ${stageOrder}` },
          { status: 404 },
        )
      }
      if (found.status !== "pending") {
        return NextResponse.json(
          { error: `Stage "${requestedStageId}" is already "${found.status}" — cannot decide again` },
          { status: 409 },
        )
      }
      // Auth check on the specifically requested stage
      if (!isAuthorizedForStage(found, userId, role)) {
        return NextResponse.json(
          { error: "You are not the assigned approver for this stage" },
          { status: 403 },
        )
      }
      actedStage = found
    } else {
      // No stageId provided — find the user's pending stage at this order by identity
      const pendingAtOrder = stagesAtOrder.filter(
        (s: (typeof stagesAtOrder)[number]) => s.status === "pending",
      )

      const authorizedPending = pendingAtOrder.filter(
        (s: (typeof pendingAtOrder)[number]) => isAuthorizedForStage(s, userId, role),
      )

      if (authorizedPending.length === 0) {
        return NextResponse.json(
          { error: "You are not authorized to decide any pending stage at this level" },
          { status: 403 },
        )
      }
      if (authorizedPending.length > 1) {
        return NextResponse.json(
          {
            error:
              "Multiple pending stages match your identity at this level. Provide stageId to disambiguate.",
          },
          { status: 409 },
        )
      }
      actedStage = authorizedPending[0]
    }

    const actedStageId = actedStage.id
    const at = new Date()

    // ── In-transaction CAS ────────────────────────────────────────────────────
    // FIX 1: Serialize concurrent decisions on the same contract by acquiring a
    // row lock (SELECT ... FOR UPDATE) as the FIRST statement inside the tx.
    // This prevents the stuck-pointer race where two concurrent approvers in an
    // all/quorum level each see "another still pending", each mark only their own
    // stage, and neither advances the contract pointer.
    //
    // Sequence inside the tx:
    //   1. FOR UPDATE lock — blocks until any prior concurrent decision's tx commits.
    //   2. RE-READ all stages — reflects the freshly committed state (prior decisions visible).
    //   3. Verify acted stage is still pending (CAS guard, read-before-write).
    //   4. Run routeApproval on the fresh state (including any prior approvals at this level).
    //   5. Stage CAS write — updateMany where status=pending; count===0 → 409.
    //   6. Apply additional stage updates (skip/reject siblings).
    //   7. Contract pointer CAS.
    const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ── Row lock: serialize all decisions on this contract ───────────────────
      // Table name is "contracts" (@@map); column is "organizationId".
      // The tagged-template parameterizes contractId and orgId safely.
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

      // Re-check the contract pointer while holding the row lock. Partial
      // parallel decisions do not update the Contract row, so without this guard
      // a cancellation/status change between pre-flight and the tx could still
      // commit a stage decision against an inactive approval chain.
      const lockedContract = await tx.contract.findFirst({
        where: { id, organizationId: orgId },
        select: { status: true, currentApprovalStage: true },
      })
      if (
        !lockedContract ||
        lockedContract.status !== "pending_approval" ||
        lockedContract.currentApprovalStage !== stageOrder
      ) {
        throw new ContractPointerMissError()
      }

      // ── Re-read ALL stages AFTER acquiring the lock ──────────────────────────
      // Because we hold the FOR UPDATE lock, any prior tx on this contract has
      // already committed by the time we get here. This re-read therefore reflects
      // any prior approver's committed decision at the same level — the router
      // computes levelComplete correctly on this fresh state.
      const dbStages = await tx.contractApprovalStage.findMany({
        where: { contractId: id, organizationId: orgId },
        orderBy: { order: "asc" },
      })

      // Build the stage state array for the pure engine (include stageId + parallelMode + quorumThreshold).
      const stages: ApprovalStageState[] = dbStages.map((s: (typeof dbStages)[number]) => ({
        stageId: s.id,
        order: s.order,
        status: s.status as ApprovalStageState["status"],
        decidedBy: s.decidedBy ?? null,
        decidedAt: s.decidedAt ?? null,
        parallelMode: (s.parallelMode ?? "all") as "all" | "any" | "quorum",
        quorumThreshold: s.quorumThreshold ?? null,
      }))

      // Call the router on the FRESH state so it sees all prior committed decisions.
      // The router also validates the acted stage is still "pending" here — if
      // a concurrent request already decided it (and committed before us), the
      // re-read will show it as decided and the router returns ok:false → 409.
      const result = routeApproval({
        stages,
        stageId: actedStageId,
        stageOrder,
        decision,
        decidedBy: userId,
        at,
      })
      if (!result.ok) {
        // Return a structured sentinel so we can emit the correct HTTP status outside.
        return { conflict: true, error: result.error } as const
      }

      // ── Stage CAS: update the acted stage by PK ───────────────────────────────
      // count===0 means a concurrent request already decided this stage → 409.
      // We write AFTER the router validation to ensure the router saw the correct
      // pending state. The FOR UPDATE lock guarantees no other tx can change this
      // stage between our re-read and this write.
      const casResult = await tx.contractApprovalStage.updateMany({
        where: {
          id: actedStageId,
          organizationId: orgId,
          status: "pending",
        },
        data: {
          status: decision === "approve" ? "approved" : "rejected",
          decidedBy: userId,
          decidedAt: at,
          // Audit trail: persist the decision note when provided (UI requires it
          // on reject). Only write when non-empty so an approve without a note
          // doesn't clobber an existing comment.
          ...(reason?.trim() ? { comments: reason.trim() } : {}),
        },
      })

      if (casResult.count !== 1) {
        return { conflict: true, error: "Stage already decided by another request" } as const
      }

      // ── Apply additional stage updates from the router ───────────────────────
      // e.g. remaining stages → "skipped" on any/quorum finish, later levels → skipped on reject.
      // Use stageId (PK) when available; fall back to order-based updateMany for backward-compat
      // (single-stage legacy levels may not have stageId in the update).
      for (const update of result.updates) {
        // Skip the acted stage — already written above.
        if (update.stageId === actedStageId) continue

        if (update.stageId) {
          // Preferred: update by PK (no compound-key ambiguity)
          await tx.contractApprovalStage.updateMany({
            where: {
              id: update.stageId,
              organizationId: orgId,
              status: "pending",
            },
            data: {
              status: update.status,
              decidedBy: update.decidedBy ?? undefined,
              decidedAt: update.decidedAt ?? undefined,
            },
          })
        } else {
          // Legacy fallback: order-based (single-stage level with no stageId in update)
          await tx.contractApprovalStage.updateMany({
            where: {
              contractId: id,
              order: update.order,
              organizationId: orgId,
              status: "pending",
            },
            data: {
              status: update.status,
              decidedBy: update.decidedBy ?? undefined,
              decidedAt: update.decidedAt ?? undefined,
            },
          })
        }
      }

      // ── Contract pointer CAS ─────────────────────────────────────────────────
      // Guard the Contract status pointer on EXPECTED state (prevents double-advance).
      // Each updateMany must match exactly 1 row — count===0 means a concurrent request
      // already advanced the contract pointer, so we throw to roll back the ENTIRE tx
      // (including the stage CAS above) and return 409 to the caller.
      if (result.chainApproved) {
        const contractUpdate = await tx.contract.updateMany({
          where: {
            id,
            organizationId: orgId,
            status: "pending_approval",
            currentApprovalStage: stageOrder,
          },
          data: { status: "approved", currentApprovalStage: null },
        })
        if (contractUpdate.count !== 1) {
          throw new ContractPointerMissError()
        }
      } else if (result.chainRejected) {
        const contractUpdate = await tx.contract.updateMany({
          where: {
            id,
            organizationId: orgId,
            status: "pending_approval",
            currentApprovalStage: stageOrder,
          },
          data: { status: "rejected", currentApprovalStage: null },
        })
        if (contractUpdate.count !== 1) {
          throw new ContractPointerMissError()
        }
      } else if (result.levelComplete && result.nextPendingOrder !== null) {
        // Level completed and chain advances → move pointer to next level.
        const contractUpdate = await tx.contract.updateMany({
          where: {
            id,
            organizationId: orgId,
            status: "pending_approval",
            currentApprovalStage: stageOrder,
          },
          data: { currentApprovalStage: result.nextPendingOrder },
        })
        if (contractUpdate.count !== 1) {
          throw new ContractPointerMissError()
        }

        // Set dueAt on the newly-active level's pending stages if they have slaHours.
        // The SLA clock starts NOW (when this level becomes active), not at submit time.
        // We set dueAt on ALL pending stages at the next level that have slaHours and
        // no dueAt yet (guard: dueAt: null prevents overwriting if already set).
        const nextLevelStages = dbStages.filter(
          (s: (typeof dbStages)[number]) =>
            s.order === result.nextPendingOrder && s.status === "pending",
        )
        for (const nextStage of nextLevelStages) {
          if (nextStage.slaHours) {
            const nextDueAt = new Date(at.getTime() + nextStage.slaHours * 3600 * 1000)
            await tx.contractApprovalStage.updateMany({
              where: {
                id: nextStage.id,
                organizationId: orgId,
                status: "pending",
                dueAt: null, // Guard: only set if not already set
              },
              data: { dueAt: nextDueAt },
            })
          }
        }
      } else if (!result.levelComplete) {
        // Level still in progress (e.g. "all" mode, not all approvals received yet).
        // No pointer change — contract stays at the current level.
        // Verify the pointer still matches (sanity check, not strictly a CAS).
        // We do NOT throw here — level undecided is a normal state.
      }

      return { conflict: false, result } as const
    })

    if (txResult.conflict) {
      return NextResponse.json({ error: txResult.error }, { status: 409 })
    }

    const { result } = txResult

    // Audit log — non-critical
    await prisma.auditLog
      .create({
        data: {
          organizationId: orgId,
          userId,
          action: "update",
          entityType: "contract",
          entityId: id,
          entityName: contract.title,
          oldValue: { stageOrder, stageId: actedStageId, decision: null },
          newValue: {
            decision,
            stageOrder,
            stageId: actedStageId,
            levelComplete: result.levelComplete,
            chainApproved: result.chainApproved,
            chainRejected: result.chainRejected,
            nextPendingOrder: result.nextPendingOrder,
          },
        },
      })
      .catch(() => {})

    // Notify admins + managers on chain close (approved or rejected)
    if (result.chainApproved || result.chainRejected) {
      const recipients = await prisma.user
        .findMany({
          where: {
            organizationId: orgId,
            role: { in: ["admin", "manager"] },
            isActive: true,
          },
          select: { id: true },
        })
        .catch(() => [] as { id: string }[])

      const notifTitle = result.chainApproved
        ? `Contract approved: ${contract.title}`
        : `Contract rejected: ${contract.title}`
      const notifMsg = result.chainApproved
        ? `All approval stages passed. Contract "${contract.title}" is now approved.`
        : `An approval stage was rejected. Contract "${contract.title}" is now rejected.`

      await Promise.allSettled(
        recipients.map((r: { id: string }) =>
          createNotification({
            organizationId: orgId,
            userId: r.id,
            type: result.chainApproved ? "info" : "error",
            title: notifTitle,
            message: notifMsg,
            entityType: "contract",
            entityId: id,
            kind: result.chainApproved ? "contract.approved" : "contract.declined",
          }),
        ),
      )

      // Slack/Teams alert — fire-and-forget (FIX 3): never await the webhook,
      // so a slow/failing webhook does not add latency to the user-visible route.
      const alertKind = result.chainApproved ? "contract.approved" : "contract.declined"
      void sendContractAlert(orgId, alertKind, {
        contractNumber: contract.contractNumber ?? id,
        title: contract.title,
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      data: {
        stageId: actedStageId,
        levelComplete: result.levelComplete,
        chainApproved: result.chainApproved,
        chainRejected: result.chainRejected,
        nextPendingOrder: result.nextPendingOrder,
      },
    })
  } catch (e) {
    if (e instanceof ContractPointerMissError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    console.error("[approval-decide]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
