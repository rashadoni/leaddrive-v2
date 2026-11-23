/**
 * An organization's own Gemini key for its phone calls (owner, 2026-11-23:
 * «по умолчанию мой ключ; если клиент сам будет платить — заменять на его»).
 *
 * The CRM hands the PBX station a short-lived Live token of the organization's
 * key in the answer to a call's `session` request. What is checked here is
 * what reaches the station and what the station's own bridge — the real
 * Python, run on the CRM's real answer — makes of it; Google is the one
 * stand-in (its answer is checked for real by /api/cron/voice-provider-check).
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const gateway = vi.hoisted(() => ({
  resolveAiKey: vi.fn(),
  unavailable: class AiUnavailableError extends Error {},
  failures: vi.fn(),
  callOrganization: vi.fn(),
}))
vi.mock("@/lib/ai/gateway/access", () => ({
  resolveAiKey: gateway.resolveAiKey,
  isAiUnavailable: (error: unknown) => error instanceof gateway.unavailable,
}))
vi.mock("@/lib/telemetry/operational-failure", () => ({ logOperationalFailure: gateway.failures }))
vi.mock("@/lib/voip/line-numbers", () => ({ callOrganization: gateway.callOrganization }))

import { GEMINI_LIVE_API_VERSION } from "@/lib/ai/voice/gemini-live"
import { PHONE_AGENT_CAPABILITY, PHONE_AGENT_CAPS_HEADER } from "@/lib/voice-agent/phone-agent/handler"
import {
  createStationLiveTokens, mintStationLiveToken, STATION_CAPS_HEADER, STATION_LIVE_TOKEN_CAPABILITY,
  STATION_TOKEN_API_VERSION, STATION_TOKEN_LIFETIME_MS, STATION_TOKEN_PATTERN, STATION_TOKEN_USES,
  type StationLiveTokenDependencies,
} from "@/lib/voice-agent/station-live-token"

const RUNTIME = "station-runtime-token-0123456789abcdef0123456789"
const CALL_ID = "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7"
const OTHER_CALL = "aaaaaaaa-1111-4111-8111-111111111111"
const TOKEN = "auth_tokens/3f1c9a7e5b2d4c6f8a0b1c2d3e4f5a6b7c8d9e0f"
const OWN_KEY = "own-gemini-key-of-the-organization-0001" // gitleaks:allow — not a key
const NOW = Date.parse("2026-11-23T08:00:00.000Z")
const BRIDGE = readFileSync("scripts/pbx/fanum-zeytun-inbound.py", "utf8")
const STATION_CAPS = BRIDGE.match(/^ZEYTUN_AGENT_CAPABILITY = "([^"]+)"$/m)![1] + ", " + BRIDGE.match(/^ZEYTUN_LIVE_TOKEN_CAPABILITY = "([^"]+)"$/m)![1]

function tokens(overrides: Partial<StationLiveTokenDependencies> = {}) {
  const dependencies = {
    organizationOf: vi.fn(async (callId: string) => (callId === CALL_ID ? "org-own-key" : callId === OTHER_CALL ? "org-platform" : null)),
    ownKey: vi.fn(async (organizationId: string) => (organizationId === "org-own-key" ? OWN_KEY : null)),
    mint: vi.fn(async () => TOKEN),
    now: () => NOW,
    ...overrides,
  } satisfies StationLiveTokenDependencies
  return { dependencies, live: createStationLiveTokens(RUNTIME, dependencies) }
}

function request(body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  return new Request("https://app.leaddrivecrm.org/api/internal/voice-agent/pharmacy-inbound", {
    method: "POST",
    // The station's client (urllib) always states the length.
    headers: { authorization: `Bearer ${RUNTIME}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)),
      [STATION_CAPS_HEADER]: STATION_CAPS, ...headers },
    body: text,
  })
}
const sessionOf = (callId = CALL_ID) => ({ action: "session", callId })
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
const LINE_SESSION = { enabled: true, variant: "pharmacy_inbound_preview", prompt: "Line rules", opening: "Salam!", maxSeconds: 900 }

/** The handler's answer as the station receives it, after the token step. */
async function answered(live: ReturnType<typeof tokens>["live"], req: Request, handlerAnswer: Response) {
  const pending = live.begin(req)
  const response = await live.attach(handlerAnswer, pending)
  return { pending, response, body: await response.clone().json() as Record<string, unknown> }
}

