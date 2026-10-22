import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ZeytunBalanceCache } from "@/lib/voice-agent/pharmacy/zeytun-balance-cache"
import { zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { validateZeytunCallContext } from "@/lib/voice-agent/pharmacy/zeytun-call-context"
import { ZeytunCustomerBindings } from "@/lib/voice-agent/pharmacy/zeytun-customer-bindings"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { createZeytunVoiceSearchHandler, ZEYTUN_VOICE_SEARCH_TOOL } from "@/lib/voice-agent/pharmacy/zeytun-voice-search"
import { guid, secondGuid, row, payload } from "./fixtures/zeytun-balances"

const stamp = "2026-10-22T12:00:00.000Z"
const initialTime = Date.parse(stamp)
const phone = "+994500000001"
const callId = "cccccccc-1111-4222-8333-444444444444"
const source = {
  organizationId: "tenant-test", endpoint: "https://inventory.example/AvailableBalances",
  username: "fake-reader", password: "fake-upstream-secret", request: { GUID: "33333333-4444-4555-8666-777777777777", METRO: false, Warehouse: "77777777-8888-4999-8aaa-bbbbbbbbbbbb" },
}
const config = { organizationId: source.organizationId, channelConfigId: "line-test", enabled: true, runtimeToken: "test-token-".repeat(8) }
const expected = { organizationId: config.organizationId, channelConfigId: config.channelConfigId, provider: "asterisk" as const, providerCallId: callId }

function directory() {
  return {
    organizationId: source.organizationId, version: "reviewed-1", capturedAt: stamp, expiresAt: "2026-10-23T12:00:00.000Z",
    bindings: [{ id: "binding-1", subject: { kind: "contact" as "contact" | "lead", id: "contact-1" },
      counterpartyGuid: source.request.GUID, warehouseGuid: source.request.Warehouse, metro: false, phoneNumbersE164: [phone], active: true,
      reviewedByUserId: "operator-1", reviewedAt: stamp, evidenceId: "review-1" }],
  }
}
function context() {
  return {
    call: { id: "call-log-1", ...expected, direction: "inbound", status: "in-progress", callMode: "ai", wasAnswered: true,
      fromNumber: phone, toNumber: "+994500000002", targetPhoneE164: phone, startedAt: stamp, endedAt: null,
      contactId: "contact-1", companyId: "company-1", leadId: null },
    subject: { kind: "contact", id: "contact-1", organizationId: source.organizationId, companyId: "company-1", isActive: true },
    company: { id: "company-1", organizationId: source.organizationId, status: "active" },
    channel: { id: config.channelConfigId, organizationId: source.organizationId, channelType: "voip", isActive: true, settings: { provider: "asterisk", voiceAgentEnabled: true } },
  }
}
function leadContext() {
  const base = context()
  return {
    ...base, call: { ...base.call, contactId: null, companyId: null, leadId: "lead-1", direction: "outbound", fromNumber: "+994500000002", toNumber: phone },
    subject: { kind: "lead", id: "lead-1", organizationId: source.organizationId, status: "qualified" }, company: null,
  }
}

describe("reviewed CRM to 1C mappings", () => {
  it("requires the CRM subject and never selects a customer by phone alone", () => {
    const mappings = new ZeytunCustomerBindings(directory())
    expect(mappings.resolve(source.organizationId, { kind: "contact", id: "contact-1" }, phone, initialTime).status).toBe("bound")
    expect(mappings.resolve(source.organizationId, { kind: "lead", id: "contact-1" }, phone, initialTime)).toMatchObject({ reason: "not_mapped" })
    expect(mappings.resolve(source.organizationId, { kind: "contact", id: "unknown" }, phone, initialTime)).toMatchObject({ reason: "not_mapped" })
    expect(mappings.resolve(source.organizationId, { kind: "contact", id: "contact-1" }, "+994500000003", initialTime)).toMatchObject({ reason: "phone_conflict" })
  })
  it("rejects the wrong tenant, expired and future directories", () => {
    const mappings = new ZeytunCustomerBindings(directory())
    for (const [tenant, now] of [["other", initialTime], [source.organizationId, initialTime - 1], [source.organizationId, initialTime + 86_400_000]] as const) {
      expect(mappings.resolve(tenant, { kind: "contact", id: "contact-1" }, phone, now)).toMatchObject({ reason: "directory_unavailable" })
    }
  })
  it("keeps shared phones and multiple warehouses ambiguous instead of choosing the configured one", () => {
    const data = directory()
    data.bindings.push({ ...data.bindings[0], id: "binding-2", subject: { kind: "contact", id: "contact-2" }, counterpartyGuid: secondGuid })
    expect(new ZeytunCustomerBindings(data).resolve(source.organizationId, data.bindings[0].subject, phone, initialTime)).toMatchObject({ reason: "ambiguous" })
    data.bindings[1] = { ...data.bindings[0], id: "binding-2", warehouseGuid: guid, phoneNumbersE164: ["+994500000004"] }
    expect(new ZeytunCustomerBindings(data).resolve(source.organizationId, data.bindings[0].subject, phone, initialTime)).toMatchObject({ reason: "ambiguous" })
  })
  it("revokes inactive mappings and returns defensive copies", () => {
    const data = directory()
    const mappings = new ZeytunCustomerBindings(data)
    const result = mappings.resolve(source.organizationId, data.bindings[0].subject, phone, initialTime)
    if (result.status !== "bound") throw new Error("expected binding")
    result.binding.phoneNumbersE164.length = 0
    data.bindings[0].active = false
    expect(mappings.resolve(source.organizationId, data.bindings[0].subject, phone, initialTime).status).toBe("bound")
    expect(new ZeytunCustomerBindings(data).resolve(source.organizationId, data.bindings[0].subject, phone, initialTime)).toMatchObject({ reason: "inactive" })
  })
  it("rejects guessed API shapes, duplicate binding IDs, nil GUIDs and future reviews", () => {
    expect(() => new ZeytunCustomerBindings({ code: 0, data: [] })).toThrow("invalid_customer_bindings")
    const duplicate = directory()
    duplicate.bindings.push({ ...duplicate.bindings[0] })
    expect(() => new ZeytunCustomerBindings(duplicate)).toThrow()
    for (const patch of [{ counterpartyGuid: "00000000-0000-0000-0000-000000000000" }, { reviewedAt: "2026-10-24T12:00:00Z" }, { phoneNumbersE164: ["0500000001"] }]) {
      const data = directory()
      Object.assign(data.bindings[0], patch)
      expect(() => new ZeytunCustomerBindings(data)).toThrow()
    }
  })
})

describe("active call projection", () => {
  it("supports an inbound contact and an explicitly mapped outbound lead", () => {
    expect(validateZeytunCallContext(context(), expected, initialTime)).not.toBeNull()
    expect(validateZeytunCallContext(leadContext(), expected, initialTime)).not.toBeNull()
  })
  it.each([
    { organizationId: "other" }, { providerCallId: guid }, { channelConfigId: "other-line" }, { provider: "twilio" },
    { status: "completed" }, { endedAt: stamp }, { callMode: "human" }, { wasAnswered: false },
    { contactId: "other-contact" }, { companyId: "other-company" }, { leadId: "also-a-lead" },
    { targetPhoneE164: "+994500000003" }, { fromNumber: "0500000001" }, { startedAt: "2026-10-23T12:00:00Z" },
  ])("denies inconsistent/ineligible call fields %j", (patch) => {
    const data = context()
    Object.assign(data.call, patch)
    expect(validateZeytunCallContext(data, expected, initialTime)).toBeNull()
  })
  it("checks related records, line disable and the call lifetime", () => {
    for (const mutate of [
      (data: ReturnType<typeof context>) => { data.subject.organizationId = "other" },
      (data: ReturnType<typeof context>) => { data.company.organizationId = "other" },
      (data: ReturnType<typeof context>) => { data.subject.companyId = "other" },
      (data: ReturnType<typeof context>) => { data.channel.channelType = "sms" },
      (data: ReturnType<typeof context>) => { data.channel.id = "other-line" },
      (data: ReturnType<typeof context>) => { data.channel.organizationId = "other" },
      (data: ReturnType<typeof context>) => { data.channel.settings.voiceAgentEnabled = false },
    ]) {
      const data = context(); mutate(data)
      expect(validateZeytunCallContext(data, expected, initialTime)).toBeNull()
    }
    expect(validateZeytunCallContext(context(), expected, initialTime + 7_200_000)).toBeNull()
  })
})

describe("voice search HTTP boundary", () => {
  let root: string
  let now: number
  let trustedCall: unknown
  let bindings: ZeytunCustomerBindings | null
  let cache: ZeytunBalanceCache
  const loadCall = vi.fn(async (_lookup: unknown): Promise<unknown> => trustedCall)
  const upstream = vi.fn(async () => { throw new Error("no network allowed") })
  let handler: (request: Request) => Promise<Response>
  beforeEach(async () => {
    now = initialTime; trustedCall = context(); bindings = new ZeytunCustomerBindings(directory())
    loadCall.mockReset(); loadCall.mockImplementation(async () => trustedCall); upstream.mockClear()
    root = await mkdtemp(join(tmpdir(), "zeytun-search-test-"))
    const disk = new ZeytunSnapshotStore(root, source.organizationId, zeytunBalanceScopeKey(source))
    const other = row(); other.Номенклатура.Guid = secondGuid; other.Номенклатура.Наименование = "Тестмедин 50 мг №20"
    const bytes = Buffer.from(payload([row(), other]))
    const feedContext = { organizationId: source.organizationId, observedAt: stamp, source: "live" as const }
    const feed = new ZeytunAvailableBalances(bytes, feedContext)
    await disk.save({ payload: bytes, context: feedContext, version: feed.summary(source.organizationId).version })
    cache = new ZeytunBalanceCache(source, disk, upstream, () => now)
    await cache.restore()
    handler = createZeytunVoiceSearchHandler(config, { cache, loadCall, getBindings: () => bindings, clock: () => now })
  })
  afterEach(async () => { expect(upstream).not.toHaveBeenCalled(); await rm(root, { recursive: true, force: true }) })
  function request(body: unknown = { callId, query: { text: "Тестмедин" } }, overrides: RequestInit = {}) {
    return new Request("https://crm.example/internal/pharmacy-search", {
      method: "POST", headers: { Authorization: `Bearer ${config.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), ...overrides,
    })
  }

  it("returns few candidates with source age, never customer identifiers, prices, stock or approval", async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json()
    expect(body).toMatchObject({ status: "candidates_only", candidateCount: 2, needsNarrowing: true,
      canQuote: false, canSubmitTo1c: false, canResolveIdentity: false, catalog: { observationStatus: "recent" } })
    expect(Object.keys(body.candidates[0]).sort()).toEqual(["externalId", "identityVerified", "itemCode", "name", "nameAz"])
    expect(JSON.stringify(body)).not.toMatch(/price|quantity|scopeKey|customer|promotion|password|operator-1|company-1|contact-1/i)
    expect(JSON.stringify(body)).not.toContain(source.request.GUID)
    expect(JSON.stringify(body)).not.toContain(source.request.Warehouse)
    expect(loadCall).toHaveBeenCalledWith(expected)
    expect(ZEYTUN_VOICE_SEARCH_TOOL.parameters.properties).not.toHaveProperty("callId")
    now += 31 * 60_000
    expect((await (await handler(request())).json()).catalog.observationStatus).toBe("stale")
  })
  it("supports a reviewed lead-only outbound call without matching by company name", async () => {
    trustedCall = leadContext()
    const data = directory(); data.bindings[0].subject = { kind: "lead", id: "lead-1" }
    bindings = new ZeytunCustomerBindings(data)
    expect((await (await handler(request())).json()).status).toBe("candidates_only")
  })
  it("requires authentication before reading CRM or catalog", async () => {
    const search = vi.spyOn(cache, "search")
    expect((await handler(request({}, { headers: { Authorization: "Bearer incorrect-token", "Content-Type": "application/json" } }))).status).toBe(401)
    expect(loadCall).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
  })
  it("provides only a defensive source identity to the handler, without 1C credentials", () => {
    const identity = cache.scope()
    expect(Object.keys(identity).sort()).toEqual(["organizationId", "request", "scopeKey"])
    expect(JSON.stringify(identity)).not.toContain(source.password)
    expect(JSON.stringify(identity)).not.toContain(source.username)
    identity.request.GUID = secondGuid
    expect(cache.scope().request.GUID).toBe(source.request.GUID)
  })
  it.each([
    { callId, organizationId: "other", query: { text: "x" } }, { callId, GUID: guid, query: { text: "x" } },
    { callId, query: { text: "x", warehouse: secondGuid } }, { callId, query: { text: "x", confidence: 1 } },
    { callId, query: { text: "x", itemCode: "y" } }, { callId, query: {} }, { callId: "bad", query: { text: "x" } },
  ])("rejects model-supplied context and invalid search %j", async (body) => {
    expect((await handler(request(body))).status).toBe(400)
    expect(loadCall).not.toHaveBeenCalled()
  })
  it("limits actual bytes and rejects malformed JSON/content type", async () => {
    expect((await handler(request({}, { body: "x".repeat(4097) }))).status).toBe(413)
    expect((await handler(request({}, { body: "{" }))).status).toBe(400)
    expect((await handler(request({}, { headers: { Authorization: `Bearer ${config.runtimeToken}`, "Content-Type": "text/plain" } }))).status).toBe(415)
    expect(loadCall).not.toHaveBeenCalled()
  })
  it("rechecks call closure and mapping revocation before each search", async () => {
    const search = vi.spyOn(cache, "search")
    expect((await handler(request())).status).toBe(200)
    const revoked = directory(); revoked.bindings[0].active = false; bindings = new ZeytunCustomerBindings(revoked)
    expect((await (await handler(request())).json()).status).toBe("customer_review_required")
    trustedCall = null
    expect((await handler(request())).status).toBe(403)
    expect(search).toHaveBeenCalledTimes(1)
  })
  it("never falls back to the configured pharmacy when another customer is bound", async () => {
    const search = vi.spyOn(cache, "search")
    const data = directory(); data.bindings[0].counterpartyGuid = secondGuid; bindings = new ZeytunCustomerBindings(data)
    expect((await handler(request())).status).toBe(503)
    expect(search).not.toHaveBeenCalled()
    bindings = null
    expect((await (await handler(request())).json()).status).toBe("customer_review_required")
    expect(search).not.toHaveBeenCalled()
  })
  it("masks loader errors and remains disabled without a valid server configuration", async () => {
    loadCall.mockRejectedValueOnce(new Error(source.password))
    expect(await (await handler(request())).text()).not.toContain(source.password)
    for (const input of [{ ...config, enabled: false }, { ...config, runtimeToken: "" }, { ...config, organizationId: "other" }]) {
      const disabled = createZeytunVoiceSearchHandler(input, { cache, loadCall, getBindings: () => bindings })
      expect((await disabled(request())).status).toBe(503)
    }
    expect(loadCall).toHaveBeenCalledTimes(1)
  })
  it("caps per-call requests, then permits the next window", async () => {
    for (let i = 0; i < 30; i++) expect((await handler(request())).status).toBe(200)
    expect((await handler(request())).status).toBe(429)
    expect(loadCall).toHaveBeenCalledTimes(30)
    now += 60_000
    expect((await handler(request())).status).toBe(200)
  })
  it("caps malformed authenticated traffic before CRM access", async () => {
    for (let i = 0; i < 120; i++) expect((await handler(request({}))).status).toBe(400)
    expect((await handler(request())).status).toBe(429)
    expect(loadCall).not.toHaveBeenCalled()
  })
  it("bounds concurrent requests while CRM reads are pending", async () => {
    let release!: () => void; let started!: () => void; let entered = 0
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { started = resolve })
    loadCall.mockImplementation(async () => { if (++entered === 4) started(); await waiting; return trustedCall })
    const pending = Array.from({ length: 4 }, () => handler(request()))
    await ready
    try { expect((await handler(request())).status).toBe(429) }
    finally { release(); await Promise.all(pending) }
    expect(loadCall).toHaveBeenCalledTimes(4)
  })
})
