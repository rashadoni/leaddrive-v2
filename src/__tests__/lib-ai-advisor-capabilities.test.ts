import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { ADVISOR_DOMAINS, buildAdvisorCapabilities, featuresToModuleMap, mergeAdvisorModuleMaps, normalizeOrgModules } from "@/lib/ai/advisor/capabilities"
import { buildOverview, filterAdvisorPayload } from "@/lib/ai/advisor/service"
import { buildColdLeadSignals, buildContractRiskSignals, buildCrmIdleContactSignals, buildHotUnassignedLeadSignals, buildIdleOfferSignals, buildIdleQuoteSignals, buildKpiOwnerSignals, buildOpenVisitSignals, buildOverdueBillSignals, buildOverdueInvoiceSignals, buildPaymentOrderSignals, buildPhotoReviewSignals, buildRepeatedTicketSignals, buildRouteRiskSignals, buildSlaTicketSignals, buildStalledDealSignals, buildTaskRiskSignals, deriveAdvisorSignalMetric, normalizeAdvisorSignalContract, normalizeAdvisorSignalMetric, validateAdvisorSourceRefs } from "@/lib/ai/advisor/signals"
import type { AdvisorCapability, AdvisorSignal } from "@/lib/ai/advisor/types"

describe("Advisor domain coverage", () => {
  it("covers every operating domain, including routes separately from MTM", () => {
    expect(ADVISOR_DOMAINS.map((domain) => domain.key)).toEqual([
      "crm",
      "sales",
      "contracts",
      "marketing",
      "tasks",
      "finance",
      "support",
      "routes",
      "mtm",
      "kpi",
    ])

    const routes = ADVISOR_DOMAINS.find((domain) => domain.key === "routes")
    const mtm = ADVISOR_DOMAINS.find((domain) => domain.key === "mtm")
    expect(routes?.moduleId).toBe("mtm")
    expect(routes?.href).toBe("/mtm/routes")
    expect(mtm?.href).toBe("/mtm/visits")
  })

  it("marks disabled tenant modules as locked instead of hiding them", () => {
    const capabilities = buildAdvisorCapabilities({
      plan: "tier-5",
      modules: { crm: true, sales: true, analytics: true },
    })

    expect(capabilities.find((capability) => capability.key === "crm")?.status).toBe("active")
    expect(capabilities.find((capability) => capability.key === "sales")?.status).toBe("active")
    expect(capabilities.find((capability) => capability.key === "finance")?.status).toBe("locked")
    expect(capabilities.find((capability) => capability.key === "routes")?.status).toBe("locked")
    expect(capabilities.find((capability) => capability.key === "mtm")?.status).toBe("locked")
  })

  it("activates subscription-backed domains from addons", () => {
    const capabilities = buildAdvisorCapabilities({
      plan: "tier-5",
      modules: { crm: true, analytics: true },
      addons: ["finance", "mtm"],
    })

    expect(capabilities.find((capability) => capability.key === "finance")?.status).toBe("active")
    expect(capabilities.find((capability) => capability.key === "routes")?.status).toBe("active")
    expect(capabilities.find((capability) => capability.key === "mtm")?.status).toBe("active")
  })

  it("marks enabled domains as no_access when the current role cannot read their source modules", () => {
    const capabilities = buildAdvisorCapabilities({
      plan: "tier-5",
      modules: {
        crm: true,
        sales: true,
        marketing: true,
        support: true,
        analytics: true,
      },
    }, "support")

    expect(capabilities.find((capability) => capability.key === "support")).toMatchObject({
      status: "active",
    })
    expect(capabilities.find((capability) => capability.key === "marketing")).toMatchObject({
      status: "no_access",
      reason: "Role support cannot read Marketing Advisor sources.",
    })
    expect(capabilities.find((capability) => capability.key === "sales")).toMatchObject({
      status: "active",
    })
  })

  it("keeps legacy tenant features active when org.modules is still empty", () => {
    const modules = mergeAdvisorModuleMaps(
      featuresToModuleMap(["deals", "tasks", "campaigns", "tickets", "invoices", "reports", "mtm"]),
      normalizeOrgModules({}),
    )
    const capabilities = buildAdvisorCapabilities({
      plan: "tier-5",
      modules,
    })

    expect(capabilities.filter((capability) => capability.status === "active").map((capability) => capability.key)).toEqual([
      "crm",
      "sales",
      "marketing",
      "tasks",
      "finance",
      "support",
      "routes",
      "mtm",
      "kpi",
    ])
  })

  it("keeps the signal orchestrator wired to every Advisor domain", () => {
    const source = readFileSync("src/lib/ai/advisor/signals.ts", "utf8")
    const collectors = [
      "collectCrmSignals",
      "collectSalesSignals",
      "collectContractSignals",
      "collectMarketingSignals",
      "collectTaskSignals",
      "collectFinanceSignals",
      "collectSupportSignals",
      "collectRouteSignals",
      "collectMtmSignals",
      "collectKpiSignals",
    ]

    for (const collector of collectors) {
      expect(source, `${collector} should be included in collectAdvisorSignals`).toContain(collector)
    }
    for (const domain of ADVISOR_DOMAINS.map((item) => item.key)) {
      expect(source, `${domain} collector should gate by active capability`).toContain(`isActive(capabilities, "${domain}")`)
    }
  })

  it("rejects Advisor signals that cannot point back to source records", () => {
    expect(validateAdvisorSourceRefs({
      id: "finance:overdue_invoice:invoice-1",
      sources: [{ label: "INV-001", entityType: "invoice", entityId: "invoice-1", href: "/invoices/invoice-1" }],
    })).toEqual([])

    expect(validateAdvisorSourceRefs({ id: "sales:stalled_deal:deal-1", sources: [] })).toEqual([
      "sales:stalled_deal:deal-1: missing source links",
    ])

    expect(validateAdvisorSourceRefs({
      id: "routes:late:route-1",
      sources: [{ label: "Route", entityType: "mtm_route", entityId: "", href: "https://example.com/route-1" }],
    })).toEqual([
      "routes:late:route-1: source 1 is missing entity id",
      "routes:late:route-1: source 1 has invalid href",
    ])
  })

  it("normalizes every signal to a typed primary metric", () => {
    expect(deriveAdvisorSignalMetric(signal("finance", "critical", 1200, { currency: "AZN" }))).toEqual({
      kind: "money",
      label: "Money at risk",
      value: 1200,
      unit: "AZN",
      formatted: "1,200 AZN",
    })

    expect(deriveAdvisorSignalMetric(signal("routes", "high", null, {
      facts: [{ label: "Delay minutes", value: "50" }],
    }))).toEqual({
      kind: "minutes",
      label: "Delay minutes",
      value: 50,
      unit: "minutes",
      formatted: "50 min",
    })

    expect(normalizeAdvisorSignalMetric(signal("tasks", "medium", null, {
      facts: [{ label: "Overdue days", value: "7" }],
    })).metric).toEqual({
      kind: "days",
      label: "Overdue days",
      value: 7,
      unit: "days",
      formatted: "7 d",
    })
  })

  it("adds collector key, freshness and health status at the signal boundary", () => {
    const normalized = normalizeAdvisorSignalContract({
      signal: signal("routes", "high", null, {
        detectedAt: "2026-06-27T12:00:00.000Z",
        facts: [{ label: "Delay minutes", value: "50" }, { label: "Status", value: "IN_PROGRESS" }],
        sources: [{ label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" }],
      }),
      collectorKey: "routes",
      checkedAt: "2026-06-27T12:05:00.000Z",
      healthStatus: "active",
    })

    expect(normalized).toMatchObject({
      collectorKey: "routes",
      healthStatus: "active",
      freshness: {
        checkedAt: "2026-06-27T12:05:00.000Z",
        detectedAt: "2026-06-27T12:00:00.000Z",
        ageMinutes: 5,
      },
      metric: {
        kind: "minutes",
        label: "Delay minutes",
        value: 50,
        formatted: "50 min",
      },
      confidence: {
        level: "medium",
        reason: "A source record and supporting facts are available.",
      },
      safetyNote: "Read-only signal; no action is prepared.",
      timeline: [
        {
          label: "Source observed",
          at: "2026-06-27T12:00:00.000Z",
          description: "Route was read from mtm_route.",
          source: { label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" },
        },
        {
          label: "Signal detected",
          at: "2026-06-27T12:00:00.000Z",
          description: "Risk summary",
          source: { label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" },
        },
        {
          label: "Impact measured",
          at: "2026-06-27T12:00:00.000Z",
          description: "Delay minutes: 50 min.",
          source: { label: "Route", entityType: "mtm_route", entityId: "route-1", href: "/mtm/routes?routeId=route-1" },
        },
      ],
      impact: {
        label: "Delay minutes",
        value: "50 min",
        severity: "high",
        moneyAtRisk: null,
      },
      rollbackPreview: {
        mode: "not_required",
        summary: "No execution is prepared for this read-only signal.",
        steps: [],
      },
    })
    expect(normalized.impact?.basis).toContain("revenue, SLA, route execution")
    expect(normalized.dryRunPreview).toBeUndefined()
  })

  it("derives approval dry-run and rollback previews for executable Advisor actions", () => {
    const normalized = normalizeAdvisorSignalContract({
      signal: signal("sales", "medium", 4500, {
        entityType: "deal",
        entityId: "deal-1",
        detectedAt: "2026-06-27T12:00:00.000Z",
        sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
        recommendedActions: [{
          actionType: "create_task",
          label: "Create quote reminder",
          risk: "low",
          payload: {
            title: "Follow up on delayed quote",
            description: "Owner should contact the customer before the quote expires.",
          },
        }],
      }),
      collectorKey: "sales",
      checkedAt: "2026-06-27T12:05:00.000Z",
      healthStatus: "active",
    })

    expect(normalized.timeline?.map((event) => event.label)).toEqual([
      "Source observed",
      "Signal detected",
      "Impact measured",
      "Safe action prepared",
    ])
    expect(normalized.impact).toMatchObject({
      label: "Money at risk",
      value: "4,500 AZN",
      severity: "medium",
      moneyAtRisk: 4500,
      currency: "AZN",
    })
    expect(normalized.dryRunPreview).toMatchObject({
      actionType: "create_task",
      title: "Create quote reminder",
      creates: ["Task: Follow up on delayed quote"],
      payload: {
        title: "Follow up on delayed quote",
        relatedType: "deal",
        relatedId: "deal-1",
      },
    })
    expect(normalized.rollbackPreview).toMatchObject({
      mode: "automatic",
      steps: [
        "Open the created Advisor task/note/alert.",
        "Close or delete it if the approval was wrong.",
        "Keep the approval/audit trail for traceability.",
      ],
    })
  })
})

describe("Advisor record widget placement", () => {
  it("embeds record-level Advisor coverage across core operating modules", () => {
    const widgetSource = readFileSync("src/components/ai/advisor-record-widget.tsx", "utf8")
    const placements = [
      ["src/app/(dashboard)/companies/[id]/page.tsx", 'entityType="company"'],
      ["src/app/(dashboard)/contacts/[id]/page.tsx", 'entityType="contact"'],
      ["src/app/(dashboard)/leads/[id]/page.tsx", 'entityType="lead"'],
      ["src/app/(dashboard)/deals/[id]/page.tsx", 'entityType="deal"'],
      ["src/app/(dashboard)/contracts/[id]/page.tsx", 'entityType="contract"'],
      ["src/app/(dashboard)/campaigns/[id]/page.tsx", 'entityType="campaign"'],
      ["src/components/tasks/task-detail-view.tsx", 'entityType="task"'],
      ["src/app/(dashboard)/tickets/[id]/page.tsx", 'entityType="ticket"'],
      ["src/app/(dashboard)/invoices/[id]/page.tsx", 'entityType="invoice"'],
      ["src/app/(dashboard)/offers/[id]/page.tsx", 'entityType="offer"'],
      ["src/app/(dashboard)/quotes/[id]/page.tsx", 'entityType="quote"'],
      ["src/components/finance/ap-dashboard.tsx", 'entityType="bill"'],
      ["src/components/finance/payments-dashboard.tsx", 'entityType="payment_order"'],
      ["src/app/(dashboard)/mtm/visits/page.tsx", 'entityType="mtm_visit"'],
      ["src/app/(dashboard)/mtm/photos/page.tsx", 'entityType="mtm_photo"'],
    ]

    for (const [file, marker] of placements) {
      const source = readFileSync(file, "utf8")
      expect(source, `${file} should import AdvisorRecordWidget`).toContain("AdvisorRecordWidget")
      expect(source, `${file} should include ${marker}`).toContain(marker)
    }
    // mtm/routes/page.tsx used to be in that list and is deliberately not any
    // more: the owner removed the risk block from the route surface (RUX-604,
    // plan task C10). Dropping a row from a placement list is how a widget
    // quietly disappears from a page nobody checks, so the removal is pinned
    // rather than merely omitted.
    const routesPage = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    expect(routesPage).not.toContain("AdvisorRecordWidget")

    expect(widgetSource).toContain("function RecordSignalRisk")
    expect(widgetSource).toContain("buildAdvisorActionPreviewEntries")
    expect(widgetSource).toContain("previewFields")
  })
})

describe("Advisor center UX shell", () => {
  it("keeps /ai/actions as the live Advisor center", () => {
    const source = readFileSync("src/app/(dashboard)/ai/actions/page.tsx", "utf8")
    const widgetSource = readFileSync("src/components/ai/advisor-center-widgets.tsx", "utf8")

    expect(source).not.toContain('redirect("/dashboard")')
    expect(source).toContain("advisor-center-widgets")
    expect(source).toContain("data-advisor-loaded")
    expect(source).toContain("/api/v1/ai/advisor/signals")
    expect(widgetSource).toContain("function AdvisorActionExecutionTrail")
    expect(widgetSource).toContain("function AdvisorSignalRail")
    expect(widgetSource).toContain("function RouteEvidencePanel")
  })

  it("keeps a fail-fast readiness gate for real responsive browser QA", () => {
    const script = readFileSync("scripts/check-advisor-qa-readiness.mjs", "utf8")
    const captureScript = readFileSync("scripts/capture-advisor-screenshots.mjs", "utf8")
    const plan = readFileSync("docs/ai-operations-advisor-plan.md", "utf8")

    expect(script).toContain("REQUIRED_TABLES")
    expect(script).toContain("ADVISOR_STORAGE_STATE")
    expect(script).toContain("ADVISOR_TENANT_SLUG")
    expect(script).toContain("node scripts/seeds/advisor-demo.mjs --slug=")
    expect(captureScript).toContain("NAVIGATION_TIMEOUT_MS")
    expect(captureScript).toContain("waitForAdvisorReady")
    expect(captureScript).toContain("hideLocalDevOverlays")
    expect(captureScript).toContain("[data-nextjs-dev-overlay]")
    expect(captureScript).toContain('querySelector("[data-advisor-loaded]")')
    expect(captureScript).toContain("metrics.offenders.length > 0")
    expect(captureScript).toContain("Retry ${target.name}/${viewport.name} after shell-only render")
    expect(captureScript).toContain("const page = await context.newPage()")
    expect(captureScript).toContain("Сегодня")
    expect(captureScript).toContain("locale: \"en-US\"")
    expect(plan).toContain("node scripts/check-advisor-qa-readiness.mjs --slug=<tenant-slug>")
    expect(plan).toContain("without mutating the database")
  })

  it("keeps /ai/advisor retired alongside /ai/actions", () => {
    const source = readFileSync("src/app/(dashboard)/ai/advisor/page.tsx", "utf8")

    expect(source).toContain('redirect("/dashboard")')
    expect(source).not.toContain("AdvisorCenter")
  })
})

describe("Advisor overview", () => {
  it("summarizes priority counts and money at risk", () => {
    const signals = [
      signal("finance", "critical", 1200),
      signal("sales", "high", 3000),
      signal("support", "medium", null),
      signal("tasks", "low", 50),
    ]

    expect(buildOverview(signals, 2)).toEqual({
      totalSignals: 4,
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      revenueAtRisk: 4250,
      pendingActions: 2,
    })
  })
})

describe("Advisor payload filters", () => {
  it("narrows signals for record-level advisor widgets and recomputes overview", () => {
    const payload = {
      capabilities: [],
      collectorHealth: [],
      overview: buildOverview([
        signal("sales", "high", 3000, { entityType: "deal", entityId: "deal-1" }),
        signal("finance", "critical", 1200, { entityType: "invoice", entityId: "invoice-1" }),
        signal("support", "medium", null, { entityType: "ticket", entityId: "ticket-1" }),
      ], 4),
      signals: [
        signal("sales", "high", 3000, { entityType: "deal", entityId: "deal-1" }),
        signal("finance", "critical", 1200, { entityType: "invoice", entityId: "invoice-1" }),
        signal("support", "medium", null, { entityType: "ticket", entityId: "ticket-1" }),
      ],
    }

    const filtered = filterAdvisorPayload(payload, { entityType: "deal", entityId: "deal-1" })

    expect(filtered.signals).toHaveLength(1)
    expect(filtered.signals[0]?.entityId).toBe("deal-1")
    expect(filtered.overview).toEqual({
      totalSignals: 1,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      revenueAtRisk: 3000,
      pendingActions: 4,
    })
  })
})

describe("Advisor cold lead signals", () => {
  it("flags idle CRM contacts with evidence and a reconnect task", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "crm",
      label: "CRM",
      moduleId: "crm",
      status: "active",
      href: "/contacts",
    }]

    const signals = buildCrmIdleContactSignals([{
      id: "contact-1",
      fullName: "Aysel Mammadova",
      email: "aysel@example.com",
      company: { name: "Acme" },
      lastActivityAt: new Date("2026-04-20T00:00:00.000Z"),
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    }], capabilities, now)

    expect(signals[0]).toMatchObject({
      id: "crm:contact_idle:contact-1",
      domain: "crm",
      entityType: "contact",
      entityId: "contact-1",
      severity: "high",
      sources: [{ label: "Aysel Mammadova", entityType: "contact", entityId: "contact-1", href: "/contacts/contact-1" }],
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task"])
  })

  it("flags stalled deals with amount, source links and three safe next actions", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "sales",
      label: "Sales",
      moduleId: "sales",
      status: "active",
      href: "/deals",
    }]

    const signals = buildStalledDealSignals([{
      id: "deal-1",
      name: "Enterprise Renewal",
      stage: "PROPOSAL",
      valueAmount: 15000,
      currency: "AZN",
      probability: 65,
      assignedTo: "owner-1",
      expectedClose: new Date("2026-06-01T00:00:00.000Z"),
      stageChangedAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      company: { name: "Acme" },
    }], capabilities, now)

    expect(signals[0]).toMatchObject({
      id: "sales:stalled_deal:deal-1",
      domain: "sales",
      entityType: "deal",
      severity: "critical",
      ownerId: "owner-1",
      amount: 15000,
      sources: [{ label: "Enterprise Renewal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task", "create_note", "draft_followup"])
  })

  it("flags hot unassigned leads and idle offers or quotes", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "sales",
      label: "Sales",
      moduleId: "sales",
      status: "active",
      href: "/deals",
    }]

    const [hotLead] = buildHotUnassignedLeadSignals([{
      id: "lead-hot",
      contactName: "Hot Prospect",
      companyName: "Beta",
      score: 95,
      estimatedValue: 9000,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    }], capabilities, now)
    const [offer] = buildIdleOfferSignals([{
      id: "offer-1",
      offerNumber: "OFF-001",
      title: "Annual supply",
      totalAmount: 12000,
      currency: "AZN",
      clientName: "Bravo",
      validUntil: new Date("2026-06-10T00:00:00.000Z"),
      sentAt: new Date("2026-05-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-20T00:00:00.000Z"),
      dealId: "deal-1",
    }], capabilities, now)
    const [quote] = buildIdleQuoteSignals([{
      id: "quote-1",
      quoteNumber: "Q-101",
      version: 2,
      status: "viewed",
      totalAmount: 8000,
      currency: "AZN",
      customerName: "Bravo",
      validUntil: null,
      sentAt: new Date("2026-05-15T00:00:00.000Z"),
      viewedAt: new Date("2026-05-18T00:00:00.000Z"),
      updatedAt: new Date("2026-05-18T00:00:00.000Z"),
      dealId: "deal-1",
    }], capabilities, now)

    expect(hotLead).toMatchObject({
      id: "sales:hot_unassigned_lead:lead-hot",
      severity: "critical",
      amount: 9000,
      sources: [{ entityType: "lead", entityId: "lead-hot", href: "/leads/lead-hot" }],
    })
    expect(hotLead?.recommendedActions.map((action) => action.actionType)).toEqual(["create_alert"])
    expect(offer).toMatchObject({
      id: "sales:idle_offer:offer-1",
      entityType: "offer",
      severity: "high",
      sources: [{ entityType: "offer", entityId: "offer-1", href: "/offers/offer-1" }],
    })
    expect(offer?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task", "create_note"])
    expect(quote).toMatchObject({
      id: "sales:idle_quote:quote-1",
      entityType: "quote",
      sources: [{ entityType: "quote", entityId: "quote-1", href: "/quotes/quote-1" }],
    })
    expect(quote?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task", "create_note"])
  })

  it("flags low-score stale leads and recommends re-engagement", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "sales",
      label: "Sales",
      moduleId: "sales",
      status: "active",
      href: "/deals",
    }]

    const signals = buildColdLeadSignals([{
      id: "lead-1",
      contactName: "Cold Prospect",
      companyName: "Acme",
      status: "contacted",
      priority: "medium",
      score: 18,
      assignedTo: "owner-1",
      estimatedValue: 750,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "sales:cold_lead:lead-1",
      domain: "sales",
      entityType: "lead",
      entityId: "lead-1",
      severity: "high",
      ownerId: "owner-1",
      amount: 750,
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "contacted" },
      { label: "Score", value: "18" },
      { label: "Idle days", value: "57" },
      { label: "Priority", value: "medium" },
      { label: "Company", value: "Acme" },
    ])
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task", "draft_followup"])
  })
})

