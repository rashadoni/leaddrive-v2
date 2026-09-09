import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdvisorPayload, AdvisorSignal } from "@/lib/ai/advisor/types"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    proactiveAlert: { findFirst: vi.fn(), create: vi.fn() },
    aiInteractionLog: { create: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    aiShadowAction: { count: vi.fn() },
  },
}))

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async (_orgId: string, _role: string, entityType: string) => {
    if (entityType === "deal") return { valueAmount: "hidden", probability: "hidden" }
    if (entityType === "contact") return { email: "hidden" }
    if (entityType === "invoice") return { balanceDue: "hidden" }
    if (entityType === "mtm_visit") return { customerId: "hidden" }
    return {}
  }),
}))

vi.mock("@/lib/ai/advisor/signals", () => ({
  collectAdvisorSignals: vi.fn(async () => []),
  collectAdvisorSignalsWithHealth: vi.fn(async () => ({ signals: [], health: [] })),
  normalizeAdvisorSignalMetric: (signal: AdvisorSignal) => ({
    ...signal,
    metric: signal.metric || (signal.amount
      ? { kind: "money", label: "Money at risk", value: signal.amount, unit: signal.currency || "AZN", formatted: `${signal.amount.toLocaleString()} ${signal.currency || "AZN"}` }
      : { kind: "count", label: "Facts", value: signal.facts.length, formatted: signal.facts.length.toLocaleString() }),
  }),
}))

import { prisma } from "@/lib/prisma"
import { collectAdvisorSignalsWithHealth } from "@/lib/ai/advisor/signals"
import { answerAdvisorQuestion, buildAdvisorAuditTools, checkAdvisorQueryGovernance, filterAdvisorPayload, inferAdvisorIntent, inferAdvisorQueryRouting, redactAdvisorAuditText, redactSignalsForRole, scopeSignalsForUser, syncAdvisorProactiveAlerts } from "@/lib/ai/advisor/service"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.proactiveAlert.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.proactiveAlert.create).mockResolvedValue({} as never)
  vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as never)
})

describe("advisor query intent", () => {
  it("routes business questions to deterministic domains", () => {
    expect(inferAdvisorIntent("Where is money at risk?")).toBe("money")
    expect(inferAdvisorIntent("Какие маршруты требуют внимания?")).toBe("routes")
    expect(inferAdvisorIntent("Which logistics deliveries are stuck?")).toBe("routes")
    expect(inferAdvisorIntent("Что с доставкой по маршрутам?")).toBe("routes")
    expect(inferAdvisorIntent("Which SLA risks are open?")).toBe("support")
    expect(inferAdvisorIntent("Which managers are behind the monthly plan?")).toBe("kpi")
    expect(inferAdvisorIntent("Which quotes are waiting for buyer decision?")).toBe("sales")
    expect(inferAdvisorIntent("Какие КП зависли после отправки?")).toBe("sales")
    expect(inferAdvisorIntent("Что по просроченным задачам?")).toBe("tasks")
    expect(inferAdvisorIntent("Which deals are stalled?")).toBe("sales")
  })

  it("extracts explicit query routing from domain, severity, owner, metric and date words", () => {
    const routing = inferAdvisorQueryRouting("Which critical money risks for Owner One this week?", [
      signal({ ownerId: "owner-1", ownerLabel: "Owner One" }),
    ])

    expect(routing).toMatchObject({
      intent: "money",
      domains: ["finance", "sales", "contracts"],
      severities: ["critical"],
      metricKinds: ["money"],
      owner: { key: "owner-1", label: "Owner One" },
      dateScope: "week",
    })
  })
})

