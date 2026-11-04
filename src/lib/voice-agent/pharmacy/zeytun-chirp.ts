import { createSign } from "node:crypto"
import { z } from "zod"
import { readPrivate } from "./zeytun-private-file"
import { spokenNameKey, spokenWordsApart } from "./name-search"

/**
 * The line's second ear (docs/zeytun-line-recognition-plan.md, tasks 6 and 8;
 * owner 2026-11-04: «Да, встраивай»). The Live model hears product names
 * wrong often enough; Google Chirp 3 (az-AZ, the products this organization
 * orders as hints) next to the model's own lookup found 84 % of the names
 * instead of 71 %, 0.6 s after the phrase.
 *
 * The station posts each phrase of the pharmacy's audio after it ends
 * (`utterance`); this process asks Chirp in the background and keeps the text
 * in memory for the call. A lookup of the model then also searches what Chirp
 * heard, and the candidates the model did not get come back as `alsoHeard`.
 *
 * No key file — the ear is off and the line searches exactly as before. The
 * key is a service account's JSON (role Cloud Speech Client): Speech-to-Text v2
 * takes no API key (tried 2026-11-04). It never leaves this module: only the
 * signed assertion and the hour's access token go to Google.
 */

export const CHIRP_KEY_FILE = "zeytun-speech-key.json"
/** chirp_3 takes at most this many inline phrases a request (2026-11-04). */
export const CHIRP_PHRASE_LIMIT = 1000
/** A phrase's whole budget — recognition, and the token if none is ready: a phrase not heard by then is not waited for. */
export const CHIRP_TIMEOUT_MS = 2500
/** The token is fetched again in the background this long before it ends, and on a line call's session. Live call 0127e38f
 * (2026-11-04): the first phrase fetched it inside its own 2.5 s and timed out — the answer to "which pharmacy" went unheard. */
export const TOKEN_REFRESH_AHEAD_MS = 5 * 60_000
/** A token fetch runs on its own clock, not a phrase's: a phrase that stops waiting does not abort it. */
const TOKEN_FETCH_TIMEOUT_MS = 10_000
/** Phone audio from the station: PCM16, 8 kHz, mono; at most 15 s a phrase. */
export const UTTERANCE_SAMPLE_RATE = 8000
export const UTTERANCE_MAX_BYTES = 15 * UTTERANCE_SAMPLE_RATE * 2
export const UTTERANCE_MIN_BYTES = UTTERANCE_SAMPLE_RATE * 2 / 10
/** A lookup waits for a phrase's text at most this long after the phrase arrived. */
export const UTTERANCE_WAIT_MS = 800
/** What a call keeps: its last four phrases, for fifteen minutes. */
const KEPT_PER_CALL = 4, KEPT_FOR_MS = 15 * 60_000, KEPT_CALLS = 200
/** A lookup with no new phrase reuses the phrase before it (another product of it) this long. */
const BATCH_REUSE_MS = 30_000
/** Recognitions in flight for the whole process; a phrase over it is not heard. */
const MAX_IN_FLIGHT = 8
/** The key file is looked at again after this long: put in place or removed, it takes effect without a restart. */
const KEY_RECHECK_MS = 60_000
const REGION = "eu"

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
  client_email: z.string().email().max(320),
  private_key: z.string().startsWith("-----BEGIN PRIVATE KEY-----").max(8192),
})
type ServiceAccount = z.infer<typeof serviceAccountSchema>

export type ChirpHeard = { text: string; ms: number } | { error: string; ms: number }

export interface ChirpRecognizer {
  /** Whether a usable key file is in place (looked at once a minute). */
  enabled(): Promise<boolean>
  /** Fetches the access token ahead of a call's first phrase unless it lasts five minutes more; never throws. */
  warm(): void
  recognize(pcm: Buffer, phrases: string[]): Promise<ChirpHeard>
}