describe("Advisor payment order signals", () => {
  it("flags finance payment orders stuck after approval", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "finance",
      label: "Finance",
      moduleId: "finance",
      status: "active",
      href: "/finance",
    }]

    const signals = buildPaymentOrderSignals([{
      id: "po-1",
      orderNumber: "PO-001",
      counterpartyName: "Vendor A",
      amount: 12000,
      currency: "AZN",
      purpose: "June service payment",
      status: "approved",
      createdBy: "creator-1",
      approvedBy: "approver-1",
      approvedAt: new Date("2026-06-20T12:00:00.000Z"),
      createdAt: new Date("2026-06-18T12:00:00.000Z"),
      updatedAt: new Date("2026-06-20T12:00:00.000Z"),
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "finance:payment_order:po-1",
      domain: "finance",
      entityType: "payment_order",
      entityId: "po-1",
      severity: "high",
      ownerId: "approver-1",
      amount: 12000,
      currency: "AZN",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "approved" },
      { label: "Counterparty", value: "Vendor A" },
      { label: "Amount", value: "12,000 AZN" },
      { label: "Waiting days", value: "7" },
      { label: "Purpose", value: "June service payment" },
    ])
    expect(signals[0]?.sources[0]).toMatchObject({
      entityType: "payment_order",
      entityId: "po-1",
      href: "/finance?tab=payments&paymentOrderId=po-1",
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_alert", "create_task"])
  })
})

