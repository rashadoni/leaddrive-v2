import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"

export const POST = withRls(async (req, { orgId }) => {
  const { tab } = await req.json()
  if (!tab) return NextResponse.json({ error: "tab is required" }, { status: 400 })

  try {
    // Gather profitability data
    const [employees, overhead, clientServices, params, snapshot] = await Promise.all([
      prisma.costEmployee.findMany({ where: { organizationId: orgId } }),
      prisma.overheadCost.findMany({ where: { organizationId: orgId } }),
      prisma.clientService.findMany({ where: { organizationId: orgId, isActive: true } }),
      prisma.pricingParameters.findFirst({ where: { organizationId: orgId } }),
      prisma.costModelSnapshot.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } }),
    ])

    // Build summary data
    const totalEmployeeCost = employees.reduce((sum: number, e: any) => sum + e.superGross * e.count, 0)
    const totalOverhead = overhead.reduce((sum: number, o: any) => sum + (o.isAnnual ? o.amount / 12 : o.amount), 0)
    const revenueByService: Record<string, number> = {}
    clientServices.forEach((cs: any) => {
      revenueByService[cs.serviceType] = (revenueByService[cs.serviceType] || 0) + cs.monthlyRevenue
    })
    const totalRevenue = Object.values(revenueByService).reduce((a, b) => a + b, 0)
    const totalCost = totalEmployeeCost + totalOverhead
    const margin = totalRevenue - totalCost
    const marginPct = totalRevenue > 0 ? ((margin / totalRevenue) * 100).toFixed(2) : "0"

    const employeesByDept: Record<string, { count: number; cost: number }> = {}
    employees.forEach((e: any) => {
      if (!employeesByDept[e.department]) employeesByDept[e.department] = { count: 0, cost: 0 }
      employeesByDept[e.department].count += e.count
      employeesByDept[e.department].cost += e.superGross * e.count
    })

    const overheadByCategory: Record<string, number> = {}
    overhead.forEach((o: any) => {
      const amt = o.isAnnual ? o.amount / 12 : o.amount
      overheadByCategory[o.category || o.label] = (overheadByCategory[o.category || o.label] || 0) + amt
    })

    const dataContext = [
      `== Финансовая сводка ==`,
      `Общая выручка: ${totalRevenue.toFixed(0)} ₼/мес`,
      `Общие расходы: ${totalCost.toFixed(0)} ₼/мес (сотрудники: ${totalEmployeeCost.toFixed(0)}, overhead: ${totalOverhead.toFixed(0)})`,
      `Маржа: ${margin.toFixed(0)} ₼ (${marginPct}%)`,
      `Всего пользователей: ${params?.totalUsers || "?"}`,
      `Стоимость на пользователя: ${params?.totalUsers ? (totalCost / params.totalUsers).toFixed(2) : "?"} ₼`,
      ``,
      `== Выручка по сервисам ==`,
      ...Object.entries(revenueByService).map(([k, v]) => `${k}: ${v.toFixed(0)} ₼`),
      ``,
      `== Сотрудники по отделам ==`,
      ...Object.entries(employeesByDept).map(([k, v]) => `${k}: ${v.count} чел, ${v.cost.toFixed(0)} ₼/мес`),
      ``,
      `== Overhead по категориям ==`,
      ...Object.entries(overheadByCategory).map(([k, v]) => `${k}: ${v.toFixed(0)} ₼/мес`),
      ``,
      `== Количество клиентов по сервисам ==`,
      ...Object.entries(
        clientServices.reduce((acc: Record<string, number>, cs: any) => {
          acc[cs.serviceType] = (acc[cs.serviceType] || 0) + 1
          return acc
        }, {} as Record<string, number>)
      ).map(([k, v]) => `${k}: ${v} клиентов`),
    ].join("\n")

    const tabPrompts: Record<string, string> = {
      analytics: "Дай 3 наблюдения об общей финансовой картине: маржа, выручка, расходы, стоимость на пользователя.",
      services: "Дай 3 наблюдения о сервисах: какие прибыльные, какие убыточные, где потенциал роста.",
      clients: "Дай 3 наблюдения о клиентской базе: концентрация выручки, убыточные клиенты, минимальный порог.",
      overhead: "Дай 3 наблюдения об overhead расходах: какие самые крупные, где можно оптимизировать, какие риски.",
    }

    const client = process.env.ANTHROPIC_API_KEY ? getAnthropicClient() : null
    if (!client) {
      return NextResponse.json({ success: true, data: { observations: [], fallback: true } })
    }

    const piiMasker = new PiiMasker()
    const maskedDataContext = piiMasker.mask(dataContext)
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      temperature: 0.4,
      system: `Ты — Da Vinci, аналитик IT-аутсорсинговой компании. Анализируй финансовые данные и давай практичные наблюдения. Отвечай ТОЛЬКО валидным JSON без markdown.`,
      messages: [{
        role: "user",
        content: `Данные компании:\n${maskedDataContext}\n\n${tabPrompts[tab] || tabPrompts.analytics}\n\nОтветь JSON массивом:\n[{"type": "insight"|"warning"|"opportunity", "title": "краткий заголовок (3-5 слов)", "description": "описание на 1-2 предложения с конкретными цифрами из данных"}]`,
      }],
    })

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("")
    const observations = JSON.parse(piiMasker.unmask(rawText))

    return NextResponse.json({ success: true, data: { observations } })
  } catch (error) {
    console.error("Da Vinci observations error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