describe("advisor field redaction", () => {
  it("removes hidden monetary facts and amounts from signals", async () => {
    const [redacted] = await redactSignalsForRole("org-1", "sales", [
      signal({
        entityType: "deal",
        amount: 2000,
        facts: [
          { label: "Value", value: "2,000 AZN" },
          { label: "Probability", value: "60%" },
          { label: "Stage", value: "PROPOSAL" },
        ],
      }),
    ])

    expect(redacted.amount).toBeNull()
    expect(redacted.facts).toEqual([{ label: "Stage", value: "PROPOSAL" }])
  })

  it("removes hidden contact email facts", async () => {
    const [redacted] = await redactSignalsForRole("org-1", "support", [
      signal({
        entityType: "contact",
        facts: [
          { label: "Email", value: "client@example.com" },
          { label: "Company", value: "Acme" },
        ],
      }),
    ])

    expect(redacted.facts).toEqual([{ label: "Company", value: "Acme" }])
  })

  it("redacts hidden finance amounts from signal facts, summary and action payloads", async () => {
    const [redacted] = await redactSignalsForRole("org-1", "sales", [
      signal({
        entityType: "invoice",
        amount: 12500,
        summary: "12,500 AZN is still unpaid after 12 days.",
        facts: [
          { label: "Balance due", value: "12,500 AZN" },
          { label: "Status", value: "sent" },
        ],
        recommendedActions: [{
          actionType: "create_task",
          label: "Collect invoice",
          risk: "medium",
          payload: {
            title: "Collect invoice",
            description: "Invoice balance is 12,500 AZN and should be reviewed.",
          },
        }],
      }),
    ])

    expect(redacted.amount).toBeNull()
    expect(redacted.metric).toEqual({ kind: "count", label: "Facts", value: 1, formatted: "1" })
    expect(redacted.summary).toBe("[hidden amount] is still unpaid after 12 days.")
    expect(redacted.facts).toEqual([{ label: "Status", value: "sent" }])
    expect(redacted.recommendedActions[0]?.payload).toMatchObject({
      description: "Invoice balance is [hidden amount] and should be reviewed.",
    })
  })

  it("removes hidden MTM customer facts from visit signals", async () => {
    const [redacted] = await redactSignalsForRole("org-1", "sales", [
      signal({
        domain: "routes",
        domainLabel: "Routes",
        entityType: "mtm_visit",
        entityId: "visit-1",
        facts: [
          { label: "Agent", value: "Leyla" },
          { label: "Customer", value: "Bravo 28 May" },
          { label: "Open minutes", value: "94" },
          { label: "Status", value: "CHECKED_IN" },
        ],
      }),
    ])

    expect(redacted.facts).toEqual([
      { label: "Agent", value: "Leyla" },
      { label: "Open minutes", value: "94" },
      { label: "Status", value: "CHECKED_IN" },
    ])
  })

})

describe("advisor user scope", () => {
  it("keeps managers org-wide and limits regular users to owned signals", () => {
    const signals = [
      signal({ id: "owned", ownerId: "user-1" }),
      signal({ id: "other", ownerId: "user-2" }),
      signal({ id: "self-kpi", domain: "kpi", entityType: "user", entityId: "user-1" }),
      signal({ id: "unowned", ownerId: null }),
    ]

    expect(scopeSignalsForUser(signals, "manager", "user-1").map((item) => item.id)).toEqual([
      "owned",
      "other",
      "self-kpi",
      "unowned",
    ])
    expect(scopeSignalsForUser(signals, "sales", "user-1").map((item) => item.id)).toEqual([
      "owned",
      "self-kpi",
    ])
  })
})