describe("Advisor overdue invoice signals", () => {
  it("adds linked contract evidence when an overdue invoice depends on an unsigned contract", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "finance",
      label: "Finance",
      moduleId: "finance",
      status: "active",
      href: "/finance",
    }]

    const signals = buildOverdueInvoiceSignals([{
      id: "invoice-1",
      invoiceNumber: "INV-001",
      title: "June invoice",
      status: "sent",
      dueDate: new Date("2026-06-20T12:00:00.000Z"),
      balanceDue: 900,
      totalAmount: 1200,
      currency: "AZN",
      company: { name: "Acme" },
      contactId: "contact-1",
      contract: {
        id: "contract-1",
        title: "Service Agreement",
        status: "approved",
        currentApprovalStage: null,
        signedAt: null,
      },
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "finance:overdue_invoice:invoice-1",
      domain: "finance",
      entityType: "invoice",
      entityId: "invoice-1",
      severity: "critical",
      amount: 900,
      currency: "AZN",
    })
    expect(signals[0]?.summary).toContain("Linked contract is approved but not signed.")
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "sent" },
      { label: "Balance due", value: "900 AZN" },
      { label: "Overdue days", value: "7" },
      { label: "Company", value: "Acme" },
      { label: "Contract status", value: "approved" },
    ])
    expect(signals[0]?.sources.map((item) => item.href)).toEqual([
      "/invoices/invoice-1",
      "/contracts/contract-1",
    ])
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task", "invoice_reminder"])
  })
})

