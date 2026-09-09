import { describe, it, expect } from "vitest"
import { navItems, NAV_GROUP_ORDER } from "@/lib/nav-items"
import {
  ENTITY_TO_MODULE,
  moduleToSection,
  deriveSection,
  NOTIFICATION_KINDS,
  kindsForSection,
} from "@/lib/notifications/taxonomy"

describe("ENTITY_TO_MODULE", () => {
  it("covers the core entityTypes that createNotification produces", () => {
    const expected = ["task", "deal", "lead", "contact", "company", "ticket", "contract", "campaign", "invoice"]
    for (const et of expected) {
      expect(ENTITY_TO_MODULE[et], `ENTITY_TO_MODULE["${et}"] must exist`).toBeDefined()
    }
  })

  it("Phase 2a: covers quote and invoice entityTypes", () => {
    expect(ENTITY_TO_MODULE["quote"]).toBeDefined()
    expect(ENTITY_TO_MODULE["invoice"]).toBeDefined()
  })

  it("Phase 2a: quote maps to the quotes module (Sales group)", () => {
    expect(ENTITY_TO_MODULE["quote"]).toBe("quotes")
  })

  it("FIX B: covers all Phase 2+ emitted entityTypes (social_mention, briefing, budget_plan)", () => {
    // These were previously unmapped — now they must be in ENTITY_TO_MODULE so
    // the allowlist read-gate covers them instead of failing open/closed arbitrarily.
    expect(ENTITY_TO_MODULE["social_mention"]).toBeDefined()
    expect(ENTITY_TO_MODULE["briefing"]).toBeDefined()
    expect(ENTITY_TO_MODULE["budget_plan"]).toBeDefined()
  })

  // MC-T4 nav re-tag: navItems now carry GROUP module ids while ENTITY_TO_MODULE
  // deliberately keeps the legacy vocabulary (delivery-gate granularity — see
  // taxonomy.ts moduleToSection). The invariant is therefore RESOLUTION, not
  // identity: every mapped id must resolve to a real section via
  // LEGACY_MODULE_MAP translation (or the addon fallback for ai/voip).
  it("social_mention (social) resolves to the Social Monitoring section", () => {
    expect(moduleToSection(ENTITY_TO_MODULE["social_mention"])).toBe("Social Monitoring")
  })

  it("briefing (ai) resolves to a section via the addon fallback", () => {
    expect(moduleToSection(ENTITY_TO_MODULE["briefing"])).toBe("Communication")
  })

  // Invariant latch: the "ai" addon section is PINNED to Communication and must NOT
  // follow an individual ai-flagged nav item if it's moved between groups (e.g. AI
  // Actions → Analytics, 2026-06-21). VoIP owns its independent analytics section.
  it('addon "ai" section is pinned to Communication regardless of nav placement', () => {
    expect(moduleToSection("ai")).toBe("Communication")
  })
  it('module "voip" resolves to its standalone section', () => {
    expect(moduleToSection("voip")).toBe("VoIP")
  })

  it("budget_plan (budgeting) resolves to the Finance section", () => {
    expect(moduleToSection(ENTITY_TO_MODULE["budget_plan"])).toBe("Finance")
  })

  it("every mapped ModuleId resolves to a real nav section", () => {
    for (const [entityType, moduleId] of Object.entries(ENTITY_TO_MODULE)) {
      const section = moduleToSection(moduleId)
      expect(
        section,
        `ENTITY_TO_MODULE["${entityType}"] = "${moduleId}" — does not resolve to any nav section`
      ).not.toBeNull()
      expect(NAV_GROUP_ORDER, `section "${section}" for "${entityType}"`).toContain(section as string)
    }
  })
})

describe("moduleToSection", () => {
  it("returns the group for a known module", () => {
    // deals nav item moved to the dedicated Sales group/module
    expect(moduleToSection("deals")).toBe("Sales")
  })

  it("returns the group for tickets (Support)", () => {
    expect(moduleToSection("tickets")).toBe("Support")
  })

  it("returns the group for campaigns (Marketing)", () => {
    expect(moduleToSection("campaigns")).toBe("Marketing")
  })

  it("returns the group for invoices (Finance)", () => {
    expect(moduleToSection("invoices")).toBe("Finance")
  })

  it("returns the group for contracts (Contracts Control)", () => {
    expect(moduleToSection("contracts")).toBe("Contracts Control")
  })

  it("returns null for an unknown moduleId", () => {
    expect(moduleToSection("totally-unknown-module" as never)).toBeNull()
  })

  it("every result is either null or a member of NAV_GROUP_ORDER", () => {
    const knownModules = [...new Set(navItems.flatMap((i) => i.module ? [i.module] : []))]
    for (const m of knownModules) {
      const section = moduleToSection(m)
      if (section !== null) {
        expect(NAV_GROUP_ORDER).toContain(section)
      }
    }
  })
})

