import { createVerify, generateKeyPairSync } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CHIRP_KEY_FILE, CHIRP_PHRASE_LIMIT, CHIRP_TIMEOUT_MS, createChirpRecognizer, TOKEN_REFRESH_AHEAD_MS, createZeytunSecondEar, heardProducts, pairHeard,
  UTTERANCE_WAIT_MS, type ChirpHeard, type ChirpRecognizer,
} from "@/lib/voice-agent/pharmacy/zeytun-chirp"
import { createInboundPilotHandler, type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { createInboundPilotHost } from "@/lib/voice-agent/pharmacy/zeytun-inbound-host"
import { learnNames } from "@/lib/voice-agent/pharmacy/zeytun-learned-names"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const account = {
  type: "service_account", project_id: "zeytun-line-test", private_key_id: "k1", client_id: "1",
  client_email: "zeytun-line-speech@zeytun-line-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
}
const pcm = Buffer.alloc(8000 * 2, 1)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"))

describe("Chirp client", () => {
  afterEach(() => vi.restoreAllMocks())

  it("signs an RS256 JWT, keeps the access token until it ends and asks chirp_3 in az-AZ with at most 1000 hints", async () => {
    let now = Date.parse("2026-11-04T10:00:00Z")
    let tokens = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token") return json({ access_token: `tok-${++tokens}`, expires_in: 3600 })
      return json({ results: [{ alternatives: [{ transcript: "Adefa beş qutu" }] }, { alternatives: [{ transcript: " Ketonal" }] }] })
    })
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch: fetch as typeof globalThis.fetch, clock: () => now, readKey: async () => account })
    const hints = Array.from({ length: 1200 }, (_, index) => `Name${index}`)

    expect(await recognizer.recognize(pcm, hints)).toMatchObject({ text: "Adefa beş qutu Ketonal" })
    const [tokenUrl, tokenInit] = fetch.mock.calls[0]
    expect(String(tokenUrl)).toBe("https://oauth2.googleapis.com/token")
    const form = new URLSearchParams(String(tokenInit!.body))
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer")
    const [header, claims, signature] = form.get("assertion")!.split(".")
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" })
    expect(decode(claims)).toEqual({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token", iat: now / 1000, exp: now / 1000 + 3600 })
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url")).toBe(true)
    // The private key itself never leaves: only the signed assertion.
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("PRIVATE KEY")

    const [speechUrl, speechInit] = fetch.mock.calls[1]
    expect(String(speechUrl)).toBe("https://eu-speech.googleapis.com/v2/projects/zeytun-line-test/locations/eu/recognizers/_:recognize")
    expect((speechInit!.headers as Record<string, string>).Authorization).toBe("Bearer tok-1")
    const body = JSON.parse(String(speechInit!.body))
    expect(body.config).toMatchObject({ model: "chirp_3", languageCodes: ["az-AZ"], autoDecodingConfig: {} })
    expect(body.config.adaptation.phraseSets[0].inlinePhraseSet.phrases).toHaveLength(CHIRP_PHRASE_LIMIT)
    const wav = Buffer.from(body.content, "base64")
    expect(wav.subarray(0, 4).toString()).toBe("RIFF")
    expect(wav.readUInt32LE(24)).toBe(8000)
    expect(wav.length).toBe(44 + pcm.length)

    await recognizer.recognize(pcm, [])
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(1)
    // A minute before the hour ends the token is fetched again.
    now += 3540_000
    await recognizer.recognize(pcm, [])
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(2)
  })

  it("gives up after its timeout and reports it without the key or the text", async () => {
    expect(CHIRP_TIMEOUT_MS).toBe(2500)
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => String(url).includes("oauth2")
      ? Promise.resolve(json({ access_token: "tok", expires_in: 3600 }))
      : new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))))
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch: fetch as typeof globalThis.fetch, readKey: async () => account, timeoutMs: 30 })
    expect(await recognizer.recognize(pcm, [])).toMatchObject({ error: "timeout" })
  })

  it("fetches the token on warm and renews it in the background five minutes before its end, so no phrase waits for one", async () => {
    let now = Date.parse("2026-11-04T10:00:00Z")
    let tokens = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => String(url).includes("oauth2")
      ? json({ access_token: `tok-${++tokens}`, expires_in: 3600 })
      : json({ results: [{ alternatives: [{ transcript: "Adefa" }] }] }))
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch, clock: () => now, readKey: async () => account })
    const oauth = () => fetch.mock.calls.filter(([url]) => String(url).includes("oauth2")).length
    // The bearer of the last recognition.
    const bearer = () => (fetch.mock.calls.filter(([url]) => !String(url).includes("oauth2")).at(-1)![1]!.headers as Record<string, string>).Authorization

    recognizer.warm()
    await vi.waitFor(() => expect(oauth()).toBe(1))
    expect(await recognizer.recognize(pcm, [])).toMatchObject({ text: "Adefa" })
    expect(oauth()).toBe(1)
    // Another call's session while the token lasts long enough: nothing fetched.
    now += 30 * 60_000
    recognizer.warm()
    await recognizer.recognize(pcm, [])
    expect(oauth()).toBe(1)
    // Four minutes left: the phrase goes with the token it has, a new one comes behind it.
    now += 3600_000 - 30 * 60_000 - 4 * 60_000
    expect(TOKEN_REFRESH_AHEAD_MS).toBe(5 * 60_000)
    await recognizer.recognize(pcm, [])
    expect(bearer()).toBe("Bearer tok-1")
    await vi.waitFor(() => expect(oauth()).toBe(2))
    await recognizer.recognize(pcm, [])
    expect(bearer()).toBe("Bearer tok-2")
    expect(oauth()).toBe(2)
  })

  it("does not abort a slow token fetch with the phrase that gave up on it: the next phrase has the token", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    let release: (() => void) | null = null
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (!String(url).includes("oauth2")) return json({ results: [{ alternatives: [{ transcript: "Adefa" }] }] })
      await new Promise<void>((resolve, reject) => {
        release = resolve
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))
      })
      return json({ access_token: "tok", expires_in: 3600 })
    })
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch, readKey: async () => account, timeoutMs: 30 })
    expect(await recognizer.recognize(pcm, [])).toMatchObject({ error: "token_timeout" })
    release!()
    await vi.waitFor(async () => expect(await recognizer.recognize(pcm, [])).toMatchObject({ text: "Adefa" }))
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("is off without its key file, and reads nothing else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zeytun-chirp-"))
    try {
      const fetch = vi.fn()
      const recognizer = createChirpRecognizer({ keyFile: join(dir, CHIRP_KEY_FILE), fetch: fetch as typeof globalThis.fetch })
      expect(await recognizer.enabled()).toBe(false)
      expect(await recognizer.recognize(pcm, ["Adefa"])).toMatchObject({ error: "no_key" })
      expect(fetch).not.toHaveBeenCalled()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("refuses a key that is not a service account's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch: vi.fn() as never, readKey: async () => ({ token: "ya29.x" }) })
    expect(await recognizer.enabled()).toBe(false)
  })
})