describe("Advisor overdue bill signals", () => {
  it("flags overdue payables with vendor evidence and payables route", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "finance",
      label: "Finance",
      moduleId: "finance",
      status: "active",
      href: "/finance",
    }]

    const signals = buildOverdueBillSignals([{
      id: "bill-1",
      billNumber: "BILL-001",
      vendorName: "Vendor A",
      title: "June hosting",
      status: "pending",
      dueDate: new Date("2026-06-15T12:00:00.000Z"),
      balanceDue: 12500,
      totalAmount: 12500,
      currency: "AZN",
      category: "software",
      createdBy: "owner-1",
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "finance:overdue_bill:bill-1",
      domain: "finance",
      entityType: "bill",
      entityId: "bill-1",
      severity: "critical",
      ownerId: "owner-1",
      amount: 12500,
      currency: "AZN",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "pending" },
      { label: "Balance due", value: "12,500 AZN" },
      { label: "Overdue days", value: "12" },
      { label: "Vendor", value: "Vendor A" },
      { label: "Category", value: "software" },
    ])
    expect(signals[0]?.sources[0]).toMatchObject({
      entityType: "bill",
      entityId: "bill-1",
      href: "/finance?tab=payables&billId=bill-1",
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_alert", "create_task"])
  })
})

describe("Advisor contract signature signals", () => {
  it("flags approved contracts that are not signed", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "contracts",
      label: "Contracts",
      moduleId: "contracts",
      status: "active",
      href: "/contracts",
    }]

    const signals = buildContractRiskSignals([{
      id: "contract-1",
      title: "Master Service Agreement",
      contractNumber: "CTR-001",
      status: "approved",
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      valueAmount: 5000,
      currency: "AZN",
      currentApprovalStage: null,
      signedAt: null,
      createdBy: "owner-1",
      updatedAt: new Date("2026-06-15T12:00:00.000Z"),
      company: { name: "Acme" },
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "contracts:signature:contract-1",
      domain: "contracts",
      entityType: "contract",
      entityId: "contract-1",
      severity: "high",
      ownerId: "owner-1",
      amount: 5000,
      currency: "AZN",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "approved" },
      { label: "Contract #", value: "CTR-001" },
      { label: "Ends in days", value: "187" },
      { label: "Unsigned days", value: "12" },
      { label: "Company", value: "Acme" },
    ])
    expect(signals[0]?.recommendedActions[0]?.payload).toMatchObject({
      relatedType: "contract",
      relatedId: "contract-1",
      assignedTo: "owner-1",
    })
  })
})