/** Waits for `promise` until `signal` aborts; the work behind it goes on. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

/** A WAV header on raw PCM16: chirp_3 decodes it itself, as in the benchmark (autoDecodingConfig). */
export function wavFromPcm16(pcm: Buffer, sampleRate = UTTERANCE_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write("data", 36, "ascii"); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export function createChirpRecognizer(options: {
  keyFile: string
  fetch?: typeof fetch
  clock?: () => number
  /** Reads the key file; readPrivate (owner-only file in an owner-only directory) by default. */
  readKey?: (path: string) => Promise<unknown>
  /** CHIRP_TIMEOUT_MS unless a test needs it shorter. */
  timeoutMs?: number
}): ChirpRecognizer {
  const timeoutMs = options.timeoutMs ?? CHIRP_TIMEOUT_MS
  const request = options.fetch ?? fetch
  const clock = options.clock ?? Date.now
  const readKey = options.readKey ?? ((path: string) => readPrivate(path, 16_384))
  let key: { at: number; account: Promise<ServiceAccount | null> } | null = null
  let token: { account: ServiceAccount; value: string; expiresAt: number } | null = null
  let pendingToken: Promise<string> | null = null

  function account(): Promise<ServiceAccount | null> {
    if (!key || clock() - key.at >= KEY_RECHECK_MS) {
      key = { at: clock(), account: readKey(options.keyFile).then((raw) => {
        const parsed = serviceAccountSchema.safeParse(raw)
        // Only that it is unusable: the file holds the private key.
        if (!parsed.success) console.warn("[zeytun-line] chirp key unusable")
        return parsed.success ? parsed.data : null
      }, (error: NodeJS.ErrnoException) => {
        if (error?.code !== "ENOENT") console.warn("[zeytun-line] chirp key unreadable", error?.code ?? error?.message ?? "error")
        return null
      }) }
    }
    return key.account
  }

  async function fetchToken(service: ServiceAccount, signal: AbortSignal): Promise<string> {
    const now = Math.floor(clock() / 1000)
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: service.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`
    const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(service.private_key, "base64url")}`
    const response = await request("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal,
    })
    const json = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null
    if (!response.ok || typeof json?.access_token !== "string") throw new Error(`token_http_${response.status}`)
    const lifetime = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600
    token = { account: service, value: json.access_token, expiresAt: clock() + lifetime * 1000 }
    return token.value
  }

  // The same key read again a minute later is a new object: compared by what it says, or every minute's phrase fetched a token.
  const sameKey = (left: ServiceAccount, right: ServiceAccount) => left === right
    || (left.client_email === right.client_email && left.private_key === right.private_key && left.project_id === right.project_id)
  const lasts = (service: ServiceAccount, forMs: number) => token !== null && sameKey(token.account, service) && clock() < token.expiresAt - forMs

  /** One fetch at a time; its failure is logged once, without the key. */
  function refreshToken(service: ServiceAccount): Promise<string> {
    if (pendingToken) return pendingToken
    const started = clock()
    const fetching = fetchToken(service, AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS))
    pendingToken = fetching.finally(() => { pendingToken = null })
    fetching.catch((error: Error) => console.warn("[zeytun-line] chirp token failed", JSON.stringify({ ms: Math.max(0, clock() - started),
      error: /^token_http_\d+$/.test(error?.message ?? "") ? error.message : error?.name === "TimeoutError" ? "timeout" : "network" })))
    return pendingToken
  }

  /** The cached token while it lasts a minute more, renewed in the background from five minutes before its end. */
  function accessToken(service: ServiceAccount, signal: AbortSignal): Promise<string> {
    if (lasts(service, 60_000)) {
      if (!lasts(service, TOKEN_REFRESH_AHEAD_MS)) refreshToken(service).catch(() => undefined)
      return Promise.resolve(token!.value)
    }
    return untilAborted(refreshToken(service), signal)
  }

  return {
    enabled: async () => (await account()) !== null,
    warm() {
      void account().then((service) => service && !lasts(service, TOKEN_REFRESH_AHEAD_MS) ? refreshToken(service) : undefined)
        .catch(() => undefined)
    },
    async recognize(pcm, phrases) {
      const started = clock()
      const ms = () => Math.max(0, clock() - started)
      const service = await account()
      if (!service) return { error: "no_key", ms: ms() }
      const signal = AbortSignal.timeout(timeoutMs)
      let stage: "token" | "speech" = "token"
      try {
        const bearer = await accessToken(service, signal)
        stage = "speech"
        const hints = phrases.slice(0, CHIRP_PHRASE_LIMIT)
        const body = {
          config: { model: "chirp_3", languageCodes: ["az-AZ"], autoDecodingConfig: {},
            ...(hints.length ? { adaptation: { phraseSets: [{ inlinePhraseSet: { phrases: hints.map((value) => ({ value })) } }] } } : {}) },
          content: wavFromPcm16(pcm).toString("base64"),
        }
        const url = `https://${REGION}-speech.googleapis.com/v2/projects/${encodeURIComponent(service.project_id)}/locations/${REGION}/recognizers/_:recognize`
        const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify(body), signal })
        const json = await response.json().catch(() => null) as { results?: { alternatives?: { transcript?: unknown }[] }[] } | null
        // A refused token is dropped: the next phrase asks for a new one.
        if (response.status === 401) token = null
        if (!response.ok) return { error: `http_${response.status}`, ms: ms() }
        const text = (json?.results ?? []).map((result) => result.alternatives?.[0]?.transcript)
          .filter((part): part is string => typeof part === "string").join(" ").replace(/\s+/gu, " ").trim()
        return { text: text.slice(0, 600), ms: ms() }
      } catch (error) {
        const name = (error as Error)?.name
        // "token_timeout": the phrase's time ran out before a token was there; "timeout": in recognition itself.
        return { error: name === "TimeoutError" || name === "AbortError" ? (stage === "token" ? "token_timeout" : "timeout")
          : /^token_http_\d+$/.test((error as Error)?.message ?? "") ? (error as Error).message : "network", ms: ms() }
      }
    },
  }
}

