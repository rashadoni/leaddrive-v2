/**
 * Durable browser outbox for SWM-14 task evidence.
 *
 * IndexedDB keeps the Blob and its stable clientDocumentId together, so a
 * multipart retry after a reload uses the same server idempotency key. The
 * pure helpers stay separate from persistence for deterministic unit tests.
 */

export type TaskDocumentQueueStatus = "queued" | "uploading" | "failed"

export interface QueuedTaskDocument {
  clientDocumentId: string
  taskId: string
  title: string
  fileName: string
  mimeType: string
  sizeBytes: number
  blob: Blob
  queuedAt: string
  updatedAt: string
  attempts: number
  nextAttemptAt: number
  status: TaskDocumentQueueStatus
  lastError?: string
}

export interface TaskDocumentDraft {
  taskId: string
  title?: string
  file: Blob
  fileName: string
  mimeType?: string
}

const DB_NAME = "leaddrive-mtm-task-document-outbox"
const DOCUMENT_STORE = "documents"
const EXECUTION_STORE = "task-execution"
const MAX_RETRY_DELAY_MS = 15 * 60_000
export const TASK_DOCUMENT_UPLOAD_LEASE_MS = 2 * 60_000

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16)
  })
}

export function createTaskDocumentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid()
}

export function createQueuedTaskDocument(
  draft: TaskDocumentDraft,
  options: { clientDocumentId?: string; now?: number } = {},
): QueuedTaskDocument {
  const now = options.now ?? Date.now()
  const timestamp = new Date(now).toISOString()
  return {
    clientDocumentId: options.clientDocumentId ?? createTaskDocumentId(),
    taskId: draft.taskId,
    title: draft.title?.trim() ?? "",
    fileName: draft.fileName,
    mimeType: draft.mimeType || draft.file.type || "application/octet-stream",
    sizeBytes: draft.file.size,
    blob: draft.file,
    queuedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    nextAttemptAt: now,
    status: "queued",
  }
}

export function taskDocumentRetryDelay(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts))
  return Math.min(MAX_RETRY_DELAY_MS, 2 ** safeAttempts * 1_000)
}

export function taskDocumentsReadyForUpload(
  entries: QueuedTaskDocument[],
  now = Date.now(),
): QueuedTaskDocument[] {
  return entries
    .filter((entry) => {
      if (entry.nextAttemptAt > now) return false
      if (entry.status !== "uploading") return true
      const updatedAt = new Date(entry.updatedAt).getTime()
      return Number.isNaN(updatedAt) || now - updatedAt >= TASK_DOCUMENT_UPLOAD_LEASE_MS
    })
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
}

export function markTaskDocumentUploading(
  entry: QueuedTaskDocument,
  now = Date.now(),
): QueuedTaskDocument {
  return {
    ...entry,
    status: "uploading",
    updatedAt: new Date(now).toISOString(),
    lastError: undefined,
  }
}

export function markTaskDocumentFailed(
  entry: QueuedTaskDocument,
  error: string,
  now = Date.now(),
): QueuedTaskDocument {
  const attempts = entry.attempts + 1
  return {
    ...entry,
    attempts,
    status: "failed",
    lastError: error,
    nextAttemptAt: now + taskDocumentRetryDelay(attempts),
    updatedAt: new Date(now).toISOString(),
  }
}

export function retryTaskDocumentNow(
  entry: QueuedTaskDocument,
  now = Date.now(),
): QueuedTaskDocument {
  return {
    ...entry,
    status: "queued",
    nextAttemptAt: now,
    updatedAt: new Date(now).toISOString(),
    lastError: undefined,
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: "clientDocumentId" })
        store.createIndex("taskId", "taskId", { unique: false })
      }
      if (!database.objectStoreNames.contains(EXECUTION_STORE)) {
        database.createObjectStore(EXECUTION_STORE, { keyPath: "taskId" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function persist(entry: QueuedTaskDocument): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
  const database = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORE, "readwrite")
    transaction.objectStore(DOCUMENT_STORE).put(entry)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
}

export async function enqueueTaskDocument(draft: TaskDocumentDraft): Promise<QueuedTaskDocument> {
  const entry = createQueuedTaskDocument(draft)
  await persist(entry)
  return entry
}

export async function listTaskDocuments(taskId?: string): Promise<QueuedTaskDocument[]> {
  if (typeof indexedDB === "undefined") return []
  try {
    const database = await openDb()
    const entries = await new Promise<QueuedTaskDocument[]>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENT_STORE, "readonly")
      const store = transaction.objectStore(DOCUMENT_STORE)
      const request = taskId ? store.index("taskId").getAll(taskId) : store.getAll()
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as QueuedTaskDocument[] : [])
      request.onerror = () => reject(request.error)
    })
    database.close()
    return entries.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
  } catch {
    return []
  }
}