describe("Advisor task risk signals", () => {
  it("flags open tasks due within a day before they become overdue", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "tasks",
      label: "Tasks",
      moduleId: "crm",
      status: "active",
      href: "/tasks",
    }]

    const signals = buildTaskRiskSignals([{
      id: "task-1",
      title: "Send proposal update",
      status: "pending",
      priority: "medium",
      dueDate: new Date("2026-06-28T09:00:00.000Z"),
      createdAt: new Date("2026-06-20T12:00:00.000Z"),
      assignedTo: "owner-1",
      relatedType: "deal",
      relatedId: "deal-1",
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "tasks:due_soon:task-1",
      domain: "tasks",
      entityType: "task",
      entityId: "task-1",
      severity: "medium",
      ownerId: "owner-1",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Status", value: "pending" },
      { label: "Priority", value: "medium" },
      { label: "Overdue days", value: "0" },
      { label: "Due in days", value: "1" },
      { label: "Age days", value: "7" },
    ])
  })

  it("flags blocked tasks as high-priority work aging risks", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "tasks",
      label: "Tasks",
      moduleId: "crm",
      status: "active",
      href: "/tasks",
    }]

    const signals = buildTaskRiskSignals([{
      id: "task-blocked",
      title: "Legal review",
      status: "blocked",
      priority: "high",
      dueDate: null,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      assignedTo: "owner-1",
      relatedType: "contract",
      relatedId: "contract-1",
    }], capabilities, now)

    expect(signals[0]).toMatchObject({
      id: "tasks:blocked:task-blocked",
      title: "Legal review is blocked",
      severity: "critical",
      ownerId: "owner-1",
    })
    expect(signals[0]?.facts).toContainEqual({ label: "Status", value: "blocked" })
    expect(signals[0]?.recommendedActions[0]?.actionType).toBe("create_alert")
  })
})

