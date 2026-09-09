import { describe, expect, it } from "vitest"
import { renderChatAnalyticsEvidence } from "@/lib/ai/chat-analytics-renderer"
import { CRM_SECTION_GUIDE_KEYS } from "@/lib/ai/chat-analytics-tools"

describe("renderChatAnalyticsEvidence", () => {
  it("renders the exact tool value without internal identifiers or timezone recitals", () => {
    const reply = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "leads_created",
      value: 2,
      basisField: "Lead.createdAt",
      period: { label: "2026-08-11", timezone: "Asia/Baku" },
      caveats: [],
    }, "ru")
    expect(reply).toContain("2026-08-11")
    expect(reply).toContain("созданные лиды — 2")
    expect(reply).not.toContain("Lead.createdAt")
    expect(reply).not.toContain("Asia/Baku")
    expect(reply).not.toContain("30")
    expect(reply).not.toContain("50")
  })

  it("speaks won sales like a colleague: money and lost count in, internals out", () => {
    const reply = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "sales_won",
      value: 1,
      lostCount: 3,
      money: { amount: 5000, currency: "AZN", mixedCurrencies: false },
      basisField: "PipelineStageTransition.transitionedAt (transitionType=won)",
      metricDefinition: "Deals with a recorded transition into a won stage during the reporting period",
      period: { label: "2026-07-19 — 2026-08-18", timezone: "UTC" },
      coverage: { wonDealsWithoutHistory: 89 },
      caveats: ["89 currently-won deals have no recorded won transition and cannot be assigned to this period."],
    }, "az")
    expect(reply).toContain("qazanılmış sövdələşmələr — 1")
    expect(reply).toContain("5.000 AZN")
    expect(reply).toContain("itirilmiş — 3")
    expect(reply).toContain("Qeyd")
    expect(reply).toContain("89")
    expect(reply).not.toContain("PipelineStageTransition")
    expect(reply).not.toContain("transitionedAt")
    expect(reply).not.toContain("Tərif")
    expect(reply).not.toContain("Hesablamanın əsası")
    expect(reply).not.toContain("saat qurşağı")
    expect(reply).not.toContain("UTC")
    // The executor's English caveat strings must never surface verbatim.
    expect(reply).not.toContain("currently-won")
  })

  it("discloses mixed currencies and the created-vs-won distinction", () => {
    const mixed = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "sales_won",
      value: 4,
      lostCount: 0,
      money: { amount: 1200, currency: "USD", mixedCurrencies: true },
      period: { label: "август", timezone: "UTC" },
      coverage: { wonDealsWithoutHistory: 0 },
      caveats: [],
    }, "ru")
    expect(mixed).toContain("валюте большинства")

    const created = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "deals_created",
      value: 7,
      period: { label: "август", timezone: "UTC" },
      caveats: [],
    }, "ru")
    expect(created).toContain("а не выигранных")
  })

  it("never asserts counts absent from evidence and keeps ru number agreement at 1", () => {
    const noLost = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "sales_won",
      value: 2,
      period: { label: "август", timezone: "UTC" },
      coverage: { wonDealsWithoutHistory: 1 },
      caveats: [],
    }, "ru")
    expect(noLost).not.toContain("проиграно")
    expect(noLost).toContain("у 1 выигранной сделки")

    const ranking = renderChatAnalyticsEvidence({
      kind: "crm_ranking",
      metric: "resolved_tickets",
      direction: "top",
      period: { label: "август", timezone: "UTC" },
      rows: [{ name: "Manager B", count: 2 }],
      caveats: [],
    }, "ru")
    expect(ranking).toContain("засчитывается его ответственному")
  })

  it("renders only ranked names/counts from evidence and discloses bottom scope", () => {
    const reply = renderChatAnalyticsEvidence({
      kind: "crm_ranking",
      metric: "completed_tasks",
      direction: "bottom",
      basisField: "Task.completedAt + assignedTo",
      period: { label: "2026-08-01 — 2026-08-11", timezone: "Asia/Baku" },
      rows: [{ name: "Manager B", count: 2 }],
      caveats: [],
    }, "en")
    expect(reply).toContain("Manager B — 2")
    expect(reply).toContain("zero activity")
    expect(reply).not.toContain("Manager A")
  })

  it.each([
    ["az", "leads", "Lidlər", "potensial müştərilərin"],
    ["az", "deals", "Sövdələşmələr", "satış imkanlarının"],
    ["az", "quotes", "Kommersiya təklifləri", "qiymət və şərtlərin"],
    ["az", "leaderboard", "KPI Arena", "KPI faizi"],
    ["en", "leads", "Leads", "prospective customers"],
    ["en", "deals", "Deals", "sales opportunities"],
    ["en", "quotes", "Quotes", "prices, and terms"],
    ["en", "leaderboard", "KPI Arena", "KPI percentage"],
  ])("renders verified %s section help for %s without leaking raw Russian", (locale, section, title, detail) => {
    const reply = renderChatAnalyticsEvidence({
      kind: "crm_section_guide",
      section,
      whatItIs: "Русский проверенный текст.",
      howItWorks: "Ещё русский текст.",
    }, locale)
    expect(reply).toContain(title)
    expect(reply).toContain(detail)
    expect(reply).not.toContain("Русский")
    expect(reply).not.toContain("Ещё")
  })

  it("returns deterministic localized help for every advertised safe section", () => {
    for (const locale of ["az", "en"] as const) {
      for (const section of CRM_SECTION_GUIDE_KEYS) {
        const reply = renderChatAnalyticsEvidence({
          kind: "crm_section_guide",
          section,
          whatItIs: "Русский исходник.",
          howItWorks: "Русская механика.",
        }, locale)
        expect(reply, `${locale}:${section}`).not.toBe("")
        expect(reply, `${locale}:${section}`).not.toContain("Русск")
      }
    }
  })

  it("keeps the audited detailed guide for Russian", () => {
    const reply = renderChatAnalyticsEvidence({
      kind: "crm_section_guide",
      section: "leads",
      whatItIs: "Лиды — карточки потенциальных клиентов.",
      howItWorks: "Откройте карточку лида и проверьте статус.",
      keyFeatures: ["Канбан"],
    }, "ru")
    expect(reply).toContain("Проверенное описание раздела")
    expect(reply).toContain("карточки потенциальных клиентов")
    expect(reply).toContain("Канбан")
  })

  it("localizes Azerbaijani numeric boilerplate and KPI period semantics", () => {
    const periodReply = renderChatAnalyticsEvidence({
      kind: "crm_period_report",
      metric: "leads_created",
      value: 2,
      basisField: "Lead.createdAt",
      period: { label: "2026-08-11", timezone: "Asia/Baku" },
      caveats: [],
    }, "az")
    expect(periodReply).toContain("yaradılmış lidlər — 2")
    expect(periodReply).not.toContain("Lead.createdAt")
    expect(periodReply).not.toContain("Definition:")
    expect(periodReply).not.toContain("Определение:")

    const kpiReply = renderChatAnalyticsEvidence({
      kind: "kpi_arena_ranking",
      group: "sales",
      requestedPeriod: "month",
      appliedPeriod: "current_quarter",
      rows: [{ name: "A", attainmentPct: 95, volume: 4 }],
      periodSemantics: "Sales KPI is quota-based and always uses the current quarter.",
    }, "az")
    expect(kpiReply).toContain("Satış")
    expect(kpiReply).toContain("cari rüb")
    expect(kpiReply).toContain("həcm 4")
    expect(kpiReply).not.toContain("Sales KPI")
    expect(kpiReply).not.toContain("volume")
    expect(kpiReply).not.toContain("текущий квартал")
  })
})
