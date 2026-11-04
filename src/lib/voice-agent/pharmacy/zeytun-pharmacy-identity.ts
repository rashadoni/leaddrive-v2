/**
 * Who is calling the line, from 1C's pharmacy list. Owner, 2026-10-24 plan
 * ("Узнавать аптеку по номеру: если номер в 1С принадлежит одной аптеке —
 * сразу назвать, если общий — спросить"). The number is a suggestion the
 * caller confirms, never an identity by itself: 108 numbers in the list
 * belong to several pharmacies, and anyone can call from any phone. What the
 * manager sees on the order says how the pharmacy was found.
 */

import { spokenWordsApart } from "./name-search"

/** How the line answers (owner, 2026-10-30): the company's sales desk, not «süni intellekt». */
export const ZEYTUN_SALES_DESK = "Zeytun Pharmaceuticals, satış şöbəsi, salam!"

export type PharmacyCandidate = { guid: string; name: string; address: string | null }

export type PharmacyIdentity =
  | { identification: "phone_unique" | "phone_shared"; pharmacy: PharmacyCandidate }
  /** The words named a 1C pharmacy the number does not belong to: a suggestion the manager checks, never the call's own pharmacy. */
  | { identification: "named_matched"; pharmacy: PharmacyCandidate; spoken: string }
  | { identification: "named_on_call"; spoken: string }
  | { identification: "unidentified" }

/** The most pharmacies a shared number is read out with; more, and the agent asks the name. */
export const MAX_SPOKEN_CANDIDATES = 4

