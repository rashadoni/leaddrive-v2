/**
 * Parts of one page that need the same list read it once.
 *
 * The task table, the task form and the saved-view bar each asked for the organisation's task
 * types, event types and saved views on their own: opening /tasks sent each of those requests
 * twice (prod, 2026-11-13), and every request to the web process waits for its one thread.
 *
 * A read that starts while the same address is still being read joins it. Nothing is kept once
 * the answer arrives — the next read goes to the server — so this is not a cache and nothing
 * can go stale. For that reason it is for the read a component makes when it appears: a
 * re-read after saving something must not join a read that began before the save, and goes
 * through plain `fetch`.
 *
 * Everyone who shares a read gets the same parsed object: treat it as read-only.
 */
export type SharedGet<T> = { ok: boolean; status: number; json: T | null }

const inFlight = new Map<string, Promise<SharedGet<unknown>>>()

export function sharedGetJson<T = unknown>(url: string): Promise<SharedGet<T>> {
  const running = inFlight.get(url)
  if (running) return running as Promise<SharedGet<T>>
  const started: Promise<SharedGet<unknown>> = (async () => {
    const res = await fetch(url, { credentials: "include" })
    const json: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  })().finally(() => {
    if (inFlight.get(url) === started) inFlight.delete(url)
  })
  inFlight.set(url, started)
  return started as Promise<SharedGet<T>>
}

/** How many reads are running — for tests. */
export function sharedGetsInFlight(): number {
  return inFlight.size
}
