import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const DEFAULT_ADVISOR_EXECUTION_DAILY_LIMIT = 100
export const DEFAULT_ADVISOR_EXECUTION_ACTION_TYPE_DAILY_LIMIT = 25

export type AdvisorExecutionGuardrailAction = {
  id?: string
  organizationId: string
  actionType: string
}

export type AdvisorExecutionSettings = {
  executionEnabled: boolean
  dailyLimit: number
  actionTypeDailyLimit: number
}

export type AdvisorExecutionGuardrailDecision =
  | {
      allowed: true
      settings: AdvisorExecutionSettings
      dailyUsed: number
      actionTypeDailyUsed: number
    }
  | {
      allowed: false
      code: "global_disabled" | "tenant_disabled" | "daily_limit" | "action_type_daily_limit"
      reason: string
      settings?: AdvisorExecutionSettings
      limit?: number
      used?: number
    }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function positiveNumberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function advisorExecutionKillSwitch(env: Record<string, string | undefined> = process.env): string | null {
  if (env.LEADDRIVE_ADVISOR_EXECUTION_DISABLED === "1") return "LEADDRIVE_ADVISOR_EXECUTION_DISABLED"
  if (env.ADVISOR_EXECUTION_DISABLED === "1") return "ADVISOR_EXECUTION_DISABLED"
  return null
}

export function parseAdvisorExecutionSettings(settings: unknown): AdvisorExecutionSettings {
  const record = asRecord(settings)
  const dailyLimit = positiveNumberSetting(
    record.aiAdvisorExecutionDailyLimit ?? record.aiAdvisorActionDailyLimit,
    DEFAULT_ADVISOR_EXECUTION_DAILY_LIMIT,
  )
  return {
    executionEnabled: record.aiAdvisorExecutionDisabled !== true && record.aiAdvisorExecutionEnabled !== false,
    dailyLimit,
    actionTypeDailyLimit: positiveNumberSetting(
      record.aiAdvisorActionTypeDailyLimit,
      DEFAULT_ADVISOR_EXECUTION_ACTION_TYPE_DAILY_LIMIT,
    ),
  }
}

export function advisorExecutionDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function evaluateAdvisorExecutionGuardrails(
  action: AdvisorExecutionGuardrailAction,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<AdvisorExecutionGuardrailDecision> {
  const killSwitch = advisorExecutionKillSwitch(env)
  if (killSwitch) {
    return {
      allowed: false,
      code: "global_disabled",
      reason: `Advisor execution is disabled by ${killSwitch}`,
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: action.organizationId },
    select: { settings: true },
  })
  const settings = parseAdvisorExecutionSettings(org?.settings)
  if (!settings.executionEnabled) {
    return {
      allowed: false,
      code: "tenant_disabled",
      reason: "Advisor execution is disabled for this tenant",
      settings,
    }
  }

  const dayStart = advisorExecutionDayStart(now)
  const executedTodayWhere: Prisma.AiShadowActionWhereInput = {
    organizationId: action.organizationId,
    approved: true,
    executionStatus: { in: ["executing", "executed", "failed"] },
    OR: [
      { executedAt: { gte: dayStart } },
      { reviewedAt: { gte: dayStart } },
    ],
  }

  const [dailyUsed, actionTypeDailyUsed] = await Promise.all([
    prisma.aiShadowAction.count({ where: executedTodayWhere }),
    prisma.aiShadowAction.count({
      where: {
        ...executedTodayWhere,
        actionType: action.actionType,
      },
    }),
  ])

  if (dailyUsed >= settings.dailyLimit) {
    return {
      allowed: false,
      code: "daily_limit",
      reason: `Advisor execution daily limit reached: ${dailyUsed}/${settings.dailyLimit}`,
      settings,
      limit: settings.dailyLimit,
      used: dailyUsed,
    }
  }

  if (actionTypeDailyUsed >= settings.actionTypeDailyLimit) {
    return {
      allowed: false,
      code: "action_type_daily_limit",
      reason: `Advisor ${action.actionType} daily limit reached: ${actionTypeDailyUsed}/${settings.actionTypeDailyLimit}`,
      settings,
      limit: settings.actionTypeDailyLimit,
      used: actionTypeDailyUsed,
    }
  }

  return {
    allowed: true,
    settings,
    dailyUsed,
    actionTypeDailyUsed,
  }
}
