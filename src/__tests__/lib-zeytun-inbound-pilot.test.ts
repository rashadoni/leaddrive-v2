import { describe, expect, it, vi } from "vitest"
import { createInboundPilotHandler, ZEYTUN_INBOUND_OPENING, ZEYTUN_INBOUND_PROMPT, type InboundPilotConfig, type InboundPilotCall, type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { isPharmacyInboundPreview } from "@/lib/voice-agent/pharmacy/zeytun-inbound-audit"

const now = Date.parse("2026-10-22T12:00:00Z"), token = "t".repeat(48)
export const config: InboundPilotConfig = {
  version: 1, enabled: true, purpose: "owner_inbound_preview", id: "aaaaaaaa-1111-4111-8111-111111111111",
  organizationId: "tenant-test", channelConfigId: "line-test", testPhoneE164: "+994500000001",
  issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), approvalReference: "test-approval",
  approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64), catalogVersion: "b".repeat(64) },
}
export const call: InboundPilotCall = {
  id: "call-test", organizationId: config.organizationId, channelConfigId: config.channelConfigId,
  providerCallId: "bbbbbbbb-1111-4111-8111-111111111111", provider: "asterisk", direction: "inbound", callMode: "ai",
  status: "in-progress", wasAnswered: true, endedAt: null, startedAt: new Date(now).toISOString(),
  fromNumber: "994500000001", targetPhoneE164: config.testPhoneE164,
}
function fixture() {
  const catalog: InboundPilotCatalog = {
    organizationId: config.approvedSource.organizationId, scopeKey: config.approvedSource.scopeKey,
    version: config.approvedSource.catalogVersion, observedAt: new Date(now).toISOString(), source: "live",
    search: vi.fn(() => ({ status: "candidates", candidateCount: 2, candidates: [{
      externalId: "cccccccc-1111-4111-8111-111111111111", itemCode: "TEST-01", name: "Medicine 10 mg", nameAz: null,
      price: 999, stock: 999, customerGuid: "private-source",
    }] })),
  }
  const state = { now }
  const dependencies = {
    loadConfig: vi.fn(async (): Promise<unknown> => structuredClone(config)),
    loadCall: vi.fn(async (): Promise<unknown> => structuredClone(call)),
    loadCatalog: vi.fn(async () => catalog), claim: vi.fn(async () => true), isClaimed: vi.fn(async () => true), clock: () => state.now,
  }
  return { state, catalog, dependencies, handle: createInboundPilotHandler(token, dependencies) }
}
function request(body: unknown = { action: "session", callId: call.providerCallId }, headers = {}) {
  return new Request("https://crm.example.test/internal", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
}
const search = () => request({ action: "search", callId: call.providerCallId, query: { text: "Medicine" } })

describe("single-call inbound owner rehearsal", () => {
  it("keeps the rehearsal texts inside the PBX bridge limits", () => {
    // scripts/pbx/fanum-zeytun-inbound.py refuses a prompt over 4000 or an
    // opening over 500 characters, and the call then never gets the pilot.
    expect(ZEYTUN_INBOUND_PROMPT.length).toBeLessThanOrEqual(4000)
    expect(ZEYTUN_INBOUND_OPENING.length).toBeLessThanOrEqual(500)
  })

  it("opens an answered inbound test using complete international digits and no CRM subject", async () => {
    const f = fixture(), response = await f.handle(request()), body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ enabled: true, variant: "pharmacy_inbound_preview", maxSeconds: 300 })
    expect(body.opening).toContain("sınaq")
    expect(body.prompt).toContain("NOT an authenticated pharmacy")
    expect(f.dependencies.claim).toHaveBeenCalledOnce()
    expect(f.dependencies.loadCall).toHaveBeenCalledTimes(2)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(JSON.stringify(body)).not.toContain(config.testPhoneE164)
    expect(JSON.stringify(body)).not.toContain(config.approvedSource.organizationId)
  })
  it("projects only names/codes and explicitly withholds stock, price and order powers", async () => {
    const f = fixture(), body = await (await f.handle(search())).json()
    expect(body).toMatchObject({ customerVerified: false, needsNarrowing: true, canQuote: false, canSubmitTo1c: false, canResolveIdentity: false })
    expect(body.candidates[0]).toEqual({ externalId: "cccccccc-1111-4111-8111-111111111111", itemCode: "TEST-01", name: "Medicine 10 mg", nameAz: null, identityVerified: false })
    expect(JSON.stringify(body)).not.toMatch(/999|private-source|customerGuid/)
    expect(f.dependencies.claim).not.toHaveBeenCalled()
    expect(f.dependencies.isClaimed).toHaveBeenCalledOnce()
  })
  it("leaves ordinary numbers on their existing scenario", async () => {
    const f = fixture()
    f.dependencies.loadCall.mockResolvedValue({ ...call, fromNumber: "+994500000002", targetPhoneE164: "+994500000002" })
    await expect((await f.handle(request())).json()).resolves.toEqual({ enabled: false })
    expect(f.dependencies.loadCatalog).not.toHaveBeenCalled()
  })
  it("waits for a real answered observation before granting any prompt, search or claim", async () => {
    const f = fixture()
    f.dependencies.loadCall.mockResolvedValue({ ...call, status: "answering", wasAnswered: false })
    await expect((await f.handle(request())).json()).resolves.toEqual({ enabled: false, status: "awaiting_answered" })
    expect(f.dependencies.claim).not.toHaveBeenCalled()
    expect(f.dependencies.loadCatalog).not.toHaveBeenCalled()
    expect((await f.handle(search())).status).toBe(403)
    f.dependencies.loadCall.mockResolvedValue(call)
    expect(await (await f.handle(request())).json()).toMatchObject({ enabled: true })
  })
  it("never requests an answered report for a wrong line, expired or revoked permit", async () => {
    const f = fixture()
    f.dependencies.loadCall.mockResolvedValue({ ...call, status: "answering", wasAnswered: false, channelConfigId: "wrong" })
    expect((await f.handle(request())).status).toBe(403)
    f.dependencies.loadCall.mockResolvedValue({ ...call, status: "answering", wasAnswered: false })
    f.dependencies.loadConfig.mockResolvedValueOnce(config).mockResolvedValue(null)
    expect((await f.handle(request())).status).toBe(403)
  })
  it.each([
    { status: "answering" }, { wasAnswered: false }, { callMode: "human" }, { direction: "outbound" },
    { endedAt: "2026-10-22T12:00:01Z" }, { channelConfigId: "wrong" }, { organizationId: "other" },
    { providerCallId: "cccccccc-1111-4111-8111-111111111111" }, { fromNumber: "0500000001" },
    { fromNumber: "++994500000001" }, { fromNumber: "994+500000001" },
    { startedAt: new Date(now - 120_000).toISOString() }, { startedAt: new Date(now + 1).toISOString() },
  ])("blocks an ineligible test call without falling back to AAC: %j", async patch => {
    const f = fixture(); f.dependencies.loadCall.mockResolvedValue({ ...call, ...patch })
    expect((await f.handle(request())).status).toBe(403)
    expect(f.dependencies.claim).not.toHaveBeenCalled()
  })
  it.each([
    { source: "attachment" }, { organizationId: "wrong" }, { scopeKey: "c".repeat(64) }, { version: "c".repeat(64) },
    { observedAt: new Date(now + 1).toISOString() }, { observedAt: new Date(now - 86400_001).toISOString() },
  ])("rejects catalog drift before disclosure: %j", async patch => {
    const f = fixture(); Object.assign(f.catalog, patch)
    expect((await f.handle(search())).status).toBe(403)
    expect(f.catalog.search).not.toHaveBeenCalled()
  })
  it("revokes after catalog/claim awaits and rechecks that the call is still live", async () => {
    for (const phase of ["catalog", "claim", "ended", "expiry"] as const) {
      const f = fixture()
      if (phase === "catalog") f.dependencies.loadCatalog.mockImplementation(async () => { f.dependencies.loadConfig.mockResolvedValue(null); return f.catalog })
      else f.dependencies.claim.mockImplementation(async () => {
        if (phase === "claim") f.dependencies.loadConfig.mockResolvedValue({ ...config, approvalReference: "changed" })
        if (phase === "ended") f.dependencies.loadCall.mockResolvedValue({ ...call, endedAt: new Date(now).toISOString() })
        if (phase === "expiry") f.state.now += 601_000
        return true
      })
      expect((await f.handle(request())).status).toBe(403)
    }
  })
  it("requires the one-call claim for session and every subsequent search", async () => {
    const f = fixture(); f.dependencies.claim.mockResolvedValue(false); f.dependencies.isClaimed.mockResolvedValue(false)
    expect((await f.handle(request())).status).toBe(403)
    expect((await f.handle(search())).status).toBe(403)
    expect(f.catalog.search).not.toHaveBeenCalled()
  })
  it("requires an explicit bounded grant and caps near-expiry call duration", async () => {
    const f = fixture()
    f.dependencies.loadConfig.mockResolvedValue({ ...config, expiresAt: new Date(now + 45_000).toISOString() })
    expect(await (await f.handle(request())).json()).toMatchObject({ maxSeconds: 45 })
    f.dependencies.loadConfig.mockResolvedValue({ ...config, expiresAt: new Date(now + 29_000).toISOString() })
    expect((await f.handle(request())).status).toBe(403)
    f.dependencies.loadConfig.mockResolvedValue({ ...config, expiresAt: new Date(now + 1800_000).toISOString() })
    expect((await f.handle(search())).status).toBe(403)
  })
  it("defaults to normal routing when no pilot is armed, but denies search", async () => {
    const f = fixture(); f.dependencies.loadConfig.mockResolvedValue(null)
    await expect((await f.handle(request())).json()).resolves.toEqual({ enabled: false })
    expect((await f.handle(search())).status).toBe(403)
  })
  it("rejects wrong authentication, content, oversize bodies and model-selected scope", async () => {
    const f = fixture()
    expect((await f.handle(request(undefined, { authorization: "Bearer wrong" }))).status).toBe(401)
    expect((await f.handle(request(undefined, { "content-type": "text/plain" }))).status).toBe(415)
    expect((await f.handle(request({ padding: "x".repeat(4096) }))).status).toBe(413)
    expect((await f.handle(request({ action: "search", callId: call.providerCallId, query: { text: "a", customerGuid: "injected" } }))).status).toBe(400)
    expect(f.dependencies.loadConfig).not.toHaveBeenCalled()
  })
  it("bounds per-call request volume and masks errors", async () => {
    const f = fixture(); f.dependencies.loadCall.mockRejectedValue(new Error("secret connection and customer"))
    const failed = await f.handle(search())
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret")
    for (let i = 1; i < 30; i++) await f.handle(search())
    expect((await f.handle(search())).status).toBe(429)
  })
  it("recognizes only the trusted same-call audit marker", () => {
    const marker = { version: 1, grantId: config.id, providerCallId: call.providerCallId }
    expect(isPharmacyInboundPreview({ pharmacyInboundPreview: marker }, call.providerCallId)).toBe(true)
    for (const audit of [null, {}, { pharmacyInboundPreview: true }, { pharmacyInboundPreview: { ...marker, providerCallId: "other" } }]) {
      expect(isPharmacyInboundPreview(audit, call.providerCallId)).toBe(false)
    }
  })
})