describe("a phrase split into its products", () => {
  it("splits at commas, joining words and after a unit, and drops answers and the pharmacy", () => {
    expect(heardProducts("Adefa beş qutu Ketonal on qutu").map(product => product.text)).toEqual(["Adefa beş qutu", "Ketonal on qutu"])
    expect(heardProducts("Noşpa, Mezim forte və Adefa").map(product => product.words)).toEqual(["Noşpa", "Mezim forte", "Adefa"])
    expect(heardProducts("bəli")).toEqual([])
    expect(heardProducts("on qutu")).toEqual([])
    expect(heardProducts("Zəfər aptekindən zəng edirəm")).toEqual([])
    // Chirp's "kutu" is the caller's "qutu" (voice stand 2026-11-04): a unit, never a product.
    expect(heardProducts("5 kutu")).toEqual([])
    expect(heardProducts("Adefo 3 kutu").map(product => [product.text, product.words])).toEqual([["Adefo 3 qutu", "Adefo"]])
  })

  it("pairs a lookup with the product that sounds like it; a single fresh product whatever the model heard", () => {
    const products = heardProducts("Adefa beş qutu, Ketonal on qutu")
    expect(pairHeard("Adexa", products, { fresh: true })?.words).toBe("Adefa")
    expect(pairHeard("Ketanol", products, { fresh: true })?.words).toBe("Ketonal")
    expect(pairHeard("Parasetamol", products, { fresh: true })).toBeNull()
    expect(pairHeard("Deva", heardProducts("Adefa"), { fresh: true })?.words).toBe("Adefa")
    // An older phrase is used only for a product that sounds like it.
    expect(pairHeard("Parasetamol", heardProducts("Adefa"), { fresh: false })).toBeNull()
    // The voice stand's step 8: the only phrase in memory was "5 kutu" (an answer with no lookup);
    // as a product it was paired with "Floimitil 600" and searched as "5 kutu" — Koraksan, folic acid.
    expect(pairHeard("Floimitil 600", heardProducts("5 kutu"), { fresh: true })).toBeNull()
  })
})

