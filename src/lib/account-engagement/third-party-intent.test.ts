import { describe, it, expect, vi } from "vitest"
import {
  normalizeDomain,
  parseIntentCsv,
  applyThirdPartyIntentRows,
  createFileIntentProvider,
} from "./third-party-intent"

describe("normalizeDomain", () => {
  it("strips scheme / www / path / query / port and lowercases", () => {
    expect(normalizeDomain("https://www.Acme.com/path?q=1")).toBe("acme.com")
    expect(normalizeDomain("acme.com:443")).toBe("acme.com")
    expect(normalizeDomain("WWW.X.IO")).toBe("x.io")
    expect(normalizeDomain("http://sub.example.org/")).toBe("sub.example.org")
  })
  it("returns null for empty / non-string", () => {
    expect(normalizeDomain("")).toBeNull()
    expect(normalizeDomain("   ")).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain(undefined)).toBeNull()
  })
})

describe("parseIntentCsv", () => {
  it("parses a domain/topic/score/date CSV with header aliases", () => {
    const csv = [
      "website,intent_topic,score,observed_at",
      "https://acme.com,CRM software,82,2026-06-01",
      '"beta.io","Marketing automation",40,2026-06-02',
    ].join("\n")
    const { rows, errors } = parseIntentCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ companyDomain: "acme.com", topic: "CRM software", intentScore: 82 })
    expect(rows[1].companyDomain).toBe("beta.io")
  })

  it("falls back to company name when no domain column", () => {
    const csv = ["company,topic", "Acme Corp,Pricing research"].join("\n")
    const { rows, errors } = parseIntentCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0]).toMatchObject({ companyName: "Acme Corp", topic: "Pricing research" })
  })

  it("rejects a header without a topic column", () => {
    const { rows, errors } = parseIntentCsv("domain,score\nacme.com,90")
    expect(rows).toHaveLength(0)
    expect(errors[0]).toMatch(/topic/i)
  })

  it("collects per-row errors without throwing", () => {
    const csv = [
      "domain,topic,date",
      "acme.com,Good,2026-06-01",
      ",,2026-06-01", // missing domain + topic
      "beta.io,BadDate,not-a-date",
    ].join("\n")
    const { rows, errors } = parseIntentCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it("createFileIntentProvider exposes the parsed rows via the vendor seam", async () => {
    const provider = createFileIntentProvider("domain,topic\nacme.com,CRM")
    expect(provider.providerName).toBe("file-import")
    const rows = await provider.fetchRows()
    expect(rows[0].companyDomain).toBe("acme.com")
  })
})

function makeClient() {
  return {
    company: { findMany: vi.fn() },
    marketingAccount: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    accountIntentSignal: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "sig-1" }),
    },
  }
}

describe("applyThirdPartyIntentRows", () => {
  it("records a company-level signal for a domain-matched tracked account", async () => {
    const client = makeClient()
    client.company.findMany.mockResolvedValue([{ id: "co1", name: "Acme", website: "https://acme.com" }])
    client.marketingAccount.findMany.mockResolvedValue([{ id: "acc1", companyId: "co1" }])

    const observedAt = new Date("2026-06-01T00:00:00Z")
    const res = await applyThirdPartyIntentRows(
      "org-1",
      [{ companyDomain: "acme.com", companyName: null, topic: "CRM software", intentScore: 82, observedAt }],
      client as any,
    )
    expect(res).toMatchObject({ recorded: 1, duplicate: 0, noCompany: 0, notTracked: 0 })
    const { data } = client.accountIntentSignal.create.mock.calls[0][0]
    expect(data.marketingAccountId).toBe("acc1")
    expect(data.signalKind).toBe("third_party_intent")
    expect(data.contactId).toBeNull()
    expect(data.resourceRef).toBe("CRM software")
    expect(data.weight).toBe(82)
    expect(client.marketingAccount.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: { lastSignalAt: observedAt },
    })
  })

  it("matches by company name when domain misses", async () => {
    const client = makeClient()
    client.company.findMany.mockResolvedValue([{ id: "co1", name: "Acme Corp", website: null }])
    client.marketingAccount.findMany.mockResolvedValue([{ id: "acc1", companyId: "co1" }])
    const res = await applyThirdPartyIntentRows(
      "org-1",
      [{ companyName: "acme corp", topic: "Pricing", observedAt: new Date("2026-06-02") }],
      client as any,
    )
    expect(res.recorded).toBe(1)
  })

  it("reports noCompany / notTracked and skips duplicates", async () => {
    const client = makeClient()
    client.company.findMany.mockResolvedValue([
      { id: "co1", name: "Acme", website: "acme.com" }, // tracked
      { id: "co2", name: "Beta", website: "beta.io" }, // not tracked
    ])
    client.marketingAccount.findMany.mockResolvedValue([{ id: "acc1", companyId: "co1" }])
    client.accountIntentSignal.findFirst.mockResolvedValue({ id: "existing" }) // everything is a dup

    const res = await applyThirdPartyIntentRows(
      "org-1",
      [
        { companyDomain: "acme.com", topic: "T", observedAt: new Date("2026-06-01") }, // tracked → dup
        { companyDomain: "beta.io", topic: "T", observedAt: new Date("2026-06-01") }, // not tracked
        { companyDomain: "ghost.com", topic: "T", observedAt: new Date("2026-06-01") }, // no company
      ],
      client as any,
    )
    expect(res).toMatchObject({ recorded: 0, duplicate: 1, notTracked: 1, noCompany: 1 })
    expect(client.accountIntentSignal.create).not.toHaveBeenCalled()
  })
})
