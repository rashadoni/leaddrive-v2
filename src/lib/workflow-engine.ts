import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { requestOutboundWebhook } from "@/lib/integrations/webhook-url-guard"
import { sendSlackNotification, formatGenericNotification } from "@/lib/slack"
import { sendEmail } from "@/lib/email"
import { sendSms } from "@/lib/sms"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { recordStageTransition } from "@/lib/revenue-intelligence/transition-recorder"

/**
 * Apply a deal stage change from an automation (workflow / scheduled action)
 * so it behaves like every other stage-mutating path: bump stageChangedAt
 * ONLY on a real change and record a pipeline_stage_transition for the
 * waterfall. Fire-and-forget recording — never blocks the workflow.
 */
async function applyDealStageUpdate(orgId: string, dealId: string, newStage: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: orgId },
    select: { stage: true, valueAmount: true, currency: true, pipelineId: true, stageChangedAt: true },
  })
  if (!deal) return
  const changes = deal.stage !== newStage
  await prisma.deal.updateMany({
    where: { id: dealId, organizationId: orgId },
    data: { stage: newStage, ...(changes && { stageChangedAt: new Date() }) },
  })
  if (changes) {
    const amount = decimalToNumber(deal.valueAmount)
    recordStageTransition(prisma, {
      organizationId: orgId,
      dealId,
      pipelineId: deal.pipelineId ?? null,
      fromStage: deal.stage,
      toStage: newStage,
      fromAmount: amount,
      toAmount: amount,
      currency: deal.currency,
      actorUserId: null, // workflow / system-executed
      priorStageChangedAt: deal.stageChangedAt ?? null,
    }).catch(() => {
      /* fire-and-forget — recordStageTransition logs internally */
    })
  }
}

// Whitelist of fields that workflow actions are allowed to update per entity type
const SAFE_UPDATE_FIELDS: Record<string, Set<string>> = {
  deal: new Set(["stage", "status", "assignedTo", "priority", "notes", "tags"]),
  lead: new Set(["status", "priority", "assignedTo", "notes", "source", "tags"]),
  ticket: new Set(["status", "priority", "assignedTo", "category", "notes", "tags"]),
  task: new Set(["status", "priority", "assignedTo", "notes", "tags"]),
  contact: new Set(["status", "notes", "tags"]),
  company: new Set(["leadStatus", "notes", "tags"]),
  // Call-triggered workflows (e.g. missed-call SMS) may add notes, but the
  // business disposition belongs only to the human outcome endpoint or the AI
  // post-call analysis. Automation cannot manufacture that customer evidence.
  call: new Set(["notes"]),
}

// Normalize entity type: v1 uses plural "deals"/"leads", v2 uses singular "deal"/"lead"
function normalizeEntityType(et: string): string {
  const map: Record<string, string> = {
    deals: "deal", leads: "lead", tickets: "ticket",
    tasks: "task", contacts: "contact", companies: "company",
  }
  return map[et] || et
}

/**
 * Run every active rule matching (entityType, triggerEvent) whose conditions
 * hold for `entity`. Returns how many rules MATCHED (conditions passed) — 0
 * on error. Callers that need "did anything fire?" (e.g. the C4 web-activity
 * cooldown) read the count; existing fire-and-forget callers ignore it.
 */
export async function executeWorkflows(
  orgId: string,
  entityType: string,
  triggerEvent: string,
  entity: Record<string, any>,
  options: { awaitExternalSideEffects?: boolean } = {},
): Promise<number> {
  let matched = 0
  try {
    // Search for both singular and plural entity types (v1 compat)
    const normalized = normalizeEntityType(entityType)
    const variants = [entityType]
    if (normalized !== entityType) variants.push(normalized)
    else variants.push(entityType + "s") // also check plural

    const rules = await prisma.workflowRule.findMany({
      where: {
        organizationId: orgId,
        entityType: { in: variants },
        triggerEvent,
        isActive: true,
      },
      include: {
        actions: { orderBy: { actionOrder: "asc" } },
      },
    })

    for (const rule of rules) {
      if (!evaluateConditions(rule.conditions as any, entity)) continue
      matched++

      for (const action of rule.actions) {
        const config = (typeof action.actionConfig === "object" && action.actionConfig)
          ? action.actionConfig as Record<string, any>
          : {}
        const delayMinutes = Number(config.delayMinutes || 0)

        if (delayMinutes > 0) {
          // Deferred: enqueue for cron pickup instead of running now.
          // TT §9 requires a 2-min delay for missed-call → SMS so the
          // operator has a chance to call back first.
          await prisma.scheduledAction.create({
            data: {
              organizationId: orgId,
              ruleId: rule.id,
              entityType: normalized,
              entityId: String(entity.id || ""),
              entitySnapshot: entity as any,
              actionType: action.actionType,
              actionConfig: config,
              scheduledAt: new Date(Date.now() + delayMinutes * 60_000),
            },
          }).catch((e: unknown) => console.error("[workflow] schedule failed:", e))
        } else {
          await executeAction(orgId, normalized, action as any, entity, options)
        }
      }
    }
  } catch (e) {
    console.error("Workflow execution error:", e)
  }
  return matched
}