describe("the call's memory", () => {
  function deferred() {
    let resolve!: (heard: ChirpHeard) => void
    return { promise: new Promise<ChirpHeard>(done => { resolve = done }), resolve }
  }
  function ear(recognize: ChirpRecognizer["recognize"]) {
    const state = { now: 1_000_000 }
    const sleep = vi.fn(async (ms: number) => { state.now += ms })
    const recognizer: ChirpRecognizer = { enabled: async () => true, warm: () => undefined, recognize }
    return { state, sleep, ear: createZeytunSecondEar({ recognizer, clock: () => state.now, sleep }) }
  }

  it("waits for a phrase's text up to 0.8 s after the phrase arrived, and not when it is older", async () => {
    const pending = deferred()
    const f = ear(() => pending.promise)
    f.ear.hear("c1", 1, pcm, [])
    f.state.now += 300
    f.sleep.mockImplementationOnce(async (ms: number) => { f.state.now += 200; pending.resolve({ text: "Adefa", ms: 500 }); await Promise.resolve(); void ms })
    const heard = await f.ear.heardFor("c1")
    expect(f.sleep).toHaveBeenCalledWith(UTTERANCE_WAIT_MS - 300)
    expect(heard?.products.map(product => product.words)).toEqual(["Adefa"])

    const late = ear(() => new Promise(() => undefined))
    late.ear.hear("c2", 1, pcm, [])
    late.state.now += 1000
    expect(await late.ear.heardFor("c2")).toMatchObject({ products: [], fresh: true })
    expect(late.sleep).not.toHaveBeenCalled()
  })

  it("gives a lookup only phrases after the call's previous lookup, and the same phrase to another product of it", async () => {
    const texts = ["Adefa və Ketonal", "bəli"]
    const f = ear(async () => ({ text: texts.shift()!, ms: 1 }))
    f.ear.hear("c1", 1, pcm, [])
    await settle()
    f.state.now += 900
    expect((await f.ear.heardFor("c1"))?.fresh).toBe(true)
    f.state.now += 100
    // The model's second lookup of the same phrase: no new phrase, the same products.
    expect(await f.ear.heardFor("c1")).toMatchObject({ fresh: false })
    expect((await f.ear.heardFor("c1"))?.products.map(product => product.words)).toEqual(["Adefa", "Ketonal"])
    f.ear.hear("c1", 2, pcm, [])
    await settle()
    f.state.now += 900
    expect(await f.ear.heardFor("c1")).toMatchObject({ fresh: true, products: [] })
    expect(await f.ear.heardFor("other")).toBeNull()
  })
})

// ---- The line's route with the second ear ----

