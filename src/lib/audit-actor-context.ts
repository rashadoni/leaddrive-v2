import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Who, in the office, made the request whose audit rows are being written.
 *
 * Audit 2026-09-21: every MTM journal row made from the web read «? · Система»
 * — `writeMtmAudit` knew the employee an action was about, never the person
 * who acted. Seventy-eight call sites write audit rows; threading a user id
 * through each would miss the seventy-ninth. The route wrappers already know
 * the signed-in user, so they put it here and the writer reads it.
 *
 * Only a browser session is an actor. An API key's creator is an audit field
 * of the key, not the person who sent the request, so it is recorded as null.
 *
 * globalThis for the same reason as `rlsStorage`: Next standalone duplicates
 * this module into route chunks, and each copy must share one storage.
 */
type AuditActor = { userId: string | null }

const globalForAuditActor = globalThis as unknown as { __auditActorStorage?: AsyncLocalStorage<AuditActor> }
const auditActorStorage: AsyncLocalStorage<AuditActor> =
  globalForAuditActor.__auditActorStorage ?? (globalForAuditActor.__auditActorStorage = new AsyncLocalStorage<AuditActor>())

export function runWithAuditActor<T>(
  auth: { userId?: string | null; principalType?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const userId = auth.principalType === "session" && auth.userId ? auth.userId : null
  return auditActorStorage.run({ userId }, fn)
}

/** The signed-in office user behind the current request, or null. */
export function currentAuditActorUserId(): string | null {
  return auditActorStorage.getStore()?.userId ?? null
}