export async function updateQueuedTaskDocument(entry: QueuedTaskDocument): Promise<boolean> {
  try {
    await persist(entry)
    return true
  } catch {
    return false
  }
}

export async function removeQueuedTaskDocument(clientDocumentId: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false
  try {
    const database = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENT_STORE, "readwrite")
      transaction.objectStore(DOCUMENT_STORE).delete(clientDocumentId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    return true
  } catch {
    return false
  }
}

// ── Task execution outbox ──────────────────────────────────────────────────

export type TaskExecutionQueueStatus = "pending" | "error" | "conflict"

export interface QueuedTaskExecution {
  operationId: string
  taskId: string
  expectedVersion: number
  data: {
    id: string
    expectedVersion: number
    status?: string
    progress?: number
    result?: string | null
  }
  clientTimestamp: string
  updatedAt: string
  attempts: number
  status: TaskExecutionQueueStatus
  lastError?: string
  serverData?: unknown
}

export function createQueuedTaskExecution(input: {
  taskId: string
  expectedVersion: number
  status?: string
  progress?: number
  result?: string | null
}, options: { operationId?: string; now?: number } = {}): QueuedTaskExecution {
  const now = options.now ?? Date.now()
  const timestamp = new Date(now).toISOString()
  return {
    operationId: options.operationId ?? createTaskDocumentId(),
    taskId: input.taskId,
    expectedVersion: input.expectedVersion,
    data: {
      id: input.taskId,
      expectedVersion: input.expectedVersion,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
    },
    clientTimestamp: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    status: "pending",
  }
}

/**
 * A task keeps one final desired execution state while offline. Repeated
 * progress/result edits merge into the existing operation and retain both the
 * original expectedVersion and operationId, so a flaky replay stays idempotent.
 */
export function mergeQueuedTaskExecution(
  current: QueuedTaskExecution | null,
  input: Parameters<typeof createQueuedTaskExecution>[0],
  now = Date.now(),
): QueuedTaskExecution {
  if (!current) {
    return createQueuedTaskExecution(input, { now })
  }
  // An error or still-unresolved version may represent a lost response after
  // a successful server commit. Keep the exact operation id and facts until
  // retry/discard. A definitive conflict may mint a new operation only after
  // the caller has reloaded a different server version.
  if (current.status === "error") return current
  if (current.status === "conflict") {
    return current.expectedVersion === input.expectedVersion
      ? current
      : createQueuedTaskExecution(input, { now })
  }
  if (current.expectedVersion !== input.expectedVersion) return current
  return {
    ...current,
    data: {
      ...current.data,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
    },
    status: "pending",
    lastError: undefined,
    serverData: undefined,
    updatedAt: new Date(now).toISOString(),
  }
}

export function applyTaskExecutionOutcome(
  entry: QueuedTaskExecution,
  outcome: { status: "ok" | "error" | "conflict"; error?: string; serverData?: unknown },
  now = Date.now(),
): QueuedTaskExecution | null {
  if (outcome.status === "ok") return null
  return {
    ...entry,
    status: outcome.status,
    attempts: entry.attempts + 1,
    lastError: outcome.error,
    serverData: outcome.serverData,
    updatedAt: new Date(now).toISOString(),
  }
}

export async function loadTaskExecution(taskId: string): Promise<QueuedTaskExecution | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    const database = await openDb()
    const entry = await new Promise<QueuedTaskExecution | null>((resolve, reject) => {
      const transaction = database.transaction(EXECUTION_STORE, "readonly")
      const request = transaction.objectStore(EXECUTION_STORE).get(taskId)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return entry
  } catch {
    return null
  }
}

export async function saveTaskExecution(entry: QueuedTaskExecution): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
  const database = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(EXECUTION_STORE, "readwrite")
    transaction.objectStore(EXECUTION_STORE).put(entry)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
}

export async function removeTaskExecution(taskId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const database = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(EXECUTION_STORE, "readwrite")
      transaction.objectStore(EXECUTION_STORE).delete(taskId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  } catch {
    // A later explicit discard can retry.
  }
}
