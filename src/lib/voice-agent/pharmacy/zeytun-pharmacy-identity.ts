/**
 * Who is calling the line, from 1C's pharmacy list. Owner, 2026-10-24 plan
 * ("Узнавать аптеку по номеру: если номер в 1С принадлежит одной аптеке —
 * сразу назвать, если общий — спросить"). The number is a suggestion the
 * caller confirms, never an identity by itself: 108 numbers in the list
 * belong to several pharmacies, and anyone can call from any phone. What the
 * manager sees on the order says how the pharmacy was found.
 */

/** How the line answers (owner, 2026-10-30): the company's sales desk, not «süni intellekt». */
export const ZEYTUN_SALES_DESK = "Zeytun Pharmaceuticals, satış şöbəsi, salam!"

export type PharmacyCandidate = { guid: string; name: string; address: string | null }

export type PharmacyIdentity =
  | { identification: "phone_unique" | "phone_shared"; pharmacy: PharmacyCandidate }
  | { identification: "named_on_call"; spoken: string }
  | { identification: "unidentified" }

/** The most pharmacies a shared number is read out with; more, and the agent asks the name. */
export const MAX_SPOKEN_CANDIDATES = 4

/** A 1C name as it is spoken: no quotes, brackets or doubled spaces. */
export function spokenPharmacyName(name: string) {
  return name.replace(/["«»“”„]/gu, "").replace(/[()]/gu, " ").replace(/\s+/gu, " ").trim()
}

const STOP = new Set(["aptek", "apteki", "aptekden", "aptekinden", "aptekdən", "aptekindən", "apteka", "аптека",
  "mmc", "mmс", "ooo", "ооо", "llc", "ltd", "№", "n", "no", "nomre", "nomreli", "номер"])

function words(text: string) {
  return text.toLocaleLowerCase("az")
    .replace(/ə/gu, "e").replace(/ı/gu, "i").replace(/ö/gu, "o").replace(/ü/gu, "u")
    .replace(/ş/gu, "s").replace(/ç/gu, "c").replace(/ğ/gu, "g")
    .normalize("NFD").replace(/\p{Mn}/gu, "")
    .split(/[^\p{L}\p{N}]+/u).filter((word) => word && !STOP.has(word))
}

/** Every word the caller said for the pharmacy appears in its 1C name (a word
 * of four letters or more may be its start: "Zəfər" for "Zəfərli"). */
export function pharmacyNameMatches(spoken: string, name: string) {
  const said = words(spoken), known = words(name)
  if (!said.length) return false
  return said.every((word) => known.some((k) => k === word || (word.length >= 4 && k.startsWith(word))))
}

/** The line's greeting for the candidates the caller's number has in 1C. */
export function openingForCandidates(base: string, candidates: PharmacyCandidate[]) {
  if (candidates.length === 1) {
    // Owner, 2026-10-30 («долго принимает заказ»): the pharmacy confirms and
    // starts its order in one answer instead of a yes and a second turn.
    return `${ZEYTUN_SALES_DESK} Nömrəniz «${spokenPharmacyName(candidates[0].name)}» kimi qeydə alınıb. Düzdürsə, sifarişinizi deyin.`
  }
  if (candidates.length >= 2 && candidates.length <= MAX_SPOKEN_CANDIDATES) {
    const names = candidates.map((candidate) => `«${spokenPharmacyName(candidate.name)}»`)
    const text = `${ZEYTUN_SALES_DESK} Bu nömrə bir neçə aptekdə qeydə alınıb: ${names.slice(0, -1).join(", ")} və ${names.at(-1)}. Hansından zəng edirsiniz?`
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