describe("deriveSection", () => {
  it('maps "deal" to Sales', () => {
    expect(deriveSection("deal")).toBe("Sales")
  })

  it('maps "ticket" to Support', () => {
    expect(deriveSection("ticket")).toBe("Support")
  })

  it('maps "task" to CRM', () => {
    expect(deriveSection("task")).toBe("CRM")
  })

  it('maps "lead" to Sales', () => {
    expect(deriveSection("lead")).toBe("Sales")
  })

  it('maps "contact" to CRM', () => {
    expect(deriveSection("contact")).toBe("CRM")
  })

  it('maps "company" to CRM', () => {
    expect(deriveSection("company")).toBe("CRM")
  })

  it('maps "contract" to Contracts Control', () => {
    expect(deriveSection("contract")).toBe("Contracts Control")
  })

  it('maps "campaign" to Marketing', () => {
    expect(deriveSection("campaign")).toBe("Marketing")
  })

  it('Phase 2a: maps "quote" to Sales', () => {
    expect(deriveSection("quote")).toBe("Sales")
  })

  it('Phase 2a: maps "invoice" to Finance', () => {
    expect(deriveSection("invoice")).toBe("Finance")
  })

  it("returns null for an unknown entityType", () => {
    expect(deriveSection("unknown_entity")).toBeNull()
    expect(deriveSection("")).toBeNull()
  })

  it("every result is either null or a member of NAV_GROUP_ORDER", () => {
    const entityTypes = Object.keys(ENTITY_TO_MODULE)
    for (const et of entityTypes) {
      const section = deriveSection(et)
      if (section !== null) {
        expect(NAV_GROUP_ORDER, `section for "${et}" must be in NAV_GROUP_ORDER`).toContain(section)
      }
    }
  })
})

describe("NOTIFICATION_KINDS", () => {
  it("contains the required event kinds", () => {
    const kinds = NOTIFICATION_KINDS.map((k) => k.kind)
    const required = [
      "task.created", "task.completed",
      "deal.created", "deal.won", "deal.lost", "deal.stage",
      "lead.created", "lead.converted", "lead.status",
      "contact.created", "company.created",
      "ticket.created", "ticket.comment",
      "campaign.sent",
    ]
    for (const k of required) {
      expect(kinds, `"${k}" must be in NOTIFICATION_KINDS`).toContain(k)
    }
  })

  it("Phase 2a: contains quote and invoice event kinds", () => {
    const kinds = NOTIFICATION_KINDS.map((k) => k.kind)
    const phase2aKinds = [
      "quote.sent", "quote.accepted", "quote.rejected",
      "invoice.paid", "invoice.overdue",
    ]
    for (const k of phase2aKinds) {
      expect(kinds, `"${k}" must be in NOTIFICATION_KINDS`).toContain(k)
    }
  })

  it("Phase 2a: quote kinds resolve to Sales section", () => {
    const quoteKinds = NOTIFICATION_KINDS.filter((k) => k.entityType === "quote")
    expect(quoteKinds.length).toBe(3)
    for (const k of quoteKinds) {
      expect(k.section, `"${k.kind}".section must be "Sales"`).toBe("Sales")
    }
  })

  it("Phase 2a: invoice.paid and invoice.overdue resolve to Finance section", () => {
    const invoicePhase2Kinds = NOTIFICATION_KINDS.filter(
      (k) => k.kind === "invoice.paid" || k.kind === "invoice.overdue"
    )
    expect(invoicePhase2Kinds.length).toBe(2)
    for (const k of invoicePhase2Kinds) {
      expect(k.section, `"${k.kind}".section must be "Finance"`).toBe("Finance")
    }
  })

  it("every entry has a non-null section", () => {
    for (const entry of NOTIFICATION_KINDS) {
      expect(entry.section, `"${entry.kind}".section must be non-null`).not.toBeNull()
      expect(typeof entry.section).toBe("string")
    }
  })

  it("every section is a member of NAV_GROUP_ORDER", () => {
    for (const entry of NOTIFICATION_KINDS) {
      expect(
        NAV_GROUP_ORDER,
        `NOTIFICATION_KINDS["${entry.kind}"].section = "${entry.section}" not in NAV_GROUP_ORDER`
      ).toContain(entry.section)
    }
  })

  it("every entry has a non-empty entityType matching a key in ENTITY_TO_MODULE", () => {
    for (const entry of NOTIFICATION_KINDS) {
      expect(
        ENTITY_TO_MODULE[entry.entityType],
        `entityType "${entry.entityType}" for kind "${entry.kind}" not in ENTITY_TO_MODULE`
      ).toBeDefined()
    }
  })
})

