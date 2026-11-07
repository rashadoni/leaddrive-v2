/**
 * The card's right column — Bordio's chat: what people wrote and what happened
 * to the task, in one time line (owner, 2026-11-07).
 *
 * Messages are TaskComment rows; events are TaskActivity rows. An event that
 * names a person by id (assignee changed) carries the name with it, so the
 * client never has to look anybody up. `external_event` rows are the other
 * tool's own history brought over by the import, kept in its words.
 */

export interface FeedPerson { id: string; name: string; avatar?: string | null }

export type FeedItem =
  | { kind: "message"; id: string; at: string; user: FeedPerson | null; text: string; mentions: string[]; system: boolean }
  | { kind: "event"; id: string; at: string; user: FeedPerson | null; action: string; oldValue: string | null; newValue: string | null; text: string | null }

interface CommentRow {
  id: string; createdAt: Date; content: string; isSystem: boolean; mentions: string[]
  user: { id: string; name: string; avatar: string | null } | null
}
interface ActivityRow {
  id: string; createdAt: Date; action: string; oldValue: string | null; newValue: string | null; metadata: unknown
  user: { id: string; name: string } | null
}

/** Events whose values are people's ids — shown by name. */
const PERSON_VALUES = new Set(["assignee_changed", "reporter_changed"])

export function buildTaskFeed(
  comments: readonly CommentRow[],
  activities: readonly ActivityRow[],
  peopleById: ReadonlyMap<string, string>,
): FeedItem[] {
  const name = (value: string | null) => (value ? peopleById.get(value) ?? null : null)
  const items: FeedItem[] = [
    ...comments.map((c): FeedItem => ({
      kind: "message", id: c.id, at: c.createdAt.toISOString(), user: c.user, text: c.content, mentions: c.mentions ?? [], system: c.isSystem,
    })),
    ...activities.map((a): FeedItem => {
      const meta = (a.metadata && typeof a.metadata === "object" ? a.metadata : {}) as { text?: unknown; actorName?: unknown }
      const person = PERSON_VALUES.has(a.action)
      return {
        kind: "event",
        id: a.id,
        at: a.createdAt.toISOString(),
        user: a.user ?? (typeof meta.actorName === "string" ? { id: "", name: meta.actorName } : null),
        action: a.action,
        oldValue: person ? name(a.oldValue) : a.oldValue,
        newValue: person ? name(a.newValue) : a.newValue,
        text: typeof meta.text === "string" ? meta.text : null,
      }
    }),
  ]
  // Oldest first, like a chat; a message and an event at the same instant keep
  // the event first (the change, then what was said about it).
  return items.sort((x, y) => x.at.localeCompare(y.at) || (x.kind === y.kind ? x.id.localeCompare(y.id) : x.kind === "event" ? -1 : 1))
}

/** Ids of people named in events, to resolve in one query. */
export function feedPersonIds(activities: readonly ActivityRow[]): string[] {
  const ids = new Set<string>()
  for (const a of activities) {
    if (!PERSON_VALUES.has(a.action)) continue
    if (a.oldValue) ids.add(a.oldValue)
    if (a.newValue) ids.add(a.newValue)
  }
  return [...ids]
}

/** Minutes between two instants, rounded, at least one for a timer that ran at all. */
export function timerMinutes(startedAt: Date, endedAt: Date): number {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime())
  return ms === 0 ? 0 : Math.max(1, Math.round(ms / 60_000))
}
