import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import type { CostModelResult } from "./types"

const MODEL = process.env.MANAGER_MODEL || "claude-sonnet-4-5-20250929"

function buildBaseContext(result: CostModelResult): string {
  const s = result.summary
  return `Бизнес-контекст:
- IT-аутсорсинговая компания «LeadDrive Inc.», Warsaw, Poland
- 7 направлений услуг: HelpDesk, SysAdmin, InfoSec, ERP, GRC, PM, Cloud
- В 2026 году цены подняты на 15%
- BackOffice (${result.employees.filter(e => e.department === 'BackOffice').reduce((s,e) => s + e.count, 0)} чел.) — overhead, расходы распределяются на клиентов

Ключевые показатели:
- Активные клиенты: ${s.totalClients} (${s.profitableClients} прибыльных, ${s.lossClients} убыточных)
- Общий доход/мес: ${s.totalRevenue.toLocaleString()} ₼
- Общая себестоимость/мес (Section G): ${result.grandTotalG.toLocaleString()} ₼
- Маржа/мес: ${s.totalMargin.toLocaleString()} ₼ (${s.marginPct}%)
- Себестоимость на пользователя: ${result.costPerUserF} ₼ (Section F)
- Сотрудников: ${result.totalHeadcount} | Пользователей: ${result.totalUsers}`
}

// Build 5 tab-specific prompts
function buildTabData(tab: string, result: CostModelResult): string {
  switch (tab) {
    case "analytics": {
      // Department summary
      const deptLines = Object.entries(result.deptCosts).map(([d, c]) => `  ${d}: ${c.toLocaleString()} ₼`).join('\n')

      // Top 10 clients
      const topClients = [...result.clients].sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, 10)
      const clientLines = topClients.map(c => `  ${c.name}: доход ${c.totalRevenue.toLocaleString()} ₼, ${c.userCount} юзеров, маржа ${c.marginPct}%`).join('\n')

      // Top overhead
      const topOh = [...result.overheadBreakdown].sort((a,b) => b.monthlyAmount - a.monthlyAmount).slice(0, 10)
      const ohLines = topOh.map(o => `  ${o.label}: ${o.monthlyAmount.toLocaleString()} ₼/мес (${o.category})`).join('\n')

      return `\nРаспределение затрат по отделам:\n${deptLines}\n\nТоп-10 клиентов по доходу:\n${clientLines}\n\nТоп-10 накладных расходов:\n${ohLines}`
    }
    case "services": {
      const svcLines = Object.entries(result.serviceCosts).map(([svc, cost]) => {
        const rev = result.serviceRevenues[svc] || 0
        const detail = result.serviceDetails[svc]
        const clients = result.serviceClients[svc] || 0
        return `  ${svc}: затраты ${cost.toLocaleString()} ₼, доход ${rev.toLocaleString()} ₼, баланс ${(rev - cost).toLocaleString()} ₼, ${detail?.headcount || 0} чел., ${clients} клиентов`
      }).join('\n')

      const deptLines = Object.entries(result.deptCosts).map(([d, c]) => {
        const hc = result.employees.filter(e => e.department === d).reduce((s,e) => s + e.count, 0)
        return `  ${d}: ${hc} чел., ФОТ ${c.toLocaleString()} ₼`
      }).join('\n')

      return `\nСервисные направления (затраты vs доход):\n${svcLines}\n\nОтделы:\n${deptLines}`
    }
    case "clients": {
      const top20 = [...result.clients].sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, 20)
      const clientLines = top20.map(c => `  ${c.name}: ${c.userCount} юзеров, доход ${c.totalRevenue.toLocaleString()} ₼, затраты ${c.totalCost.toLocaleString()} ₼, маржа ${c.marginPct}% [${c.status}]`).join('\n')

      const zeroRev = result.clients.filter(c => c.totalRevenue === 0).slice(0, 15)
      const zeroLines = zeroRev.map(c => `  ${c.name} (${c.userCount} юзеров)`).join('\n')

      const payingClients = result.clients.filter(c => c.totalRevenue > 0)
      const avgRev = payingClients.length > 0 ? result.summary.totalRevenue / payingClients.length : 0
      const avgPerUser = result.totalUsers > 0 ? result.summary.totalRevenue / result.totalUsers : 0

      return `\nТоп-20 клиентов:\n${clientLines}\n\nКлиенты без дохода:\n${zeroLines || '  (нет)'}\n\nСредний доход на клиента: ${avgRev.toFixed(0)} ₼\nСредний доход на пользователя: ${avgPerUser.toFixed(2)} ₼`
    }
    case "overhead": {
      const sorted = [...result.overheadBreakdown].sort((a,b) => b.monthlyAmount - a.monthlyAmount)
      const ohLines = sorted.map(o => {
        const flags = [o.isAnnual ? '(illik÷12)' : '', o.hasVat ? '(+ƏDV)' : ''].filter(Boolean).join(' ')
        return `  ${o.label}: ${o.monthlyAmount.toLocaleString()} ₼/мес ${flags} [${o.category}]`
      }).join('\n')

      // Group by category
      const byCat: Record<string, number> = {}
      for (const o of sorted) {
        byCat[o.category] = (byCat[o.category] || 0) + o.monthlyAmount
      }
      const catLines = Object.entries(byCat).sort((a,b) => b[1] - a[1]).map(([c, v]) => `  ${c}: ${v.toLocaleString()} ₼`).join('\n')

      const ohPctRev = result.summary.totalRevenue > 0 ? (result.totalOverhead / result.summary.totalRevenue * 100).toFixed(1) : '∞'
      const ohPerEmp = result.totalHeadcount > 0 ? (result.totalOverhead / result.totalHeadcount).toFixed(0) : '0'

      return `\nВсе накладные расходы:\n${ohLines}\n\nПо категориям:\n${catLines}\n\nOverhead как % от дохода: ${ohPctRev}%\nOverhead на сотрудника: ${ohPerEmp} ₼`
    }
    case "employees": {
      const empLines = result.employees.map(e => {
        const burdened = e.superGross * e.count
        const flag = e.inOverhead ? ' [OVERHEAD]' : ''
        return `  ${e.department} / ${e.position}: ${e.count} чел., net ${e.netSalary.toLocaleString()} ₼, burdened ${e.superGross.toLocaleString()} ₼, итого ${burdened.toLocaleString()} ₼${flag}`
      }).join('\n')

      // By department
      const byDept: Record<string, { hc: number; cost: number }> = {}
      for (const e of result.employees) {
        if (!byDept[e.department]) byDept[e.department] = { hc: 0, cost: 0 }
        byDept[e.department].hc += e.count
        byDept[e.department].cost += e.superGross * e.count
      }
      const deptLines = Object.entries(byDept).map(([d, v]) => `  ${d}: ${v.hc} чел., ФОТ ${v.cost.toLocaleString()} ₼`).join('\n')

      const totalNet = result.employees.reduce((s, e) => s + e.netSalary * e.count, 0)
      const totalBurdened = result.employees.reduce((s, e) => s + e.superGross * e.count, 0)
      const avgNet = result.totalHeadcount > 0 ? totalNet / result.totalHeadcount : 0
      const revPerEmp = result.totalHeadcount > 0 ? result.summary.totalRevenue / result.totalHeadcount : 0

      return `\nШтатное расписание:\n${empLines}\n\nПо отделам:\n${deptLines}\n\nОбщий ФОТ (net): ${totalNet.toLocaleString()} ₼\nОбщий ФОТ (burdened): ${totalBurdened.toLocaleString()} ₼\nСредняя зарплата (net): ${avgNet.toFixed(0)} ₼\nДоход на сотрудника: ${revPerEmp.toFixed(0)} ₼`
    }
    default:
      return ""
  }
}