describe("Phase 2b", () => {
  it('ENTITY_TO_MODULE: covers complaint and inbox_message entityTypes', () => {
    expect(ENTITY_TO_MODULE["complaint"]).toBeDefined()
    expect(ENTITY_TO_MODULE["inbox_message"]).toBeDefined()
  })

  it('complaint maps to the tickets module (Support group)', () => {
    expect(ENTITY_TO_MODULE["complaint"]).toBe("tickets")
  })

  it('inbox_message maps to the omnichannel module (Communication group)', () => {
    expect(ENTITY_TO_MODULE["inbox_message"]).toBe("omnichannel")
  })

  it('deriveSection("complaint") === "Support"', () => {
    expect(deriveSection("complaint")).toBe("Support")
  })

  it('deriveSection("inbox_message") === "Communication"', () => {
    expect(deriveSection("inbox_message")).toBe("Communication")
  })

  it("NOTIFICATION_KINDS: contains complaint.created with section=Support", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "complaint.created")
    expect(entry, '"complaint.created" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("complaint")
    expect(entry?.section).toBe("Support")
  })

  it("NOTIFICATION_KINDS: contains inbox.message with section=Communication", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "inbox.message")
    expect(entry, '"inbox.message" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("inbox_message")
    expect(entry?.section).toBe("Communication")
  })

  it("kindsForSection: Support includes complaint.created", () => {
    const supportKinds = kindsForSection("Support")
    expect(supportKinds).toContain("complaint.created")
  })

  it("kindsForSection: Communication includes inbox.message", () => {
    const commKinds = kindsForSection("Communication")
    expect(commKinds).toContain("inbox.message")
  })
})

describe("kindsForSection", () => {
  it("returns only kinds for the given section", () => {
    const crmKinds = kindsForSection("CRM")
    // All returned must be from CRM section
    for (const k of crmKinds) {
      const entry = NOTIFICATION_KINDS.find((n) => n.kind === k)
      expect(entry?.section).toBe("CRM")
    }
    // Must include known CRM kinds (task + contact/company stay in CRM;
    // deal/lead/quote moved to the Sales section).
    expect(crmKinds).toContain("task.created")
    expect(crmKinds).toContain("contact.created")
    expect(crmKinds).not.toContain("deal.won")
  })

  it("returns Sales kinds (deal/lead/quote moved here)", () => {
    const salesKinds = kindsForSection("Sales")
    for (const k of salesKinds) {
      const entry = NOTIFICATION_KINDS.find((n) => n.kind === k)
      expect(entry?.section).toBe("Sales")
    }
    expect(salesKinds).toContain("deal.won")
    expect(salesKinds).toContain("lead.created")
    expect(salesKinds).toContain("quote.sent")
  })

  it("returns Support kinds", () => {
    const supportKinds = kindsForSection("Support")
    expect(supportKinds).toContain("ticket.created")
    expect(supportKinds).toContain("ticket.comment")
    // no deal kinds
    expect(supportKinds).not.toContain("deal.won")
  })

  it("returns Marketing kinds", () => {
    const marketingKinds = kindsForSection("Marketing")
    expect(marketingKinds).toContain("campaign.sent")
  })

  it("returns empty array for a section with no notification kinds", () => {
    expect(kindsForSection("Settings")).toEqual([])
  })

  it("CLM: Contracts Control section includes all contract notification kinds", () => {
    const contractKinds = kindsForSection("Contracts Control")
    expect(contractKinds).toContain("contract.approval_requested")
    expect(contractKinds).toContain("contract.approved")
    expect(contractKinds).toContain("contract.signed")
    expect(contractKinds).toContain("contract.declined")
    expect(contractKinds).toContain("contract.renewal_due")
  })

  it("Phase 2a: Sales section includes quote kinds", () => {
    const salesKinds = kindsForSection("Sales")
    expect(salesKinds).toContain("quote.sent")
    expect(salesKinds).toContain("quote.accepted")
    expect(salesKinds).toContain("quote.rejected")
  })

  it("Phase 2a: Finance section includes invoice.paid and invoice.overdue", () => {
    const financeKinds = kindsForSection("Finance")
    expect(financeKinds).toContain("invoice.paid")
    expect(financeKinds).toContain("invoice.overdue")
  })

  it("Phase 2c: Route & Field section includes order kinds", () => {
    const rfKinds = kindsForSection("Route & Field")
    expect(rfKinds).toContain("order.created")
    expect(rfKinds).toContain("order.shipped")
    expect(rfKinds).toContain("order.returned")
  })

  it("Phase 2c: Marketing section includes survey.response", () => {
    const marketingKinds = kindsForSection("Marketing")
    expect(marketingKinds).toContain("survey.response")
    expect(marketingKinds).not.toContain("loyalty.tier_changed")
  })

  it("Phase 2c: Loyalty Program section includes loyalty kinds", () => {
    const loyaltyKinds = kindsForSection("Loyalty Program")
    expect(loyaltyKinds).toContain("loyalty.tier_changed")
    expect(loyaltyKinds).toContain("loyalty.redeemed")
  })
})