describe("advisor payload filtering", () => {
  it("scopes record widgets to the selected entity and rebuilds the overview", () => {
    const payload = advisorPayload([
      signal({
        id: "sales:stalled_deal:deal-1",
        entityType: "deal",
        entityId: "deal-1",
        domain: "sales",
        severity: "critical",
        amount: 1200,
      }),
      signal({
        id: "support:sla:ticket-1",
        entityType: "ticket",
        entityId: "ticket-1",
        domain: "support",
        severity: "high",
        amount: 300,
      }),
    ])

    const filtered = filterAdvisorPayload(payload, { entityType: "deal", entityId: "deal-1" })

    expect(filtered.signals).toHaveLength(1)
    expect(filtered.signals[0]).toMatchObject({ entityType: "deal", entityId: "deal-1" })
    expect(filtered.overview).toMatchObject({
      totalSignals: 1,
      critical: 1,
      high: 0,
      revenueAtRisk: 1200,
      pendingActions: 2,
    })
  })

  it("keeps source-linked risks visible on related record widgets", () => {
    const payload = advisorPayload([
      signal({
        id: "finance:invoice_overdue:invoice-1",
        domain: "finance",
        entityType: "invoice",
        entityId: "invoice-1",
        severity: "critical",
        amount: 5000,
        sources: [
          { label: "INV-1", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" },
          { label: "Contract A", entityType: "contract", entityId: "contract-1", href: "/contracts/contract-1" },
        ],
      }),
      signal({
        id: "sales:deal-1",
        domain: "sales",
        entityType: "deal",
        entityId: "deal-1",
      }),
    ])

    const filtered = filterAdvisorPayload(payload, { entityType: "contract", entityId: "contract-1" })

    expect(filtered.signals).toHaveLength(1)
    expect(filtered.signals[0]).toMatchObject({
      id: "finance:invoice_overdue:invoice-1",
      entityType: "invoice",
      entityId: "invoice-1",
    })
    expect(filtered.overview).toMatchObject({
      totalSignals: 1,
      critical: 1,
      revenueAtRisk: 5000,
    })
  })

  it("filters the Advisor Center by domain and severity without changing capabilities", () => {
    const payload = advisorPayload([
      signal({ id: "sales:deal-1", domain: "sales", severity: "high" }),
      signal({ id: "support:ticket-1", entityType: "ticket", entityId: "ticket-1", domain: "support", severity: "critical" }),
      signal({ id: "support:ticket-2", entityType: "ticket", entityId: "ticket-2", domain: "support", severity: "medium" }),
    ])

    const filtered = filterAdvisorPayload(payload, { domain: "support", severity: "critical" })

    expect(filtered.signals).toHaveLength(1)
    expect(filtered.signals[0]).toMatchObject({ domain: "support", severity: "critical" })
    expect(filtered.capabilities).toBe(payload.capabilities)
    expect(filtered.overview).toMatchObject({
      totalSignals: 1,
      critical: 1,
      medium: 0,
      revenueAtRisk: 0,
    })
  })
})

describe("advisor query governance", () => {
  it("allows advisor questions when tenant is below budget and daily request cap", async () => {
    vi.mocked(prisma.aiInteractionLog.aggregate).mockResolvedValue({ _sum: { costUsd: 0 } } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { aiDailyBudgetUsd: 5, aiAdvisorDailyRequestLimit: 2 } } as never)
    vi.mocked(prisma.aiInteractionLog.count).mockResolvedValue(1 as never)

    await expect(checkAdvisorQueryGovernance("org-1")).resolves.toMatchObject({
      allowed: true,
      limit: 2,
      used: 1,
    })
  })

  it("blocks advisor questions when daily AI budget is exhausted", async () => {
    vi.mocked(prisma.aiInteractionLog.aggregate).mockResolvedValue({ _sum: { costUsd: 6 } } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { aiDailyBudgetUsd: 5, aiAdvisorDailyRequestLimit: 10 } } as never)
    vi.mocked(prisma.aiInteractionLog.count).mockResolvedValue(0 as never)

    await expect(checkAdvisorQueryGovernance("org-1")).resolves.toMatchObject({
      allowed: false,
      reason: "Daily AI budget exceeded: $6/$5",
    })
  })

  it("blocks advisor questions when tenant daily advisor request cap is reached", async () => {
    vi.mocked(prisma.aiInteractionLog.aggregate).mockResolvedValue({ _sum: { costUsd: 0 } } as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { aiDailyBudgetUsd: 5, aiAdvisorDailyRequestLimit: 2 } } as never)
    vi.mocked(prisma.aiInteractionLog.count).mockResolvedValue(2 as never)

    await expect(checkAdvisorQueryGovernance("org-1")).resolves.toMatchObject({
      allowed: false,
      reason: "Daily Advisor request limit exceeded: 2/2",
      limit: 2,
      used: 2,
    })
  })
})