// ---- What the second ear heard, product by product ----

/** Words that end one product of a phrase: "Adefa beş qutu, Ketonal on qutu". */
const UNIT_WORDS = new Set(["qutu", "qutusu", "qutudan", "ədəd", "dənə", "paket", "ampula", "ampul", "flakon", "blister", "şpris",
  "tablet", "шт", "штук", "штуки", "упаковка", "упаковки", "упаковок", "коробка", "коробки", "коробок"])
/**
 * Chirp writes the caller's "qutu" as "kutu" (voice stand, 2026-11-04: "5 kutu",
 * "Adefo 3 kutu"). Unknown, "kutu" was a product word: "5 kutu" became a product of
 * its own, the next lookup took it as its second-ear pair, and its search (k and q
 * sound alike) returned Koraksan and folic acid by the "/*qutu/*" in 1C's names.
 */
const CHIRP_SPELLING: Record<string, string> = { kutu: "qutu", kutusu: "qutusu", kutudan: "qutudan" }
/** Words that join two products ("bir" is not one: it is "one box"). */
const JOIN_WORDS = new Set(["və", "ve", "həm", "и", "and", "plus", "üstəgəl", "sonra"])
/** Words that are an answer or the order's own talk, never a product's name. */
const NOT_PRODUCT = /^(?:bəli|bali|hə|he|yox|xeyr|yoxdur|salam|sağ|sag|olun|təşəkkür\p{L}*|tesekkur\p{L}*|да|нет|алло|allo|təsdiq\p{L}*|ləğv\p{L}*|sifariş\p{L}*|daha|başqa|hamısı|elə|okay|tamam|zəhmət|olmasa)$/iu
/** A part naming a pharmacy ("Zəfər aptekindən") is the caller, not a product. */
const PHARMACY_WORD = /^(?:aptek|apteka|аптек)/iu

/** Number words a quantity is said with ("beş qutu", "on beş qutu"); a dose is mostly digits. */
const NUMBER_WORDS = new Set(["bir", "iki", "üç", "dörd", "beş", "altı", "yeddi", "səkkiz", "doqquz", "on", "iyirmi", "otuz", "qırx",
  "əlli", "altmış", "yetmiş", "səksən", "doxsan", "yüz", "min"])

/**
 * What the second ear searches for one part: its words without the unit and the
 * quantity said right before it ("Bisakodil 10 qutu" -> "Bisakodil", "Mezim Forte
 * 10000 3 qutu" -> "Mezim Forte 10000": one digit group, or a run of number words).
 * Voice stand 2026-11-04: the whole part was searched, and "qutu" (k and q alike)
 * matched the "/*qutu/*" in 1C's names — "Bisakodil 10 qutu" brought "Bone
 * birdəfəlik" and Afobazol as the second ear's candidates, and "Fluimucil 600 iki
 * qutu" found nothing at all, where "Fluimucil 600" finds the line's Fluifort.
 */
