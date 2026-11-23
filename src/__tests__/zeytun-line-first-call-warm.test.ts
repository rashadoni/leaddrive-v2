/**
 * The first call after a deploy starts as fast as any other (owner, 2026-11-23).
 *
 * Measured that day from the station's journal and the line's own timing log:
 * the calls that were the first on a freshly started line process waited
 * 1.9 s, 2.4 s and 6.1 s for the greeting (10:39 UTC: the two `session`
 * requests took 1388 ms and 3437 ms; on the calls after it, 61 ms and 419 ms).
 * A deploy starts a new line process and warmed only the catalog and the
 * pharmacy list. A pharmacy says «Alo» into such a silence, the greeting is
 * cut, and the agent opens with "Aha." instead.
 *
 * What is asserted here is what ran, not which functions are named: the
 * rehearsal goes through the real handler, so its reads are compared with the
 * reads of a real answered session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/api-auth", () => ({ getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: [], modules: {} })) }))

import { createInboundPilotHandler, rehearseInboundSession, type InboundPilotCall, type InboundPilotCatalog,
  type InboundPilotConfig, type InboundPilotDependencies, type InboundPilotOrderCall } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { warmZeytunLine } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { EMPTY_LINE_SPEECH } from "@/lib/voice-agent/pharmacy/zeytun-line-speech"
import { rehearseStationRoute } from "@/lib/voice-agent/pharmacy/zeytun-station-rehearsal"
import { createStationLiveTokens } from "@/lib/voice-agent/station-live-token"
import { PHONE_AGENT_CAPS_HEADER } from "@/lib/voice-agent/phone-agent/handler"

const now = Date.parse("2026-11-23T10:39:00Z")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const line = {
  version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
  organizationId: "tenant-line", channelConfigId: "channel-line",
  issuedAt: new Date(now - 3600_000).toISOString(), expiresAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
  approvalReference: "owner-2026-10-24", approvedSource: { organizationId: "inspection", scopeKey: "a".repeat(64) },
  orderOrganizationId: "org-zeytun",
} as const satisfies InboundPilotConfig
const realCall: InboundPilotCall = {
  id: "call-real", organizationId: line.organizationId, channelConfigId: line.channelConfigId,
  providerCallId: "bbbbbbbb-1111-4111-8111-111111111111", provider: "asterisk", direction: "inbound", callMode: "ai",
  status: "in-progress", wasAnswered: true, endedAt: null, startedAt: new Date(now - 2000).toISOString(),
  fromNumber: "+994552223344", targetPhoneE164: "+994120000000",
}

/** A line's dependencies as the host gives them, every one a spy; `seen` lists the reads in order. */
function lineHost(overrides: Partial<InboundPilotDependencies> = {}) {
  const seen: string[] = []
  const spy = <A extends unknown[], R>(name: string, answer: () => R) => vi.fn((...args: A) => { void args; seen.push(name); return answer() })
  const catalog: InboundPilotCatalog = {
    organizationId: line.approvedSource.organizationId, scopeKey: line.approvedSource.scopeKey, version: "e".repeat(64),
    observedAt: new Date(now - 60_000).toISOString(), source: "live",
    search: vi.fn(() => ({ status: "candidates" as const, candidateCount: 0, candidates: [] })),
  }
  const spies = {
    loadConfig: spy<[], Promise<unknown>>("loadConfig", async () => structuredClone(line)),
    loadCall: spy<[InboundPilotConfig, string], Promise<unknown>>("loadCall", async () => structuredClone(realCall)),
    loadCatalog: spy<[InboundPilotConfig], Promise<InboundPilotCatalog>>("loadCatalog", async () => catalog),
    claim: spy<[InboundPilotConfig, InboundPilotCall], Promise<boolean>>("claim", async () => true),
    isClaimed: spy<unknown[], Promise<boolean>>("isClaimed", async () => true),
    findPharmacies: spy<[InboundPilotConfig, string], Promise<never[]>>("findPharmacies", async () => []),
    loadLineSpeech: spy<unknown[], Promise<typeof EMPTY_LINE_SPEECH>>("loadLineSpeech", async () => EMPTY_LINE_SPEECH),
    learnedNames: spy<unknown[], null>("learnedNames", () => null),
    waitlistCallbackReaches: spy<unknown[], Promise<boolean>>("waitlistCallbackReaches", async () => false),
    pharmacyArrivals: spy<[unknown, InboundPilotOrderCall, unknown, string], Promise<never[]>>("pharmacyArrivals", async () => []),
    pharmacyAssortment: spy<unknown[], null>("pharmacyAssortment", () => null),
    saveOrder: spy<unknown[], Promise<never>>("saveOrder", async () => { throw new Error("a rehearsal saves nothing") }),
    cancelOrder: spy<unknown[], Promise<"cancelled">>("cancelOrder", async () => "cancelled"),
    requestTransfer: spy<unknown[], Promise<"unavailable">>("requestTransfer", async () => "unavailable"),
    markWaitlistArrivals: spy<unknown[], Promise<number>>("markWaitlistArrivals", async () => 0),
  }
  const secondEar = { enabled: spy<[], Promise<boolean>>("secondEar.enabled", async () => true), warm: spy<[], void>("secondEar.warm", () => undefined),
    recognize: spy<unknown[], Promise<{ error: "no_key"; ms: number }>>("secondEar.recognize", async () => ({ error: "no_key", ms: 0 })),
    pharmacyHeard: () => [], heard: () => [], remember: () => undefined } as unknown as NonNullable<InboundPilotDependencies["secondEar"]>
  const dependencies: InboundPilotDependencies = { clock: () => now, ...spies, secondEar, ...overrides }
  return { seen, catalog, spies, dependencies }
}

