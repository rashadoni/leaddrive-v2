import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, type Role } from "@/lib/permissions"
import { aiSpendReport, isSpendGranularity, isSpendRange, RANGES_FOR } from "@/lib/ai/gateway"

/**
 * GET /api/v1/settings/ai-spend?granularity=day|week|month&range=7d|30d|90d|12m&tz=Asia/Baku
 *
 * The organization's AI spend report («Настройки → ИИ и расходы»), from the
 * gateway's journal `ai_usage`. Admins only: it names agents, models and the
 * money the organization spends.
 */
export const GET = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const params = new URL(req.url).searchParams
  const granularity = params.get("granularity") ?? "week"
  const range = params.get("range") ?? "90d"
  if (!isSpendGranularity(granularity) || !isSpendRange(range) || !RANGES_FOR[granularity].includes(range)) {
    return NextResponse.json({ error: "Unsupported granularity or range" }, { status: 400 })
  }
  const report = await aiSpendReport(auth.orgId, { granularity, range, timeZone: params.get("tz") ?? undefined })
  return NextResponse.json({ data: report })
})
