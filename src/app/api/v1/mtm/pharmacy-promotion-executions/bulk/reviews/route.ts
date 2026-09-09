import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import {
  pharmacyPromotionBulkReviewInclude,
  preparePharmacyPromotionBulkReview,
} from "@/lib/mtm/pharmacy-promotion-bulk-review"
import { PharmacyPromotionBulkReviewApplySchema } from "@/lib/mtm/pharmacy-promotion-validators"

function notificationCopy(locale: string | null | undefined, level: string, decision: string) {
  const language = locale === "az" || locale === "en" ? locale : "ru"
  const decisionText = {
    ru: { APPROVED: "одобрено", REJECTED: "отклонено", RETURNED: "возвращено на исправление" },
    az: { APPROVED: "təsdiqləndi", REJECTED: "rədd edildi", RETURNED: "düzəliş üçün qaytarıldı" },
    en: { APPROVED: "approved", REJECTED: "rejected", RETURNED: "returned for correction" },
  }[language][decision as "APPROVED" | "REJECTED" | "RETURNED"]
  return {
    title: {
      ru: "Решение по аптечной промоакции",
      az: "Aptek promosiyası üzrə qərar",
      en: "Pharmacy promotion decision",
    }[language],
    body: {
      ru: `${level}: выполнение ${decisionText}`,
      az: `${level}: icra ${decisionText}`,
      en: `${level}: execution ${decisionText}`,
    }[language],
  }
}

function exactVersionSet(
  executionIds: string[],
  versions: Array<{ executionId: string; expectedVersion: number }>,
) {
  const sorted = [...versions].sort((left, right) => left.executionId.localeCompare(right.executionId))
  if (sorted.length !== executionIds.length) return null
  if (sorted.some((entry, index) => entry.executionId !== executionIds[index])) return null
  return sorted
}