describe("a rehearsed session reads what an answered call's first answer reads", () => {
  it("makes every read of a real session, and claims, saves and sends nothing", async () => {
    // What a pharmacy's real answered session reads.
    const real = lineHost()
    const token = "t".repeat(48)
    const answer = await createInboundPilotHandler(token, real.dependencies)(new Request("https://crm.example.test/internal", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "session", callId: realCall.providerCallId }) }))
    expect(await answer.json()).toMatchObject({ enabled: true, variant: "pharmacy_inbound_preview" })
    const sessionReads = new Set(real.seen)
    expect([...sessionReads]).toEqual(expect.arrayContaining(["loadCall", "loadCatalog", "claim", "findPharmacies", "loadLineSpeech",
      "secondEar.enabled", "secondEar.warm", "waitlistCallbackReaches", "learnedNames", "pharmacyAssortment"]))

    const rehearsed = lineHost()
    const result = await rehearseInboundSession(line, rehearsed.dependencies)
    expect(result).toEqual({ status: 200, ms: 0 })
    const made = new Set(rehearsed.seen)
    // The claim is the one thing a session does that a rehearsal must not: it takes the call.
    for (const read of sessionReads) if (read !== "claim" && read !== "loadConfig") expect(made, read).toContain(read)
    for (const never of ["claim", "isClaimed", "saveOrder", "cancelOrder", "requestTransfer", "markWaitlistArrivals", "secondEar.recognize"]) {
      expect(made, never).not.toContain(never)
    }
  })

  it("asks the database for a call nobody made, and never reads a real pharmacy", async () => {
    const { dependencies, spies } = lineHost()
    await rehearseInboundSession(line, dependencies)
    // The lookup a session makes, once, for an id no call has.
    expect(spies.loadCall).toHaveBeenCalledTimes(1)
    expect(spies.loadCall.mock.calls[0][0]).toEqual(line)
    expect(spies.loadCall.mock.calls[0][1]).toMatch(UUID)
    expect(spies.loadCall.mock.calls[0][1]).not.toBe(realCall.providerCallId)
    // A number no pharmacy has, and a pharmacy 1C does not list.
    expect(spies.findPharmacies).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), "+994000000000")
    expect(spies.pharmacyArrivals).toHaveBeenCalledTimes(1)
    const [, call, , pharmacy] = spies.pharmacyArrivals.mock.calls[0]
    expect(pharmacy).toBe("00000000-0000-0000-0000-000000000000")
    expect(call).toMatchObject({ fromNumber: "+994000000000", organizationId: line.organizationId, channelConfigId: line.channelConfigId })
    expect(call.id).toMatch(/^rehearsal-/)
  })

  it("is the warm-up's report, never its failure: a slow or broken read costs the rehearsal, not the process", async () => {
    // The database does not answer the lookup, the line speech cannot be read: the session still composes.
    const broken = lineHost({ loadCall: vi.fn(async () => { throw new Error("db down") }),
      loadLineSpeech: vi.fn(async () => { throw new Error("settings unreadable") }) })
    expect(await rehearseInboundSession(line, broken.dependencies)).toMatchObject({ status: 200 })
    // A catalog a day old serves no call: the rehearsal says what a call would get.
    const stale = lineHost()
    stale.catalog.observedAt = new Date(now - 25 * 3600_000).toISOString()
    expect(await rehearseInboundSession(line, stale.dependencies)).toMatchObject({ status: 403 })
    // Anything thrown where the handler does not catch is "failed", not an exception.
    const thrown = lineHost({ loadCatalog: vi.fn(async () => { throw new Error("no snapshot") }) })
    expect(await rehearseInboundSession(line, thrown.dependencies)).toMatchObject({ status: expect.anything() })
  })

  it("leaves the owner's test grant as it was: a made-up caller is not its call, and none of the line is read", async () => {
    const preview = { ...line, purpose: "owner_inbound_preview", testPhoneE164: "+994500000001", orderOrganizationId: undefined,
      expiresAt: new Date(now + 600_000).toISOString(), issuedAt: new Date(now - 60_000).toISOString(),
      approvedSource: { ...line.approvedSource, catalogVersion: "e".repeat(64) } } as unknown as InboundPilotConfig
    const { dependencies, seen } = lineHost()
    // That grant takes only its own test number: a made-up caller gets «not ours», as a stranger's call would.
    expect(await rehearseInboundSession(preview, dependencies)).toMatchObject({ status: 200 })
    expect(seen).not.toContain("findPharmacies")
    expect(seen).not.toContain("loadLineSpeech")
    expect(seen).not.toContain("pharmacyArrivals")
  })
})

