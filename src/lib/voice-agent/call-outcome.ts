/**
 * What an AI phone conversation came to, and who the caller asked for
 * (owner, 2026-11-21: «ночью ИИ принял обращения, утром рассказал»).
 *
 * Pure on purpose: the server stores this inside `CallLog.insights`, and the
 * call card and the lead card read it back in the browser. Every field is
 * optional, because every call analysed before this release has none of them
 * and must keep reading as it always did.
 */

export const CALL_OUTCOMES = ["qualified", "not_qualified", "needs_human"] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export type RequestedEmployee = {
  /** The name as the caller said it. Kept even when it matched nobody. */
  spokenName: string
  /** Set only when exactly one person in the organization fits the name. */
  userId: string | null
  match: "matched" | "ambiguous" | "not_found"
}

export type StoredCallOutcome = {
  outcome: CallOutcome | null
  requestedEmployee: RequestedEmployee | null
  callerName: string | null
}

const NAME_LIMIT = 120

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.replace(/\s+/g, " ").trim()
  return trimmed ? trimmed.slice(0, NAME_LIMIT) : null
}

/** Read the outcome fields from a stored insight of any age. Anything malformed reads as absent. */
export function readCallOutcome(insights: unknown): StoredCallOutcome {
  if (!insights || typeof insights !== "object" || Array.isArray(insights)) {
    return { outcome: null, requestedEmployee: null, callerName: null }
  }
  const row = insights as Record<string, unknown>
  const outcome = (CALL_OUTCOMES as readonly unknown[]).includes(row.outcome)
    ? row.outcome as CallOutcome
    : null
  let requestedEmployee: RequestedEmployee | null = null
  const raw = row.requestedEmployee
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const candidate = raw as Record<string, unknown>
    const spokenName = text(candidate.spokenName)
    const match = candidate.match
    if (spokenName && (match === "matched" || match === "ambiguous" || match === "not_found")) {
      const userId = match === "matched" && typeof candidate.userId === "string" && candidate.userId
        ? candidate.userId
        : null
      // A "matched" row without a person is not a match: nobody may be told
      // that a customer asked for them on the strength of it.
      requestedEmployee = { spokenName, userId, match: match === "matched" && !userId ? "not_found" : match }
    }
  }
  return { outcome, requestedEmployee, callerName: text(row.callerName) }
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h",
  ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ә: "a", ө: "o", ү: "u", һ: "h", ҹ: "j",
}

const AZERBAIJANI: Record<string, string> = {
  ə: "a", ş: "sh", ç: "ch", ğ: "g", ı: "i", ö: "o", ü: "u", x: "h", q: "g", c: "j",
}

/** Forms of address, after folding: «Leyla xanım» is Leyla. */
const FORMS_OF_ADDRESS = new Set([
  "bay", "bey", "hanim", "hanum", "muallim", "muellim", "muallima", "muellima",
  "janab", "mr", "mrs", "ms", "mister", "gospodin", "gospoja",
])

function foldPersonName(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/i̇/g, "i")
    .replace(/дж/g, "j")
    .replace(/./gu, (char) => CYRILLIC[char] ?? AZERBAIJANI[char] ?? char)
    // «Əliyev» and «Алиев»: one surname, spelled with and without the glide.
    .replace(/iy/g, "i")
}

/** The words of a person's name in one spelling, so «Рашад», «Rəşad» and «Rashad» are one word. */
export function personNameTokens(value: string): string[] {
  const words = foldPersonName(value).match(/[\p{L}\p{N}]+/gu) ?? []
  return words.filter((word) => word.length >= 2 && !FORMS_OF_ADDRESS.has(word))
}

/**
 * Who the caller meant, without guessing.
 *
 * A person fits when every word the caller said is a whole word of their name.
 * Exactly one fit is a match; two Leylas are `ambiguous`, and the task then goes
 * to the responsible person with the name written in it. Telling the wrong
 * Leyla that a customer is waiting for her is worse than asking a human.
 */
export function matchRequestedEmployee(
  spokenName: string,
  people: ReadonlyArray<{ id: string; name: string | null }>,
): RequestedEmployee {
  const spoken = text(spokenName) ?? ""
  const wanted = personNameTokens(spoken)
  if (wanted.length === 0) return { spokenName: spoken, userId: null, match: "not_found" }
  const fits = people.filter((person) => {
    const tokens = new Set(personNameTokens(person.name ?? ""))
    return wanted.every((word) => tokens.has(word))
  })
  if (fits.length === 1) return { spokenName: spoken, userId: fits[0].id, match: "matched" }
  return { spokenName: spoken, userId: null, match: fits.length > 1 ? "ambiguous" : "not_found" }
}

/**
 * Words that prove a line was open, not that anybody said what they wanted.
 * Written in the folded spelling: «алло» is `allo`, «bəli» is `bali`, «hə» is `ha`.
 */
const LINE_CHECK_WORDS = new Set([
  "alo", "allo", "hello", "salam", "privet", "zdravstvuyte",
  "bali", "beli", "ha", "he", "yoh", "yok", "da", "net", "aga", "ugu", "ok", "okay", "yes", "no",
  "eshidiram", "slushayu",
])

/**
 * Did the customer actually say something? An open line, «алло, алло», and a
 * lone «да» are a call the CRM keeps, but not a person to chase as a lead.
 */
export function customerReallySpoke(
  turns: ReadonlyArray<{ role: "customer" | "agent"; text: string }>,
): boolean {
  const words = turns
    .filter((turn) => turn.role === "customer")
    .flatMap((turn) => foldPersonName(turn.text).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !LINE_CHECK_WORDS.has(word))
  return words.length >= 2
}