describe("advisor audit metadata", () => {
  it("redacts obvious PII from Advisor audit text", () => {
    expect(redactAdvisorAuditText("Contact john.smith@example.com or +994 50 123 45 67 today")).toBe(
      "Contact [redacted-email] or [redacted-phone] today",
    )
  })

  it("records intent, query scope and source refs in AI interaction tools", () => {
    expect(buildAdvisorAuditTools({
      userId: "manager-1",
      role: "manager",
      intent: "sales",
      domains: ["sales", "crm"],
      totalSignals: 12,
      filteredSignals: 5,
      returnedSignals: 3,
      sources: [
        { label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" },
        { label: "Deal duplicate", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" },
        { label: "Quote", entityType: "quote", entityId: "quote-1", href: "/quotes/quote-1" },
      ],
    })).toEqual([
      "advisor_signals",
      "user:manager-1",
      "role:manager",
      "intent:sales",
      "domains:sales,crm",
      "signals:3/5/12",
      "source:deal:deal-1",
      "source:quote:quote-1",
    ])
  })
})

describe("advisor proactive alert sync", () => {
  it("stores only active high-priority Advisor exceptions and keeps source context", async () => {
    vi.mocked(prisma.proactiveAlert.findFirst).mockResolvedValue(null as never)

    await syncAdvisorProactiveAlerts("org-1", [
      signal({
        id: "finance:overdue_invoice:invoice-1",
        domain: "finance",
        domainLabel: "Finance",
        entityType: "invoice",
        entityId: "invoice-1",
        title: "Invoice is overdue",
        summary: "Payment is 14 days overdue.",
        severity: "critical",
        facts: [{ label: "Overdue days", value: "14" }],
        sources: [{ label: "INV-1", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" }],
        detectedAt: "2026-06-27T00:00:00.000Z",
      }),
      signal({
        id: "tasks:aging:task-1",
        domain: "tasks",
        domainLabel: "Tasks",
        entityType: "task",
        entityId: "task-1",
        title: "Task is aging",
        severity: "medium",
      }),
    ])

    expect(prisma.proactiveAlert.create).toHaveBeenCalledTimes(1)
    expect(prisma.proactiveAlert.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        triggerType: "custom",
        severity: "critical",
        entityType: "invoice",
        entityId: "invoice-1",
        message: "Invoice is overdue",
        context: {
          advisor: true,
          advisorSignalId: "finance:overdue_invoice:invoice-1",
          domain: "finance",
          summary: "Payment is 14 days overdue.",
          facts: [{ label: "Overdue days", value: "14" }],
          sources: [{ label: "INV-1", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" }],
          detectedAt: "2026-06-27T00:00:00.000Z",
        },
      },
    })
  })

  it("does not duplicate active Advisor proactive alerts", async () => {
    vi.mocked(prisma.proactiveAlert.findFirst).mockResolvedValue({ id: "existing-alert" } as never)

    await syncAdvisorProactiveAlerts("org-1", [
      signal({
        id: "support:sla:ticket-1",
        domain: "support",
        entityType: "ticket",
        entityId: "ticket-1",
        severity: "high",
        title: "Ticket is at SLA risk",
      }),
    ])

    expect(prisma.proactiveAlert.create).not.toHaveBeenCalled()
  })
})

describe("advisor localized answers", () => {
  it("ranks matched signals by question terms after deterministic intent routing", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "tier-5", modules: { sales: true, analytics: true }, addons: [] } as never)
    vi.mocked(prisma.aiShadowAction.count).mockResolvedValue(0 as never)
    vi.mocked(collectAdvisorSignalsWithHealth).mockResolvedValue({
      health: [],
      signals: [
      signal({
        id: "sales:stalled_deal:deal-1",
        domain: "sales",
        entityType: "deal",
        entityId: "deal-1",
        title: "Enterprise renewal is stalled",
        summary: "No stage movement for 30 days.",
        severity: "critical",
        sources: [{ label: "Enterprise deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
      }),
      signal({
        id: "sales:idle_quote:quote-1",
        domain: "sales",
        entityType: "quote",
        entityId: "quote-1",
        title: "Q-101 for Beta buyer decision",
        summary: "Quote is viewed and waiting for buyer decision.",
        severity: "medium",
        facts: [{ label: "Customer", value: "Beta Retail" }],
        sources: [{ label: "Q-101 Beta", entityType: "quote", entityId: "quote-1", href: "/quotes/quote-1" }],
      }),
    ]})

    const answer = await answerAdvisorQuestion({
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      question: "Which quote is waiting for Beta buyer decision?",
      locale: "en",
    })

    expect(answer.intent).toBe("sales")
    expect(answer.signals.map((item) => item.id)).toEqual([
      "sales:idle_quote:quote-1",
      "sales:stalled_deal:deal-1",
    ])
    expect(answer.sources[0]).toMatchObject({
      entityType: "quote",
      entityId: "quote-1",
      href: "/quotes/quote-1",
    })
    expect(prisma.aiInteractionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentType: "advisor",
        toolsCalled: expect.arrayContaining([
          "user:manager-1",
          "role:manager",
          "intent:sales",
          "source:quote:quote-1",
        ]),
      }),
    }))
    expect(prisma.proactiveAlert.create).not.toHaveBeenCalled()
  })

  it("filters Ask answers by explicit owner, severity and metric routing before ranking", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "tier-5", modules: { finance: true, analytics: true }, addons: [] } as never)
    vi.mocked(prisma.aiShadowAction.count).mockResolvedValue(0 as never)
    vi.mocked(collectAdvisorSignalsWithHealth).mockResolvedValue({
      health: [],
      signals: [
        signal({
          id: "finance:owner-one-critical",
          domain: "finance",
          entityType: "invoice",
          entityId: "invoice-1",
          title: "Owner One invoice is overdue",
          severity: "critical",
          ownerId: "owner-1",
          ownerLabel: "Owner One",
          amount: 5000,
          sources: [{ label: "INV-1", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" }],
        }),
        signal({
          id: "finance:owner-two-critical",
          domain: "finance",
          entityType: "invoice",
          entityId: "invoice-2",
          title: "Owner Two invoice is overdue",
          severity: "critical",
          ownerId: "owner-2",
          ownerLabel: "Owner Two",
          amount: 7000,
        }),
        signal({
          id: "finance:owner-one-high",
          domain: "finance",
          entityType: "invoice",
          entityId: "invoice-3",
          title: "Owner One invoice is high priority",
          severity: "high",
          ownerId: "owner-1",
          ownerLabel: "Owner One",
          amount: 3000,
        }),
      ],
    })

    const answer = await answerAdvisorQuestion({
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      question: "Show critical money risk for Owner One",
      locale: "en",
    })

    expect(answer.signals.map((item) => item.id)).toEqual(["finance:owner-one-critical"])
    expect(answer.scope).toMatchObject({
      filteredSignals: 1,
      returnedSignals: 1,
      routing: {
        intent: "money",
        severities: ["critical"],
        metricKinds: ["money"],
        owner: { key: "owner-1", label: "Owner One" },
      },
    })
    expect(prisma.aiInteractionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        toolsCalled: expect.arrayContaining([
          "route:severity:critical",
          "route:metric:money",
          "route:owner:owner-1",
        ]),
      }),
    }))
  })

  it("does not store obvious email or phone PII in Advisor interaction logs", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "tier-5", modules: { sales: true, analytics: true }, addons: [] } as never)
    vi.mocked(prisma.aiShadowAction.count).mockResolvedValue(0 as never)
    vi.mocked(collectAdvisorSignalsWithHealth).mockResolvedValue({
      health: [],
      signals: [
      signal({
        id: "sales:stalled_deal:deal-1",
        domain: "sales",
        entityType: "deal",
        entityId: "deal-1",
        title: "Call john.smith@example.com about stalled renewal",
        summary: "Customer phone +994 50 123 45 67 has no recent activity.",
        severity: "critical",
        sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
      }),
    ]})

    await answerAdvisorQuestion({
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      question: "What is blocking john.smith@example.com at +994 50 123 45 67?",
      locale: "en",
    })

    expect(prisma.aiInteractionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userMessage: "What is blocking [redacted-email] at [redacted-phone]?",
        aiResponse: expect.stringContaining("Call [redacted-email] about stalled renewal"),
      }),
    }))
    const logged = vi.mocked(prisma.aiInteractionLog.create).mock.calls.at(-1)?.[0]?.data
    expect(logged?.userMessage).not.toContain("john.smith@example.com")
    expect(logged?.aiResponse).not.toContain("+994 50 123 45 67")
  })

  it("localizes answer scaffolding and fact labels for Russian Advisor questions", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "tier-5", modules: { sales: true, analytics: true }, addons: [] } as never)
    vi.mocked(prisma.aiShadowAction.count).mockResolvedValue(0 as never)
    vi.mocked(collectAdvisorSignalsWithHealth).mockResolvedValue({
      health: [],
      signals: [
      signal({
        id: "sales:stalled_deal:deal-1",
        domain: "sales",
        domainLabel: "Sales",
        severity: "critical",
        amount: 2500,
        sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
      }),
    ]})

    const answer = await answerAdvisorQuestion({
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      question: "Какие продажи зависли?",
      locale: "ru",
    })

    expect(answer.answer).toContain("Найдено рисков: 1")
    expect(answer.answer).toContain("Сначала проверьте:")
    expect(answer.answer).toContain("1. Deal завис")
    expect(answer.answer).not.toContain("Интент:")
    expect(answer.answer).not.toContain("Всего открытых рисков:")
    expect(answer.answer).not.toContain("Intent:")
    expect(answer.answer).not.toContain("Matched:")
    expect(answer.facts.map((fact) => fact.label)).toEqual([
      "Найденные риски",
      "Критичные",
      "Высокие",
      "Деньги под риском",
    ])
  })
})

function advisorPayload(signals: AdvisorSignal[]): AdvisorPayload {
  return {
    capabilities: [
      {
        key: "sales",
        label: "Sales",
        moduleId: "sales",
        status: "active",
      },
    ],
    collectorHealth: [],
    overview: {
      totalSignals: signals.length,
      critical: signals.filter((item) => item.severity === "critical").length,
      high: signals.filter((item) => item.severity === "high").length,
      medium: signals.filter((item) => item.severity === "medium").length,
      low: signals.filter((item) => item.severity === "low").length,
      revenueAtRisk: signals.reduce((sum, item) => sum + (item.amount || 0), 0),
      pendingActions: 2,
    },
    signals,
  }
}

function signal(overrides: Partial<AdvisorSignal>): AdvisorSignal {
  return {
    id: "sales:stalled_deal:deal-1",
    domain: "sales",
    domainLabel: "Sales",
    entityType: "deal",
    entityId: "deal-1",
    title: "Deal is stalled",
    summary: "No movement",
    severity: "high",
    detectedAt: "2026-06-27T00:00:00.000Z",
    facts: [],
    sources: [],
    recommendedActions: [],
    ...overrides,
  }
}
