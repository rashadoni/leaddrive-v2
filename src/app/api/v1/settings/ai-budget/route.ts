import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, isSuperAdmin, type Role } from "@/lib/permissions"
import { checkAiBudget, getAiLimits, DEFAULT_AI_LIMITS } from "@/lib/ai/budget"

/**
 * GET /api/v1/settings/ai-budget — current budget usage
 * PATCH /api/v1/settings/ai-budget — reply limits (admin); daily limit (platform superadmin)
 *
 * The daily limit guards the platform's AI key, so the platform sets it
 * (owner, 2026-11-10: one setting, one owner — «Настройки → ИИ и расходы»
 * shows it, the tenant card in /admin/tenants changes it). Until then any
 * member of the organization could raise it to $100 a day on our key.
 */
export const GET = withRls(async (_req, { orgId }) => {
  const [budget, limits] = await Promise.all([checkAiBudget(orgId), getAiLimits(orgId)])
  return NextResponse.json({ data: { ...budget, limits } })
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const orgId = auth.orgId
  const body = await req.json()
  const { limit, aiLimits } = body as {
    limit?: number
    aiLimits?: { maxRepliesPerConversation?: number; maxRepliesPerContactPerDay?: number; maxOutputTokens?: number }
  }

  if (limit !== undefined && !isSuperAdmin(auth.role as Role)) {
    return NextResponse.json({ error: "The daily AI limit is set by the platform", code: "LIMIT_PLATFORM_ONLY" }, { status: 403 })
  }
  if (limit !== undefined && (typeof limit !== "number" || limit <= 0 || limit > 100)) {
    return NextResponse.json({ error: "Limit must be between 0.5 and 100" }, { status: 400 })
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
  if (limit !== undefined) settings.aiDailyBudgetUsd = limit
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
