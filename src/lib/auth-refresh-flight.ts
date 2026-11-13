/**
 * Requests that arrive together share one read of the person from the database.
 *
 * Opening a page sends ~35 API requests at once, and each resolved the session with its own
 * read: the person and their company, then their CRM eligibility in a repeatable-read snapshot
 * — three round-trips through Prisma, ~50 ms of waiting and ~12 ms of the web process's only
 * thread per request (CPU profile and benchmark on prod, 2026-11-13: one page load kept that
 * thread busy for ~2 s, a quarter of it in Prisma, most of that this read).
 *
 * A request whose read would start while another request's read of the same person is still
 * running now takes that read's answer. Nothing is kept afterwards: the entry is removed the
 * moment the read settles, so a request that arrives later reads for itself, exactly as before.
 * The answer a request acts on is therefore at most one read old — tens of milliseconds — and a
 * person deactivated, a reviewer closed or a module unticked is still refused on the next request.
 *
 * A failed read fails for everyone who shared it; each of them denies, as a failed read of its
 * own would have made it.
 */
const inFlight = new Map<string, Promise<unknown>>()

/** Runs `read`, or joins the read already running under `key`. */
export function shareSessionRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key)
  if (running) return running as Promise<T>
  const started: Promise<T> = (async () => read())().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key)
  })
  inFlight.set(key, started)
  return started
}

/**
 * Whose read it is: the person, and the identity claims the read is checked against. Two
 * sessions of one person share; the same person with different claims does not.
 */
export function sessionReadKey(token: { sub?: unknown; identityCrm?: unknown }): string {
  return JSON.stringify([token.sub ?? null, token.identityCrm ?? null])
}

/** How many reads are running — for tests. */
export function sessionReadsInFlight(): number {
  return inFlight.size
}
