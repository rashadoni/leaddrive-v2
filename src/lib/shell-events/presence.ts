/**
 * Who has the CRM open right now, per organisation: one entry per live shell
 * events stream that carries `calls` — the tab that would show an incoming
 * call's popup. Owner, 2026-10-27: the AI offers a transfer to a manager only
 * when a manager can answer; at night the pharmacy used to hear 30 s of
 * ringing into an empty office before the AI took the order back.
 *
 * In this process's memory, like the streams themselves: the web process holds
 * every tab's stream and answers the station's calls. A tab whose stream did
 * not come up (it polls instead) is not counted, so in doubt the AI keeps the
 * call rather than ringing nobody.
 */

type Presence = Map<string, Map<string, number>>

const globalForPresence = globalThis as unknown as { __leaddriveShellPresence?: Presence }

function presence(): Presence {
  globalForPresence.__leaddriveShellPresence ??= new Map()
  return globalForPresence.__leaddriveShellPresence
}

/** Count one open tab of this user; the returned function releases it, once. */
export function markShellPresent(orgId: string, userId: string): () => void {
  const orgs = presence()
  const users = orgs.get(orgId) ?? new Map<string, number>()
  orgs.set(orgId, users)
  users.set(userId, (users.get(userId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const current = orgs.get(orgId)
    const tabs = (current?.get(userId) ?? 0) - 1
    if (!current) return
    if (tabs > 0) current.set(userId, tabs)
    else current.delete(userId)
    if (current.size === 0) orgs.delete(orgId)
  }
}

/** The users of this organisation with at least one open tab. */
export function shellPresentUserIds(orgId: string): string[] {
  return [...(presence().get(orgId)?.keys() ?? [])]
}

export function resetShellPresenceForTests() {
  presence().clear()
}
