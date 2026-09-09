/**
 * G (Creatio 10X roadmap — MTM Offline PWA) — client offline outbox.
 *
 * A field agent's visit mutations (check-out, later check-in / survey answers)
 * are queued locally so they survive a dead zone, then flushed to the server's
 * idempotent sync engine when connectivity returns. Each op carries a stable
 * client-generated operationId (the idempotency key), so a retry after a flaky
 * connection can never double-apply.
 *
 * This module splits a PURE, unit-testable queue reducer from a thin IndexedDB
 * persistence adapter (browser-only) — the reducer holds all the logic, the
 * adapter just load/saves the array.
 */

export type OutboxEntity = "visits"
export type OutboxOpType = "create" | "update"
export type OutboxStatus = "pending" | "synced" | "conflict" | "error"

export interface OutboxOp {
  /** Client UUID — the server idempotency key. */
  operationId: string
  entity: OutboxEntity
  op: OutboxOpType
  /** e.g. { kind: "checkout", visitId, checkOutAt, checkOutLat, checkOutLng } */
  data: Record<string, unknown>
  clientTimestamp: string
  status: OutboxStatus
  attempts: number
  lastError?: string
}

export const OUTBOX_MAX = 500
export const OUTBOX_SYNC_BATCH_MAX = 100

/** Create a fresh op (status pending). Uses crypto.randomUUID (browser + node18+). */
export function makeOp(entity: OutboxEntity, op: OutboxOpType, data: Record<string, unknown>): OutboxOp {
  return {
    operationId: (globalThis.crypto?.randomUUID?.() ?? fallbackUuid()),
    entity,
    op,
    data,
    clientTimestamp: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  }
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Append an op, keeping the queue bounded (drop oldest synced first, then oldest). */
export function enqueue(queue: OutboxOp[], op: OutboxOp): OutboxOp[] {
  // De-dupe: an op already queued with the same operationId is not re-added.
  if (queue.some((q) => q.operationId === op.operationId)) return queue
  let next = [...queue, op]
  if (next.length > OUTBOX_MAX) {
    const synced = next.filter((q) => q.status === "synced")
    const drop = Math.min(next.length - OUTBOX_MAX, synced.length)
    if (drop > 0) {
      let dropped = 0
      next = next.filter((q) => !(q.status === "synced" && dropped++ < drop))
    }
    if (next.length > OUTBOX_MAX) next = next.slice(next.length - OUTBOX_MAX)
  }
  return next
}

/** Ops that still need a (re)try — pending or a prior transient error. */
export function pending(queue: OutboxOp[]): OutboxOp[] {
  return queue.filter((q) => q.status === "pending" || q.status === "error")
}

/** Count of ops not yet accepted by the server (for the "N pending" badge). */
export function pendingCount(queue: OutboxOp[]): number {
  return pending(queue).length
}

/**
 * The web sync endpoint accepts at most 100 operations per request. Keep the
 * batching contract beside the pure queue reducer so a full 500-item outbox is
 * drained sequentially instead of becoming a permanently invalid payload.
 */
export function pendingBatches(
  queue: OutboxOp[],
  batchSize = OUTBOX_SYNC_BATCH_MAX,
): OutboxOp[][] {
  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0
    ? Math.min(batchSize, OUTBOX_SYNC_BATCH_MAX)
    : OUTBOX_SYNC_BATCH_MAX
  const operations = pending(queue)
  const batches: OutboxOp[][] = []
  for (let index = 0; index < operations.length; index += safeBatchSize) {
    batches.push(operations.slice(index, index + safeBatchSize))
  }
  return batches
}

/** Apply a server per-op outcome, incrementing attempts. */
export function applyOutcome(
  queue: OutboxOp[],
  operationId: string,
  outcome: { status: "ok" | "conflict" | "error"; error?: string },
): OutboxOp[] {
  const mapped: OutboxStatus = outcome.status === "ok" ? "synced" : outcome.status
  return queue.map((q) =>
    q.operationId === operationId
      ? { ...q, status: mapped, attempts: q.attempts + 1, lastError: outcome.error }
      : q,
  )
}

/** Drop settled ops (synced / conflict — terminal); keep pending + error for retry. */
export function prune(queue: OutboxOp[]): OutboxOp[] {
  return queue.filter((q) => q.status === "pending" || q.status === "error")
}

// ── IndexedDB persistence (browser only) ─────────────────────────────────────

const DB_NAME = "leaddrive-mtm-offline"
const STORE = "outbox"
const KEY = "queue"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadQueue(): Promise<OutboxOp[]> {
  if (typeof indexedDB === "undefined") return []
  try {
    const db = await openDb()
    return await new Promise<OutboxOp[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as OutboxOp[]) : [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveQueue(queue: OutboxOp[]): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(queue, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // best-effort; a failed persist just means the op retries from memory
  }
}
