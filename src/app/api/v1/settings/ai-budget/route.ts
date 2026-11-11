import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsSessionAuth } from "@/lib/with-rls"
import { checkAiBudget, getAiLimits, DEFAULT_AI_LIMITS } from "@/lib/ai/budget"
import { holdsSettingsSectionForRequest } from "@/lib/settings-sections"

/** A limit is a sum in dollars a day: a cent is too small to mean anything, ten thousand a typo. */
const MIN_DAILY_LIMIT_USD = 0.5
const MAX_DAILY_LIMIT_USD = 10_000

/**
 * GET /api/v1/settings/ai-budget — current budget usage
 * PATCH /api/v1/settings/ai-budget — reply limits and the daily limit (admin)
 *
 * The daily limit is the organization's own (owner, 2026-11-11: «лимит в
 * балансе сколько загрузил… если клиент захочет, то пусть ставит лимит»):
 * none unless its admin sets one in «Настройки → ИИ и расходы»; `limit: null`
 * clears it. Members who are not admins still cannot change it.
 */
export const GET = withRls(async (_req, { orgId }) => {
  const [budget, limits] = await Promise.all([checkAiBudget(orgId), getAiLimits(orgId)])
  return NextResponse.json({ data: { ...budget, limits } })
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  if (!holdsSettingsSectionForRequest(auth, req)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const orgId = auth.orgId
  const body = await req.json()
  const { limit, aiLimits } = body as {
    limit?: number | null
    aiLimits?: { maxRepliesPerConversation?: number; maxRepliesPerContactPerDay?: number; maxOutputTokens?: number }
  }

  if (limit !== undefined && limit !== null
    && (typeof limit !== "number" || !Number.isFinite(limit) || limit < MIN_DAILY_LIMIT_USD || limit > MAX_DAILY_LIMIT_USD)) {
    return NextResponse.json({ error: `Limit must be between ${MIN_DAILY_LIMIT_USD} and ${MAX_DAILY_LIMIT_USD}, or null for none` }, { status: 400 })
  }
  // A6 — granular limits validation (int ranges; anything else is rejected, not coerced).
  const intOk = (v: unknown, min: number, max: number) =>
    v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max)
  if (
    aiLimits !== undefined &&
    !(
      typeof aiLimits === "object" && aiLimits !== null &&
      intOk(aiLimits.maxRepliesPerConversation, 1, 1000) &&
      intOk(aiLimits.maxRepliesPerContactPerDay, 1, 1000) &&
      intOk(aiLimits.maxOutputTokens, 64, 4096)
    )
  ) {
    return NextResponse.json({ error: "Invalid aiLimits" }, { status: 400 })
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = (org?.settings as Record<string, any>) || {}
  if (limit === null) delete settings.aiDailyBudgetUsd
  else if (limit !== undefined) settings.aiDailyBudgetUsd = Math.round(limit * 100) / 100
  if (aiLimits !== undefined) {
    settings.aiLimits = { ...DEFAULT_AI_LIMITS, ...(settings.aiLimits ?? {}), ...aiLimits }
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings },
  })

  const [budget, limits] = await Promise.all([checkAiBudget(orgId), getAiLimits(orgId)])
  return NextResponse.json({ data: { ...budget, limits } })
})