/**
 * Execute a single action outside the normal trigger path —
 * used by the scheduled-actions cron. Exported so cron handlers
 * don't have to duplicate the switch statement.
 */
export async function runScheduledAction(
  orgId: string,
  entityType: string,
  actionType: string,
  actionConfig: Record<string, any>,
  entity: Record<string, any>
) {
  await executeAction(orgId, entityType, { actionType, actionConfig }, entity)
}

function evaluateConditions(conditions: any, entity: Record<string, any>): boolean {
  if (!conditions || (typeof conditions === "object" && Object.keys(conditions).length === 0)) return true

  // New format: { rules: [{ field, operator, value }] }
  if (conditions.rules && Array.isArray(conditions.rules)) {
    for (const rule of conditions.rules) {
      const actual = entity[rule.field]
      const expected = rule.value

      switch (rule.operator) {
        case "equals":
          if (String(actual) !== String(expected)) return false
          break
        case "not_equals":
          if (String(actual) === String(expected)) return false
          break
        case "contains":
          if (typeof actual !== "string" || !actual.toLowerCase().includes(String(expected).toLowerCase())) return false
          break
        case "not_empty":
          if (!actual && actual !== 0) return false
          break
        case "greater_than":
          if (Number(actual) <= Number(expected)) return false
          break
        case "less_than":
          if (Number(actual) >= Number(expected)) return false
          break
      }
    }
    return true
  }

  // Legacy format: { field: value } or { field: { eq, ne, gt, lt, contains } }
  for (const [field, expected] of Object.entries(conditions)) {
    if (field === "rules") continue
    const actual = entity[field]

    if (typeof expected === "object" && expected !== null) {
      const { eq, ne, gt, lt, contains } = expected as any
      if (eq !== undefined && actual !== eq) return false
      if (ne !== undefined && actual === ne) return false
      if (gt !== undefined && actual <= gt) return false
      if (lt !== undefined && actual >= lt) return false
      if (contains !== undefined && typeof actual === "string" && !actual.includes(contains)) return false
    } else {
      if (String(actual) !== String(expected)) return false
    }
  }
  return true
}