const STRUCTURE = `
Формат ответа (строго):
1. 📊 Общая оценка (2-3 предложения)
2. ⚠️ Ключевые риски (2-4 пункта)
3. 💡 Рекомендации (3-5 конкретных действий с цифрами)
4. 🔍 Наблюдения (2-3 паттерна в данных)`

const LANG_MAP: Record<string, string> = {
  ru: "Напиши анализ на РУССКОМ языке.",
  en: "Write the analysis in ENGLISH.",
  az: "Analizi AZƏRBAYCAN dilində yaz.",
}

export async function analyzeTab(
  tab: string,
  result: CostModelResult,
  lang: string = "ru",
): Promise<{ analysis: string; thinking: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured")
  }

  // Heavy call: 16k max_tokens + 10k extended-thinking budget can run well past
  // the factory's 45s default. Give it a generous-but-bounded window (the pre-factory
  // behaviour was the SDK's 10-min default, which worked); maxRetries:0 so a stalled
  // expensive call fails fast rather than doubling the wall-clock.
  const client = getAnthropicClient({ apiKey, timeout: 240_000, maxRetries: 0 })

  const baseContext = buildBaseContext(result)
  const tabData = buildTabData(tab, result)
  const langInstruction = LANG_MAP[lang] || LANG_MAP.ru

  const wordLimits: Record<string, number> = {
    analytics: 400,
    services: 350,
    clients: 350,
    overhead: 350,
    employees: 350,
  }
  const limit = wordLimits[tab] || 350

  const fullPrompt = `Ты — финансовый аналитик IT-аутсорсинговой компании.

${baseContext}
${tabData}

${langInstruction}
Лимит: ${limit} слов.
${STRUCTURE}

Используй конкретные цифры из данных. Будь прямолинеен и практичен.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "enabled", budget_tokens: 10000 },
    messages: [{ role: "user", content: fullPrompt }],
  })

  let analysisText = ""
  let thinkingText = ""

  for (const block of response.content) {
    if (block.type === "thinking") {
      thinkingText = block.thinking
    } else if (block.type === "text") {
      analysisText = block.text
    }
  }

  return { analysis: analysisText, thinking: thinkingText }
}
