/**
 * @-mentions in the task card's message box (Bordio's chat, 2026-11-07).
 * Typing «@na» offers people whose name starts a word with «na»; picking one
 * writes «@Nazrin Shirinova » into the text and remembers the id. What is sent
 * is the ids still present in the text — deleting the name drops the mention.
 */

export interface MentionPerson { id: string; name: string }

/** The «@query» being typed right before the caret, or null. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null // e-mail-like «a@b» is not a mention
  const query = before.slice(at + 1)
  if (query.length > 30 || /[\n@]/.test(query) || /\s{2,}/.test(query)) return null
  return { start: at, query }
}

// ə and ı have no decomposition, so NFKD alone would keep «Ələkbərova» away from «elek».
const fold = (value: string) => value.toLocaleLowerCase("az").replace(/ə/g, "e").replace(/ı/g, "i").normalize("NFKD").replace(/\p{M}/gu, "")

/** People whose name — any word of it — starts with the query; at most `limit`. */
export function mentionCandidates(people: readonly MentionPerson[], query: string, limit = 6): MentionPerson[] {
  const q = fold(query.trim())
  if (!q) return people.slice(0, limit)
  return people.filter((person) => fold(person.name).split(/\s+/).some((word) => word.startsWith(q)) || fold(person.name).startsWith(q)).slice(0, limit)
}

/** Replace the «@query» at `start` with the person's name; returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, person: MentionPerson): { text: string; caret: number } {
  const inserted = `@${person.name} `
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length }
}

/** Ids of picked people whose «@Name» is still in the text. */
export function mentionedIds(text: string, picked: readonly MentionPerson[]): string[] {
  return [...new Set(picked.filter((person) => text.includes(`@${person.name}`)).map((person) => person.id))]
}