/** What the station's own bridge makes of a session answer: open(), then whose key Live opens on. */
function stationOpens(sessionAnswer: unknown): { opened: "session" | "ordinary" | "refused"; liveToken: string | null; usage: unknown } {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bridge", "scripts/pbx/fanum-zeytun-inbound.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
answer = json.load(sys.stdin)
bridge = module.ZeytunInboundBridge("https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config", "t" * 48,
    "${CALL_ID}", lambda body: answer, lambda: 100)
try:
    pilot = bridge.open()
    print(json.dumps({"opened": "session" if pilot else "ordinary", "liveToken": bridge.live_token(), "usage": bridge.auth_usage()}))
except module.ZeytunPilotUnavailable:
    print(json.dumps({"opened": "refused", "liveToken": bridge.live_token(), "usage": bridge.auth_usage()}))
`
  return JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(sessionAnswer), encoding: "utf8" }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the token Google is asked for", () => {
  it("is one call's worth: several sessions, to the end of the station's longest call, locked to no setup", async () => {
    const fetched = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ name: TOKEN }), { status: 200 }))
    await expect(mintStationLiveToken(OWN_KEY, new Date(NOW), fetched)).resolves.toBe(TOKEN)
    const [url, init] = fetched.mock.calls[0]
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens")
    expect(STATION_TOKEN_API_VERSION).toBe(GEMINI_LIVE_API_VERSION)
    expect(new Headers(init!.headers).get("x-goog-api-key")).toBe(OWN_KEY)
    const expires = new Date(NOW + STATION_TOKEN_LIFETIME_MS).toISOString()
    // Nothing but these three: a setup or a field mask here would replace the station's own setup.
    expect(JSON.parse(String(init!.body))).toEqual({ uses: STATION_TOKEN_USES, expireTime: expires, newSessionExpireTime: expires })
    // The station's longest call is fifteen minutes; a fresh session must still open at its end.
    expect(STATION_TOKEN_LIFETIME_MS).toBeGreaterThanOrEqual(15 * 60_000 + 60_000)
    expect(STATION_TOKEN_USES).toBeGreaterThan(1)
    expect(String(url)).not.toContain(OWN_KEY)
  })

  it("is refused when Google gives no token, and never passes something else on as one", async () => {
    const google = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    await expect(mintStationLiveToken(OWN_KEY, new Date(NOW), google({ error: { message: "API key not valid" } }, 400))).rejects.toThrow("400")
    for (const body of [{}, { name: "" }, { name: OWN_KEY }, { name: "auth_tokens/x y" }, { name: 7 }]) {
      await expect(mintStationLiveToken(OWN_KEY, new Date(NOW), google(body)), JSON.stringify(body)).rejects.toThrow("no token")
    }
  })
})

describe("the session answer of an organization with its own key", () => {
  it("carries the token, and the handler's answer is otherwise the handler's", async () => {
    const { live, dependencies } = tokens()
    const { response, body } = await answered(live, request(sessionOf()), answer(LINE_SESSION))
    expect(body).toEqual({ ...LINE_SESSION, liveToken: TOKEN })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(dependencies.mint).toHaveBeenCalledExactlyOnceWith(OWN_KEY)
    // The station's real bridge takes the same session it took without the token, on the token.
    expect(stationOpens(body)).toEqual({ opened: "session", liveToken: TOKEN, usage: { auth: "token" } })
    expect(stationOpens(LINE_SESSION)).toEqual({ opened: "session", liveToken: null, usage: null })
  })

  it("carries the token for a call that is not the line's: it runs the ordinary way, on the organization's key", async () => {
    const { live } = tokens()
    const { body } = await answered(live, request(sessionOf()), answer({ enabled: false }))
    expect(body).toEqual({ enabled: false, liveToken: TOKEN })
    expect(stationOpens(body)).toEqual({ opened: "ordinary", liveToken: TOKEN, usage: { auth: "token" } })
  })

  it("is asked for once per call: «ask again once it is answered» gets none, the answer after it gets the same one", async () => {
    const { live, dependencies } = tokens()
    const waiting = answer({ enabled: false, status: "awaiting_answered" })
    const first = await answered(live, request(sessionOf()), waiting)
    expect(first.response).toBe(waiting)
    expect(first.body).toEqual({ enabled: false, status: "awaiting_answered" })
    const second = await answered(live, request(sessionOf()), answer(LINE_SESSION))
    expect(second.body.liveToken).toBe(TOKEN)
    expect(dependencies.mint).toHaveBeenCalledTimes(1)
  })

  it("leaves the request for the handlers to read", async () => {
    const { live } = tokens()
    const req = request(sessionOf())
    const pending = live.begin(req)
    await expect(req.json()).resolves.toEqual(sessionOf())
    await expect(pending!.token).resolves.toBe(TOKEN)
    expect(pending!.session).toBe(true)
  })
})

describe("no token", () => {
  it("for an organization on the platform's key — the default: the answer is not touched and Google is not asked", async () => {
    const { live, dependencies } = tokens()
    const handlerAnswer = answer(LINE_SESSION)
    const { response } = await answered(live, request(sessionOf(OTHER_CALL)), handlerAnswer)
    expect(response).toBe(handlerAnswer)
    expect(dependencies.ownKey).toHaveBeenCalledWith("org-platform")
    expect(dependencies.mint).not.toHaveBeenCalled()
  })

  it("for a station that did not say it can use one: nothing of its request is read", async () => {
    const { live, dependencies } = tokens()
    // The core installed before this compares {"enabled": false} whole — a field more refuses the call.
    for (const caps of [PHONE_AGENT_CAPABILITY, "", "live-token-10"]) {
      const req = request(sessionOf(), { [STATION_CAPS_HEADER]: caps })
      expect(live.begin(req), caps).toBeNull()
      expect(req.bodyUsed).toBe(false)
    }
    const handlerAnswer = answer({ enabled: false })
    expect(await live.attach(handlerAnswer, null)).toBe(handlerAnswer)
    expect(dependencies.organizationOf).not.toHaveBeenCalled()
  })

  it("for a request that is not the station's, whatever it names", async () => {
    const { live, dependencies } = tokens()
    expect(live.begin(request(sessionOf(), { authorization: "Bearer " + "x".repeat(RUNTIME.length) }))).toBeNull()
    expect(live.begin(request(sessionOf(), { authorization: "" }))).toBeNull()
    expect(live.begin(request(sessionOf(), { "content-type": "text/plain" }))).toBeNull()
    expect(createStationLiveTokens("", dependencies).begin(request(sessionOf(), { authorization: "Bearer " }))).toBeNull()
    expect(dependencies.organizationOf).not.toHaveBeenCalled()
  })

  it("for anything but a session of a call the CRM knows", async () => {
    const { live, dependencies } = tokens()
    for (const body of [{ action: "tool", callId: CALL_ID, name: "x" }, { action: "search", callId: CALL_ID },
      { action: "session", callId: "not-a-call-id" }, { action: "session" }, [sessionOf()], "session"]) {
      const pending = live.begin(request(body))!
      await expect(pending.token, JSON.stringify(body)).resolves.toBeNull()
      expect(pending.session, JSON.stringify(body)).toBe(false)
      // Once known not to be a session, the handler's answer is passed on unread.
      const handlerAnswer = answer({ enabled: true, candidates: [] })
      expect(await live.attach(handlerAnswer, pending)).toBe(handlerAnswer)
      expect(handlerAnswer.bodyUsed).toBe(false)
    }
    await expect(live.begin(request(sessionOf("bbbbbbbb-2222-4222-8222-222222222222")))!.token).resolves.toBeNull()
    expect(dependencies.mint).not.toHaveBeenCalled()
  })

  it("for a request too large to be a session — a phrase's audio, a long order: it is not copied or read", async () => {
    const { live, dependencies } = tokens()
    const audio = request({ action: "utterance", callId: CALL_ID, pcm: "A".repeat(4_000) })
    expect(live.begin(audio)).toBeNull()
    expect(audio.bodyUsed).toBe(false)
    // No stated length is not a session's request either.
    const unstated = request(sessionOf())
    unstated.headers.delete("content-length")
    expect(live.begin(unstated)).toBeNull()
    expect(dependencies.organizationOf).not.toHaveBeenCalled()
  })

  it("in an answer that is not a session's final one", async () => {
    const { live } = tokens()
    for (const [body, status] of [[{ enabled: false, status: "pilot_not_authorized", candidates: [] }, 403],
      [{ enabled: false, error: "pilot_unavailable" }, 503], [{ enabled: false, error: "pilot_unavailable" }, 200],
      [{ candidates: [] }, 200], [{ result: { status: "booked" } }, 200], [[LINE_SESSION], 200]] as const) {
      const handlerAnswer = answer(body, status)
      const { response } = await answered(live, request(sessionOf()), handlerAnswer)
      expect(response, JSON.stringify(body)).toBe(handlerAnswer)
    }
    const text = new Response("not json", { status: 200 })
    expect(await live.attach(text, live.begin(request(sessionOf())))).toBe(text)
  })

  it("when Google refuses the organization's key or is slow: the call runs on the platform's key, and it is logged", async () => {
    const { live } = tokens({ mint: vi.fn(async () => { throw new Error("station Live token mint failed (400)") }) })
    const handlerAnswer = answer(LINE_SESSION)
    const { response } = await answered(live, request(sessionOf()), handlerAnswer)
    expect(response).toBe(handlerAnswer)
    expect(gateway.failures).toHaveBeenCalledWith("voice-station-live-token", "warn")
  })
})

describe("whose key an organization's calls run on", () => {
  it("its own when it entered one, the platform's when it did not or cannot be read", async () => {
    const mint = vi.fn(async () => TOKEN)
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: TOKEN }), { status: 200 }))
    gateway.callOrganization.mockResolvedValue("org-1")
    const live = () => createStationLiveTokens(RUNTIME)
    // Its own key: the token is minted with it.
    gateway.resolveAiKey.mockResolvedValueOnce({ apiKey: OWN_KEY, keySource: "tenant" })
    await expect(live().begin(request(sessionOf()))!.token).resolves.toBe(TOKEN)
    expect(gateway.resolveAiKey).toHaveBeenCalledWith("org-1", "gemini")
    expect(new Headers(fetched.mock.calls[0][1]!.headers).get("x-goog-api-key")).toBe(OWN_KEY)
    // The platform's key is the station's already: no token is minted with it.
    fetched.mockClear()
    gateway.resolveAiKey.mockResolvedValueOnce({ apiKey: "platform-key", keySource: "platform" })
    await expect(live().begin(request(sessionOf()))!.token).resolves.toBeNull()
    // No key at all for this organization: the same.
    gateway.resolveAiKey.mockRejectedValueOnce(new gateway.unavailable("not_connected"))
    await expect(live().begin(request(sessionOf()))!.token).resolves.toBeNull()
    expect(fetched).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
    fetched.mockRestore()
  })
})

describe("the station and the CRM name the same things", () => {
  it("the capability, the header, and what a token looks like", () => {
    expect(STATION_CAPS).toBe(`${PHONE_AGENT_CAPABILITY}, ${STATION_LIVE_TOKEN_CAPABILITY}`)
    expect(STATION_CAPS_HEADER).toBe(PHONE_AGENT_CAPS_HEADER)
    expect(BRIDGE).toContain('"X-Voice-Agent-Caps": ZEYTUN_STATION_CAPS')
    // One shape on both sides: what the CRM passes on, the station puts into the Live address.
    const stationPattern = BRIDGE.match(/LIVE_TOKEN = re\.compile\(r"([^"]+)"\)/)![1]
    expect(stationPattern).toBe(STATION_TOKEN_PATTERN.source.replace(/\\\//g, "/"))
  })

  it("a token the CRM would not pass on is not one for the station either", () => {
    for (const bad of [OWN_KEY, "auth_tokens/short", "auth_tokens/with space", "auth_tokens/x?key=y", "https://x/auth_tokens/abcdefgh"]) {
      expect(STATION_TOKEN_PATTERN.test(bad), bad).toBe(false)
      expect(stationOpens({ ...LINE_SESSION, liveToken: bad }), bad).toEqual({ opened: "session", liveToken: null, usage: null })
    }
  })
})