const now = Date.parse("2026-11-04T12:00:00Z"), token = "t".repeat(48)
const callId = "bbbbbbbb-1111-4111-8111-111111111111"
const line = {
  version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
  organizationId: "tenant-test", channelConfigId: "line-test",
  issuedAt: new Date(now - 60_000).toISOString(), approvalReference: "owner",
  approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64) }, orderOrganizationId: "org-zeytun",
}
const call = {
  id: "call-test", organizationId: line.organizationId, channelConfigId: line.channelConfigId, providerCallId: callId,
  provider: "asterisk", direction: "inbound", callMode: "ai", status: "in-progress", wasAnswered: true, endedAt: null,
  startedAt: new Date(now).toISOString(), fromNumber: "+994552223344", targetPhoneE164: "+994552223344",
}
const item = (n: number, name: string) => ({ externalId: `cccccccc-${String(n).padStart(4, "0")}-4111-8111-111111111111`, itemCode: `I${n}`, name, nameAz: null })
const ITEMS = [item(1, "Deva 10 mq"), item(2, "Devamin"), item(3, "Adefa № 30"), item(4, "Adefa forte"), item(5, "Adelfan"),
  item(6, "Ketonal 100 mq"), item(7, "Ketonal krem")]

function routeFixture(options: { recognize?: ChirpRecognizer["recognize"]; recognizer?: ChirpRecognizer; secondEar?: boolean } = {}) {
  const state = { now }
  const catalog: InboundPilotCatalog = {
    organizationId: line.approvedSource.organizationId, scopeKey: line.approvedSource.scopeKey, version: "e".repeat(64),
    observedAt: new Date(now).toISOString(), source: "live",
    search: vi.fn((query: { text?: string; externalId?: string }) => {
      if (query.externalId) return { status: "candidates_only", candidateCount: 1, candidates: ITEMS.filter(found => found.externalId === query.externalId) }
      const text = (query.text ?? "").toLowerCase()
      const rows = text.startsWith("dev") ? [ITEMS[0], ITEMS[1]] : text.startsWith("adefa") ? [ITEMS[2], ITEMS[3], ITEMS[4], ITEMS[0]]
        : text.startsWith("adexa") ? [ITEMS[4]] : /^ket/.test(text) ? [ITEMS[5], ITEMS[6]] : []
      return { status: rows.length ? "candidates_only" : "not_found_in_snapshot", candidateCount: rows.length, candidates: rows }
    }),
  }
  const recognize = vi.fn(options.recognize ?? (async () => ({ text: "Adefa beş qutu", ms: 600 })))
  const sleep = vi.fn(async (ms: number) => { state.now += ms })
  const secondEar = createZeytunSecondEar({ recognizer: options.recognizer ?? { enabled: async () => true, warm: vi.fn(), recognize },
    clock: () => state.now, sleep })
  const dependencies = {
    loadConfig: vi.fn(async (): Promise<unknown> => structuredClone(line)),
    loadCall: vi.fn(async (): Promise<unknown> => structuredClone(call)),
    loadCatalog: vi.fn(async () => catalog), claim: vi.fn(async () => true), isClaimed: vi.fn(async () => true),
    learnedNames: () => learnNames([], [ITEMS[2].externalId, ITEMS[5].externalId]),
    clock: () => state.now,
    ...(options.secondEar === false ? {} : { secondEar }),
  }
  const handle = createInboundPilotHandler(token, dependencies)
  const send = (body: unknown) => handle(new Request("https://crm.example.test/internal", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { state, catalog, recognize, sleep, dependencies, send }
}
const utterance = (seq: number, audio = pcm.toString("base64")) => ({ action: "utterance", callId, seq, audio })
const lookup = (text: string) => ({ action: "search", callId, query: { text } })
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe("the line takes the pharmacy's phrases and searches what Chirp heard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("tells the station to send phrases only when the key is in place, and says nothing otherwise", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const session = { action: "session", callId }
    const on = routeFixture()
    const body = await (await on.send(session)).json()
    expect(body).toMatchObject({ enabled: true, utterance: true })
    const off = routeFixture()
    off.dependencies.secondEar = { ...off.dependencies.secondEar!, enabled: async () => false }
    expect(await (await off.send(session)).json()).not.toHaveProperty("utterance")
    const none = routeFixture({ secondEar: false })
    const without = await (await none.send(session)).json()
    expect(without.enabled).toBe(true)
    expect(without).not.toHaveProperty("utterance")
    // The station's session reader takes known keys with .get: an extra one is not a refusal.
    const bridge = readFileSync(join(process.cwd(), "scripts/pbx/fanum-zeytun-inbound.py"), "utf8")
    const open = bridge.slice(bridge.indexOf("    def open(self):"), bridge.indexOf("    def tools(self):"))
    expect(open).not.toMatch(/set\(value\)|value\.keys\(\)|len\(value\)/)
  })

  it("asks for the token on the call's session, and the first phrase is recognized without asking again", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => String(url).includes("oauth2")
      ? json({ access_token: "tok-1", expires_in: 3600 })
      : json({ results: [{ alternatives: [{ transcript: "Zəfər aptekindən" }] }] }))
    const recognizer = createChirpRecognizer({ keyFile: "/k", fetch, readKey: async () => account })
    const f = routeFixture({ recognizer })
    const oauth = () => fetch.mock.calls.filter(([url]) => String(url).includes("oauth2")).length

    expect(await (await f.send({ action: "session", callId })).json()).toMatchObject({ utterance: true })
    await vi.waitFor(() => expect(oauth()).toBe(1))
    expect((await f.send(utterance(1))).status).toBe(202)
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("speech.googleapis.com"))).toBe(true))
    expect(oauth()).toBe(1)
  })

  it("answers 202 at once, before Chirp, with the order hints", async () => {
    const f = routeFixture({ recognize: () => new Promise(() => undefined) })
    const response = await f.send(utterance(1))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: "accepted" })
    expect(f.recognize).toHaveBeenCalledOnce()
    const [audio, hints] = f.recognize.mock.calls[0]
    expect(Buffer.compare(audio as Buffer, pcm)).toBe(0)
    expect(hints).toEqual(["Adefa", "Ketonal"])
  })

  it("adds up to two Chirp candidates the model lacks, after the model's own, marked alsoHeard", async () => {
    const f = routeFixture()
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    await f.send(utterance(1)); await settle()
    f.state.now += 1000
    const body = await (await f.send(lookup("Deva"))).json()
    expect(body.candidates.map((found: { name: string }) => found.name)).toEqual(["Deva 10 mq", "Devamin", "Adefa № 30", "Adefa forte"])
    expect(body.candidates.slice(0, 2).every((found: object) => !("alsoHeard" in found))).toBe(true)
    expect(body.candidates.slice(2).map((found: { alsoHeard: string }) => found.alsoHeard)).toEqual(["Adefa", "Adefa"])
    expect(body.candidateCount).toBe(2)
    expect(body.needsNarrowing).toBe(true)
    const chirpLog = log.mock.calls.find(([tag]) => tag === "[zeytun-line] chirp")
    expect(JSON.parse(chirpLog![1] as string)).toEqual({ call: callId, ms: 0, used: 2 })
    // Never what the pharmacy said.
    expect(chirpLog![1]).not.toMatch(/Adefa/)
    // The next lookup with no new phrase does not add Adefa to an unrelated product.
    const next = await (await f.send(lookup("Ketanol"))).json()
    expect(next.candidates.some((found: object) => "alsoHeard" in found)).toBe(false)
  })

  it("gives a candidate when the model's words found nothing but Chirp's did", async () => {
    const f = routeFixture()
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    await f.send(utterance(1)); await settle()
    f.state.now += 1000
    const body = await (await f.send(lookup("Ədəfə"))).json()
    expect(body.status).toBe("candidates_only")
    expect(body.candidates.map((found: { name: string }) => found.name)).toEqual(["Adefa № 30", "Adefa forte"])
  })

  it("searches each product of a phrase for the model's lookup of it", async () => {
    const f = routeFixture({ recognize: async () => ({ text: "Adefa beş qutu, Ketonal on qutu", ms: 600 }) })
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    await f.send(utterance(1)); await settle()
    f.state.now += 1000
    const first = await (await f.send(lookup("Adexa"))).json()
    expect(first.candidates.map((found: { name: string; alsoHeard?: string }) => [found.name, found.alsoHeard ?? null]))
      .toEqual([["Adelfan", null], ["Adefa № 30", "Adefa"], ["Adefa forte", "Adefa"]])
    f.state.now += 200
    const second = await (await f.send(lookup("Ketanol"))).json()
    // The model already has both Ketonal items: nothing to add, and never Adefa.
    expect(second.candidates.map((found: { name: string }) => found.name)).toEqual(["Ketonal 100 mq", "Ketonal krem"])
  })

  it("waits up to 0.8 s for a phrase that has just arrived", async () => {
    let finish!: (heard: ChirpHeard) => void
    const f = routeFixture({ recognize: () => new Promise(done => { finish = done }) })
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    await f.send(utterance(1))
    f.state.now += 300
    f.sleep.mockImplementationOnce(async (ms: number) => { f.state.now += ms; finish({ text: "Adefa", ms: 700 }); await settle() })
    const body = await (await f.send(lookup("Deva"))).json()
    expect(f.sleep).toHaveBeenCalledWith(500)
    expect(body.candidates.filter((found: object) => "alsoHeard" in found)).toHaveLength(2)
  })

  it("searches as before when Chirp did not answer in time", async () => {
    const f = routeFixture({ recognize: async () => ({ error: "timeout", ms: 2500 }) })
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const without = routeFixture({ secondEar: false })
    await f.send(utterance(1)); await settle()
    f.state.now += 1000
    const body = await (await f.send(lookup("Deva"))).json()
    expect(body).toEqual(await (await without.send(lookup("Deva"))).json())
  })

  it("takes no phrase of a call this line did not claim, nor on the owner's rehearsal", async () => {
    const f = routeFixture()
    f.dependencies.isClaimed.mockResolvedValue(false)
    expect((await f.send(utterance(1))).status).toBe(403)
    f.dependencies.isClaimed.mockResolvedValue(true)
    f.dependencies.loadCall.mockResolvedValue({ ...structuredClone(call), organizationId: "someone-else" })
    expect((await f.send(utterance(1))).status).toBe(403)
    expect(f.recognize).not.toHaveBeenCalled()
  })

  it("is off without the key: the phrase is answered and the lookup is the model's alone", async () => {
    const host = createInboundPilotHost({ configFile: "/nonexistent/grant.json", snapshotDirectory: "/nonexistent", runtimeOrganizationId: "x",
      database: {} as never })
    expect(await host.secondEar?.enabled()).toBe(false)
    const f = routeFixture()
    f.dependencies.secondEar = { ...f.dependencies.secondEar!, enabled: async () => false }
    const response = await f.send(utterance(1))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: "off" })
    expect(f.recognize).not.toHaveBeenCalled()
  })

  it("keeps the phrase strict: at most 15 s of PCM16, whole samples, base64; other actions stay small", async () => {
    const f = routeFixture()
    expect((await f.send(utterance(1, Buffer.alloc(15 * 16000 + 2).toString("base64")))).status).toBe(400)
    expect((await f.send(utterance(1, Buffer.alloc(1601).toString("base64")))).status).toBe(400)
    expect((await f.send(utterance(1, "not base64!"))).status).toBe(400)
    expect((await f.send({ ...utterance(1), extra: true })).status).toBe(400)
    expect((await f.send(utterance(1, Buffer.alloc(15 * 16000).toString("base64")))).status).toBe(202)
    expect((await f.send({ action: "search", callId, query: { text: "x".repeat(20_000) } })).status).toBe(413)
  })
})
