import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, type Role } from "@/lib/permissions"
import { aiFeatureLabel, aiSpendReport, isSpendGranularity, isSpendRange, RANGES_FOR } from "@/lib/ai/gateway"

/**
 * GET /api/v1/settings/ai-spend/export?granularity=&range=&tz=&lang=ru|az|en
 *
 * The same report as the settings page, as an Excel workbook: one sheet by
 * service and agent, one by period. Built from `aiSpendReport`, so the file
 * and the screen never disagree.
 */
const TEXT = {
  ru: { rows: "По сервисам", periods: "По периодам", service: "Сервис", agent: "ИИ-агент", provider: "Провайдер", model: "Модель", key: "Чей ключ", calls: "Вызовов", input: "Токены: вход", output: "Токены: ответ", cost: "Сумма, $", period: "Начало периода", total: "Итого", platform: "LeadDrive", tenant: "Ваш ключ" },
  az: { rows: "Xidmətlər üzrə", periods: "Dövrlər üzrə", service: "Xidmət", agent: "AI agent", provider: "Provayder", model: "Model", key: "Kimin açarı", calls: "Çağırış", input: "Tokenlər: giriş", output: "Tokenlər: cavab", cost: "Məbləğ, $", period: "Dövrün başlanğıcı", total: "Cəmi", platform: "LeadDrive", tenant: "Sizin açar" },
  en: { rows: "By service", periods: "By period", service: "Service", agent: "AI agent", provider: "Provider", model: "Model", key: "Whose key", calls: "Calls", input: "Tokens: input", output: "Tokens: output", cost: "Cost, $", period: "Period start", total: "Total", platform: "LeadDrive", tenant: "Your key" },
} as const

export const GET = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const params = new URL(req.url).searchParams
  const granularity = params.get("granularity") ?? "week"
  const range = params.get("range") ?? "90d"
  if (!isSpendGranularity(granularity) || !isSpendRange(range) || !RANGES_FOR[granularity].includes(range)) {
    return NextResponse.json({ error: "Unsupported granularity or range" }, { status: 400 })
  }
  const lang = params.get("lang") === "az" || params.get("lang") === "en" ? (params.get("lang") as "az" | "en") : "ru"
  const t = TEXT[lang]
  const report = await aiSpendReport(auth.orgId, { granularity, range, timeZone: params.get("tz") ?? undefined })

  const wb = new ExcelJS.Workbook()
  wb.creator = "LeadDrive"
  wb.created = new Date()

  const byRow = wb.addWorksheet(t.rows)
  byRow.columns = [
    { header: t.service, key: "service", width: 36 },
    { header: t.agent, key: "agent", width: 26 },
    { header: t.provider, key: "provider", width: 14 },
    { header: t.model, key: "model", width: 28 },
    { header: t.key, key: "key", width: 14 },
    { header: t.calls, key: "calls", width: 10 },
    { header: t.input, key: "input", width: 16 },
    { header: t.output, key: "output", width: 16 },
    { header: t.cost, key: "cost", width: 12 },
  ]
  byRow.getRow(1).font = { bold: true }
  for (const r of report.rows) {
    byRow.addRow({
      service: aiFeatureLabel(r.feature, lang),
      agent: r.agentName ?? "",
      provider: r.provider,
      model: r.model ?? "",
      key: r.keySource === "tenant" ? t.tenant : t.platform,
      calls: r.calls,
      input: r.inputTokens,
      output: r.outputTokens,
      cost: r.costUsd,
    })
  }
  const totalRow = byRow.addRow({ service: t.total, calls: report.totals.calls, cost: report.totals.costUsd })
  totalRow.font = { bold: true }
  byRow.getColumn("cost").numFmt = "0.0000"

  const features = [...new Set(report.rows.map((r) => r.feature))]
  const byPeriod = wb.addWorksheet(t.periods)
  byPeriod.columns = [
    { header: t.period, key: "period", width: 16 },
    ...features.map((f) => ({ header: aiFeatureLabel(f, lang), key: f, width: 22 })),
    { header: t.total, key: "__total", width: 12 },
  ]
  byPeriod.getRow(1).font = { bold: true }
  for (const p of report.periods) {
    byPeriod.addRow({ period: p.period, ...Object.fromEntries(features.map((f) => [f, p.byFeature[f] ?? 0])), __total: p.costUsd })
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ai-spend-${report.firstDay}-${report.lastDay}.xlsx"`,
    },
  })
})