describe("warmZeytunLine rehearses a session once the catalog and the pharmacy list are in memory", () => {
  it("reports the rehearsal beside the warm-up, after the catalog and the list", async () => {
    const { dependencies, seen } = lineHost()
    const result = await warmZeytunLine(dependencies as unknown as Parameters<typeof warmZeytunLine>[0])
    expect(result).toMatchObject({ outcome: "warm", session: { status: 200 } })
    const first = (name: string) => seen.indexOf(name)
    expect(first("loadCatalog")).toBeGreaterThan(-1)
    expect(first("markWaitlistArrivals")).toBeGreaterThan(first("findPharmacies"))
    // The rehearsal's own reads come after the waiting list was stamped.
    expect(first("loadCall")).toBeGreaterThan(first("markWaitlistArrivals"))
    expect(first("loadLineSpeech")).toBeGreaterThan(first("markWaitlistArrivals"))
  })

  it("rehearses nothing without the line's grant", async () => {
    const { dependencies, seen } = lineHost({ loadConfig: vi.fn(async () => null) })
    expect(await warmZeytunLine(dependencies as unknown as Parameters<typeof warmZeytunLine>[0])).toEqual({ outcome: "not_configured" })
    expect(seen).toEqual([])
  })
})

describe("the station's first request, asked of this process's own route", () => {
  const token = "s".repeat(48)
  const env = { PORT: "3005", FANUM_VOICE_RUNTIME_TOKEN: token } as unknown as NodeJS.ProcessEnv
  let requests: Request[]
  beforeEach(() => { requests = [] })
  const answering = (status: number) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // As it arrives at the route: the HTTP client states the length of a string body.
    const headers = new Headers(init?.headers)
    headers.set("content-length", String(Buffer.byteLength(String(init?.body ?? ""))))
    requests.push(new Request(input as string, { ...init, headers }))
    return new Response(JSON.stringify({ enabled: false }), { status })
  }) as unknown as typeof fetch

  it("asks the route on loopback as the station does: its token, its capabilities, a call nobody made", async () => {
    const result = await rehearseStationRoute(answering(403), env)
    expect(result).toMatchObject({ status: 403 })
    expect(requests).toHaveLength(1)
    const sent = requests[0]
    expect(sent.url).toBe("http://127.0.0.1:3005/api/internal/voice-agent/pharmacy-inbound")
    expect(sent.method).toBe("POST")
    expect(sent.headers.get("authorization")).toBe(`Bearer ${token}`)
    expect(sent.headers.get(PHONE_AGENT_CAPS_HEADER)).toBe("tools-1, live-token-1")
    expect(await sent.clone().json()).toEqual({ action: "session", callId: expect.stringMatching(UUID) })
  })

  it("is a request the real route's parts take as a station's session", async () => {
    await rehearseStationRoute(answering(403), env)
    const sent = requests[0]
    const callId = ((await sent.clone().json()) as { callId: string }).callId
    // The line's handler authenticates it, parses it and looks that call up.
    const { dependencies } = lineHost({ loadCall: vi.fn(async () => null) })
    const answer = await createInboundPilotHandler(token, dependencies)(sent.clone())
    expect(answer.status).toBe(403)
    expect(dependencies.loadCall).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), callId)
    // The own-key token asks whose call it is: the station's capability and token are the ones it requires.
    const organizationOf = vi.fn(async () => null)
    const tokens = createStationLiveTokens(token, { now: () => now, organizationOf, ownKey: vi.fn(async () => null), mint: vi.fn(async () => "auth_tokens/never-minted") })
    const pending = tokens.begin(sent.clone())
    expect(pending).not.toBeNull()
    await tokens.attach(new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { "content-type": "application/json" } }), pending)
    expect(organizationOf).toHaveBeenCalledWith(callId)
  })

  it("asks nothing without a port or the station's token, and a failed request is its own result", async () => {
    for (const missing of [{}, { PORT: "3005" }, { FANUM_VOICE_RUNTIME_TOKEN: token }, { PORT: "abc", FANUM_VOICE_RUNTIME_TOKEN: token },
      { PORT: "70000", FANUM_VOICE_RUNTIME_TOKEN: token }, { PORT: "3005", FANUM_VOICE_RUNTIME_TOKEN: "short" }]) {
      const fetchImpl = answering(200)
      expect(await rehearseStationRoute(fetchImpl, missing as unknown as NodeJS.ProcessEnv)).toEqual({ status: "skipped" })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
    const refused = vi.fn(async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch
    expect(await rehearseStationRoute(refused, env)).toMatchObject({ status: "failed" })
  })
})
