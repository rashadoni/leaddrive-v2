import type { Deal, Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireFieldPermissions } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { recordStageTransition } from "@/lib/revenue-intelligence/transition-recorder"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { applyAutoEarn } from "@/lib/loyalty"
import { parseMeddpicc } from "@/lib/meddpicc"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, notFoundError, staleWriteError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { updateDealCommandSchema, type UpdateDealCommandInput } from "../schemas/deal"

/**
 * Update one deal — the single implementation behind PUT/PATCH
 * /api/v1/deals/:id and a confirmed voice receipt (roadmap C1.13).
 *
 * Moved from the route rather than rewritten, so stage validation rules,
 * revenue-intelligence transitions, attribution, loyalty, cadence auto-exit,
 * activity rows, surveys, notifications and webhooks behave identically for
 * a click and for a voice receipt.
 *
 * Voice is narrower on purpose. It cannot move a deal between stages or
 * pipelines, change its probability or touch the qualification: a stage move
 * can mark a deal won, and "won" pays out cashback and surveys the customer.
 * That needs the organisation's own stage vocabulary and its own receipt, not
 * a free-text field. It also carries a mandatory `expectedUpdatedAt`, so a
 * deal edited after the user read the receipt is refused, not overwritten.
 */

const VOICE_UPDATE_FIELDS = new Set([
  "name",
  "companyId",
  "contactId",
  "valueAmount",
  "currency",
  "expectedClose",
  "assignedTo",
  "notes",
])

export const dealInclude = {
  company: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  teamMembers: true,
} as const

export type UpdatedDeal = Prisma.DealGetPayload<{ include: typeof dealInclude }>

export interface UpdateDealCommandResult {
  entity: UpdatedDeal
}

/** A stage transition refused by the target stage's validation rules (HTTP 422). */
export class DealStageValidationError extends Error {
  constructor(readonly validationErrors: { field: string; message: string }[]) {
    super("Stage transition blocked by validation rules")
    this.name = "DealStageValidationError"
  }
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid deal update"
}

function enforceVoiceContract(input: UpdateDealCommandInput): void {
  if (!input.expectedUpdatedAt) {
    throw validationError("expectedUpdatedAt is required for voice updates")
  }
  const forbiddenFields = Object.keys(input).filter((field) =>
    field !== "expectedUpdatedAt" && !VOICE_UPDATE_FIELDS.has(field),
  )
  if (forbiddenFields.length > 0) {
    throw new CrmCommandError(
      "FORBIDDEN_FIELD",
      `Fields are not available to voice updates: ${forbiddenFields.join(", ")}`,
      403,
      { fields: forbiddenFields },
    )
  }
}