describe("Phase 2c", () => {
  it("ENTITY_TO_MODULE: covers order, survey, loyalty entityTypes", () => {
    expect(ENTITY_TO_MODULE["order"]).toBeDefined()
    expect(ENTITY_TO_MODULE["survey"]).toBeDefined()
    expect(ENTITY_TO_MODULE["loyalty"]).toBeDefined()
  })

  it("order maps to mtm module (Route & Field group)", () => {
    expect(ENTITY_TO_MODULE["order"]).toBe("mtm")
  })

  it("survey maps to campaigns module (Marketing group)", () => {
    expect(ENTITY_TO_MODULE["survey"]).toBe("campaigns")
  })

  it("loyalty maps to loyalty module (Loyalty Program group)", () => {
    expect(ENTITY_TO_MODULE["loyalty"]).toBe("loyalty")
  })

  it('deriveSection("order") === "Route & Field"', () => {
    expect(deriveSection("order")).toBe("Route & Field")
  })

  it('deriveSection("survey") === "Marketing"', () => {
    expect(deriveSection("survey")).toBe("Marketing")
  })

  it('deriveSection("loyalty") === "Loyalty Program"', () => {
    expect(deriveSection("loyalty")).toBe("Loyalty Program")
  })

  it("NOTIFICATION_KINDS: contains all three order kinds with section=Route & Field", () => {
    const orderKinds = NOTIFICATION_KINDS.filter((k) => k.entityType === "order")
    expect(orderKinds.length).toBe(3)
    for (const k of orderKinds) {
      expect(k.section, `"${k.kind}".section must be "Route & Field"`).toBe("Route & Field")
    }
    const kindStrings = orderKinds.map((k) => k.kind)
    expect(kindStrings).toContain("order.created")
    expect(kindStrings).toContain("order.shipped")
    expect(kindStrings).toContain("order.returned")
  })

  it("NOTIFICATION_KINDS: contains survey.response with section=Marketing", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "survey.response")
    expect(entry, '"survey.response" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("survey")
    expect(entry?.section).toBe("Marketing")
  })

  it("NOTIFICATION_KINDS: contains loyalty.tier_changed and loyalty.redeemed with section=Loyalty Program", () => {
    const loyaltyKinds = NOTIFICATION_KINDS.filter((k) => k.entityType === "loyalty")
    const kindStrings = loyaltyKinds.map((k) => k.kind)
    expect(kindStrings).toContain("loyalty.tier_changed")
    expect(kindStrings).toContain("loyalty.redeemed")
    // NOT emitted on every earn — high-volume event must NOT appear
    expect(kindStrings).not.toContain("loyalty.earned")
    expect(kindStrings).not.toContain("loyalty.points_earned")
    for (const k of loyaltyKinds) {
      expect(k.section, `"${k.kind}".section must be "Loyalty Program"`).toBe("Loyalty Program")
    }
  })

  it("kindsForSection: Route & Field is non-empty after Phase 2c", () => {
    const rfKinds = kindsForSection("Route & Field")
    expect(rfKinds.length).toBeGreaterThan(0)
  })

  it("all new Phase 2c entityTypes resolve to real nav sections", () => {
    // MC-T4: survey maps to legacy "campaigns" which resolves to the
    // Marketing GROUP via LEGACY_MODULE_MAP; loyalty and mtm are own group modules.
    for (const et of ["order", "survey", "loyalty"]) {
      const mod = ENTITY_TO_MODULE[et]
      const section = moduleToSection(mod)
      expect(section, `module "${mod}" for "${et}" must resolve to a section`).not.toBeNull()
      expect(NAV_GROUP_ORDER).toContain(section as string)
    }
  })
})