function searchText(part: string[]) {
  const kept: string[] = []
  for (const word of part) {
    if (!UNIT_WORDS.has(word.toLowerCase())) { kept.push(word); continue }
    if (kept.length && /^\d+$/u.test(kept[kept.length - 1])) kept.pop()
    else while (kept.length && NUMBER_WORDS.has(kept[kept.length - 1].toLowerCase())) kept.pop()
  }
  return kept.join(" ")
}

export interface HeardProduct {
  /** What is searched: the part's name and dose as Chirp wrote them, without the quantity and its unit. */
  text: string
  /** Its product words as Chirp wrote them (the `alsoHeard` the agent gets). */
  words: string
  /** Its product words folded (spokenNameKey), for pairing with the model's lookup. */
  keys: string[]
}

/**
 * A phrase split into its products, each one searched on its own (the
 * benchmark's rule, task 8.1): at a comma or full stop, a joining word, or
 * after a unit ("beş qutu"). Parts without a product word (a number, "bəli",
 * the pharmacy) are dropped; each is searched by searchText.
 */
export function heardProducts(text: string): HeardProduct[] {
  const parts: string[][] = []
  let current: string[] = []
  const close = () => { if (current.length) parts.push(current); current = [] }
  for (const raw of text.split(/\s+/u)) {
    if (!raw) continue
    const ends = /[,.;!?]$/u.test(raw)
    const stripped = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    const word = CHIRP_SPELLING[stripped.toLowerCase()] ?? stripped
    const lower = word.toLowerCase()
    if (JOIN_WORDS.has(lower)) { close(); continue }
    if (word) current.push(word)
    if (ends || UNIT_WORDS.has(lower)) close()
  }
  close()
  const products: HeardProduct[] = []
  for (const part of parts) {
    if (part.some((word) => PHARMACY_WORD.test(word))) continue
    const named = part.filter((word) => !NOT_PRODUCT.test(word) && spokenNameKey(word))
    if (!named.length) continue
    products.push({ text: searchText(part).slice(0, 240), words: named.join(" ").slice(0, 80),
      keys: [...new Set(named.flatMap((word) => spokenNameKey(word).split(" ")).filter(Boolean))] })
  }
  return products
}

/** How close a heard product sounds to the model's lookup: its closest pair of words. */
function apart(query: string[], product: HeardProduct): number {
  let best = 1
  for (const left of query) for (const right of product.keys) best = Math.min(best, spokenWordsApart(left, right))
  return best
}
/** Further apart than this, a heard product is another product than the lookup's. */
const PAIR_MAX_APART = 0.5

/**
 * Which heard product the model's lookup is: the one that sounds closest.
 * A fresh phrase with a single product is that product whatever the model
 * made of it ("Deva" for Adefa) — that is what the second ear is for. Among
 * several, or on a phrase an earlier lookup already used, the closest one
 * within PAIR_MAX_APART, preferring one no lookup of this phrase took yet.
 */
export function pairHeard(query: string, products: HeardProduct[], options: { fresh: boolean; taken?: ReadonlySet<string> }): HeardProduct | null {
  if (!products.length) return null
  if (options.fresh && products.length === 1 && !options.taken?.size) return products[0]
  const words = spokenNameKey(query).split(" ").filter(Boolean)
  if (!words.length) return null
  let best: HeardProduct | null = null, bestScore = Infinity
  for (const product of products) {
    const distance = apart(words, product)
    if (distance > PAIR_MAX_APART) continue
    const score = distance + (options.taken?.has(product.text) ? 0.25 : 0)
    if (score < bestScore) { best = product; bestScore = score }
  }
  return best
}

// ---- The call's memory ----

/** `order`: when it arrived among the call's phrases and lookups — the clock may give both the same millisecond. */
interface Utterance { seq: number; at: number; order: number; text: string | null; settled: boolean; done: Promise<void> }
interface CallMemory { utterances: Utterance[]; lastLookup: number; batch: Utterance[]; taken: Set<string>; touched: number }