async function executeAction(
  orgId: string,
  entityType: string,
  action: { actionType: string; actionConfig: Record<string, any> },
  entity: Record<string, any>,
  options: { awaitExternalSideEffects?: boolean } = {},
) {
  const config = (typeof action.actionConfig === "object" && action.actionConfig) ? action.actionConfig : {} as Record<string, any>
  const entityName = entity.title || entity.name || entity.fullName || entity.contactName || "item"

  switch (action.actionType) {
    case "send_notification":
    case "notify":
      // userId: "" means visible to all users in the org
      await createNotification({
        organizationId: orgId,
        userId: "",
        type: "info",
        title: config.title || "Workflow",
        message: config.message || config.value || `Action triggered for ${entityName}`,
        entityType,
        entityId: entity.id,
      })
      break

    case "create_task":
      await prisma.task.create({
        data: {
          organizationId: orgId,
          title: config.title || config.value || `Follow up: ${entityName}`,
          description: config.description || "",
          status: "pending",
          priority: config.priority || "medium",
          assignedTo: config.assignee || config.assignedTo || entity.assignedTo,
          relatedType: entityType,
          relatedId: entity.id,
        },
      })
      break

    case "update_field":
      if (config.field && (config.value !== undefined)) {
        const allowedFields = SAFE_UPDATE_FIELDS[entityType]
        if (!allowedFields || !allowedFields.has(config.field)) {
          console.error(`[Workflow] Blocked update of restricted field: ${entityType}.${config.field}`)
          break
        }
        try {
          // A12 — a workflow moving a DEAL's stage must land in the pipeline
          // waterfall + bump stageChangedAt, same as every other path.
          if (entityType === "deal" && config.field === "stage") {
            await applyDealStageUpdate(orgId, entity.id, String(config.value))
          } else {
            const model = (prisma as any)[entityType]
            if (model) {
              await model.updateMany({
                where: { id: entity.id, organizationId: orgId },
                data: { [config.field]: config.value },
              })
            }
          }
        } catch (e) {
          console.error("Update field action failed:", e)
        }
      }
      break

    case "auto_assign":
    case "assign_to": {
      const assignee = config.assignTo || config.assign_to || config.value
      if (assignee) {
        try {
          const model = (prisma as any)[entityType]
          if (model) {
            await model.updateMany({
              where: { id: entity.id, organizationId: orgId },
              data: { assignedTo: assignee },
            })
          }
        } catch (e) {
          console.error("Auto assign action failed:", e)
        }
      }
      break
    }

    case "send_email": {
      const recipientEmail = config.to || (entity as any).email || (entity as any).contactEmail
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: config.subject || `[LeadDrive] Notification for ${entityType} #${entity.id}`,
          html: config.body || config.template || `<p>Workflow notification for ${entityType}.</p>`,
          organizationId: orgId,
          templateId: config.templateId,
        }).catch(err => console.error(`[Workflow] send_email failed:`, err))
      } else {
        console.warn(`[Workflow] send_email skipped — no recipient for ${entityType} ${entity.id}`)
      }
      break
    }

    case "send_sms": {
      const recipientPhone = config.to
        || (entity as any).phone
        || (entity as any).fromNumber
        || (entity as any).toNumber
      if (recipientPhone) {
        const message = (config.message || config.body || `[LeadDrive] Notification for ${entityType}`)
          .toString()
          .replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String((entity as any)[k] ?? ""))
        await sendSms({ to: recipientPhone, message, organizationId: orgId })
          .catch(err => console.error(`[Workflow] send_sms failed:`, err))
      } else {
        console.warn(`[Workflow] send_sms skipped — no phone for ${entityType} ${entity.id}`)
      }
      break
    }

    case "webhook": {
      // Fire registered webhooks for this event
      const webhookPayload = {
        entityType,
        entityId: entity.id,
        ...entity,
      }
      if (
        entityType === "social_mention"
        || options.awaitExternalSideEffects === true
      ) {
        await fireWebhooks(
          orgId,
          `${entityType}.${"updated"}`,
          webhookPayload,
          { awaitDelivery: true },
        ).catch(() => {})
      } else {
        await fireWebhooks(
          orgId,
          `${entityType}.${"updated"}`,
          webhookPayload,
        ).catch(() => {})
      }
      // Also fire custom URL if specified in workflow config
      if (config.url) {
        try {
          const method = String(config.method || "POST").toUpperCase()
          const body = JSON.stringify({
            event: `${entityType}.workflow`,
            organizationId: orgId,
            entity,
            timestamp: new Date().toISOString(),
          })
          await requestOutboundWebhook(String(config.url), {
            method,
            headers: { "Content-Type": "application/json" },
            body: method === "GET" || method === "HEAD" ? undefined : body,
            timeoutMs: 10_000,
            maxRedirects: 3,
          })
        } catch (e) {
          console.error("Webhook action failed:", e)
        }
      }
      break
    }

    case "slack_notify": {
      const slackConfigs = await prisma.channelConfig.findMany({
        where: { organizationId: orgId, channelType: "slack", isActive: true },
      })
      const message = formatGenericNotification(
        entityType,
        config.message || `${entityType} ${"updated"}`,
        { id: entity.id, name: entity.name || entity.subject || entity.fullName || "" }
      )
      for (const cfg of slackConfigs) {
        if (cfg.webhookUrl) {
          await sendSlackNotification(cfg.webhookUrl, message).catch(() => {})
        }
      }
      break
    }

    default:
      console.warn(`Unknown workflow action type: ${action.actionType}`)
  }
}