describe("Phase 2d — Industry Cloud notifications", () => {
  it("ENTITY_TO_MODULE: covers all 5 industry entityTypes", () => {
    for (const et of ["health_patient", "claim", "ps_case", "media_subscriber", "outage"]) {
      expect(ENTITY_TO_MODULE[et], `ENTITY_TO_MODULE["${et}"] must exist`).toBeDefined()
    }
  })

  it("health_patient maps to health module (Health Cloud)", () => {
    expect(ENTITY_TO_MODULE["health_patient"]).toBe("health")
    expect(deriveSection("health_patient")).toBe("Health Cloud")
  })

  it("claim maps to insurance module (Insurance Cloud)", () => {
    expect(ENTITY_TO_MODULE["claim"]).toBe("insurance")
    expect(deriveSection("claim")).toBe("Insurance Cloud")
  })

  it("ps_case maps to public-sector module (Public Sector)", () => {
    expect(ENTITY_TO_MODULE["ps_case"]).toBe("public-sector")
    expect(deriveSection("ps_case")).toBe("Public Sector")
  })

  it("media_subscriber maps to media module (Media Cloud)", () => {
    expect(ENTITY_TO_MODULE["media_subscriber"]).toBe("media")
    expect(deriveSection("media_subscriber")).toBe("Media Cloud")
  })

  it("outage maps to energy module (Energy & Utilities)", () => {
    expect(ENTITY_TO_MODULE["outage"]).toBe("energy")
    expect(deriveSection("outage")).toBe("Energy & Utilities")
  })

  it("NOTIFICATION_KINDS: contains health_patient.created with section=Health Cloud", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "health_patient.created")
    expect(entry, '"health_patient.created" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("health_patient")
    expect(entry?.section).toBe("Health Cloud")
  })

  it("NOTIFICATION_KINDS: contains claim.filed with section=Insurance Cloud", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "claim.filed")
    expect(entry, '"claim.filed" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("claim")
    expect(entry?.section).toBe("Insurance Cloud")
  })

  it("NOTIFICATION_KINDS: contains ps_case.created with section=Public Sector", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "ps_case.created")
    expect(entry, '"ps_case.created" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("ps_case")
    expect(entry?.section).toBe("Public Sector")
  })

  it("NOTIFICATION_KINDS: contains subscriber.created with section=Media Cloud", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "subscriber.created")
    expect(entry, '"subscriber.created" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("media_subscriber")
    expect(entry?.section).toBe("Media Cloud")
  })

  it("NOTIFICATION_KINDS: contains outage.reported with section=Energy & Utilities", () => {
    const entry = NOTIFICATION_KINDS.find((k) => k.kind === "outage.reported")
    expect(entry, '"outage.reported" must be in NOTIFICATION_KINDS').toBeDefined()
    expect(entry?.entityType).toBe("outage")
    expect(entry?.section).toBe("Energy & Utilities")
  })

  it("kindsForSection: each industry section contains its kind", () => {
    expect(kindsForSection("Health Cloud")).toContain("health_patient.created")
    expect(kindsForSection("Insurance Cloud")).toContain("claim.filed")
    expect(kindsForSection("Public Sector")).toContain("ps_case.created")
    expect(kindsForSection("Media Cloud")).toContain("subscriber.created")
    expect(kindsForSection("Energy & Utilities")).toContain("outage.reported")
  })

  it("all 5 industry entityTypes have modules that exist in navItems", () => {
    const navModules = new Set(navItems.flatMap((i) => i.module ? [i.module] : []))
    for (const et of ["health_patient", "claim", "ps_case", "media_subscriber", "outage"]) {
      const mod = ENTITY_TO_MODULE[et]
      expect(navModules.has(mod as never), `module "${mod}" for "${et}" must exist in navItems`).toBe(true)
    }
  })

  it("all 5 industry deriveSection results are in NAV_GROUP_ORDER", () => {
    const sectionMap: Record<string, string> = {
      health_patient:   "Health Cloud",
      claim:            "Insurance Cloud",
      ps_case:          "Public Sector",
      media_subscriber: "Media Cloud",
      outage:           "Energy & Utilities",
    }
    for (const [et, expectedSection] of Object.entries(sectionMap)) {
      const section = deriveSection(et)
      expect(section, `deriveSection("${et}") must equal "${expectedSection}"`).toBe(expectedSection)
      expect(NAV_GROUP_ORDER, `section "${section}" must be in NAV_GROUP_ORDER`).toContain(section)
    }
  })
})