describe("Advisor KPI owner signals", () => {
  it("flags managers behind monthly planned actions with overdue work", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const monthStart = new Date("2026-06-01T00:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "kpi",
      label: "KPI",
      moduleId: "analytics",
      status: "active",
      href: "/leaderboard",
    }]

    const signals = buildKpiOwnerSignals([
      taskRow("task-1", "owner-1", "pending", "2026-06-10T00:00:00.000Z", "2026-06-01T00:00:00.000Z"),
      taskRow("task-2", "owner-1", "in_progress", "2026-06-12T00:00:00.000Z", "2026-06-02T00:00:00.000Z"),
      taskRow("task-3", "owner-1", "todo", "2026-06-14T00:00:00.000Z", "2026-06-03T00:00:00.000Z"),
      taskRow("task-4", "owner-1", "pending", "2026-06-30T00:00:00.000Z", "2026-06-04T00:00:00.000Z"),
      taskRow("task-5", "owner-1", "completed", "2026-06-20T00:00:00.000Z", "2026-06-05T00:00:00.000Z", "2026-06-21T00:00:00.000Z"),
    ], capabilities, now, monthStart)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "kpi:owner_plan:owner-1",
      domain: "kpi",
      entityType: "user",
      entityId: "owner-1",
      severity: "high",
      ownerLabel: "Owner One",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Planned actions this month", value: "5" },
      { label: "Completed actions", value: "1" },
      { label: "Completion rate", value: "20%" },
      { label: "Overdue open tasks", value: "3" },
      { label: "Oldest overdue days", value: "17" },
      { label: "Response gaps", value: "0" },
      { label: "Oldest response gap hours", value: "0" },
    ])
    expect(signals[0]?.sources[0]).toMatchObject({
      entityType: "user",
      entityId: "owner-1",
      href: "/tasks?assignedTo=owner-1",
    })
  })

  it("flags owners with open ticket response gaps", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const monthStart = new Date("2026-06-01T00:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "kpi",
      label: "KPI",
      moduleId: "analytics",
      status: "active",
      href: "/leaderboard",
    }]

    const signals = buildKpiOwnerSignals([], capabilities, now, monthStart, [
      kpiTicketRow("ticket-1", "owner-2", "2026-06-26T08:00:00.000Z", "2026-06-26T10:00:00.000Z"),
      kpiTicketRow("ticket-2", "owner-2", "2026-06-26T09:00:00.000Z", "2026-06-26T11:00:00.000Z"),
    ])

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "kpi:owner_plan:owner-2",
      domain: "kpi",
      entityType: "user",
      entityId: "owner-2",
      severity: "medium",
      ownerLabel: "Owner Two",
      title: "Owner Two has 2 response gaps",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Planned actions this month", value: "0" },
      { label: "Completed actions", value: "0" },
      { label: "Completion rate", value: "0%" },
      { label: "Overdue open tasks", value: "0" },
      { label: "Oldest overdue days", value: "0" },
      { label: "Response gaps", value: "2" },
      { label: "Oldest response gap hours", value: "26" },
    ])
    expect(signals[0]?.sources.map((item) => item.href)).toEqual([
      "/tasks?assignedTo=owner-2",
      "/tickets?assignedTo=owner-2",
    ])
  })
})

