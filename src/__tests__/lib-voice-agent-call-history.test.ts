import { describe, expect, it, vi } from "vitest"

import {
  buildPriorConnectedCallWhere,
  deterministicCallPhoneVariants,
  loadPriorConnectedCallHistory,
} from "@/lib/voice-agent/call-history"

type HistoryRow = {
  leadId: string | null
  direction: string
  fromNumber: string
  toNumber: string
  targetPhoneE164: string | null
  callMode: string
  wasAnswered: boolean
  providerOutcome: string | null
  conversationOutcome: string | null
  status: string
  duration: number | null
}

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    leadId: null,
    direction: "outbound",
    fromNumber: "agent",
    toNumber: "+994500000001",
    targetPhoneE164: null,
    callMode: "human",
    wasAnswered: false,
    providerOutcome: null,
    conversationOutcome: null,
    status: "completed",
    duration: null,
    ...overrides,
  }
}

describe("deterministic call phone identity", () => {
  it("derives only exact canonical and known Azerbaijani storage variants", () => {
    expect(deterministicCallPhoneVariants("+994500000001")).toEqual([
      "+994500000001",
      "994500000001",
      "0500000001",
    ])
    expect(deterministicCallPhoneVariants("+15551112222")).toEqual([
      "+15551112222",
      "15551112222",
    ])
  })

  it("does not normalize formatted, local, short, or suffix-only input", () => {
    expect(deterministicCallPhoneVariants("+994 50 000 00 01")).toEqual([])
    expect(deterministicCallPhoneVariants("0500000001")).toEqual([])
    expect(deterministicCallPhoneVariants("000000001")).toEqual([])
  })

  it("builds an org-scoped predicate with no fuzzy phone operator", () => {
    const serialized = JSON.stringify(buildPriorConnectedCallWhere({
      organizationId: "org-1",
      leadId: "lead-1",
      targetPhoneE164: "+994500000001",
    }))

    expect(serialized).toContain('"organizationId":"org-1"')
    expect(serialized).toContain('"targetPhoneE164":"+994500000001"')
    expect(serialized).toContain('"toNumber":{"in":["+994500000001","994500000001","0500000001"]}')
    expect(serialized).toContain('"leadId":"lead-1","callMode":"human","status":"completed","duration":{"gt":0}')
    expect(serialized).not.toContain("contains")
    expect(serialized).not.toContain("endsWith")
  })
})

describe("loadPriorConnectedCallHistory", () => {
  it("separates explicit phone evidence from same-lead-only legacy evidence", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({
        leadId: "lead-a",
        targetPhoneE164: "+994500000001",
        wasAnswered: true,
      }),
      row({
        leadId: "lead-b",
        toNumber: "994500000002",
        callMode: "ai",
        conversationOutcome: "customer_spoke",
      }),
      row({
        leadId: "lead-c",
        toNumber: "0500000003",
        duration: 27,
      }),
      row({
        leadId: "different-lead",
        toNumber: "0500000004",
        duration: 60,
      }),
      row({
        leadId: "lead-e",
        targetPhoneE164: "+994500000005",
        status: "no-answer",
        providerOutcome: "no_answer",
      }),
    ])

    const result = await loadPriorConnectedCallHistory({
      db: { callLog: { findMany } } as never,
      organizationId: "org-1",
      targets: [
        { leadId: "lead-a", targetPhoneE164: "+994500000001" },
        { leadId: "lead-b", targetPhoneE164: "+994500000002" },
        { leadId: "lead-c", targetPhoneE164: "+994500000003" },
        { leadId: "lead-d", targetPhoneE164: "+994500000004" },
        { leadId: "lead-e", targetPhoneE164: "+994500000005" },
      ],
    })

    expect([...result.connectedLeadIds].sort()).toEqual(["lead-a", "lead-b", "lead-c"])
    expect([...result.connectedPhoneE164s].sort()).toEqual([
      "+994500000001",
      "+994500000002",
    ])
    const query = JSON.stringify(findMany.mock.calls[0]?.[0])
    expect(query).toContain('"organizationId":"org-1"')
    expect(query).toContain('"targetPhoneE164":{"in"')
    expect(query).not.toContain("contains")
  })

  it("accepts explicit provider connected evidence and inbound external-party identity", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({
        leadId: null,
        direction: "inbound",
        fromNumber: "0500000001",
        toNumber: "agent",
        providerOutcome: "connected",
      }),
    ])

    const result = await loadPriorConnectedCallHistory({
      db: { callLog: { findMany } } as never,
      organizationId: "org-1",
      targets: [{ leadId: "lead-a", targetPhoneE164: "+994500000001" }],
    })

    expect(result.connectedLeadIds.size).toBe(0)
    expect([...result.connectedPhoneE164s]).toEqual(["+994500000001"])
  })

  it("temporarily treats durable connected proof as connected until callback enrichment", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({
        leadId: "lead-a",
        callMode: "ai",
        conversationOutcome: "provider_connected_pending_result",
        targetPhoneE164: "+994500000001",
      }),
    ])

    const result = await loadPriorConnectedCallHistory({
      db: { callLog: { findMany } } as never,
      organizationId: "org-1",
      targets: [{ leadId: "lead-a", targetPhoneE164: "+994500000001" }],
    })

    expect([...result.connectedLeadIds]).toEqual(["lead-a"])
    expect([...result.connectedPhoneE164s]).toEqual(["+994500000001"])
    const query = JSON.stringify(findMany.mock.calls[0]?.[0])
    expect(query).toContain("provider_connected_pending_result")
  })

  it("does not query when no targets are supplied", async () => {
    const findMany = vi.fn()
    const result = await loadPriorConnectedCallHistory({
      db: { callLog: { findMany } } as never,
      organizationId: "org-1",
      targets: [],
    })

    expect(result.connectedLeadIds.size).toBe(0)
    expect(result.connectedPhoneE164s.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
