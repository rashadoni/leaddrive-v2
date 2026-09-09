import { describe, expect, it } from "vitest"
import {
  CHAT_ANALYTICS_TOOLS,
  CHAT_ANALYTICS_TOOL_SCHEMAS,
  CRM_SECTION_GUIDE_KEYS,
  chatAnalyticsInputMatchesRequest,
  hasMixedChatAnalyticsIntent,
  requiredChatAnalyticsTool,
} from "@/lib/ai/chat-analytics-tools"

describe("chat analytics tool routing", () => {
  it.each([
    ["Сколько лидов было за сегодня?", "get_crm_period_report"],
    ["Дай отчет по продажам за этот месяц", "get_crm_period_report"],
    ["Bu gün neçə lid yaradılıb?", "get_crm_period_report"],
    ["Who completed the most tasks this week?", "get_crm_ranking"],
    ["Кто меньше всего закрыл сделок?", "get_crm_ranking"],
    ["Кто топ в KPI Arena?", "get_kpi_arena"],
    ["Что за раздел KPI-арена?", "explain_crm_section"],
    ["Количество лидов за 5 августа?", "get_crm_period_report"],
    ["Число сделок с 1 по 5 августа", "get_crm_period_report"],
    ["Итого продаж за 2026-08-01", "get_crm_period_report"],
    ["У кого наибольшее число сделок?", "get_crm_ranking"],
    ["Как пользоваться разделом Прогноз?", "explain_crm_section"],
    ["Расскажи про KPI Arena", "explain_crm_section"],
    ["What is this CRM section?", "explain_crm_section"],
    ["Продажи за 5 августа", "get_crm_period_report"],
    ["Лиды на 5 августа", "get_crm_period_report"],
    ["Sales on August 5", "get_crm_period_report"],
    ["Лиды вчера?", "get_crm_period_report"],
    ["Объясни раздел Финансы", "explain_crm_section"],
    ["Что такое раздел Финансы?", "explain_crm_section"],
    ["How many opportunities today?", "get_crm_period_report"],
    ["Кто выполнил меньше всего задач в этом месяце?", "get_crm_ranking"],
    ["Which employee completed the fewest tasks this month?", "get_crm_ranking"],
    ["Лиды за этот месяц?", "get_crm_period_report"],
    ["Сделки за эту неделю?", "get_crm_period_report"],
    ["Лиды на этот месяц?", "get_crm_period_report"],
    ["Лиды в этом месяце?", "get_crm_period_report"],
    ["Лиды за текущий месяц?", "get_crm_period_report"],
    ["Лиды за этот квартал?", "get_crm_period_report"],
    ["Лиды в этом квартале?", "get_crm_period_report"],
    ["Лиды за этот год?", "get_crm_period_report"],
    ["Лиды в этом году?", "get_crm_period_report"],
    ["Лиды за прошлую неделю?", "get_crm_period_report"],
    ["Сделки за текущую неделю?", "get_crm_period_report"],
    ["Продажи текущего месяца?", "get_crm_period_report"],
    ["Лиды за прошлый квартал?", "get_crm_period_report"],
    ["Leads last year?", "get_crm_period_report"],
    ["Keçən rübdə neçə lid olub?", "get_crm_period_report"],
    ["Лиды за предыдущую неделю?", "get_crm_period_report"],
    ["Leads in the previous year?", "get_crm_period_report"],
    ["Əvvəlki həftə neçə lid olub?", "get_crm_period_report"],
    ["Дай сводку лидов за текущий день", "get_crm_period_report"],
    ["Give me a lead summary for the current day", "get_crm_period_report"],
    ["Cari gün üzrə lid xülasəsi", "get_crm_period_report"],
    ["Кто эффективнее по сделкам в этом месяце?", "get_crm_ranking"],
  ])("forces evidence for %s", (message, tool) => {
    expect(requiredChatAnalyticsTool(message)).toBe(tool)
  })

  it("does not force analytics for ordinary CRM help", () => {
    expect(requiredChatAnalyticsTool("Как создать новую сделку?")).toBeNull()
  })

  it("never substitutes a total count for an ambiguous employee-efficiency question", () => {
    const message = "Кто эффективнее по сделкам в этом месяце?"
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_ranking")
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_ranking", {
      metric: "won_deals", direction: "top", period: "this_month", limit: 5,
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "Дай сводку лидов за текущий день",
    "Give me a lead summary for the current day",
    "Cari gün üzrə lid xülasəsi",
  ])("binds current-day summaries to verified lead evidence for %s", (message) => {
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "today",
    }, "2026-08-12")).toBe(true)
  })

  it("requires strict custom date keys and both inclusive endpoints", () => {
    const schema = CHAT_ANALYTICS_TOOL_SCHEMAS.get_crm_period_report
    expect(schema.safeParse({
      metric: "leads_created",
      period: "custom",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-11",
    }).success).toBe(true)
    expect(schema.safeParse({
      metric: "leads_created",
      period: "custom",
      dateFrom: "01.08.2026",
    }).success).toBe(false)
    expect(schema.safeParse({
      metric: "leads_created",
      period: "today",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-11",
    }).success).toBe(false)
  })

  it("advertises every server-maintained section guide key, including KPI Arena", () => {
    expect(CRM_SECTION_GUIDE_KEYS).toContain("leaderboard")
    expect(CRM_SECTION_GUIDE_KEYS).toContain("leads")
    expect(CRM_SECTION_GUIDE_KEYS).toContain("quotes")
    const tool = CHAT_ANALYTICS_TOOLS.find((entry) => entry.name === "explain_crm_section")
    const section = (tool?.input_schema.properties as Record<string, { enum?: string[] }>).section
    expect(section.enum).toEqual(CRM_SECTION_GUIDE_KEYS)
  })

  it("locks explicit entities, periods, directions, KPI dimensions and section aliases", () => {
    const date = "2026-08-12"
    expect(chatAnalyticsInputMatchesRequest("Сколько лидов за сегодня?", "get_crm_period_report", {
      metric: "leads_created", period: "today",
    }, date)).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("Сколько лидов за сегодня?", "get_crm_period_report", {
      metric: "deals_created", period: "all_time",
    }, date)).toBe(false)
    expect(chatAnalyticsInputMatchesRequest("Which employee completed the fewest tasks this month?", "get_crm_ranking", {
      metric: "completed_tasks", direction: "top", period: "this_month",
    }, date)).toBe(false)
    expect(chatAnalyticsInputMatchesRequest("Кто топ в KPI Arena по продажам за текущий квартал?", "get_kpi_arena", {
      group: "tasks", period: "year", direction: "top", sortBy: "volume",
    }, date)).toBe(false)
    expect(chatAnalyticsInputMatchesRequest("Кто топ в KPI Arena по продажам за текущий квартал?", "get_kpi_arena", {
      group: "sales", period: "quarter", direction: "top", sortBy: "kpi",
    }, date)).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("Что за раздел Лиды?", "explain_crm_section", { section: "deals" }, date)).toBe(false)
    expect(chatAnalyticsInputMatchesRequest("Что за раздел Лиды?", "explain_crm_section", { section: "leads" }, date)).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("Объясни раздел Отчёты", "explain_crm_section", { section: "contacts" }, date)).toBe(false)
    expect(chatAnalyticsInputMatchesRequest("Объясни раздел Отчёты", "explain_crm_section", { section: "reports" }, date)).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("Расскажи про раздел Счета", "explain_crm_section", { section: "invoices" }, date)).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("Расскажи про раздел Проекты", "explain_crm_section", { section: "projects" }, date)).toBe(true)
  })

  it("binds opportunity, proposal, won-sale and named-month semantics exactly", () => {
    const date = "2026-08-12"
    const metrics = [
      "leads_created", "deals_created", "sales_won", "quotes_created",
      "quotes_sent", "quotes_accepted", "tasks_completed", "tickets_resolved",
    ]
    const accepted = (message: string, input: Record<string, unknown>) => metrics.filter((metric) => (
      chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", { ...input, metric }, date)
    ))
    expect(accepted("How many opportunities today?", { period: "today" })).toEqual(["deals_created"])
    expect(accepted("Сколько отправленных предложений всего?", { period: "all_time" })).toEqual(["quotes_sent"])
    expect(accepted("Сколько принятых предложений сегодня?", { period: "today" })).toEqual(["quotes_accepted"])
    expect(accepted("Сколько созданных предложений сегодня?", { period: "today" })).toEqual(["quotes_created"])
    expect(accepted("Bu gün neçə sövdələşmə qazanılıb?", { period: "today" })).toEqual(["sales_won"])
    expect(accepted("Сколько закрытых сделок сегодня?", { period: "today" })).toEqual([])
    expect(accepted("Сколько лидов было за май?", {
      period: "custom", dateFrom: "2026-05-01", dateTo: "2026-05-31",
    })).toEqual(["leads_created"])
    expect(accepted("Сколько лидов было за май?", { period: "today" })).toEqual([])
  })

  it("fails closed for ranking semantics the current tools cannot prove", () => {
    const base = { direction: "top", limit: 5, period: "this_month" }
    for (const metric of ["won_deals", "created_leads", "completed_tasks", "resolved_tickets", "created_quotes"]) {
      expect(chatAnalyticsInputMatchesRequest(
        "Who has the most opportunities this month?",
        "get_crm_ranking",
        { ...base, metric },
        "2026-08-12",
      )).toBe(false)
    }
  })

  it.each([
    ["Сколько лидов за предыдущий месяц?", "last_month"],
    ["How many leads in the previous month?", "last_month"],
    ["Əvvəlki ay neçə lid olub?", "last_month"],
  ])("binds previous calendar month in %s", (message, period) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_period_report")
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period,
    }, "2026-08-12")).toBe(true)
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "today",
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "Сколько лидов за предыдущую неделю?",
    "How many leads in the previous week?",
    "Əvvəlki həftə neçə lid olub?",
  ])("fails closed for unsupported previous calendar week %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_period_report")
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "last_7_days",
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "В KPI Arena кто выполнил больше всего задач за месяц?",
    "In KPI Arena, who completed the most tasks this month?",
    "KPI Arenasında bu ay kim ən çox tapşırıq yerinə yetirib?",
  ])("locks explicit KPI activity counts to volume for %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_kpi_arena")
    const base = { group: "tasks", period: "month", direction: "top", limit: 5 }
    expect(chatAnalyticsInputMatchesRequest(message, "get_kpi_arena", {
      ...base, sortBy: "volume",
    }, "2026-08-12")).toBe(true)
    expect(chatAnalyticsInputMatchesRequest(message, "get_kpi_arena", {
      ...base, sortBy: "kpi",
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "В KPI Arena кто выполнил больше всего задач в прошлом месяце?",
    "In KPI Arena, who completed the most tasks last month?",
    "KPI Arenasında keçən ay kim ən çox tapşırıq yerinə yetirib?",
  ])("fails closed for unsupported historical KPI period %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_kpi_arena")
    expect(chatAnalyticsInputMatchesRequest(message, "get_kpi_arena", {
      group: "tasks", period: "month", direction: "top", sortBy: "volume", limit: 5,
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "Сколько лидов за прошлый квартал?",
    "Сколько лидов за прошлый год?",
    "How many leads last quarter?",
    "How many leads last year?",
    "Keçən rübdə neçə lid olub?",
    "Кто больше сделок выиграл в прошлом квартале?",
    "Who won the most deals last year?",
  ])("fails closed for unsupported historical period %s", (message) => {
    const tool = requiredChatAnalyticsTool(message)
    expect(tool).not.toBeNull()
    const input = tool === "get_crm_ranking"
      ? { metric: "won_deals", direction: "top", period: "this_quarter" }
      : { metric: "leads_created", period: "this_quarter" }
    expect(chatAnalyticsInputMatchesRequest(message, tool!, input, "2026-08-12")).toBe(false)
  })

  it.each([
    ["Сколько лидов 05.08.2026?", "2026-08-05", "2026-08-05"],
    ["Сколько лидов 05.08.26?", "2026-08-05", "2026-08-05"],
    ["Сколько лидов 5.8?", "2026-08-05", "2026-08-05"],
    ["Сколько лидов с 1 августа по 5 августа?", "2026-08-01", "2026-08-05"],
    ["How many leads from August 1 to August 5?", "2026-08-01", "2026-08-05"],
    ["1 avqustdan 5 avqusta neçə lid yaradılıb?", "2026-08-01", "2026-08-05"],
  ])("binds the full custom range in %s", (message, dateFrom, dateTo) => {
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "custom", dateFrom, dateTo,
    }, "2026-08-12")).toBe(true)
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "all_time",
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "Сколько сейчас открытых сделок?",
    "Сколько просроченных задач?",
    "How many unresolved tickets?",
    "How many active leads?",
  ])("rejects unsupported current-state semantics for %s", (message) => {
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
      metric: "leads_created", period: "all_time",
    }, "2026-08-12")).toBe(false)
  })

  it.each([
    "How many tasks were created today?",
    "Сколько задач было создано сегодня?",
    "How many tickets were created today?",
    "Bu gün neçə bilet yaradılıb?",
    "How many leads converted today?",
    "Сколько лидов конвертировано сегодня?",
    "How many deals were lost today?",
    "Bu gün neçə sövdələşmə uduzulub?",
  ])("rejects unsupported event substitution in period reports for %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_period_report")
    for (const metric of [
      "leads_created", "deals_created", "sales_won", "quotes_created",
      "quotes_sent", "quotes_accepted", "tasks_completed", "tickets_resolved",
    ]) {
      expect(chatAnalyticsInputMatchesRequest(message, "get_crm_period_report", {
        metric, period: "today",
      }, "2026-08-12")).toBe(false)
    }
  })

  it.each([
    "Who created the most deals this month?",
    "Кто создал больше всего задач в этом месяце?",
    "Bu ay ən çox bileti kim yaradıb?",
    "Who created the most leads this month?",
  ])("rejects unsupported attribution/event substitution in rankings for %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_ranking")
    for (const metric of [
      "won_deals", "answered_leads_by_call", "created_leads",
      "completed_tasks", "resolved_tickets", "created_quotes",
    ]) {
      expect(chatAnalyticsInputMatchesRequest(message, "get_crm_ranking", {
        metric, direction: "top", period: "this_month", limit: 5,
      }, "2026-08-12")).toBe(false)
    }
  })

  it("detects mixed section-help and numeric questions", () => {
    expect(hasMixedChatAnalyticsIntent("Что за раздел KPI Arena и сколько лидов было сегодня?")).toBe(true)
    expect(hasMixedChatAnalyticsIntent("Что за раздел KPI Arena?")).toBe(false)
    expect(hasMixedChatAnalyticsIntent("How many leads and deals were created today?")).toBe(true)
    expect(hasMixedChatAnalyticsIntent("Сколько выполненных задач и решённых тикетов сегодня?")).toBe(true)
    expect(hasMixedChatAnalyticsIntent("Who won most deals and completed most tasks this month?")).toBe(true)
    expect(hasMixedChatAnalyticsIntent("Explain KPI Arena and show top sales")).toBe(true)
    expect(hasMixedChatAnalyticsIntent("Create a task for this deal.")).toBe(false)
    expect(hasMixedChatAnalyticsIntent("How do I convert a lead into a deal?")).toBe(false)
    expect(hasMixedChatAnalyticsIntent("Кто выполнил больше всего задач в этом месяце?")).toBe(false)
  })

  it.each([
    "Кто выполнил больше всего задач в этом месяце?",
    "Bu ay ən çox tapşırığı kim tamamlayıb?",
  ])("accepts a verified completed-task ranking for %s", (message) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_ranking")
    expect(chatAnalyticsInputMatchesRequest(message, "get_crm_ranking", {
      metric: "completed_tasks",
      direction: "top",
      period: "this_month",
      limit: 5,
    }, "2026-08-12")).toBe(true)
  })

  it.each([
    ["How many tasks did I complete today?", "get_crm_period_report", { metric: "tasks_completed", period: "today" }],
    ["How many Google Ads leads today?", "get_crm_period_report", { metric: "leads_created", period: "today" }],
    ["How many high-value deals today?", "get_crm_period_report", { metric: "deals_created", period: "today" }],
    ["How many technical tickets were resolved today?", "get_crm_period_report", { metric: "tickets_resolved", period: "today" }],
    ["Total sales revenue this month", "get_crm_period_report", { metric: "sales_won", period: "this_month" }],
    ["Average deal value this month", "get_crm_period_report", { metric: "deals_created", period: "this_month" }],
    ["Compare leads this month vs last month", "get_crm_period_report", { metric: "leads_created", period: "this_month" }],
    ["Leads by day this month", "get_crm_period_report", { metric: "leads_created", period: "this_month" }],
    ["Show the sales ranking this month", "get_crm_ranking", { metric: "won_deals", direction: "top", period: "this_month", limit: 5 }],
    ["Who completed the most high-priority tasks this month?", "get_crm_ranking", { metric: "completed_tasks", direction: "top", period: "this_month", limit: 5 }],
    ["Who won the most enterprise deals this month?", "get_crm_ranking", { metric: "won_deals", direction: "top", period: "this_month", limit: 5 }],
  ])("forces evidence but rejects an unsupported scope/filter in %s", (message, tool, input) => {
    expect(requiredChatAnalyticsTool(message)).toBe(tool)
    expect(chatAnalyticsInputMatchesRequest(
      message,
      tool as "get_crm_period_report" | "get_crm_ranking",
      input,
      "2026-08-12",
    )).toBe(false)
  })

  it.each([
    ["Leads current week?", { metric: "leads_created", period: "this_week" }],
    ["Current quarter leads?", { metric: "leads_created", period: "this_quarter" }],
    ["QTD leads?", { metric: "leads_created", period: "this_quarter" }],
    ["WTD leads?", { metric: "leads_created", period: "this_week" }],
    ["YTD leads?", { metric: "leads_created", period: "this_year" }],
    ["August, 2025 lead count", { metric: "leads_created", period: "custom", dateFrom: "2025-08-01", dateTo: "2025-08-31" }],
    ["2025-ci ilin avqust ayında neçə lid olub?", { metric: "leads_created", period: "custom", dateFrom: "2025-08-01", dateTo: "2025-08-31" }],
    ["Q2 leads?", { metric: "leads_created", period: "custom", dateFrom: "2026-04-01", dateTo: "2026-06-30" }],
    ["2025 leads?", { metric: "leads_created", period: "custom", dateFrom: "2025-01-01", dateTo: "2025-12-31" }],
    ["Cari ayda neçə lid olub?", { metric: "leads_created", period: "this_month" }],
  ])("binds a supported terse calendar period in %s", (message, input) => {
    expect(requiredChatAnalyticsTool(message)).toBe("get_crm_period_report")
    expect(chatAnalyticsInputMatchesRequest(
      message,
      "get_crm_period_report",
      input,
      "2026-08-12",
    )).toBe(true)
  })

  it("uses the most recent past occurrence for an omitted named-month year", () => {
    expect(chatAnalyticsInputMatchesRequest("How many leads in December?", "get_crm_period_report", {
      metric: "leads_created",
      period: "custom",
      dateFrom: "2025-12-01",
      dateTo: "2025-12-31",
    }, "2026-01-10")).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("How many leads in December?", "get_crm_period_report", {
      metric: "leads_created",
      period: "custom",
      dateFrom: "2026-12-01",
      dateTo: "2026-12-31",
    }, "2026-01-10")).toBe(false)
  })

  it("binds KPI group, calendar period, measure, direction and explicit limit", () => {
    expect(chatAnalyticsInputMatchesRequest(
      "Who ranks first in KPI Arena for tasks this month?",
      "get_kpi_arena",
      { group: "tasks", period: "month", direction: "top", sortBy: "kpi", limit: 5 },
      "2026-08-12",
    )).toBe(true)
    expect(chatAnalyticsInputMatchesRequest(
      "Who has the highest sales revenue in KPI Arena this quarter?",
      "get_kpi_arena",
      { group: "sales", period: "quarter", direction: "top", sortBy: "volume", limit: 5 },
      "2026-08-12",
    )).toBe(true)
    expect(chatAnalyticsInputMatchesRequest(
      "Top 3 employees who completed tasks this month",
      "get_crm_ranking",
      { metric: "completed_tasks", direction: "top", period: "this_month", limit: 10 },
      "2026-08-12",
    )).toBe(false)
    expect(chatAnalyticsInputMatchesRequest(
      "Top 3 employees who completed tasks this month",
      "get_crm_ranking",
      { metric: "completed_tasks", direction: "top", period: "this_month", limit: 3 },
      "2026-08-12",
    )).toBe(true)
  })

  it("does not misread the English modal may as the month of May", () => {
    expect(chatAnalyticsInputMatchesRequest("How many quotes may have been sent today?", "get_crm_period_report", {
      metric: "quotes_sent", period: "today",
    }, "2026-08-12")).toBe(true)
    expect(chatAnalyticsInputMatchesRequest("How many quotes may have been sent today?", "get_crm_period_report", {
      metric: "quotes_sent", period: "custom", dateFrom: "2026-05-01", dateTo: "2026-05-31",
    }, "2026-08-12")).toBe(false)
  })
})