export interface HeardForLookup {
  products: HeardProduct[]
  /** Whether these phrases came after the call's previous lookup. */
  fresh: boolean
  /** How long the lookup waited for Chirp. */
  waitedMs: number
  /** Products earlier lookups of the same phrases were paired with. */
  taken: Set<string>
}

export interface ZeytunSecondEar {
  enabled(): Promise<boolean>
  warm(): void
  /** Takes a phrase and recognizes it in the background; false when it was not taken. */
  hear(callId: string, seq: number, pcm: Buffer, hints: string[]): boolean
  /** The phrases of this lookup: those after the call's previous lookup, waiting up to UTTERANCE_WAIT_MS for their text. */
  heardFor(callId: string): Promise<HeardForLookup | null>
}

export function createZeytunSecondEar(options: {
  recognizer: ChirpRecognizer
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
}): ZeytunSecondEar {
  const clock = options.clock ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const calls = new Map<string, CallMemory>()
  let inFlight = 0, events = 0

  function prune(now: number) {
    for (const [callId, memory] of calls) {
      memory.utterances = memory.utterances.filter((utterance) => now - utterance.at < KEPT_FOR_MS)
      if (now - memory.touched >= KEPT_FOR_MS) calls.delete(callId)
    }
    while (calls.size > KEPT_CALLS) calls.delete(calls.keys().next().value!)
  }

  return {
    enabled: () => options.recognizer.enabled(),
    warm: () => options.recognizer.warm(),
    hear(callId, seq, pcm, hints) {
      const now = clock()
      prune(now)
      const memory = calls.get(callId) ?? { utterances: [], lastLookup: 0, batch: [], taken: new Set<string>(), touched: now }
      memory.touched = now
      calls.set(callId, memory)
      // The station resends a phrase it got no answer for: the first one counts.
      if (memory.utterances.some((utterance) => utterance.seq === seq)) return true
      if (inFlight >= MAX_IN_FLIGHT) {
        console.warn("[zeytun-line] chirp busy", JSON.stringify({ call: callId, seq }))
        return false
      }
      inFlight++
      const utterance: Utterance = { seq, at: now, order: ++events, text: null, settled: false, done: Promise.resolve() }
      utterance.done = options.recognizer.recognize(pcm, hints).then((heard) => {
        if ("text" in heard) utterance.text = heard.text || null
        else console.warn("[zeytun-line] chirp failed", JSON.stringify({ call: callId, seq, ms: heard.ms, error: heard.error }))
      }, () => undefined).finally(() => { utterance.settled = true; inFlight-- })
      memory.utterances = [...memory.utterances, utterance].sort((a, b) => a.seq - b.seq).slice(-KEPT_PER_CALL)
      return true
    },
    async heardFor(callId) {
      const now = clock()
      const memory = calls.get(callId)
      if (!memory) return null
      memory.touched = now
      const fresh = memory.utterances.filter((utterance) => utterance.order > memory.lastLookup && now - utterance.at < KEPT_FOR_MS)
      // No new phrase: the model is looking up another product of the same one
      // ("Adefa və Ketonal" — two lookups, task 8.1), not a phrase long gone.
      const reuse = !fresh.length && memory.batch.length > 0 && now - Math.max(...memory.batch.map((utterance) => utterance.at)) <= BATCH_REUSE_MS
      if (fresh.length) { memory.batch = fresh; memory.taken = new Set() }
      else if (!reuse) { memory.batch = []; memory.taken = new Set() }
      memory.lastLookup = ++events
      const batch = memory.batch, taken = memory.taken
      if (!batch.length) return null
      const pending = batch.filter((utterance) => !utterance.settled)
      const deadline = pending.length ? Math.max(...pending.map((utterance) => utterance.at + UTTERANCE_WAIT_MS)) : now
      if (deadline > now) await Promise.race([Promise.all(pending.map((utterance) => utterance.done)), sleep(deadline - now)])
      const products = batch.flatMap((utterance) => utterance.text ? heardProducts(utterance.text) : [])
      return { products, fresh: fresh.length > 0, waitedMs: Math.max(0, clock() - now), taken }
    },
  }
}