/** A 1C name as it is spoken: no quotes, brackets or doubled spaces. */
export function spokenPharmacyName(name: string) {
  return name.replace(/["«»“”„]/gu, "").replace(/[()]/gu, " ").replace(/\s+/gu, " ").trim()
}

const STOP = new Set(["ci", "cu", "nci", "inci", "ncu", "uncu", "den", "dan", "nden", "ndan", "aptek", "apteki", "aptekden", "aptekinden", "aptekdən", "aptekindən", "apteka", "аптека",
  "mmc", "mmс", "ooo", "ооо", "llc", "ltd", "№", "n", "no", "nomre", "nomreli", "номер"])

/** Azerbaijani number words, as letters() leaves them: "doxsan iki" is 92. */
const UNITS: Record<string, number> = { bir: 1, iki: 2, uc: 3, dord: 4, bes: 5, alti: 6, yeddi: 7, sekkiz: 8, doqquz: 9 }
const TENS: Record<string, number> = { on: 10, iyirmi: 20, otuz: 30, qirx: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doxsan: 90 }
/** "from" and "-th", as letters() leaves them: "92-dən", "doxsan ikidən", "ikinci". */
const NUMBER_ENDINGS = ["nden", "ndan", "den", "dan", "inci", "nci", "uncu", "ncu", "ci", "cu"]

function letters(text: string) {
  return text.toLocaleLowerCase("az")
    .replace(/ə/gu, "e").replace(/ı/gu, "i").replace(/ö/gu, "o").replace(/ü/gu, "u")
    .replace(/ş/gu, "s").replace(/ç/gu, "c").replace(/ğ/gu, "g")
    .normalize("NFD").replace(/\p{Mn}/gu, "")
}

/**
 * Number words as digits: "beş yüz əlli iki" → "552", "doxsan iki" → "92".
 * 1C names Zeytun's pharmacies by number and district ("92 Yasamal",
 * 2026-11-04: 1 143 of 1 144), and a caller may say the number either way.
 * An ending stuck to a digit ("92-ci", "92-dən") comes off.
 */
export function spokenNumbers(text: string): string[] {
  const out: string[] = []
  let value = 0, open = false
  const close = () => { if (open) out.push(String(value)); value = 0; open = false }
  for (const raw of letters(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue
    const digits = raw.match(/^(\d+)\p{L}*$/u)?.[1]
    if (digits) { close(); out.push(String(Number(digits))); continue }
    // "doxsan ikidən", "ikinci": a number word with the ending a pharmacy's number takes.
    const isNumber = (word: string) => word in UNITS || word in TENS || word === "yuz"
    const stem = isNumber(raw) ? raw : NUMBER_ENDINGS.map((ending) => raw.endsWith(ending) ? raw.slice(0, -ending.length) : "").find(isNumber) ?? raw
    const unit = UNITS[stem], ten = TENS[stem], hundred = stem === "yuz"
    if (unit === undefined && ten === undefined && !hundred) { close(); out.push(raw); continue }
    // A word that cannot continue the number said so far starts the next one ("iki üç": 2, 3).
    const fits = hundred ? value < 10 : ten !== undefined ? value % 100 === 0 : value % 10 === 0
    if (open && !fits) close()
    value = hundred ? (value || 1) * 100 : value + (ten ?? unit!)
    open = true
  }
  close()
  return out
}

function words(text: string) {
  return spokenNumbers(text).filter((word) => word && !STOP.has(word))
}

/**
 * Whether a word the caller said is this word of a 1C name: the same; a start
 * of it, four letters or more ("Zəfər" for "Zəfərli"); or, five letters or
 * more and not a number, one alike sound off as the search measures it
 * ("Yasemal" for Yasamal, "Zəhər" for Zəfər — f and h sound alike on the line).
 */
function sameWord(said: string, known: string) {
  if (said === known || (said.length >= 4 && known.startsWith(said))) return true
  return said.length >= 5 && known.length >= 5 && !/\d/u.test(said + known) && spokenWordsApart(said, known) <= 0.1
}

/** Every word the caller said for the pharmacy appears in its 1C name (sameWord). */
export function pharmacyNameMatches(spoken: string, name: string) {
  const said = words(spoken), known = words(name)
  if (!said.length) return false
  return said.every((word) => known.some((k) => sameWord(word, k)))
}

/** Words of 1C names that tell no pharmacy apart: the class, the chain's tag. */
const NOT_DISTINCT = new Set(["vip", "class", "pharma", "store", "a", "b", "c", "l"])

/**
 * The one 1C pharmacy a caller's words name out of the whole list, or null:
 * its number said (digits or words) and a word of the rest of its name (the
 * district: "Yasamal") among the words, within one alike sound. Several
 * texts (the agent's words, the second ear's) must agree on one pharmacy;
 * two pharmacies, or none, is null. Only the name's own number counts: a
 * number elsewhere in the text ("10 qutu") names no pharmacy unless a
 * district of that number is said too.
 */
export function matchPharmacyName(texts: string[], pharmacies: readonly PharmacyCandidate[]): PharmacyCandidate | null {
  const found = new Map<string, PharmacyCandidate>()
  for (const text of texts) {
    const said = words(text)
    const numbers = new Set(said.filter((word) => /^\d+$/u.test(word)))
    if (!numbers.size) continue
    const named = said.filter((word) => !/^\d+$/u.test(word) && word.length >= 4)
    const matching = pharmacies.filter((pharmacy) => {
      const known = words(pharmacy.name)
      const number = known.find((word) => /^\d+$/u.test(word))
      return number !== undefined && numbers.has(number)
        && known.some((k) => !/^\d+$/u.test(k) && !NOT_DISTINCT.has(k) && named.some((word) => sameWord(word, k)))
    })
    if (matching.length !== 1) continue
    found.set(matching[0].guid, matching[0])
  }
  return found.size === 1 ? [...found.values()][0] : null
}

/** The line's greeting for the candidates the caller's number has in 1C. */
/** `desk` is the greeting's first sentence: the organization's own, or the sales desk. */
export function openingForCandidates(base: string, candidates: PharmacyCandidate[], desk = ZEYTUN_SALES_DESK) {
  if (candidates.length === 1) {
    // Owner, 2026-10-30 («долго принимает заказ»): the pharmacy confirms and
    // starts its order in one answer instead of a yes and a second turn.
    const text = `${desk} Nömrəniz «${spokenPharmacyName(candidates[0].name)}» kimi qeydə alınıb. Düzdürsə, sifarişinizi deyin.`
    if (text.length <= 500) return text
  }
  if (candidates.length >= 2 && candidates.length <= MAX_SPOKEN_CANDIDATES) {
    const names = candidates.map((candidate) => `«${spokenPharmacyName(candidate.name)}»`)
    const text = `${desk} Bu nömrə bir neçə aptekdə qeydə alınıb: ${names.slice(0, -1).join(", ")} və ${names.at(-1)}. Hansından zəng edirsiniz?`
    if (text.length <= 500) return text
  }
  return base
}

/** The order's pharmacy: the number's own pharmacy when the caller did not
 * name another; on a shared number, the one candidate the caller named. */
export function identifyPharmacy(candidates: PharmacyCandidate[], spoken: string | undefined): PharmacyIdentity {
  const said = spoken?.trim()
  if (candidates.length === 1 && (!said || pharmacyNameMatches(said, candidates[0].name))) {
    return { identification: "phone_unique", pharmacy: candidates[0] }
  }
  if (candidates.length > 1 && said) {
    const named = candidates.filter((candidate) => pharmacyNameMatches(said, candidate.name))
    if (named.length === 1) return { identification: "phone_shared", pharmacy: named[0] }
  }
  return said ? { identification: "named_on_call", spoken: said } : { identification: "unidentified" }
}

/**
 * Words for the second ear while the caller says who is calling: the
 * districts and other distinct words of 1C's pharmacy names ("Yasamal",
 * "Xətai"), most frequent first, at most `limit`. Never a pharmacy's whole
 * name, address or phone, and never in the model's prompt.
 */
export function pharmacyHintWords(names: readonly string[], limit = 150): string[] {
  const counts = new Map<string, { word: string; count: number }>()
  for (const name of names) {
    for (const raw of spokenPharmacyName(name).split(/[^\p{L}]+/u)) {
      const key = letters(raw)
      if (raw.length < 3 || STOP.has(key) || NOT_DISTINCT.has(key)) continue
      const word = raw.charAt(0).toLocaleUpperCase("az") + raw.slice(1).toLocaleLowerCase("az")
      const entry = counts.get(key) ?? { word, count: 0 }
      entry.count++
      counts.set(key, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, limit).map((entry) => entry.word)
}
