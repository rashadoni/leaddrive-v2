/**
 * Loads a list again without painting over edits that are still on their way.
 *
 * An edit is shown on screen at once and sent behind it. A load that started
 * before the edit landed carries the old value; painted while the edit is
 * still out, it would flip the screen back for a moment and then forward
 * again. So while any edit is out a finished load is not shown but
 * remembered, and the last edit to come back loads again — always, when the
 * edit asks for it (the server may have changed more than the screen knows),
 * or only when a load was held back.
 */
export function quietReloader<T>(fetchFresh: () => Promise<T>, show: (fresh: T) => void) {
  let inFlight = 0
  let missed = false

  async function load(): Promise<void> {
    const fresh = await fetchFresh()
    if (inFlight > 0) { missed = true; return }
    missed = false
    show(fresh)
  }

  async function track<R>(work: () => Promise<R>, reloadAfter: boolean): Promise<R> {
    inFlight += 1
    try {
      return await work()
    } finally {
      inFlight -= 1
      if (inFlight === 0 && (reloadAfter || missed)) load().catch(() => {})
    }
  }

  return { load, track }
}
