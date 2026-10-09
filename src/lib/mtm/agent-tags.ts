/**
 * Labels («метки») and a personal map colour on an employee's card.
 *
 * Both are the managers' own notes about a person («стажёр», «на испытательном
 * сроке», «резерв»): they are set on the web, shown on the live map and in its
 * list, and never given to the employee they are about — not on his phone and
 * not under his own web login. The rules live here, in one place without React
 * or Prisma, because the card form, the API, the map's list, its Excel export
 * and the marker all have to agree on them.
 */

/** Ten labels of twenty-four characters, joined with «, », make 258 characters. */
export const MTM_AGENT_TAG_MAX_COUNT = 10
export const MTM_AGENT_TAG_MAX_LENGTH = 24

/**
 * What a label may look like. Three things outside this module depend on it:
 *
 *   - the first character is a letter or a digit, so a label — and the Excel
 *     cell that starts with it — can never begin a formula (`=`, `+`, `-`, `@`);
 *   - there is no comma, because the list's Excel and print cell joins labels
 *     with «, » and has to stay readable as a list;
 *   - there is no underscore, so nobody can type `__none__`, the value the
 *     map's list keeps for «without labels».
 *
 * The limits above keep that joined cell under the 300 characters the export
 * accepts; a longer cell refuses the whole file, not one row.
 */
export const MTM_AGENT_TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .\-+/#№]*$/u

export type MtmAgentTagsProblem = "type" | "count" | "length" | "characters"

export type MtmAgentTagsValidation =
  | { ok: true; tags: string[] }
  | { ok: false; reason: MtmAgentTagsProblem; error: string }

/**
 * Labels as they are stored: trimmed, inner whitespace collapsed to one space,
 * empty ones dropped, and the same word in another case kept once — in the
 * spelling that came first, so «VIP» typed after «Vip» is not a second label
 * on the same card. (Across cards nothing merges them: the form offers the
 * labels already in use so that the spelling does not drift.) Composed to NFC
 * first: a word pasted from a Mac arrives as a letter plus a combining mark,
 * which the pattern would refuse.
 */
export function normalizeMtmAgentTags(input: readonly string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of input) {
    // A row read from JSON is not always what its type says.
    if (typeof raw !== "string") continue
    const tag = raw.normalize("NFC").trim().replace(/\s+/g, " ")
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/**
 * The strict form for a write: anything that would not be stored exactly as
 * sent — apart from spacing, case duplicates and empties — is refused with the
 * reason, never silently cut. The count is taken after normalizing, so a
 * repeated label does not use up a place.
 */
export function validateMtmAgentTags(value: unknown): MtmAgentTagsValidation {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return { ok: false, reason: "type", error: "tags must be a list of strings" }
  }
  const tags = normalizeMtmAgentTags(value)
  if (tags.length > MTM_AGENT_TAG_MAX_COUNT) {
    return { ok: false, reason: "count", error: `An employee can have at most ${MTM_AGENT_TAG_MAX_COUNT} tags` }
  }
  if (tags.some((tag) => tag.length > MTM_AGENT_TAG_MAX_LENGTH)) {
    return { ok: false, reason: "length", error: `A tag can be at most ${MTM_AGENT_TAG_MAX_LENGTH} characters long` }
  }
  if (tags.some((tag) => !MTM_AGENT_TAG_PATTERN.test(tag))) {
    return {
      ok: false,
      reason: "characters",
      error: "A tag starts with a letter or a digit and may contain letters, digits, spaces and . - + / # №",
    }
  }
  return { ok: true, tags }
}

/**
 * The eight colours a manager can give an employee, in the order the card
 * offers them. The card stores the KEY, never the hex: the marker is drawn as
 * an HTML string, and text from the database must not be able to reach it.
 *
 * The marker's fill already says how fresh the GPS point is (green, amber,
 * slate), so the personal colour is a ring outside the marker's white border,
 * never the fill, and none of the eight is one of those three.
 */
