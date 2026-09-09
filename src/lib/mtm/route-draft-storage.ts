/**
 * Where a route planner draft is kept, and which one wins.
 *
 * Field UX audit 2026-09-05, task C8: a manager was offered the 09:43 draft
 * when a 15:23 one existed. Nothing overwrote anything — the two drafts sat
 * under different keys.
 *
 * The old key mixed four things into the identity of a draft: agent, date,
 * customer and contact. Opening the planner from a customer card produced a
 * different key than opening the same day from the calendar, so "the plan I
 * was making for Tuesday" existed twice and the app offered whichever key it
 * happened to compute on open.
 *
 * A draft is identified by what makes it that plan: the route it edits, or —
 * for a new one — the day and the agent. Everything else is a way of getting
 * there, not a different plan. And when more than one candidate is found, the
 * newest `savedAt` wins: the only reading of "restore my draft" that is never
 * surprising.
 */
const PREFIX = "leaddrive:mtm:route-draft"

export type RouteDraftScope = {
  orgId: string | null | undefined
  viewerKey: string | null | undefined
  routeId?: string | null
  /** Local date key (YYYY-MM-DD) of the planned day, when known. */
  date?: string | null
  agentId?: string | null
}

/** The key a draft is written under. Empty string means "do not persist". */
export function routeDraftStorageKey(scope: RouteDraftScope): string {
  if (!scope.orgId || !scope.viewerKey) return ""
  const head = `${PREFIX}:${encodeURIComponent(scope.orgId)}:${encodeURIComponent(scope.viewerKey)}`
  if (scope.routeId) return `${head}:route:${encodeURIComponent(scope.routeId)}`
  const day = encodeURIComponent(scope.date || "any-date")
  const agent = encodeURIComponent(scope.agentId || "any-agent")
  return `${head}:new:${day}:${agent}`
}

/**
 * Every key that belongs to this planner draft, newest-looking first is NOT
 * assumed: the caller compares `savedAt`. Includes keys written by older
 * versions of this app, which carried customer and contact in the tail — that
 * is how a 15:23 draft could hide behind a 09:43 one.
 */
export function routeDraftStorageKeys(storage: Pick<Storage, "length" | "key">, scope: RouteDraftScope): string[] {
  const exact = routeDraftStorageKey(scope)
  if (!exact) return []
  if (scope.routeId) return [exact]
  const legacyHead = `${exact}:`
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    if (key === exact || key.startsWith(legacyHead)) keys.push(key)
  }
  return keys.length > 0 ? keys : [exact]
}

export type SavedDraft = { savedAt: string }

/**
 * The draft to offer. Anything unparseable is skipped rather than trusted, and
 * an unreadable `savedAt` loses to a readable one instead of winning by
 * accident.
 */
export function latestRouteDraft<T extends SavedDraft>(drafts: readonly (T | null | undefined)[]): T | null {
  let best: T | null = null
  let bestAt = Number.NEGATIVE_INFINITY
  for (const draft of drafts) {
    if (!draft) continue
    const at = new Date(draft.savedAt).getTime()
    if (!Number.isFinite(at)) continue
    if (at > bestAt) {
      best = draft
      bestAt = at
    }
  }
  return best
}
