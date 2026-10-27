import { describe, expect, it, vi } from "vitest"
import { createInboundPilotHandler, ZEYTUN_INBOUND_CLOSING, ZEYTUN_INBOUND_OPENING, ZEYTUN_INBOUND_PROMPT, ZEYTUN_LINE_OPENING, ZEYTUN_LINE_PROMPT, ZEYTUN_LINE_RETURN_OPENING, ZEYTUN_TRANSFER_PHRASE, type InboundPilotConfig, type InboundPilotCall, type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { isPharmacyInboundPreview } from "@/lib/voice-agent/pharmacy/zeytun-inbound-audit"

const now = Date.parse("2026-10-22T12:00:00Z"), token = "t".repeat(48)
export const config: Extract<InboundPilotConfig, { purpose: "owner_inbound_preview" }> = {
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
    expect(ZEYTUN_INBOUND_CLOSING.length).toBeGreaterThanOrEqual(3)
    expect(ZEYTUN_INBOUND_CLOSING.length).toBeLessThanOrEqual(120)
  })

  it("opens an answered inbound test using complete international digits and no CRM subject", async () => {
    const f = fixture(), response = await f.handle(request()), body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ enabled: true, variant: "pharmacy_inbound_preview", maxSeconds: 300 })
    expect(body.opening).toContain("sınaq")
    expect(body.prompt).toContain("NOT an authenticated pharmacy")
    // The station hangs up on this exact sentence; the prompt must ask for the same one.
    expect(body.closing).toBe(ZEYTUN_INBOUND_CLOSING)
    // The station re-voices the agent with this TTS; it accepts only a model and voice it knows.
    expect(body).toMatchObject({ voice: null, pinSpeechLanguage: false,
      speech: { engine: "tts", model: "gemini-3.8-flash-tts", voice: "Sulafat" } })
    expect(body.prompt).toContain(`"${ZEYTUN_INBOUND_CLOSING}"`)
    // No maker words in this catalog: an empty hint list, never a missing field.
    expect(body.vocabulary).toEqual([])
    expect(f.dependencies.claim).toHaveBeenCalledOnce()
    expect(f.dependencies.loadCall).toHaveBeenCalledTimes(2)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(JSON.stringify(body)).not.toContain(config.testPhoneE164)
    expect(JSON.stringify(body)).not.toContain(config.approvedSource.organizationId)
  })
  it("reads Zeytun's list price per spoken unit, never stock", async () => {
    const f = fixture()
    const rows = [
      { externalId: "cccccccc-1111-4111-8111-111111111111", itemCode: "BOX", name: "Box", nameAz: null,
        priceAsReported: "1.33", baseUnitAsReported: "упак", quantityAsReported: "100" },
      { externalId: "cccccccc-2222-4111-8111-111111111111", itemCode: "AMP", name: "Ampoule", nameAz: null,
        priceAsReported: "4.54", baseUnitAsReported: "шт ", quantityAsReported: "6" },
      // A unit without a reviewed spoken word, a zero and a float: no price.
      { externalId: "cccccccc-3333-4111-8111-111111111111", itemCode: "TUBE", name: "Tube", nameAz: null,
        priceAsReported: "3.2", baseUnitAsReported: "тюб" },
      { externalId: "cccccccc-4444-4111-8111-111111111111", itemCode: "ZERO", name: "Zero", nameAz: null,
        priceAsReported: "0", baseUnitAsReported: "упак" },
      { externalId: "cccccccc-5555-4111-8111-111111111111", itemCode: "NUM", name: "Num", nameAz: null,
        priceAsReported: 2.5, baseUnitAsReported: "упак" },
    ]
    vi.mocked(f.catalog.search).mockReturnValue({ status: "candidates", candidateCount: rows.length, candidates: rows })
    const body = await (await f.handle(search())).json()
    const asOf = f.catalog.observedAt
    expect(body.candidates.map((item: { listPrice?: unknown }) => item.listPrice ?? null)).toEqual([
      { amount: "1.33", currency: "AZN", per: "qutu", asOf },
      { amount: "4.54", currency: "AZN", per: "ədəd", asOf },
      null, null, null,
    ])
    expect(JSON.stringify(body)).not.toMatch(/quantityAsReported|"100"|"6"/)
    // A reference price is not a binding quote: the restrictions stay.
    expect(body).toMatchObject({ canQuote: false, canSubmitTo1c: false, requiresOperatorReview: true })
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
    // The grant's catalog may be warmed, but nothing of it or of the pilot is given.
    expect(f.dependencies.claim).not.toHaveBeenCalled()
  })
  it("starts the grant's catalog on the first session request, before the answered one needs it", async () => {
    // 2026-10-23: building the catalog on the answered request outlasted the
    // station's 5 s and the call stayed silent (nginx 499).
    const f = fixture()
    f.dependencies.loadCall.mockResolvedValue({ ...call, fromNumber: "+994500000002", targetPhoneE164: "+994500000002" })
    await f.handle(request())
    expect(f.dependencies.loadCatalog).toHaveBeenCalledOnce()
    // A failing warm-up never changes the answer.
    const g = fixture()
    g.dependencies.loadCatalog.mockRejectedValue(new Error("snapshot_unavailable"))
    g.dependencies.loadCall.mockResolvedValue({ ...call, fromNumber: "+994500000002", targetPhoneE164: "+994500000002" })
    await expect((await g.handle(request())).json()).resolves.toEqual({ enabled: false })
  })
  it("waits for a real answered observation before granting any prompt, search or claim", async () => {
    const f = fixture()
    f.dependencies.loadCall.mockResolvedValue({ ...call, status: "answering", wasAnswered: false })
    await expect((await f.handle(request())).json()).resolves.toEqual({ enabled: false, status: "awaiting_answered" })
    expect(f.dependencies.claim).not.toHaveBeenCalled()
    // The catalog is warmed here so the answered request is fast; no prompt,
    // search result or claim is given before the answer is observed.
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
    expect((await f.handle(request({ padding: "x".repeat(16_384) }))).status).toBe(413)
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

describe("saving the agreed list from the rehearsal call", () => {
  const PRODUCT = "cccccccc-1111-4111-8111-111111111111"
  const order = (lines: unknown) => request({ action: "order", callId: call.providerCallId, lines })
  const lines = [{ externalId: PRODUCT, quantity: 10, unit: "qutu", spoken: "on qutu" }, { quantity: 3, unit: "qutu", spoken: "fluimusil üç qutu" }]
  function withOrders() {
    const f = fixture()
    f.dependencies.loadConfig.mockImplementation(async () => ({ ...structuredClone(config), orderOrganizationId: "org-zeytun" }))
    vi.mocked(f.catalog.search).mockImplementation((query: { externalId?: string }) => ({ status: "candidates", candidateCount: 1, candidates:
      query.externalId === PRODUCT ? [{ externalId: PRODUCT, itemCode: "TEST-01", name: "Medicine", nameAz: "Dərman",
        priceAsReported: "12.5", baseUnitAsReported: "упак" }] : [] }))
    const saveOrder = vi.fn(async () => ({ status: "saved" as const, orderId: "o1", number: 1001, revision: 1, created: true, changed: true,
      total: "125.00", currency: "AZN" as const, priced: 1, unpriced: [], notFound: ["fluimusil üç qutu"] }))
    const handle = createInboundPilotHandler(token, { ...f.dependencies, saveOrder })
    return { ...f, saveOrder, handle }
  }

  it("saves to the grant's order organization with the catalog's own item and price, and returns the receipt", async () => {
    const f = withOrders()
    const response = await f.handle(order(lines))
    expect(await response.json()).toEqual({ status: "saved", orderNumber: "TS-1001", changed: true, total: "125.00",
      currency: "AZN", notFound: ["fluimusil üç qutu"], unpriced: [] })
    const [grant, savedCall, catalog, saved] = f.saveOrder.mock.calls[0] as unknown as [
      { orderOrganizationId: string }, InboundPilotCall, { find: (id: string) => unknown; source: string }, unknown]
    expect(grant.orderOrganizationId).toBe("org-zeytun")
    expect(savedCall.providerCallId).toBe(call.providerCallId)
    expect(saved).toEqual(lines)
    expect(catalog.source).toBe(config.approvedSource.organizationId)
    expect(catalog.find(PRODUCT)).toEqual({ externalId: PRODUCT, itemCode: "TEST-01", name: "Medicine", nameAz: "Dərman",
      listPrice: { amount: "12.5", per: "qutu" } })
    expect(catalog.find("dddddddd-1111-4111-8111-111111111111")).toBeNull()
    // The same proof as a search: the call must hold this grant's claim.
    expect(f.dependencies.isClaimed).toHaveBeenCalledOnce()
    expect(f.dependencies.claim).not.toHaveBeenCalled()
  })

  it("saves nothing without an order organization in the grant, or for a call without the claim", async () => {
    const f = fixture()
    const saveOrder = vi.fn()
    const handle = createInboundPilotHandler(token, { ...f.dependencies, saveOrder })
    expect(await (await handle(order(lines))).json()).toEqual({ status: "orders_disabled" })
    const g = withOrders()
    g.dependencies.isClaimed.mockResolvedValue(false)
    expect((await g.handle(order(lines))).status).toBe(403)
    expect(saveOrder).not.toHaveBeenCalled()
    expect(g.saveOrder).not.toHaveBeenCalled()
  })

  it("refuses a malformed list before reading anything", async () => {
    const f = withOrders()
    for (const bad of [[], [{ quantity: 1, unit: "qutu" }], [{ quantity: 0, unit: "qutu", spoken: "x" }],
      [{ quantity: 1, unit: "qutu", spoken: "x", price: "1.00" }], Array.from({ length: 31 }, () => ({ quantity: 1, unit: "qutu", spoken: "x" }))]) {
      expect((await f.handle(order(bad))).status).toBe(400)
    }
    expect(f.dependencies.loadConfig).not.toHaveBeenCalled()
    expect(f.saveOrder).not.toHaveBeenCalled()
  })

  it("tells the call when a manager already decided on its order", async () => {
    const f = withOrders()
    f.saveOrder.mockResolvedValueOnce({ status: "already_reviewed", number: 1001 } as never)
    expect(await (await f.handle(order(lines))).json()).toEqual({ status: "already_reviewed", orderNumber: "TS-1001" })
  })
})

describe("the line: every inbound call on it is Zeytun's order desk", () => {
  const line = {
    version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
    organizationId: config.organizationId, channelConfigId: config.channelConfigId,
    issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
    approvalReference: "owner-2026-10-24", approvedSource: { organizationId: config.approvedSource.organizationId, scopeKey: config.approvedSource.scopeKey },
    orderOrganizationId: "org-zeytun",
  } as const
  const pharmacyCall = { ...call, fromNumber: "+994552223344", targetPhoneE164: "+994552223344" }
  function lineFixture() {
    const f = fixture()
    f.dependencies.loadConfig.mockImplementation(async () => structuredClone(line))
    f.dependencies.loadCall.mockImplementation(async () => structuredClone(pharmacyCall))
    // The newest snapshot, not the rehearsal's pinned version.
    f.catalog.version = "e".repeat(64)
    const saveOrder = vi.fn(async () => ({ status: "saved" as const, orderId: "o1", number: 1001, revision: 1, created: true, changed: true,
      total: "0.00", currency: "AZN" as const, priced: 0, unpriced: [], notFound: ["x"] }))
    return { ...f, saveOrder, handle: createInboundPilotHandler(token, { ...f.dependencies, saveOrder }) }
  }

  it("keeps its texts inside the bridge limits and never calls the caller a test", () => {
    expect(ZEYTUN_LINE_PROMPT.length).toBeLessThanOrEqual(4000)
    expect(ZEYTUN_LINE_OPENING.length).toBeLessThanOrEqual(500)
    expect(ZEYTUN_LINE_OPENING).not.toMatch(/sınaq/i)
    expect(ZEYTUN_LINE_PROMPT).not.toMatch(/test participant|test call|rehearsal/i)
    expect(ZEYTUN_LINE_PROMPT).toContain("NOT verified")
    expect(ZEYTUN_LINE_PROMPT).toContain(`"${ZEYTUN_INBOUND_CLOSING}"`)
    // Owner, 2026-10-26: a substitute with the same substance, strength and form, only after a clear yes.
    expect(ZEYTUN_LINE_PROMPT).toContain('"substitute: INN; strength; form"')
    expect(ZEYTUN_LINE_PROMPT).toContain("only after a clear yes")
    expect(ZEYTUN_LINE_PROMPT).not.toContain("substitution or dosage")
    expect(ZEYTUN_LINE_PROMPT).toContain("unasked")
    // Owner, 2026-10-26: no read-back at the end unless asked; the order number and that it is being processed.
    expect(ZEYTUN_LINE_PROMPT).toContain("do not read the list back unless asked")
    expect(ZEYTUN_LINE_PROMPT).toContain("passed to Zeytun's manager for processing")
  })

  it("answers any caller with the line's opening and claims each call by itself", async () => {
    const f = lineFixture()
    const body = await (await f.handle(request())).json()
    expect(body).toMatchObject({ enabled: true, variant: "pharmacy_inbound_preview", opening: ZEYTUN_LINE_OPENING, prompt: ZEYTUN_LINE_PROMPT, maxSeconds: 300 })
    expect(f.dependencies.claim).toHaveBeenCalledOnce()
  })

  it("greets by the pharmacy 1C lists for the caller's number", async () => {
    const f = lineFixture()
    const findPharmacies = vi.fn(async () => [{ guid: "g1", name: "Zəfər Aptek", address: null }])
    const handle = createInboundPilotHandler(token, { ...f.dependencies, findPharmacies })
    const body = await (await handle(request())).json()
    expect(body.opening).toContain("«Zəfər Aptek» kimi qeydə alınıb")
    expect(findPharmacies).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), "+994552223344")
    // A directory that fails keeps the plain greeting.
    const failing = createInboundPilotHandler(token, { ...f.dependencies, findPharmacies: vi.fn(async () => { throw new Error("x") }) })
    expect((await (await failing(request())).json()).opening).toBe(ZEYTUN_LINE_OPENING)
  })

  it("hands the station the catalog's maker words for recognition", async () => {
    const f = lineFixture()
    f.catalog.vocabulary = ["Sopharma", "Berlin-Chemie"]
    expect((await (await f.handle(request())).json()).vocabulary).toEqual(["Sopharma", "Berlin-Chemie"])
  })

  it("leaves outbound calls on the line with the line's own agent", async () => {
    const f = lineFixture()
    f.dependencies.loadCall.mockResolvedValue({ ...pharmacyCall, direction: "outbound" })
    expect(await (await f.handle(request())).json()).toEqual({ enabled: false })
    expect(f.dependencies.claim).not.toHaveBeenCalled()
  })

  it("refuses rather than hands to AAC an inbound call it cannot read yet", async () => {
    const f = lineFixture()
    f.dependencies.loadCall.mockResolvedValue(null)
    expect((await f.handle(request())).status).toBe(403)
  })

  it("takes a newer snapshot but never a stale one, and lasts at most a month", async () => {
    const f = lineFixture()
    expect((await f.handle(search())).status).toBe(200)
    const stale = lineFixture()
    stale.catalog.observedAt = new Date(now - 25 * 3600_000).toISOString()
    expect((await stale.handle(search())).status).toBe(403)
    const long = lineFixture()
    long.dependencies.loadConfig.mockImplementation(async () => ({ ...structuredClone(line), expiresAt: new Date(now + 32 * 24 * 3600_000).toISOString() }))
    expect(await (await long.handle(request())).json()).toEqual({ enabled: false })
  })

  it("saves the list with the pharmacy the caller named", async () => {
    const f = lineFixture()
    const response = await f.handle(request({ action: "order", callId: call.providerCallId, pharmacy: "Zəfər Aptek",
      lines: [{ quantity: 2, unit: "qutu", spoken: "iki qutu" }] }))
    expect(await response.json()).toMatchObject({ status: "saved", orderNumber: "TS-1001" })
    expect((f.saveOrder.mock.calls[0] as unknown[])[4]).toBe("Zəfər Aptek")
  })

  describe("handing the call to a manager in the CRM browser", () => {
    // Owner, 2026-10-27: «переводить на менеджеров Зейтуна в браузере CRM, как обычный входящий».
    const transfer = () => request({ action: "transfer", callId: call.providerCallId })
    function withTransfer(answer: "transferring" | "unavailable" = "transferring") {
      const f = lineFixture()
      const requestTransfer = vi.fn(async () => answer)
      return { ...f, requestTransfer, handle: createInboundPilotHandler(token, { ...f.dependencies, saveOrder: f.saveOrder, requestTransfer }) }
    }

    it("offers the station the transfer phrase and keeps the rule inside the prompt limit", async () => {
      const f = withTransfer()
      expect((await (await f.handle(request())).json()).transfer).toBe(ZEYTUN_TRANSFER_PHRASE)
      expect(ZEYTUN_LINE_PROMPT).toContain("If the caller asks for a person, call transfer_to_manager.")
      expect(ZEYTUN_LINE_PROMPT.length).toBeLessThanOrEqual(4000)
      expect(ZEYTUN_LINE_RETURN_OPENING.length).toBeLessThanOrEqual(500)
      // Without a way to transfer (or on the owner's rehearsal) the station is told nothing.
      expect((await (await lineFixture().handle(request())).json())).not.toHaveProperty("transfer")
    })

    it("asks the CRM once for this claimed call and says the phrase only when it took the transfer", async () => {
      const f = withTransfer()
      expect(await (await f.handle(transfer())).json()).toEqual({ status: "transferring", say: ZEYTUN_TRANSFER_PHRASE })
      expect(f.requestTransfer).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), expect.objectContaining({ id: call.id }))
      expect(f.dependencies.isClaimed).toHaveBeenCalled()
      const busy = withTransfer("unavailable")
      expect(await (await busy.handle(transfer())).json()).toEqual({ status: "unavailable" })
    })

    it("never transfers a call that is not the line's live AI call", async () => {
      const unclaimed = withTransfer()
      unclaimed.dependencies.isClaimed.mockResolvedValue(false)
      expect((await unclaimed.handle(transfer())).status).toBe(403)
      const ringing = withTransfer()
      ringing.dependencies.loadCall.mockResolvedValue({ ...pharmacyCall, callMode: "human", status: "ringing", handoffState: "ringing" })
      expect((await ringing.handle(transfer())).status).toBe(403)
      expect(unclaimed.requestTransfer).not.toHaveBeenCalled()
      expect(ringing.requestTransfer).not.toHaveBeenCalled()
      // The owner's rehearsal grant has no transfer.
      const rehearsal = fixture()
      const requestTransfer = vi.fn(async () => "transferring" as const)
      const handle = createInboundPilotHandler(token, { ...rehearsal.dependencies, requestTransfer })
      expect(await (await handle(transfer())).json()).toEqual({ status: "unavailable" })
      expect(requestTransfer).not.toHaveBeenCalled()
    })

    it("greets a call nobody answered as one the AI takes back, not as a new call", async () => {
      const f = withTransfer()
      f.dependencies.loadCall.mockImplementation(async () => structuredClone({ ...pharmacyCall, handoffState: "returned" }))
      expect((await (await f.handle(request())).json()).opening).toBe(ZEYTUN_LINE_RETURN_OPENING)
    })
  })
})
