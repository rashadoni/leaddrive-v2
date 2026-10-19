import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

/**
 * Work that must not run twice at once for one key — one WhatsApp sender, one
 * organization's TikTok leads — without running the connection pool dry.
 *
 * Across processes an advisory lock keeps such work apart. Postgres holds it in
 * a transaction, and that transaction keeps its pooled connection while the
 * work inside it, on the global client, needs another. A delivery waiting for
 * the lock keeps a connection as well. So with as many simultaneous deliveries
 * for one key as the pool has connections, the one holding the lock could not
 * get one more, and nothing moved until the pool timeout: eight messages from
 * one phone took all five connections of the CI pool (#896, 2026-10-18), and
 * the TikTok Lead Ads webhook had the same form twice over.
 *
 * So the work first takes its key's turn in this process, where waiting costs
 * no connection — production runs one process, so this alone keeps it in
 * order — and then one of the caller's slots: at most `holdersPerProcess` of
 * its lock transactions at a time, each keeping one connection, which leaves
 * the pool a connection for the work. Each caller has its own turns and slots,
 * so a slow one (a TikTok delivery waiting for its organization's monitoring
 * fence) holds up only its own kind. The price is that the slots add up: the
 * four callers (WhatsApp intake, TikTok Lead Ads, Meta and TikTok comment
 * webhooks) can keep eight connections, more than the pool of a 2-core server
 * (5). What the caps rule out is one kind's burst running the pool dry; five
 * lock transactions at once still take bursts of three kinds together, two of
 * them each for two organizations (or senders).
 */
export type LockTurns = {
  /** `work` in its key's turn and in one of the caller's slots. */
  run<T>(key: string, work: () => Promise<T>): Promise<T>
}

type TurnState = { keys: Map<string, Promise<void>>; holders: number; waiting: Array<() => void> }
// One state per caller and process even when the bundle copies this module (or
// the caller's) into several route chunks (see rls-context.ts).
const globalForLockTurns = globalThis as unknown as { __lockTurns?: Map<string, TurnState> }
const states: Map<string, TurnState> = (globalForLockTurns.__lockTurns ??= new Map())

export function lockTurns(caller: string, holdersPerProcess: number): LockTurns {
  let state = states.get(caller)
  if (!state) states.set(caller, state = { keys: new Map(), holders: 0, waiting: [] })
  const turns = state
  return {
    run: (key, work) => inTurn(turns, key, () => withSlot(turns, holdersPerProcess, work)),
  }
}

async function inTurn<T>(turns: TurnState, key: string, work: () => Promise<T>): Promise<T> {
  const previous = turns.keys.get(key) ?? Promise.resolve()
  const result = previous.then(work)
  const done = result.then(() => undefined, () => undefined)
  turns.keys.set(key, done)
  try {
    return await result
  } finally {
    if (turns.keys.get(key) === done) turns.keys.delete(key)
  }
}

async function withSlot<T>(turns: TurnState, holdersPerProcess: number, work: () => Promise<T>): Promise<T> {
  if (turns.holders < holdersPerProcess) turns.holders += 1
  else await new Promise<void>((resolve) => turns.waiting.push(resolve))
  try {
    return await work()
  } finally {
    // The slot passes straight to the next one waiting, or is freed.
    const next = turns.waiting.shift()
    if (next) next()
    else turns.holders -= 1
  }
}

/**
 * `work` for the organization while this transaction holds the advisory lock
 * `key`. Run it inside a `LockTurns` turn: the transaction keeps a connection
 * from the moment it opens, waiting for the lock included.
 */
export function withAdvisoryLock<T>(
  organizationId: string,
  key: string,
  work: () => Promise<T>,
  options: { maxWait: number; timeout: number },
): Promise<T> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    // The transaction owns only the lock, held by its connection until commit.
    // Inside it the RLS context is marked in-transaction, which would send the
    // global Prisma calls of `work` out with no tenant at all; runWithTenant
    // gives each of them the tenant on the connection it actually uses.
    return runWithTenant(organizationId, work)
  }, options)
}
