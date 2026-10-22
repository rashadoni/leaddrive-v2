import { beforeEach, describe, expect, it, vi } from "vitest"
import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { createZeytunOwnerPreviewSearchHandler, ZEYTUN_OWNER_PREVIEW_SEARCH_TOOL } from "@/lib/voice-agent/pharmacy/zeytun-owner-preview"
import { createZeytunVoiceSearchHandler } from "@/lib/voice-agent/pharmacy/zeytun-voice-search"
import { payload, row } from "./fixtures/zeytun-balances"

const stamp = "2026-10-22T12:00:00.000Z", start = Date.parse(stamp)
const callId = "cccccccc-1111-4222-8333-444444444444"
const phone = "+994500000001"
const source = { organizationId: "inspection-source", scopeKey: "a".repeat(64),
  request: { GUID: "33333333-4444-4555-8666-777777777777", METRO: false, Warehouse: "77777777-8888-4999-8aaa-bbbbbbbbbbbb" } }
const config = { enabled: true, organizationId: "pilot-tenant", channelConfigId: "pilot-line",
  runtimeToken: "preview-only-token-".repeat(4), purpose: "owner_preview", testPhoneE164: phone,
  approvedSource: { organizationId: source.organizationId, scopeKey: source.scopeKey } }
const feed = new ZeytunAvailableBalances(Buffer.from(payload([row()])), { organizationId: source.organizationId, observedAt: stamp, source: "live" })
const version = feed.summary(source.organizationId).version
function permit() {
  return { id: "permit-1", purpose: "owner_preview", active: true, organizationId: config.organizationId,
    channelConfigId: config.channelConfigId, callLogId: "test-call", providerCallId: callId, direction: "outbound",
    testPhoneE164: phone, subject: { kind: "lead", id: "test-lead" }, approvedSource: { ...config.approvedSource },
    catalogVersion: version, issuedAt: stamp, expiresAt: "2026-10-22T12:30:00.000Z", approvedByUserId: "reviewer-1", evidenceId: "approval-1" }
}
function context() {
  return {
    call: { id: "test-call", organizationId: config.organizationId, channelConfigId: config.channelConfigId,
      provider: "asterisk", providerCallId: callId, callMode: "ai", direction: "outbound", status: "in-progress", wasAnswered: true,
      fromNumber: "+994500000002", toNumber: phone, targetPhoneE164: phone, contactId: null, companyId: null,
      leadId: "test-lead", startedAt: stamp, endedAt: null },
    channel: { id: config.channelConfigId, organizationId: config.organizationId, channelType: "voip", isActive: true,
      settings: { provider: "asterisk", voiceAgentEnabled: true } },
    subject: { kind: "lead", id: "test-lead", organizationId: config.organizationId, status: "qualified" }, company: null,
  }
}
function request(body: unknown = { callId, query: { text: "Тестмедин" } }, headers?: HeadersInit) {
  return new Request("http://localhost/internal/owner-preview", { method: "POST",
    headers: headers ?? { Authorization: `Bearer ${config.runtimeToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

describe("explicit owner-only catalog preview", () => {
  let now: number, currentPermit: unknown, trustedCall: unknown, catalogVersion: string
  let sourceScope: typeof source
  const loadCall = vi.fn(async (_lookup: unknown): Promise<unknown> => trustedCall)
  const getPermit = vi.fn((_callId: string): unknown => currentPermit)
  const search = vi.fn((organizationId: string, scopeKey: string, query: unknown) => {
    if (organizationId !== source.organizationId || scopeKey !== source.scopeKey) throw new Error("source_scope_mismatch")
    return { ...feed.search(organizationId, query), cache: {
      scopeKey, catalogVersion, itemCount: 1, observedAt: stamp, source: "live" as const, snapshotAgeMs: now - start,
      observationStatus: "recent" as const, nextAttemptAt: null, lastError: null, sourceGeneratedAt: null,
      coverage: "unverified" as const, canQuote: false as const, canSubmitTo1c: false as const,
    } }
  })
  const cache = { scope: () => structuredClone(sourceScope), search }
  const dependencies = { cache, loadCall, getPermit, clock: () => now }
  let handler: (request: Request) => Promise<Response>
  beforeEach(() => {
    now = start; currentPermit = permit(); trustedCall = context(); catalogVersion = version; sourceScope = structuredClone(source)
    loadCall.mockReset(); loadCall.mockImplementation(async () => trustedCall)
    getPermit.mockReset(); getPermit.mockImplementation(() => currentPermit)
    search.mockClear()
    handler = createZeytunOwnerPreviewSearchHandler(config, dependencies)
  })
  it("reads the explicitly approved source without relabeling its tenant or claiming customer verification", async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json()
    expect(body).toMatchObject({ mode: "owner_preview", customerVerified: false, status: "candidates_only",
      canResolveIdentity: false, canQuote: false, canSubmitTo1c: false, requiresOperatorReview: true })
    expect(body.candidates).toHaveLength(1)
    expect(search).toHaveBeenCalledWith(source.organizationId, source.scopeKey, { text: "Тестмедин" })
    expect(loadCall).toHaveBeenCalledWith({ organizationId: config.organizationId, channelConfigId: config.channelConfigId,
      provider: "asterisk", providerCallId: callId })
    const text = JSON.stringify(body)
    for (const privateValue of [phone, source.request.GUID, source.request.Warehouse, source.organizationId,
      source.scopeKey, "reviewer-1", "approval-1", "test-lead", config.runtimeToken]) expect(text).not.toContain(privateValue)
    expect(text).not.toMatch(/price|quantity|password/i)
    expect(ZEYTUN_OWNER_PREVIEW_SEARCH_TOOL.parameters.properties).not.toHaveProperty("callId")
  })
  it("permits inbound only with an explicitly matching inbound permit", async () => {
    const call = context(); call.call.direction = "inbound"; call.call.fromNumber = phone; call.call.toNumber = "+994500000002"
    trustedCall = call
    expect((await handler(request())).status).toBe(403)
    currentPermit = { ...permit(), direction: "inbound" }
    expect((await handler(request())).status).toBe(200)
    expect(search).toHaveBeenCalledTimes(1)
  })
  it.each([
    { active: false }, { purpose: "customer" }, { organizationId: "other" }, { channelConfigId: "other" },
    { callLogId: "different-log" }, { providerCallId: "bbbbbbbb-1111-4222-8333-444444444444" },
    { testPhoneE164: "+994500000003" }, { direction: "inbound" },
    { subject: { kind: "contact", id: "test-lead" } }, { subject: { kind: "lead", id: "different-lead" } },
    { approvedSource: { ...config.approvedSource, organizationId: "other" } },
    { approvedSource: { ...config.approvedSource, scopeKey: "b".repeat(64) } },
    { issuedAt: "2026-10-22T12:00:01Z" }, { expiresAt: stamp },
    { expiresAt: "2026-10-22T12:30:00.001Z" }, { issuedAt: "invalid" },
    { approvedByUserId: "" }, { evidenceId: "" }, { arbitraryOverride: true },
  ])("denies an invalid or mismatched server permit %j", async patch => {
    currentPermit = { ...permit(), ...patch }
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ status: "preview_not_authorized", candidates: [], customerVerified: false })
    expect(search).not.toHaveBeenCalled()
  })
  it("revokes access on missing permission and at the expiry boundary", async () => {
    expect((await handler(request())).status).toBe(200)
    currentPermit = null
    expect((await handler(request())).status).toBe(403)
    currentPermit = permit(); now = start + 30 * 60_000
    expect((await handler(request())).status).toBe(403)
    expect(search).toHaveBeenCalledTimes(1)
  })
  it("checks expiration and revocation after the awaited CRM read", async () => {
    loadCall.mockImplementationOnce(async () => { now = start + 30 * 60_000; return context() })
    expect((await handler(request())).status).toBe(403)
    now = start
    loadCall.mockImplementationOnce(async () => { currentPermit = null; return context() })
    expect((await handler(request())).status).toBe(403)
    expect(search).not.toHaveBeenCalled()
  })
  it("blocks another participant even if a permit for the approved owner exists", async () => {
    const call = context(); call.call.toNumber = "+994500000003"; call.call.targetPhoneE164 = call.call.toNumber
    trustedCall = call
    expect((await handler(request())).status).toBe(403)
    expect(search).not.toHaveBeenCalled()
  })
  it("blocks closure before reading a permit or the catalog", async () => {
    const call = context(); call.call.status = "completed"; trustedCall = call
    expect((await handler(request())).status).toBe(403)
    expect(getPermit).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
  })
  it("rejects a replaced source or snapshot without exposing its candidates", async () => {
    sourceScope.scopeKey = "b".repeat(64)
    expect((await handler(request())).status).toBe(403)
    expect(search).not.toHaveBeenCalled()
    sourceScope = structuredClone(source); catalogVersion = "new-version"
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect((await response.json()).candidates).toEqual([])
  })
  it("does not accept permissions or routing from model/request data", async () => {
    for (const extra of [{ permit: permit() }, { testPhoneE164: phone }, { approvedSource: config.approvedSource }, { mode: "owner_preview" }]) {
      expect((await handler(request({ callId, query: { text: "x" }, ...extra }))).status).toBe(400)
    }
    expect(loadCall).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
  })
  it("requires authentication and rejects disabled/unknown-purpose configuration", async () => {
    expect((await handler(request({}, { Authorization: "Bearer invalid", "Content-Type": "application/json" }))).status).toBe(401)
    for (const changed of [{ enabled: false }, { purpose: "customer" }, { approvedSource: null }, { testPhoneE164: "0500000001" }]) {
      const disabled = createZeytunOwnerPreviewSearchHandler({ ...config, ...changed }, dependencies)
      expect((await disabled(request())).status).toBe(503)
    }
    expect(loadCall).not.toHaveBeenCalled()
  })
  it("the standard customer factory cannot be switched into a preview by extra config fields", async () => {
    const standard = createZeytunVoiceSearchHandler(config, { cache, loadCall, getBindings: () => null, getClients: () => null })
    expect((await standard(request())).status).toBe(503)
    expect(search).not.toHaveBeenCalled()
  })
  it("masks a permit-store failure without catalog access", async () => {
    getPermit.mockImplementationOnce(() => { throw new Error("private-permit-store-details") })
    const response = await handler(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("private-permit-store-details")
    expect(search).not.toHaveBeenCalled()
  })
  it("uses the shared per-call request limit", async () => {
    for (let index = 0; index < 30; index++) expect((await handler(request())).status).toBe(200)
    expect((await handler(request())).status).toBe(429)
    expect(search).toHaveBeenCalledTimes(30)
  })
})