export async function updateDealCommand(
  actor: CrmCommandActorContext,
  dealId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<UpdateDealCommandResult> {
  const parsedInput = updateDealCommandSchema.safeParse(rawInput)
  if (!parsedInput.success) throw validationError(firstValidationMessage(parsedInput.error))
  const isVoice = actor.source === "voice"
  if (isVoice) enforceVoiceContract(parsedInput.data)

  const { organizationId: orgId, role } = actor
  const id = dealId
  const db = execution?.transaction ?? prisma
  const { expectedUpdatedAt, ...requested } = parsedInput.data
  if (isVoice) {
    const fieldPermissions = await requireFieldPermissions(orgId, role, "deal")
    requireWritableFields(requested as Record<string, unknown>, fieldPermissions, role)
  }
  const parsed = { data: { ...requested } }
  const expectedDate = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null

  // Voice sees only what the user may see, and checks the reviewed version up
  // front. REST keeps its historical organisation scope.
  if (isVoice) {
    const where = await applyRecordFilter(orgId, actor.userId ?? "", role, "deal", {
      id,
      organizationId: orgId,
    })
    const visible = await db.deal.findFirst({ where, select: { id: true, updatedAt: true } })
    if (!visible) throw notFoundError("Deal not found")
    if (expectedDate && visible.updatedAt.getTime() !== expectedDate.getTime()) {
      throw staleWriteError()
    }
    if (parsed.data.assignedTo) {
      const assignee = await db.user.findFirst({
        where: { id: parsed.data.assignedTo, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!assignee) throw validationError("Assignee must be an active member of this organization")
    }
  }

  // Org-ownership guard: Deal.contactId/companyId have NO DB foreign key, so
  // a forged PATCH with a cross-tenant id would write a dangling reference.
  // (NULL clears the field and is allowed.)
  if (parsed.data.contactId) {
    const c = await db.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId: orgId },
      select: { id: true },
    })
    if (!c) throw validationError("Invalid contactId")
  }
  if (parsed.data.companyId) {
    const co = await db.company.findFirst({
      where: { id: parsed.data.companyId, organizationId: orgId },
      select: { id: true },
    })
    if (!co) throw validationError("Invalid companyId")
  }
  if (parsed.data.pipelineId) {
    const pipeline = await db.pipeline.findFirst({
      where: {
        id: parsed.data.pipelineId,
        organizationId: orgId,
        isActive: true,
      },
      select: { id: true },
    })
    if (!pipeline) throw validationError("Invalid pipelineId")
  }

  // ── STAGE VALIDATION RULES ──
  if (parsed.data.stage) {
    // Find PipelineStage matching the target stage name
    const targetPipelineStage = await db.pipelineStage.findFirst({
      where: {
        organizationId: orgId,
        name: parsed.data.stage,
        isActive: true,
        ...(parsed.data.pipelineId ? { pipelineId: parsed.data.pipelineId } : {}),
      },
      include: { validationRules: { where: { isActive: true } } },
    })

    if (targetPipelineStage && targetPipelineStage.validationRules.length > 0) {
      // Load current deal data to check against rules
      const currentDeal = await db.deal.findFirst({
        where: { id, organizationId: orgId },
      })

      if (currentDeal) {
        const errors: { field: string; message: string }[] = []

        for (const rule of targetPipelineStage.validationRules) {
          const fieldValue = (currentDeal as unknown as Record<string, unknown>)[rule.fieldName]

          switch (rule.ruleType) {
            case "required":
              if (!fieldValue && fieldValue !== 0) {
                errors.push({ field: rule.fieldName, message: rule.errorMessage })
              }
              break
            case "min_value":
              if (typeof fieldValue === "number" && rule.ruleValue && fieldValue < parseFloat(rule.ruleValue)) {
                errors.push({ field: rule.fieldName, message: rule.errorMessage })
              }
              break
            case "task_completed": {
              const completedTasks = await db.task.count({
                where: { relatedId: id, status: "completed", organizationId: orgId },
              })
              if (completedTasks === 0) {
                errors.push({ field: rule.fieldName, message: rule.errorMessage })
              }
              break
            }
          }
        }

        if (errors.length > 0) throw new DealStageValidationError(errors)
      }
    }
  }

  /*
   * What the requested stage MEANS, not how it is spelled.
   *
   * Everything below hangs off this: the auto-probability, the timeline
   * wording, the satisfaction survey, the "Сделка выиграна!" push and the
   * cashback notifications. All of them compared against the literal "WON",
   * so an org that renamed its winning stage, or a deal moved to CLOSED_WON,
   * silently got none of it — no survey to the client, no push to the owner,
   * no cashback, and a timeline that said "moved to CLOSED_WON" instead of
   * "won".
   *
   * The names are read only when a stage is actually being set, so ordinary
   * edits pay nothing.
   */
  const [configuredWonStages, configuredLostStages] = parsed.data.stage
    ? await Promise.all([wonStageNames(orgId), lostStageNames(orgId)])
    : [[] as string[], [] as string[]]
  const canonStage = (stage: string | null | undefined) =>
    stage ? canonicalDealStage(stage, configuredWonStages, configuredLostStages) : null
  const requestedStage = canonStage(parsed.data.stage)
  const isWonRequest = requestedStage === "WON"
  const isLostRequest = requestedStage === "LOST"

  // Auto-set probability when stage changes (if not explicitly provided)
  const STAGE_PROBABILITY: Record<string, number> = {
    LEAD: 10, QUALIFIED: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0,
  }
  if (requestedStage && parsed.data.probability === undefined && STAGE_PROBABILITY[requestedStage] !== undefined) {
    parsed.data.probability = STAGE_PROBABILITY[requestedStage]
  }

  // Capture old values before update
  // A12: also pull stageChangedAt + pipelineId + currency so we can
  // record a pipeline_stage_transitions row when stage changes.
  const existing = await db.deal.findFirst({
    where: { id, organizationId: orgId },
    select: {
      stage: true,
      valueAmount: true,
      assignedTo: true,
      name: true,
      stageChangedAt: true,
      pipelineId: true,
      currency: true,
    },
  })

  const deal = await db.deal.updateMany({
    // The version check and the write are one statement when a reviewed
    // version was supplied: an edit in between is refused, not overwritten.
    where: expectedDate
      ? { id, organizationId: orgId, updatedAt: expectedDate }
      : { id, organizationId: orgId },
    data: {
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.companyId !== undefined && { companyId: parsed.data.companyId }),
      ...(parsed.data.campaignId !== undefined && { campaignId: parsed.data.campaignId }),
      ...(parsed.data.pipelineId !== undefined && { pipelineId: parsed.data.pipelineId }),
      ...(parsed.data.stage && { stage: parsed.data.stage }),
      // Only bump stageChangedAt on a REAL stage change — a no-op move
      // (re-setting the current stage) must not reset velocity duration.
      // Keeps single-deal / bulk / sandbox paths consistent.
      ...(parsed.data.stage && existing?.stage !== parsed.data.stage && { stageChangedAt: new Date() }),
      ...(parsed.data.valueAmount !== undefined && { valueAmount: parsed.data.valueAmount }),
      ...(parsed.data.currency && { currency: parsed.data.currency }),
      ...(parsed.data.probability !== undefined && { probability: parsed.data.probability }),
      ...(parsed.data.expectedClose !== undefined && { expectedClose: parsed.data.expectedClose ? new Date(parsed.data.expectedClose) : null }),
      ...(parsed.data.assignedTo && { assignedTo: parsed.data.assignedTo }),
      ...(parsed.data.lostReason && { lostReason: parsed.data.lostReason }),
      ...(parsed.data.notes && { notes: parsed.data.notes }),
      ...(parsed.data.tags !== undefined && { tags: parsed.data.tags }),
      ...(parsed.data.confidenceLevel !== undefined && { confidenceLevel: parsed.data.confidenceLevel }),
      ...(parsed.data.contactId !== undefined && { contactId: parsed.data.contactId }),
      ...(parsed.data.customerNeed && { customerNeed: parsed.data.customerNeed }),
      ...(parsed.data.salesChannel && { salesChannel: parsed.data.salesChannel }),
      // null clears the qualification; otherwise store the normalised shape
      ...(parsed.data.meddpicc !== undefined && {
        meddpicc: parsed.data.meddpicc === null
          ? null
          : (parseMeddpicc(parsed.data.meddpicc) as unknown as Prisma.InputJsonValue),
      }),
    } as Prisma.DealUpdateManyMutationInput,
  })

  if (deal.count === 0) {
    if (expectedDate) throw staleWriteError()
    throw notFoundError("Deal not found")
  }

  const updated = await db.deal.findFirst({
    where: { id, organizationId: orgId },
    include: dealInclude,
  })
  if (!updated) throw notFoundError("Deal not found")

  const actorUserId = actor.userId || null
  const dispatchEffects = async () => {
    // A12 Revenue Intelligence — record stage transition (fire-and-forget).
    // Captures every WON/LOST/advance/regress/reopen so the waterfall
    // dashboard + velocity helper have data. Errors logged but don't
    // block the response. Runs only when stage actually changed.
    if (
      parsed.data.stage &&
      existing?.stage &&
      existing.stage !== parsed.data.stage
    ) {
      const fromAmt = decimalToNumber(existing.valueAmount)
      const toAmt = decimalToNumber(updated.valueAmount)
      recordStageTransition(prisma, {
        organizationId: orgId,
        dealId: id,
        pipelineId: updated.pipelineId ?? existing.pipelineId ?? null,
        fromStage: existing.stage,
        toStage: parsed.data.stage,
        fromAmount: fromAmt,
        toAmount: toAmt,
        // Deal.currency is non-nullable with @default("AZN") in schema —
        // the fallback is unreachable but kept defensive. Align with schema default.
        currency: existing.currency ?? "AZN",
        actorUserId,
        priorStageChangedAt: existing.stageChangedAt ?? null,
        // Already resolved above for this request — pass them so a renamed
        // winning stage lands in «Выиграно» on the waterfall, not «Продвинуто».
        wonStageNames: configuredWonStages,
        lostStageNames: configuredLostStages,
      }).catch(() => {
        /* fire-and-forget — recordStageTransition logs internally */
      })
    }

    // C9 #17 — recompute-on-won: a deal entering or leaving a won stage changes
    // the attribution input set, so mark the org's active models dirty for the
    // attribution-drain cron to recompute promptly. Awaited (persist-first: two
    // fast queries) so the marker survives the serverless response; the heavy
    // recompute runs in the drainer. Best-effort — the periodic full-sweep cron
    // is the backstop if this fails.
    if (parsed.data.stage && existing?.stage && existing.stage !== parsed.data.stage) {
      try {
        // По канону, а не по вхождению в список имён: `wonStageNames` — это
        // настроенные стадии ∪ "WON", и CLOSED_WON проходит мимо него так же,
        // как мимо литерала.
        if (isWonRequest || canonStage(existing.stage) === "WON") {
          await prisma.attributionModel.updateMany({
            where: { organizationId: orgId, status: "active" },
            data: { recomputeRequestedAt: new Date() },
          })
        }
      } catch (e) {
        console.warn("[deals/:id] attribution recompute-mark failed:", e)
      }
    }

    // D8 Loyalty — deal-WON auto-earn. Award when a deal NEWLY enters a won stage
    // (not on leaving, not when already won). A DISTINCT 'deal_won' trigger so it
    // never double-awards with the invoice-paid 'purchase' hook — the tenant opts
    // in by creating a deal_won rule. Member = the deal's contact (company-only
    // deals have none → skipped). Fire-and-forget + .catch-wrapped (a loyalty
    // failure must not fail the deal update); RLS tenant context is inherited from
    // the caller's tenant scope. requireAutoEarnEnabled-gated; referenceId=deal.id
    // makes it idempotent (a deal re-entering won never re-awards).
    if (
      parsed.data.stage &&
      existing?.stage &&
      existing.stage !== parsed.data.stage &&
      updated.contactId
    ) {
      try {
        if (isWonRequest && canonStage(existing.stage) !== "WON") {
          applyAutoEarn(prisma, {
            orgId,
            contactId: updated.contactId,
            trigger: "deal_won",
            orderAmount: decimalToNumber(updated.valueAmount),
            currency: updated.currency,
            referenceId: updated.id,
            reason: `Deal "${updated.name}" won`,
            requireAutoEarnEnabled: true,
          }).catch((e) => console.error("[loyalty deal-won]", e))
        }
      } catch (e) {
        console.warn("[deals/:id] deal-won loyalty hook failed:", e)
      }
    }

    // Cadence auto-exit: the deal closed (won OR lost) — keeping its contact in
    // an outbound sequence no longer makes sense. Fire-and-forget like the survey
    // trigger; tenant context is inherited from the caller's tenant scope.
    if (
      parsed.data.stage &&
      existing?.stage &&
      existing.stage !== parsed.data.stage &&
      updated.contactId
    ) {
      try {
        const wasClosed = ["WON", "LOST"].includes(canonStage(existing.stage) ?? "")
        const nowClosed = isWonRequest || isLostRequest
        if (nowClosed && !wasClosed) {
          autoExitSequenceEnrollments({
            organizationId: orgId,
            trigger: "deal_closed",
            contactId: updated.contactId,
          }).catch((e) => console.error("[deals/:id] cadence auto-exit failed:", e))
        }
      } catch (e) {
        console.warn("[deals/:id] cadence auto-exit hook failed:", e)
      }
    }

    const oldValue: Record<string, unknown> = {}
    const newValue: Record<string, unknown> = {}
    if (parsed.data.stage && existing?.stage !== parsed.data.stage) {
      oldValue.stage = existing?.stage
      newValue.stage = parsed.data.stage
    }
    const existingValueNum = decimalToNumber(existing?.valueAmount)
    if (parsed.data.valueAmount !== undefined && existingValueNum !== parsed.data.valueAmount) {
      oldValue.valueAmount = existingValueNum
      newValue.valueAmount = parsed.data.valueAmount
    }
    if (parsed.data.assignedTo && existing?.assignedTo !== parsed.data.assignedTo) {
      oldValue.assignedTo = existing?.assignedTo
      newValue.assignedTo = parsed.data.assignedTo
    }
    if (parsed.data.name && existing?.name !== parsed.data.name) {
      oldValue.name = existing?.name
      newValue.name = parsed.data.name
    }
    if (parsed.data.pipelineId !== undefined && existing?.pipelineId !== parsed.data.pipelineId) {
      oldValue.pipelineId = existing?.pipelineId
      newValue.pipelineId = parsed.data.pipelineId
    }
    // fallback: store full patch if no specific fields tracked
    logAudit(orgId, "update", "deal", id, updated.name || "", {
      oldValue: Object.keys(oldValue).length > 0 ? oldValue : undefined,
      newValue: Object.keys(newValue).length > 0 ? newValue : parsed.data,
      userId: actorUserId ?? undefined,
    })

    // Auto-track activity for important changes
    const activityEntries: { type: string; subject: string; description?: string }[] = []
    if (parsed.data.stage && existing?.stage !== parsed.data.stage) {
      activityEntries.push({
        type: "note",
        subject: `Stage: ${existing?.stage} → ${parsed.data.stage}`,
        description: isWonRequest
          ? `Deal "${updated.name}" won!`
          : isLostRequest
          ? `Deal "${updated.name}" lost. ${parsed.data.lostReason ? `Reason: ${parsed.data.lostReason}` : ""}`
          : `Deal "${updated.name}" moved to ${parsed.data.stage}`,
      })
    }
    if (parsed.data.valueAmount !== undefined && existingValueNum !== parsed.data.valueAmount) {
      activityEntries.push({
        type: "note",
        subject: `Value: ${existingValueNum.toLocaleString()} → ${parsed.data.valueAmount.toLocaleString()}`,
      })
    }
    if (parsed.data.assignedTo && existing?.assignedTo !== parsed.data.assignedTo) {
      activityEntries.push({
        type: "note",
        subject: `Assigned to changed`,
      })
    }
    if (activityEntries.length > 0) {
      prisma.activity.createMany({
        data: activityEntries.map(entry => ({
          organizationId: orgId,
          type: entry.type,
          subject: entry.subject,
          description: entry.description,
          relatedType: "deal",
          relatedId: id,
          companyId: updated.companyId || null,
          contactId: updated.contactId || null,
          createdBy: actorUserId,
        })),
      }).catch(() => {})
    }

    // Trigger surveys when the deal transitions into WON.
    if (isWonRequest && canonStage(existing?.stage) !== "WON" && updated.contactId) {
      const { triggerSurveysOnDealWon } = await import("@/lib/survey-triggers")
      triggerSurveysOnDealWon(orgId, updated.contactId).catch(e =>
        console.error("[deals] survey trigger failed:", e),
      )
    }

    // Trigger workflows for updates
    const triggerEvent = parsed.data.stage ? "stage_changed" : "updated"
    executeWorkflows(orgId, "deal", triggerEvent, updated).catch(() => {})

    // Notification for stage change
    if (parsed.data.stage && existing?.stage !== parsed.data.stage) {
      const isWon = isWonRequest
      createNotification({
        organizationId: orgId,
        type: isWon ? "success" : isLostRequest ? "error" : "info",
        title: isWon ? "Сделка выиграна!" : isLostRequest ? "Сделка проиграна" : "Смена стадии сделки",
        message: `Сделка «${updated.name}»: ${existing?.stage} → ${parsed.data.stage}`,
        entityType: "deal",
        entityId: id,
        // Deal-won targets the owner (assignedTo) so the best-effort push
        // reaches them; unassigned → org-wide in-app (userId ""), no push.
        // Non-won stage changes stay org-wide + no push (unchanged).
        userId: isWon ? (updated.assignedTo ?? undefined) : undefined,
        push: isWon,
        kind: isWon ? "deal.won" : undefined,
      }).catch(() => {})

      // Cashback notifications when deal is WON
      if (isWonRequest) {
        const rolesWithCashback = await prisma.dealContactRole.findMany({
          where: { dealId: id, cashbackValue: { not: null }, deal: { organizationId: orgId } },
        })
        if (rolesWithCashback.length > 0) {
          const contactIds = rolesWithCashback.map((r: { contactId: string }) => r.contactId)
          const contacts = await prisma.contact.findMany({
            where: { id: { in: contactIds }, organizationId: orgId },
            select: { id: true, fullName: true },
          })
          const contactMap = Object.fromEntries(
            contacts.map((c: { id: string; fullName: string }) => [c.id, c.fullName]),
          )

          for (const r of rolesWithCashback) {
            const name = contactMap[r.contactId] || "Контакт"
            const amount = r.cashbackType === "percent"
              ? `${r.cashbackValue}% от суммы сделки`
              : `$${r.cashbackValue}`
            createNotification({
              organizationId: orgId,
              type: "warning",
              title: "💰 Кэшбек к выплате",
              message: `Сделка «${updated.name}» выиграна — выплатить кэшбек ${amount} контакту ${name}`,
              entityType: "deal",
              entityId: id,
            }).catch(() => {})
          }
        }
      }
    }

    fireWebhooks(orgId, "deal.updated", { id: updated.id, name: updated.name, stage: updated.stage, status: updated.status }).catch(() => {})
  }

  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, dispatchEffects)
  } else {
    // Awaited, as the route always did: the attribution marker and cashback
    // notifications were written before the response.
    await dispatchEffects()
  }

  return { entity: updated }
}

export type { Deal }