export const MTM_AGENT_MAP_COLOR_KEYS = ["pink", "fuchsia", "purple", "navy", "cyan", "teal", "lime", "black"] as const
export type MtmAgentMapColorKey = typeof MTM_AGENT_MAP_COLOR_KEYS[number]

export const MTM_AGENT_MAP_COLORS: Readonly<Record<MtmAgentMapColorKey, string>> = {
  pink: "#db2777",
  fuchsia: "#c026d3",
  purple: "#7e22ce",
  navy: "#1e3a8a",
  cyan: "#0891b2",
  teal: "#0d9488",
  lime: "#65a30d",
  black: "#0f172a",
}

export function isMtmAgentMapColorKey(value: unknown): value is MtmAgentMapColorKey {
  // Own keys only: `constructor` and `toString` are also «in» the object.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MTM_AGENT_MAP_COLORS, value)
}

/**
 * The hex for a stored key, or null for «no colour». An unknown key — a colour
 * dropped from the palette later, a row written by a newer build during a
 * rollback — also means no colour: the marker simply has no ring.
 */
export function mtmAgentMapColorHex(key: string | null | undefined): string | null {
  return isMtmAgentMapColorKey(key) ? MTM_AGENT_MAP_COLORS[key] : null
}

/**
 * The two columns as a Prisma select. A query gets them only for somebody who
 * reads them (`mtmAgentNotesReader` below): the selects that also answer the
 * phone or an integration key must not include them, and a handler that
 * serves several kinds of caller spreads this in behind that check.
 */
export const MTM_AGENT_WEB_ONLY_SELECT = { tags: true, mapColor: true } as const

/**
 * Who reads the labels and the colour. They are the managers' notes ABOUT a
 * person, so the answer is about the person asking, not only about what he
 * signed in with:
 *
 *   - nobody — anything that is not a person at a browser (an integration
 *     key, the phone's token, a caller without a session), and a field
 *     employee signed in on the web: the only card he reaches is his own;
 *   - everyone — an administrator of the whole organization. He administers
 *     every card, his own included, so nothing is kept from him;
 *   - all but his own — a manager or a supervisor: the cards of his people,
 *     never what was noted about himself.
 *
 * It began as «web sessions only», and that was a rule about the transport:
 * the same employee the phone was refused read his labels by signing in on
 * the web with the same email and password (review of 2026-10-10). Whatever
 * is unclear — an unknown role, a card without an id — reads nothing.
 */
export type MtmAgentNotesReader =
  | { kind: "nobody" }
  | { kind: "everyone" }
  | { kind: "all-but-own"; ownAgentId: string }

export function mtmAgentNotesReader(caller: {
  /** A browser session, compared to its exact value by the route — never «not a key». */
  webSession: boolean
  /** The MTM actor resolved for that session: his own card and his role. */
  actor: { agentId: string | null; role: string } | null | undefined
}): MtmAgentNotesReader {
  if (caller.webSession !== true || !caller.actor) return { kind: "nobody" }
  const { role, agentId } = caller.actor
  if (role === "ADMIN") return { kind: "everyone" }
  if ((role === "MANAGER" || role === "SUPERVISOR") && agentId) return { kind: "all-but-own", ownAgentId: agentId }
  return { kind: "nobody" }
}

/** Whether this reader gets the labels and the colour of that card. */
export function readsMtmAgentNotes(reader: MtmAgentNotesReader, agentId: string | null | undefined): boolean {
  if (reader.kind === "everyone") return true
  if (reader.kind === "all-but-own") return Boolean(agentId) && agentId !== reader.ownAgentId
  return false
}

/**
 * A journal row's before/after snapshot without the two notes. The snapshot
 * of an employee card carries them on every save — also on one that changed
 * only a phone number — so the journal is a second place they are read from.
 * The keys are dropped, not blanked: «tags: []» would read as «the labels
 * were taken off».
 */
export function withoutMtmAgentNotes(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot
  const rest: Record<string, unknown> = { ...snapshot }
  delete rest.tags
  delete rest.mapColor
  return rest
}