describe("Advisor repeated support signals", () => {
  it("flags unresolved escalated support tickets with SLA evidence", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "support",
      label: "Ticketing",
      moduleId: "support",
      status: "active",
      href: "/tickets",
    }]

    const signals = buildSlaTicketSignals([{
      id: "ticket-esc",
      ticketNumber: "TK-009",
      subject: "Service outage",
      priority: "critical",
      status: "escalated",
      assignedTo: "owner-1",
      slaFirstResponseDueAt: new Date("2026-06-27T08:00:00.000Z"),
      slaDueAt: new Date("2026-06-27T10:00:00.000Z"),
      firstResponseAt: null,
      escalationLevel: 2,
      createdAt: new Date("2026-06-27T07:00:00.000Z"),
      company: { name: "Acme" },
    }], capabilities, now)

    expect(signals[0]).toMatchObject({
      id: "support:escalated:ticket-esc",
      title: "TK-009 is escalated and unresolved",
      severity: "critical",
      ownerId: "owner-1",
      sources: [{ label: "TK-009", entityType: "ticket", entityId: "ticket-esc", href: "/tickets/ticket-esc" }],
    })
    expect(signals[0]?.facts).toContainEqual({ label: "Escalation level", value: "2" })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["support_escalation"])
  })

  it("recommends ticket owner and priority updates when SLA risk has no owner", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "support",
      label: "Ticketing",
      moduleId: "support",
      status: "active",
      href: "/tickets",
    }]

    const signals = buildSlaTicketSignals([{
      id: "ticket-unassigned",
      ticketNumber: "TK-010",
      subject: "Delayed delivery",
      priority: "medium",
      status: "new",
      assignedTo: null,
      slaFirstResponseDueAt: new Date("2026-06-27T08:00:00.000Z"),
      slaDueAt: new Date("2026-06-27T16:00:00.000Z"),
      firstResponseAt: null,
      escalationLevel: 0,
      createdAt: new Date("2026-06-27T07:00:00.000Z"),
      company: { name: "Acme" },
    }], capabilities, now)

    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual([
      "support_escalation",
      "assign_ticket_owner",
      "priority_update",
    ])
    expect(signals[0]?.recommendedActions[2]?.payload).toMatchObject({
      priority: "urgent",
      relatedType: "ticket",
      relatedId: "ticket-unassigned",
    })
  })

  it("flags repeated open tickets from the same company", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "support",
      label: "Ticketing",
      moduleId: "support",
      status: "active",
      href: "/tickets",
    }]

    const signals = buildRepeatedTicketSignals([
      ticketRow("t1", "TK-001", "co-1", "Acme", "high", "owner-1"),
      ticketRow("t2", "TK-002", "co-1", "Acme", "medium", "owner-1"),
      ticketRow("t3", "TK-003", "co-1", "Acme", "medium", "owner-2"),
      ticketRow("t4", "TK-004", "co-2", "Beta", "medium", "owner-3"),
    ], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "support:repeated_company:co-1",
      domain: "support",
      domainLabel: "Ticketing",
      entityType: "company",
      entityId: "co-1",
      severity: "medium",
      ownerId: "owner-1",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Company", value: "Acme" },
      { label: "Open tickets", value: "3" },
      { label: "High priority tickets", value: "1" },
      { label: "Latest ticket", value: "TK-001" },
    ])
    expect(signals[0]?.sources.map((item) => item.href)).toEqual([
      "/tickets/t1",
      "/tickets/t2",
      "/tickets/t3",
    ])
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["support_escalation", "create_task"])
  })
})

describe("Advisor route visit signals", () => {
  it("flags missed planned route stops as route deviations", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "routes",
      label: "Routes",
      moduleId: "mtm",
      status: "active",
      href: "/mtm/routes",
    }]

    const signals = buildRouteRiskSignals([{
      id: "route-2",
      name: "City Center",
      status: "IN_PROGRESS",
      totalPoints: 6,
      visitedPoints: 2,
      startedAt: new Date("2026-06-27T08:00:00.000Z"),
      agent: { name: "Agent Two", userId: "agent-user-2" },
      points: [{
        status: "PENDING",
        plannedTime: new Date("2026-06-27T11:10:00.000Z"),
        visitedAt: null,
        customer: { name: "Market B" },
      }],
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "routes:deviation:route-2",
      domain: "routes",
      entityType: "mtm_route",
      entityId: "route-2",
      severity: "high",
      ownerId: "agent-user-2",
      ownerLabel: "Agent Two",
    })
    expect(signals[0]?.summary).toContain("Market B is 50 minutes behind schedule.")
    expect(signals[0]?.facts).toEqual([
      { label: "Agent", value: "Agent Two" },
      { label: "Status", value: "IN_PROGRESS" },
      { label: "Visited", value: "2/6" },
      { label: "Completion", value: "33%" },
      { label: "Break minutes", value: "—" },
      { label: "Missed stop", value: "Market B" },
      { label: "Delay minutes", value: "50" },
    ])
    expect(signals[0]?.recommendedActions[0]?.actionType).toBe("flag_route_issue")
  })

  it("flags long breaks on in-progress routes", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "routes",
      label: "Routes",
      moduleId: "mtm",
      status: "active",
      href: "/mtm/routes",
    }]

    const signals = buildRouteRiskSignals([{
      id: "route-1",
      name: "North Baku",
      status: "IN_PROGRESS",
      totalPoints: 8,
      visitedPoints: 3,
      startedAt: new Date("2026-06-27T08:00:00.000Z"),
      agent: { name: "Agent One", userId: "agent-user-1" },
      points: [{ status: "VISITED", plannedTime: null, visitedAt: new Date("2026-06-27T10:00:00.000Z") }],
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "routes:long_break:route-1",
      domain: "routes",
      entityType: "mtm_route",
      entityId: "route-1",
      severity: "high",
      ownerId: "agent-user-1",
      ownerLabel: "Agent One",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Agent", value: "Agent One" },
      { label: "Status", value: "IN_PROGRESS" },
      { label: "Visited", value: "3/8" },
      { label: "Completion", value: "38%" },
      { label: "Break minutes", value: "120" },
      { label: "Missed stop", value: "—" },
      { label: "Delay minutes", value: "—" },
    ])
    expect(signals[0]?.recommendedActions[0]?.payload).toMatchObject({
      relatedType: "mtm_route",
      relatedId: "route-1",
      assignedTo: "agent-user-1",
    })
    expect(signals[0]?.recommendedActions[0]?.actionType).toBe("flag_route_issue")
  })

  it("flags stale checked-in visits without checkout", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "routes",
      label: "Routes",
      moduleId: "mtm",
      status: "active",
      href: "/mtm/routes",
    }]

    const signals = buildOpenVisitSignals([
      {
        id: "visit-1",
        status: "CHECKED_IN",
        checkInAt: new Date("2026-06-27T08:30:00.000Z"),
        agent: { name: "Agent One", userId: "agent-user-1" },
        customer: { name: "Market A" },
      },
    ], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "routes:open_visit:visit-1",
      domain: "routes",
      entityType: "mtm_visit",
      entityId: "visit-1",
      severity: "high",
      ownerId: "agent-user-1",
      ownerLabel: "Agent One",
    })
    expect(signals[0]?.facts).toEqual([
      { label: "Agent", value: "Agent One" },
      { label: "Customer", value: "Market A" },
      { label: "Open minutes", value: "210" },
      { label: "Status", value: "CHECKED_IN" },
    ])
    expect(signals[0]?.sources[0]).toMatchObject({
      entityType: "mtm_visit",
      entityId: "visit-1",
      href: "/mtm/visits?visitId=visit-1",
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["flag_route_issue", "create_task"])
  })
})