function operationResult(operation: any) {
  return {
    id: operation.id,
    status: operation.status,
    selectionScope: operation.selectionScope,
    selectionHash: operation.selectionHash,
    selectedCount: operation.selectedCount,
    succeededCount: operation.succeededCount,
    failedCount: operation.failedCount,
    completedAt: operation.completedAt,
    result: operation.resultPayload,
  }
}

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
    if (forbidden) return forbidden
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  }
  const parsed = PharmacyPromotionBulkReviewApplySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid bulk review",
      code: "MTM_PHARMACY_BULK_REVIEW_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  const executionIds = [...body.executionIds].sort((left, right) => left.localeCompare(right))
  const versions = exactVersionSet(executionIds, body.versions)
  if (!versions) {
    return NextResponse.json({
      error: "Bulk review versions do not match the selected executions",
      code: "MTM_PHARMACY_BULK_VERSION_SET_INVALID",
    }, { status: 409 })
  }
  const expectedSelectionHash = pharmacyPromotionHash(executionIds)
  if (body.selectionHash !== expectedSelectionHash) {
    return NextResponse.json({
      error: "Bulk review selection changed",
      code: "MTM_PHARMACY_BULK_SELECTION_STALE",
    }, { status: 409 })
  }
  const normalizedRequest = {
    schemaVersion: 1,
    operationId: body.operationId,
    idempotencyKey: body.idempotencyKey,
    selectionScope: "EXPLICIT_IDS" as const,
    executionIds,
    selectionHash: body.selectionHash,
    versions,
    level: body.level,
    decision: body.decision,
    reason: body.reason?.trim() || null,
    previewHash: body.previewHash,
  }
  const requestHash = pharmacyPromotionHash(normalizedRequest)

  // Privacy-safe preflight: one missing, cross-tenant, or out-of-scope ID makes
  // the whole explicit selection indistinguishable from a missing resource.
  const visible = await prisma.mtmPharmacyPromotionExecution.findMany({
    where: {
      id: { in: executionIds },
      organizationId: auth.orgId,
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  if (visible.length !== executionIds.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-bulk-review:${auth.orgId}:${body.operationId}`}, 0))`
      // Use the same lock namespace as single review and acquire IDs in stable
      // order so single and bulk decisions cannot interleave or deadlock.
      for (const executionId of executionIds) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-review:${auth.orgId}:${executionId}`}, 0))`
      }

      const currentActor = await resolveMtmRouteActor(tx as typeof prisma, {
        organizationId: auth.orgId,
        userId: auth.userId,
        webRole: auth.role,
        agentId: auth.agentId,
      })
      if (!currentActor) throw new Error("MTM_AGENT_INACTIVE")
      const postingRow = await tx.mtmSetting.findFirst({
        where: { organizationId: auth.orgId, key: "pharmacyPromotionPostingEnabled" },
        select: { value: true },
      })
      const postingEnabled = postingRow?.value === true || postingRow?.value === "true"
      const executions = await tx.mtmPharmacyPromotionExecution.findMany({
        where: {
          id: { in: executionIds },
          organizationId: auth.orgId,
          ...(currentActor.scopedAgentIds === null ? {} : { agentId: { in: [...currentActor.scopedAgentIds] } }),
        },
        include: pharmacyPromotionBulkReviewInclude,
        orderBy: { id: "asc" },
      })
      // Scope is re-resolved inside the serializable transaction, including
      // exact replays after a team/manager assignment has changed.
      if (executions.length !== executionIds.length) return { notFound: true as const }

      const replay = await tx.mtmPharmacyPromotionOperation.findFirst({
        where: {
          organizationId: auth.orgId,
          OR: [{ id: body.operationId }, { idempotencyKey: body.idempotencyKey }],
        },
      })
      if (replay) {
        const replayIds = Array.isArray(replay.explicitIds) ? replay.explicitIds : null
        if (
          replay.id !== body.operationId
          || replay.idempotencyKey !== body.idempotencyKey
          || replay.kind !== "BULK_REVIEW"
          || replay.selectionScope !== "EXPLICIT_IDS"
          || replay.selectionHash !== body.selectionHash
          || replay.requestHash !== requestHash
          || replay.actorUserId !== auth.userId
          || replay.actorAgentId !== currentActor.agentId
          || !replayIds
          || replayIds.length !== executionIds.length
          || replayIds.some((id, index) => id !== executionIds[index])
        ) {
          throw new Error("MTM_PHARMACY_BULK_REVIEW_IDEMPOTENCY_CONFLICT")
        }
        if (replay.status !== "COMPLETED" || !replay.resultPayload) {
          throw new Error("MTM_PHARMACY_BULK_REVIEW_REPLAY_INCOMPLETE")
        }
        return { operation: replay, idempotent: true as const }
      }

      const prepared = preparePharmacyPromotionBulkReview({
        executions,
        actor: currentActor,
        reviewerUserId: auth.userId,
        level: body.level,
        decision: body.decision,
        reason: body.reason,
        postingEnabled,
        versions,
      })
      if (prepared.selectionHash !== body.selectionHash) {
        throw new Error("MTM_PHARMACY_BULK_SELECTION_STALE")
      }
      if (
        prepared.versions.length !== versions.length
        || prepared.versions.some((entry, index) => (
          entry.executionId !== versions[index]?.executionId
          || entry.expectedVersion !== versions[index]?.expectedVersion
        ))
      ) {
        throw new Error("MTM_PHARMACY_BULK_VERSION_SET_INVALID")
      }
      if (prepared.previewHash !== body.previewHash) {
        throw new Error("MTM_PHARMACY_BULK_REVIEW_PREVIEW_STALE")
      }
      if (prepared.entries.some((entry) => entry.preview.nextState.postsLedger)) {
        const beneficiaryAgentIds = [...new Set(executions.map((execution) => execution.agentId))]
          .sort((left, right) => left.localeCompare(right))
        for (const beneficiaryAgentId of beneficiaryAgentIds) {
          // The ledger guard acquires this same lock. Taking all beneficiary
          // locks up front in canonical order prevents cross-batch deadlocks.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-ledger:${auth.orgId}:${beneficiaryAgentId}`}, 0))`
        }
      }

      const now = new Date()
      const operation = await tx.mtmPharmacyPromotionOperation.create({
        data: {
          id: body.operationId,
          organizationId: auth.orgId,
          kind: "BULK_REVIEW",
          status: "PENDING",
          selectionScope: "EXPLICIT_IDS",
          explicitIds: executionIds,
          selectionHash: body.selectionHash,
          idempotencyKey: body.idempotencyKey,
          requestHash,
          requestPayload: normalizedRequest,
          selectedCount: executionIds.length,
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          startedAt: now,
        },
      })

      const executionById = new Map(executions.map((execution) => [execution.id, execution]))
      const reviewByExecutionId = new Map<string, any>()
      // Reviews are inserted while executions are still in their reviewable
      // state. A later failed CAS throws and rolls every insert back.
      for (const entry of prepared.entries) {
        const execution = executionById.get(entry.executionId)
        if (!execution) throw new Error("MTM_PHARMACY_BULK_SELECTION_STALE")
        const reviewRequestHash = pharmacyPromotionHash({
          operationRequestHash: requestHash,
          executionId: entry.executionId,
          expectedVersion: entry.expectedVersion,
          previewHash: entry.previewHash,
        })
        const review = await tx.mtmPharmacyPromotionReview.create({
          data: {
            organizationId: auth.orgId,
            executionId: execution.id,
            level: body.level,
            decision: body.decision,
            reviewerAgentId: currentActor.agentId,
            reviewerUserId: auth.userId,
            reviewerNameSnapshot: auth.name,
            reviewerScopeSnapshot: {
              role: currentActor.role,
              scopedAgentIds: currentActor.scopedAgentIds,
            },
            reason: body.reason?.trim() || null,
            approvalPolicyId: execution.approvalPolicyId,
            approvalPolicyVersion: execution.approvalPolicyVersion,
            approvalPolicyHash: execution.approvalPolicyHash,
            formulaId: execution.formulaId,
            formulaVersion: execution.formulaVersion,
            formulaHash: execution.formulaHash,
            factPointsPreview: new Prisma.Decimal(entry.calculation.factPoints),
            rewardPointsPreview: new Prisma.Decimal(entry.calculation.rewardPoints),
            differencePointsPreview: new Prisma.Decimal(entry.calculation.difference),
            calculationSnapshot: entry.preview.calculation,
            idempotencyKey: `bulk:${body.idempotencyKey}:${execution.id}:${body.level}`,
            requestHash: reviewRequestHash,
            batchId: operation.id,
          },
        })
        reviewByExecutionId.set(execution.id, { review, reviewRequestHash })
      }

      for (const entry of prepared.entries) {
        const execution = executionById.get(entry.executionId)
        if (!execution) throw new Error("MTM_PHARMACY_BULK_SELECTION_STALE")
        const next = entry.preview.nextState
        const updated = await tx.mtmPharmacyPromotionExecution.updateMany({
          where: {
            id: execution.id,
            organizationId: auth.orgId,
            version: entry.expectedVersion,
            status: execution.status,
            l1State: execution.l1State,
            l2State: execution.l2State,
          },
          data: {
            status: next.status as any,
            l1State: next.l1State as any,
            l2State: next.l2State as any,
            closedAt: next.status === "APPROVED" || next.status === "REJECTED" ? now : null,
            version: { increment: 1 },
          },
        })
        if (updated.count !== 1) throw new Error("MTM_PHARMACY_EXECUTION_VERSION_CONFLICT")
      }

      const recipients = await tx.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          id: { in: [...new Set(executions.map((execution) => execution.agentId))] },
        },
        select: { id: true, user: { select: { preferredLanguage: true } } },
      })
      const localeByAgentId = new Map(recipients.map((recipient) => [recipient.id, recipient.user?.preferredLanguage]))
      const results = []
      for (const entry of prepared.entries) {
        const execution = executionById.get(entry.executionId)
        const reviewState = reviewByExecutionId.get(entry.executionId)
        if (!execution || !reviewState) throw new Error("MTM_PHARMACY_BULK_SELECTION_STALE")
        const { review, reviewRequestHash } = reviewState
        const next = entry.preview.nextState
        if (next.postsLedger) {
          const ledgerBase = {
            organizationId: auth.orgId,
            beneficiaryAgentId: execution.agentId,
            targetId: execution.target.id,
            customerId: execution.target.customerId,
            contactId: execution.target.contactId,
            executionId: execution.id,
            reviewId: review.id,
            entryType: "AWARD" as const,
            requestHash: reviewRequestHash,
            formulaId: execution.formulaId,
            formulaVersion: execution.formulaVersion,
            formulaHash: execution.formulaHash,
            calculationSnapshot: entry.preview.calculation,
            actorAgentId: currentActor.agentId,
            actorUserId: auth.userId,
          }
          // Both signed buckets are mandatory even when their exact Decimal
          // delta is zero. This keeps ledger reconciliation deterministic.
          await tx.mtmPharmacyPointsLedgerEntry.create({
            data: {
              ...ledgerBase,
              bucket: "FACT_POINTS",
              delta: new Prisma.Decimal(entry.calculation.factPoints),
              sourceKey: `execution:${execution.id}:award:fact`,
            },
          })
          await tx.mtmPharmacyPointsLedgerEntry.create({
            data: {
              ...ledgerBase,
              bucket: "REWARD_POINTS",
              delta: new Prisma.Decimal(entry.calculation.rewardPoints),
              sourceKey: `execution:${execution.id}:award:reward`,
            },
          })
        }
        await tx.mtmPharmacyPromotionEvent.create({
          data: {
            organizationId: auth.orgId,
            targetId: execution.target.id,
            executionId: execution.id,
            formulaId: execution.formulaId,
            approvalPolicyId: execution.approvalPolicyId,
            reviewId: review.id,
            operationId: operation.id,
            eventType: `REVIEW_${body.level}_${body.decision}`,
            fromState: execution.status,
            toState: next.status,
            actorAgentId: currentActor.agentId,
            actorUserId: auth.userId,
            sourceKey: `execution:${execution.id}:review:${body.level}`,
            requestHash: reviewRequestHash,
            payload: {
              reviewId: review.id,
              batchId: operation.id,
              previewHash: entry.previewHash,
              bulkPreviewHash: body.previewHash,
              nextState: next,
            },
          },
        })
        await tx.mtmAuditLog.create({
          data: {
            organizationId: auth.orgId,
            agentId: currentActor.agentId,
            action: `PHARMACY_PROMOTION_REVIEW_${body.decision}`,
            entity: "mtm_pharmacy_promotion_execution",
            entityId: execution.id,
            metadataKind: "pharmacy_promotion_bulk_review",
            oldData: {
              status: execution.status,
              l1State: execution.l1State,
              l2State: execution.l2State,
              version: execution.version,
            },
            newData: {
              status: next.status,
              l1State: next.l1State,
              l2State: next.l2State,
              version: entry.expectedVersion + 1,
              reviewId: review.id,
              operationId: operation.id,
            },
          },
        })
        const copy = notificationCopy(localeByAgentId.get(execution.agentId), body.level, body.decision)
        await tx.mtmNotification.create({
          data: {
            organizationId: auth.orgId,
            agentId: execution.agentId,
            title: copy.title,
            body: copy.body,
            type: body.decision === "APPROVED" ? "info" : "warning",
            metadata: {
              executionId: execution.id,
              reviewId: review.id,
              operationId: operation.id,
              level: body.level,
              decision: body.decision,
            },
          },
        })
        results.push({
          executionId: execution.id,
          reviewId: review.id,
          version: entry.expectedVersion + 1,
          status: next.status,
          l1State: next.l1State,
          l2State: next.l2State,
          closedAt: next.status === "APPROVED" || next.status === "REJECTED" ? now.toISOString() : null,
        })
      }

      const resultPayload = {
        schemaVersion: 1,
        selectionHash: body.selectionHash,
        previewHash: body.previewHash,
        level: body.level,
        decision: body.decision,
        results,
      }
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          operationId: operation.id,
          eventType: "BULK_REVIEW_COMPLETED",
          toState: "COMPLETED",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `pharmacy-promotion-operation:${operation.id}:completed`,
          requestHash,
          payload: {
            selectionHash: body.selectionHash,
            previewHash: body.previewHash,
            selectedCount: executionIds.length,
            level: body.level,
            decision: body.decision,
          },
        },
      })
      const completed = await tx.mtmPharmacyPromotionOperation.update({
        where: { organizationId_id: { organizationId: auth.orgId, id: operation.id } },
        data: {
          status: "COMPLETED",
          resultPayload,
          succeededCount: executionIds.length,
          failedCount: 0,
          completedAt: now,
          version: { increment: 1 },
        },
      })
      return { operation: completed, idempotent: false as const }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    })

    if ("notFound" in outcome) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      success: true,
      data: { operation: operationResult(outcome.operation) },
      idempotent: outcome.idempotent,
    }, { status: outcome.idempotent ? 200 : 201 })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_BULK_REVIEW_FAILED"
    if (code.endsWith("_DENIED") || code === "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED" || code === "MTM_AGENT_INACTIVE") {
      return NextResponse.json({ error: "Bulk review is not permitted", code }, { status: 403 })
    }
    const conflicts = new Set([
      "MTM_PHARMACY_BULK_REVIEW_IDEMPOTENCY_CONFLICT",
      "MTM_PHARMACY_BULK_REVIEW_REPLAY_INCOMPLETE",
      "MTM_PHARMACY_BULK_REVIEW_PREVIEW_STALE",
      "MTM_PHARMACY_BULK_SELECTION_STALE",
      "MTM_PHARMACY_BULK_VERSION_SET_INVALID",
      "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT",
      "MTM_PHARMACY_L1_NOT_READY",
      "MTM_PHARMACY_L2_NOT_READY",
      "MTM_PHARMACY_REVIEW_REASON_REQUIRED",
      "MTM_PHARMACY_POSTING_DISABLED",
      "MTM_PHARMACY_CONFIGURATION_NOT_SIGNED",
      "MTM_PHARMACY_POLICY_PROJECTION_MISMATCH",
      "MTM_PHARMACY_SOURCE_STALE",
      "MTM_PHARMACY_CALCULATION_CHANGED",
      "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE",
      "MTM_PHARMACY_FACT_QUANTITY_INVALID",
    ])
    if (conflicts.has(code)) return NextResponse.json({ error: "Bulk review conflict", code }, { status: 409 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      const conflictCode = error.code === "P2034"
        ? "MTM_PHARMACY_BULK_REVIEW_RETRY"
        : "MTM_PHARMACY_BULK_REVIEW_IDEMPOTENCY_CONFLICT"
      return NextResponse.json({ error: "Bulk review conflict", code: conflictCode }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion bulk review]", error)
    return NextResponse.json({ error: "Failed to apply bulk review", code: "MTM_PHARMACY_BULK_REVIEW_FAILED" }, { status: 500 })
  }
})