describe("Advisor field photo signals", () => {
  it("links photo review risks to the MTM photos gallery focus state", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "mtm",
      label: "Routes & Field",
      moduleId: "mtm",
      status: "active",
      href: "/mtm/visits",
    }]

    const signals = buildPhotoReviewSignals([{
      id: "photo-1",
      category: "display",
      status: "REJECTED",
      createdAt: new Date("2026-06-27T10:00:00.000Z"),
      agent: { name: "Agent One", userId: "user-1" },
      visitId: "visit-1",
    }], capabilities, now)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      id: "mtm:photo_review:photo-1",
      domain: "mtm",
      entityType: "mtm_photo",
      entityId: "photo-1",
      title: "Visit photo was rejected",
      severity: "high",
      ownerId: "user-1",
      ownerLabel: "Agent One",
    })
    expect(signals[0]?.sources[0]).toMatchObject({
      entityType: "mtm_photo",
      entityId: "photo-1",
      href: "/mtm/photos?photoId=photo-1",
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task"])
  })

  it("titles pending photo reviews as needing review with a medium severity", () => {
    const now = new Date("2026-06-27T12:00:00.000Z")
    const capabilities: AdvisorCapability[] = [{
      key: "mtm",
      label: "Routes & Field",
      moduleId: "mtm",
      status: "active",
      href: "/mtm/visits",
    }]

    const signals = buildPhotoReviewSignals([{
      id: "photo-2",
      category: "display",
      status: "PENDING",
      createdAt: new Date("2026-06-27T10:00:00.000Z"),
      agent: { name: "Agent One", userId: "user-1" },
      visitId: "visit-1",
    }], capabilities, now)

    expect(signals[0]).toMatchObject({
      title: "Visit photo needs review",
      severity: "medium",
    })
    expect(signals[0]?.recommendedActions.map((action) => action.actionType)).toEqual(["create_task"])
  })
})

function signal(
  domain: AdvisorSignal["domain"],
  severity: AdvisorSignal["severity"],
  amount: number | null,
  overrides: Partial<AdvisorSignal> = {},
): AdvisorSignal {
  return {
    id: `${domain}:${severity}`,
    domain,
    domainLabel: domain,
    entityType: domain,
    entityId: "entity-1",
    title: "Risk",
    summary: "Risk summary",
    severity,
    amount,
    detectedAt: "2026-06-26T00:00:00.000Z",
    facts: [],
    sources: [],
    recommendedActions: [],
    ...overrides,
  }
}

function taskRow(
  id: string,
  assignedTo: string,
  status: string,
  dueDate: string,
  createdAt: string,
  completedAt: string | null = null,
) {
  return {
    id,
    assignedTo,
    status,
    dueDate: new Date(dueDate),
    createdAt: new Date(createdAt),
    completedAt: completedAt ? new Date(completedAt) : null,
    assignee: { name: "Owner One", email: "owner@example.com" },
  }
}

function ticketRow(
  id: string,
  ticketNumber: string,
  companyId: string,
  companyName: string,
  priority: string,
  assignedTo: string,
) {
  return {
    id,
    ticketNumber,
    subject: "Support issue",
    priority,
    status: "new",
    assignedTo,
    companyId,
    createdAt: new Date("2026-06-27T10:00:00.000Z"),
    company: { name: companyName },
  }
}

function kpiTicketRow(id: string, assignedTo: string, createdAt: string, slaFirstResponseDueAt: string) {
  return {
    id,
    assignedTo,
    status: "new",
    createdAt: new Date(createdAt),
    firstResponseAt: null,
    slaFirstResponseDueAt: new Date(slaFirstResponseDueAt),
    assignee: { name: "Owner Two", email: "owner2@example.com" },
  }
}
