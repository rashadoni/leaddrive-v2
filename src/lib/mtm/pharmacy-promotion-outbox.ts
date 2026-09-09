/**
 * Durable browser outbox for SWM-09 pharmacy-promotion execution requests.
 *
 * Each operation stores a canonical JSON snapshot instead of a mutable payload;
 * evidence operations additionally keep the immutable Blob in IndexedDB. A
 * retry therefore reuses the exact operationId, clientExecutionId and request
 * body that may already have reached the server. IndexedDB is deliberately
 * kept behind a small adapter so queue and flush behaviour can be tested
 * without a browser.
 */

import { normalizePharmacyPromotionDecimal18_4 } from "@/lib/mtm/pharmacy-promotion-decimal"

export type PharmacyPromotionOutboxKind = "DRAFT" | "EVIDENCE" | "SUBMIT"
export type PharmacyPromotionOutboxStatus = "pending" | "syncing" | "error" | "conflict"

export interface PharmacyPromotionDraftPayload {
  targetId: string
  supersedesExecutionId?: string
  clientExecutionId: string
  operationId: string
  visitId?: string | null
  factQuantity: string
  unit: string
  expectedVersion?: number
  clientOccurredAt: string
}

export interface PharmacyPromotionSubmitPayload {
  operationId: string
  expectedVersion: number
}

export interface PharmacyPromotionEvidencePayload {
  clientEvidenceId: string
  clientDocumentId: string
  operationId: string
  capturedAt: string
  checksumSha256: string
  fileName: string
  mimeType: string
  sizeBytes: number
  title?: string
}

export interface PharmacyPromotionDraftInput {
  targetId: string
  supersedesExecutionId?: string
  visitId?: string | null
  factQuantity: string | number
  unit: string
  expectedVersion?: number
  clientOccurredAt?: string
}

export interface PharmacyPromotionSubmitInput {
  clientExecutionId: string
  expectedVersion: number
}

export interface PharmacyPromotionEvidenceInput {
  clientExecutionId: string
  clientEvidenceId: string
  clientDocumentId: string
  capturedAt: string
  checksumSha256: string
  fileName: string
  title?: string
  file: Blob
}

export interface PharmacyPromotionOutboxEntry {
  /** Opaque server-derived organization/principal partition. */
  scopeKey: string
  operationId: string
  clientExecutionId: string
  kind: PharmacyPromotionOutboxKind
  /** Canonical and immutable request-body snapshot. */
  payloadJson: string
  /** Structured-clone-safe binary body, present only for EVIDENCE. */
  binary?: Blob
  queuedAt: string
  updatedAt: string
  attempts: number
  nextAttemptAt: number
  status: PharmacyPromotionOutboxStatus
  leaseStartedAt?: number
  lastError?: string
  serverData?: unknown
}

export interface PharmacyPromotionOutboxRequest {
  operationId: string
  clientExecutionId: string
  kind: PharmacyPromotionOutboxKind
  payload: PharmacyPromotionDraftPayload | PharmacyPromotionEvidencePayload | PharmacyPromotionSubmitPayload
  binary?: Blob
}

export interface PharmacyPromotionServerOutcome {
  operationId: string
  status: "ok" | "error" | "conflict"
  error?: string
  serverData?: unknown
}

export interface PharmacyPromotionOutcomeApplication {
  entries: PharmacyPromotionOutboxEntry[]
  acceptedOperationIds: string[]
  errorOperationIds: string[]
  conflictOperationIds: string[]
}

export interface PharmacyPromotionOutboxStore {
  list(scopeKey: string): Promise<PharmacyPromotionOutboxEntry[]>
  put(entries: readonly PharmacyPromotionOutboxEntry[]): Promise<void>
  remove(scopeKey: string, operationIds: readonly string[]): Promise<void>
}

export interface PharmacyPromotionFlushCoordinator {
  run<T>(work: () => Promise<T>): Promise<T>
  isRunning(): boolean
}

export interface PharmacyPromotionFlushSummary {
  batches: number
  attempted: number
  accepted: number
  errors: number
  conflicts: number
}

type PharmacyPromotionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export const PHARMACY_PROMOTION_OUTBOX_BATCH_MAX = 100
export const PHARMACY_PROMOTION_OUTBOX_LEASE_MS = 2 * 60_000
export const PHARMACY_PROMOTION_OUTBOX_RETRY_MAX_MS = 15 * 60_000

const DB_NAME = "leaddrive-mtm-pharmacy-promotion-outbox"
const STORE_NAME = "operations"
const TARGET_CACHE_STORE_NAME = "targetAssignments"
const DB_VERSION = 4

export type PharmacyPromotionTargetCache = {
  targets: unknown[]
  updatedAt: string
}

type PharmacyPromotionTargetCacheRecord = {
  scopeKey: string
  payloadJson: string
  updatedAt: string
}

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16)
  })
}

export function createPharmacyPromotionOutboxId(): string {
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid()
}

function createPharmacyPromotionClientExecutionId(): string {
  return `ppx_${createPharmacyPromotionOutboxId()}`
}

function requiredText(
  value: string,
  field: string,
  limits: { minimum?: number; maximum?: number } = {},
): string {
  const normalized = value.trim()
  const minimum = limits.minimum ?? 1
  if (normalized.length < minimum) {
    throw new Error(`${field} must contain at least ${minimum} characters`)
  }
  if (limits.maximum !== undefined && normalized.length > limits.maximum) {
    throw new Error(`${field} must contain at most ${limits.maximum} characters`)
  }
  return normalized
}

function expectedVersion(value: number, field: string, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${field} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function initialExpectedVersion(value: number): 0 {
  if (value !== 0) throw new Error("expectedVersion must equal 0 for a draft create")
  return 0
}

function decimalValue(value: string | number): string {
  const normalized = normalizePharmacyPromotionDecimal18_4(value)
  if (normalized === null) {
    throw new Error("factQuantity must be a non-negative DECIMAL(18,4) value")
  }
  return normalized
}

function isoDate(value: string, field: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${field} must be a valid date-time`)
  return timestamp.toISOString()
}

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain a non-finite number")
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("Canonical JSON cannot contain cycles")
    ancestors.add(value)
    const result = value.map((item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") return null
      return canonicalValue(item, ancestors)
    })
    ancestors.delete(value)
    return result
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("Canonical JSON cannot contain cycles")
    ancestors.add(value)
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue
      result[key] = canonicalValue(item, ancestors)
    }
    ancestors.delete(value)
    return result
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`)
}

export function canonicalPharmacyPromotionPayload(value: unknown): string {
  const serialized = JSON.stringify(canonicalValue(value, new Set()))
  if (serialized === undefined) throw new Error("Canonical payload must be JSON-serializable")
  return serialized
}

function freezeEntry(entry: PharmacyPromotionOutboxEntry): PharmacyPromotionOutboxEntry {
  return Object.freeze(entry)
}

function sameImmutableOperation(
  left: PharmacyPromotionOutboxEntry,
  right: PharmacyPromotionOutboxEntry,
): boolean {
  return left.scopeKey === right.scopeKey
    && left.operationId === right.operationId
    && left.clientExecutionId === right.clientExecutionId
    && left.kind === right.kind
    && left.payloadJson === right.payloadJson
    && (left.binary?.size ?? null) === (right.binary?.size ?? null)
    && (left.binary?.type ?? null) === (right.binary?.type ?? null)
    && left.queuedAt === right.queuedAt
}

function immutableOperationError(): Error {
  return new Error("operationId cannot be reused with a different pharmacy-promotion payload")
}

export function createPharmacyPromotionDraftOperation(
  input: PharmacyPromotionDraftInput,
  options: { scopeKey: string; operationId?: string; clientExecutionId?: string; now?: number },
): PharmacyPromotionOutboxEntry {
  const now = options.now ?? Date.now()
  const timestamp = new Date(now).toISOString()
  const operationId = requiredText(
    options.operationId ?? createPharmacyPromotionOutboxId(),
    "operationId",
    { minimum: 8, maximum: 128 },
  )
  const scopeKey = requiredText(options.scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const clientExecutionId = requiredText(
    options.clientExecutionId ?? createPharmacyPromotionClientExecutionId(),
    "clientExecutionId",
    { minimum: 8, maximum: 128 },
  )
  const payload: PharmacyPromotionDraftPayload = {
    targetId: requiredText(input.targetId, "targetId", { maximum: 128 }),
    ...(input.supersedesExecutionId !== undefined
      ? {
          supersedesExecutionId: requiredText(
            input.supersedesExecutionId,
            "supersedesExecutionId",
            { maximum: 128 },
          ),
        }
      : {}),
    clientExecutionId,
    operationId,
    ...(input.visitId !== undefined
      ? {
          visitId: input.visitId === null
            ? null
            : requiredText(input.visitId, "visitId", { maximum: 128 }),
        }
      : {}),
    factQuantity: decimalValue(input.factQuantity),
    unit: requiredText(input.unit, "unit", { maximum: 40 }),
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: initialExpectedVersion(input.expectedVersion) }
      : {}),
    clientOccurredAt: input.clientOccurredAt !== undefined
      ? isoDate(input.clientOccurredAt, "clientOccurredAt")
      : timestamp,
  }

  return freezeEntry({
    scopeKey,
    operationId,
    clientExecutionId,
    kind: "DRAFT",
    payloadJson: canonicalPharmacyPromotionPayload(payload),
    queuedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    nextAttemptAt: now,
    status: "pending",
  })
}

export function createPharmacyPromotionSubmitOperation(
  input: PharmacyPromotionSubmitInput,
  options: { scopeKey: string; operationId?: string; now?: number },
): PharmacyPromotionOutboxEntry {
  const now = options.now ?? Date.now()
  const timestamp = new Date(now).toISOString()
  const operationId = requiredText(
    options.operationId ?? createPharmacyPromotionOutboxId(),
    "operationId",
    { minimum: 8, maximum: 128 },
  )
  const scopeKey = requiredText(options.scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const clientExecutionId = requiredText(input.clientExecutionId, "clientExecutionId", {
    minimum: 8,
    maximum: 128,
  })
  const payload: PharmacyPromotionSubmitPayload = {
    operationId,
    expectedVersion: expectedVersion(input.expectedVersion, "expectedVersion", 1),
  }

  return freezeEntry({
    scopeKey,
    operationId,
    clientExecutionId,
    kind: "SUBMIT",
    payloadJson: canonicalPharmacyPromotionPayload(payload),
    queuedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    nextAttemptAt: now,
    status: "pending",
  })
}

export function createPharmacyPromotionEvidenceOperation(
  input: PharmacyPromotionEvidenceInput,
  options: { scopeKey: string; operationId?: string; now?: number },
): PharmacyPromotionOutboxEntry {
  const now = options.now ?? Date.now()
  const timestamp = new Date(now).toISOString()
  const operationId = requiredText(
    options.operationId ?? createPharmacyPromotionOutboxId(),
    "operationId",
    { minimum: 8, maximum: 128 },
  )
  const scopeKey = requiredText(options.scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const clientExecutionId = requiredText(input.clientExecutionId, "clientExecutionId", {
    minimum: 8,
    maximum: 128,
  })
  if (!(input.file instanceof Blob) || input.file.size < 1 || input.file.size > 25 * 1024 * 1024) {
    throw new Error("evidence file must contain 1 byte to 25 MB")
  }
  const checksumSha256 = requiredText(input.checksumSha256.toLowerCase(), "checksumSha256", {
    minimum: 64,
    maximum: 64,
  })
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) {
    throw new Error("checksumSha256 must be a lowercase SHA-256 digest")
  }
  const title = input.title?.trim()
  if (title && title.length > 200) throw new Error("title must contain at most 200 characters")
  const payload: PharmacyPromotionEvidencePayload = {
    clientEvidenceId: requiredText(input.clientEvidenceId, "clientEvidenceId", { minimum: 8, maximum: 128 }),
    clientDocumentId: requiredText(input.clientDocumentId, "clientDocumentId", { minimum: 8, maximum: 128 }),
    operationId,
    capturedAt: isoDate(input.capturedAt, "capturedAt"),
    checksumSha256,
    fileName: requiredText(input.fileName, "fileName", { maximum: 255 }),
    mimeType: input.file.type.trim().slice(0, 255) || "application/octet-stream",
    sizeBytes: input.file.size,
    ...(title ? { title } : {}),
  }

  return freezeEntry({
    scopeKey,
    operationId,
    clientExecutionId,
    kind: "EVIDENCE",
    payloadJson: canonicalPharmacyPromotionPayload(payload),
    binary: input.file,
    queuedAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    nextAttemptAt: now,
    status: "pending",
  })
}

export function pharmacyPromotionOutboxPayload(
  entry: PharmacyPromotionOutboxEntry,
): PharmacyPromotionDraftPayload | PharmacyPromotionEvidencePayload | PharmacyPromotionSubmitPayload {
  return JSON.parse(entry.payloadJson) as PharmacyPromotionDraftPayload | PharmacyPromotionEvidencePayload | PharmacyPromotionSubmitPayload
}

export function pharmacyPromotionOutboxRequest(
  entry: PharmacyPromotionOutboxEntry,
): PharmacyPromotionOutboxRequest {
  return Object.freeze({
    operationId: entry.operationId,
    clientExecutionId: entry.clientExecutionId,
    kind: entry.kind,
    payload: pharmacyPromotionOutboxPayload(entry),
    ...(entry.binary ? { binary: entry.binary } : {}),
  })
}

function serverErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const code = (payload as { code?: unknown }).code
  return typeof code === "string" && code.trim().length > 0 ? code : undefined
}

function acceptedExecutionResponse(payload: unknown): payload is {
  success: true
  data: { id: string }
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const candidate = payload as { success?: unknown; data?: unknown }
  if (candidate.success !== true || !candidate.data || typeof candidate.data !== "object") return false
  const id = (candidate.data as { id?: unknown }).id
  return typeof id === "string" && id.trim().length > 0 && id.length <= 128
}

/**
 * Production transport for the durable browser outbox. JSON mutations and
 * multipart evidence share the same ordered retry lane. A queued draft is
 * accepted before its submit operation, while evidence reuses its immutable
 * binary and server-idempotent identity after connectivity returns.
 */
export async function sendPharmacyPromotionOutboxRequests(
  requests: readonly PharmacyPromotionOutboxRequest[],
  fetcher: PharmacyPromotionFetch = globalThis.fetch.bind(globalThis),
  options: { signal?: AbortSignal } = {},
): Promise<PharmacyPromotionServerOutcome[]> {
  const outcomes: PharmacyPromotionServerOutcome[] = []
  const draftOutcomes = new Map<string, PharmacyPromotionServerOutcome>()
  const batchDrafts = new Set(
    requests.filter((request) => request.kind === "DRAFT").map((request) => request.clientExecutionId),
  )

  for (const request of requests) {
    if (options.signal?.aborted) throw new DOMException("Outbox sync aborted", "AbortError")
    const dependency = request.kind === "SUBMIT"
      ? draftOutcomes.get(request.clientExecutionId)
      : undefined
    if (request.kind === "SUBMIT" && batchDrafts.has(request.clientExecutionId) && !dependency) {
      outcomes.push({
        operationId: request.operationId,
        status: "error",
        error: "MTM_PHARMACY_SYNC_DRAFT_NOT_PROCESSED",
      })
      continue
    }
    if (dependency && dependency.status !== "ok") {
      outcomes.push({
        operationId: request.operationId,
        status: dependency.status === "conflict" ? "conflict" : "error",
        error: dependency.status === "conflict"
          ? "MTM_PHARMACY_SYNC_DRAFT_CONFLICT"
          : "MTM_PHARMACY_SYNC_DRAFT_FAILED",
        serverData: { dependencyOperationId: dependency.operationId },
      })
      continue
    }
    const record = (outcome: PharmacyPromotionServerOutcome) => {
      outcomes.push(outcome)
      if (request.kind === "DRAFT") draftOutcomes.set(request.clientExecutionId, outcome)
    }
    const url = request.kind === "DRAFT"
      ? "/api/v1/mtm/pharmacy-promotion-executions"
      : request.kind === "EVIDENCE"
        ? `/api/v1/mtm/pharmacy-promotion-executions/${encodeURIComponent(request.clientExecutionId)}/evidence`
        : `/api/v1/mtm/pharmacy-promotion-executions/${encodeURIComponent(request.clientExecutionId)}/submit`
    try {
      let init: RequestInit
      if (request.kind === "EVIDENCE") {
        const payload = request.payload as PharmacyPromotionEvidencePayload
        if (!request.binary || request.binary.size !== payload.sizeBytes) {
          record({
            operationId: request.operationId,
            status: "conflict",
            error: "MTM_PHARMACY_EVIDENCE_BINARY_MISSING",
          })
          continue
        }
        const formData = new FormData()
        formData.set("file", request.binary, payload.fileName)
        formData.set("clientEvidenceId", payload.clientEvidenceId)
        formData.set("clientDocumentId", payload.clientDocumentId)
        formData.set("operationId", payload.operationId)
        formData.set("capturedAt", payload.capturedAt)
        formData.set("checksumSha256", payload.checksumSha256)
        if (payload.title) formData.set("title", payload.title)
        init = { method: "POST", body: formData, signal: options.signal }
      } else {
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: canonicalPharmacyPromotionPayload(request.payload),
          signal: options.signal,
        }
      }
      const response = await fetcher(url, init)
      const payload: unknown = await response.json().catch(() => null)
      if (options.signal?.aborted) throw new DOMException("Outbox sync aborted", "AbortError")
      if (response.ok && acceptedExecutionResponse(payload)) {
        record({
          operationId: request.operationId,
          status: "ok",
          serverData: payload,
        })
        continue
      }

      if (response.ok) {
        record({
          operationId: request.operationId,
          status: "error",
          error: "MTM_PHARMACY_SYNC_RESPONSE_INVALID",
          serverData: payload,
        })
        continue
      }

      const code = serverErrorCode(payload) ?? `MTM_PHARMACY_SYNC_HTTP_${response.status}`
      const terminalClientFailure = response.status >= 400
        && response.status < 500
        && response.status !== 401
        && response.status !== 403
        && response.status !== 429
      record({
        operationId: request.operationId,
        status: terminalClientFailure ? "conflict" : "error",
        error: code,
        serverData: payload,
      })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw error
      }
      record({
        operationId: request.operationId,
        status: "error",
        error: error instanceof Error && error.message
          ? error.message
          : "MTM_PHARMACY_SYNC_REQUEST_FAILED",
      })
    }
  }

  return outcomes
}

/**
 * De-duplicate exact retries and reject idempotency-key reuse with changed
 * facts. A changed draft must be represented by a newly minted operation.
 */
export function enqueuePharmacyPromotionOperation(
  entries: readonly PharmacyPromotionOutboxEntry[],
  entry: PharmacyPromotionOutboxEntry,
): PharmacyPromotionOutboxEntry[] {
  const existing = entries.find((candidate) => (
    candidate.scopeKey === entry.scopeKey && candidate.operationId === entry.operationId
  ))
  if (!existing) return [...entries, entry]
  if (!sameImmutableOperation(existing, entry)) throw immutableOperationError()
  return [...entries]
}

export function pharmacyPromotionRetryDelay(attempts: number): number {
  const safeAttempts = Number.isFinite(attempts)
    ? Math.max(1, Math.floor(attempts))
    : 1
  return Math.min(PHARMACY_PROMOTION_OUTBOX_RETRY_MAX_MS, 2 ** safeAttempts * 1_000)
}

function leaseStartedAt(entry: PharmacyPromotionOutboxEntry): number {
  if (typeof entry.leaseStartedAt === "number" && Number.isFinite(entry.leaseStartedAt)) {
    return entry.leaseStartedAt
  }
  const updatedAt = new Date(entry.updatedAt).getTime()
  return Number.isNaN(updatedAt) ? Number.NEGATIVE_INFINITY : updatedAt
}

function operationIsDue(entry: PharmacyPromotionOutboxEntry, now: number): boolean {
  if (entry.status === "conflict" || entry.nextAttemptAt > now) return false
  if (entry.status !== "syncing") return true
  return now - leaseStartedAt(entry) >= PHARMACY_PROMOTION_OUTBOX_LEASE_MS
}

export function pharmacyPromotionOperationsReady(
  entries: readonly PharmacyPromotionOutboxEntry[],
  now = Date.now(),
): PharmacyPromotionOutboxEntry[] {
  const draftByExecution = new Map<string, PharmacyPromotionOutboxEntry>()
  for (const entry of entries) {
    if (entry.kind === "DRAFT") draftByExecution.set(entry.clientExecutionId, entry)
  }
  const ready = entries
    .filter((entry) => {
      if (!operationIsDue(entry, now)) return false
      if (entry.kind !== "SUBMIT") return true
      const draft = draftByExecution.get(entry.clientExecutionId)
      return !draft || operationIsDue(draft, now)
    })
  const dueDraftByExecution = new Map(
    ready
      .filter((entry) => entry.kind === "DRAFT")
      .map((entry) => [entry.clientExecutionId, entry] as const),
  )

  const sorted = ready.sort((left, right) => {
    const timestampOrder = left.queuedAt.localeCompare(right.queuedAt)
    return timestampOrder === 0
      ? left.operationId.localeCompare(right.operationId)
      : timestampOrder
  })
  const dependentSubmits = new Map<string, PharmacyPromotionOutboxEntry[]>()
  for (const entry of sorted) {
    if (entry.kind !== "SUBMIT" || !dueDraftByExecution.has(entry.clientExecutionId)) continue
    const current = dependentSubmits.get(entry.clientExecutionId) ?? []
    current.push(entry)
    dependentSubmits.set(entry.clientExecutionId, current)
  }
  const ordered: PharmacyPromotionOutboxEntry[] = []
  for (const entry of sorted) {
    if (entry.kind === "SUBMIT" && dueDraftByExecution.has(entry.clientExecutionId)) continue
    ordered.push(entry)
    if (entry.kind === "DRAFT" && dueDraftByExecution.get(entry.clientExecutionId) === entry) {
      ordered.push(...(dependentSubmits.get(entry.clientExecutionId) ?? []))
    }
  }
  return ordered
}

export function pharmacyPromotionOperationBatches(
  entries: readonly PharmacyPromotionOutboxEntry[],
  now = Date.now(),
  batchSize = PHARMACY_PROMOTION_OUTBOX_BATCH_MAX,
): PharmacyPromotionOutboxEntry[][] {
  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0
    ? Math.min(batchSize, PHARMACY_PROMOTION_OUTBOX_BATCH_MAX)
    : PHARMACY_PROMOTION_OUTBOX_BATCH_MAX
  const ready = pharmacyPromotionOperationsReady(entries, now)
  const batches: PharmacyPromotionOutboxEntry[][] = []
  for (let index = 0; index < ready.length; index += safeBatchSize) {
    batches.push(ready.slice(index, index + safeBatchSize))
  }
  return batches
}

export function markPharmacyPromotionOperationsSyncing(
  entries: readonly PharmacyPromotionOutboxEntry[],
  operationIds: readonly string[],
  now = Date.now(),
): PharmacyPromotionOutboxEntry[] {
  const selected = new Set(operationIds)
  const timestamp = new Date(now).toISOString()
  return entries.map((entry) => {
    if (!selected.has(entry.operationId) || !operationIsDue(entry, now)) return entry
    return freezeEntry({
      ...entry,
      status: "syncing",
      leaseStartedAt: now,
      updatedAt: timestamp,
      lastError: undefined,
      serverData: undefined,
    })
  })
}

function failedOperation(
  entry: PharmacyPromotionOutboxEntry,
  error: string,
  serverData: unknown,
  now: number,
): PharmacyPromotionOutboxEntry {
  const attempts = entry.attempts + 1
  return freezeEntry({
    ...entry,
    status: "error",
    attempts,
    nextAttemptAt: now + pharmacyPromotionRetryDelay(attempts),
    leaseStartedAt: undefined,
    lastError: error,
    serverData,
    updatedAt: new Date(now).toISOString(),
  })
}

function conflictedOperation(
  entry: PharmacyPromotionOutboxEntry,
  outcome: PharmacyPromotionServerOutcome,
  now: number,
): PharmacyPromotionOutboxEntry {
  return freezeEntry({
    ...entry,
    status: "conflict",
    attempts: entry.attempts + 1,
    leaseStartedAt: undefined,
    lastError: outcome.error ?? "MTM_PHARMACY_SYNC_CONFLICT",
    serverData: outcome.serverData,
    updatedAt: new Date(now).toISOString(),
  })
}

/**
 * Apply one and only one server result to every claimed operation. Missing,
 * duplicate, or malformed outcomes are transient errors and retain the exact
 * canonical request for retry. Conflicts are terminal until explicitly
 * resolved by creating a new operation.
 */
export function applyPharmacyPromotionServerOutcomes(
  entries: readonly PharmacyPromotionOutboxEntry[],
  claimedOperationIds: readonly string[],
  outcomes: readonly PharmacyPromotionServerOutcome[],
  now = Date.now(),
): PharmacyPromotionOutcomeApplication {
  const claimed = new Set(claimedOperationIds)
  const outcomesByOperation = new Map<string, PharmacyPromotionServerOutcome[]>()
  for (const outcome of outcomes) {
    const current = outcomesByOperation.get(outcome.operationId) ?? []
    current.push(outcome)
    outcomesByOperation.set(outcome.operationId, current)
  }

  const acceptedOperationIds: string[] = []
  const errorOperationIds: string[] = []
  const conflictOperationIds: string[] = []
  const nextEntries: PharmacyPromotionOutboxEntry[] = []

  for (const entry of entries) {
    if (!claimed.has(entry.operationId)) {
      nextEntries.push(entry)
      continue
    }

    const matching = outcomesByOperation.get(entry.operationId) ?? []
    if (matching.length !== 1) {
      const error = matching.length === 0
        ? "MTM_PHARMACY_SYNC_OUTCOME_MISSING"
        : "MTM_PHARMACY_SYNC_OUTCOME_AMBIGUOUS"
      nextEntries.push(failedOperation(entry, error, undefined, now))
      errorOperationIds.push(entry.operationId)
      continue
    }

    const outcome = matching[0]
    if (outcome.status === "ok") {
      acceptedOperationIds.push(entry.operationId)
      continue
    }
    if (outcome.status === "conflict") {
      nextEntries.push(conflictedOperation(entry, outcome, now))
      conflictOperationIds.push(entry.operationId)
      continue
    }
    if (outcome.status === "error") {
      nextEntries.push(failedOperation(
        entry,
        outcome.error ?? "MTM_PHARMACY_SYNC_FAILED",
        outcome.serverData,
        now,
      ))
      errorOperationIds.push(entry.operationId)
      continue
    }

    nextEntries.push(failedOperation(entry, "MTM_PHARMACY_SYNC_OUTCOME_INVALID", outcome, now))
    errorOperationIds.push(entry.operationId)
  }

  return {
    entries: nextEntries,
    acceptedOperationIds,
    errorOperationIds,
    conflictOperationIds,
  }
}

export function retryPharmacyPromotionOperationNow(
  entry: PharmacyPromotionOutboxEntry,
  now = Date.now(),
): PharmacyPromotionOutboxEntry {
  if (entry.status !== "error") return entry
  return freezeEntry({
    ...entry,
    status: "pending",
    nextAttemptAt: now,
    leaseStartedAt: undefined,
    lastError: undefined,
    serverData: undefined,
    updatedAt: new Date(now).toISOString(),
  })
}

export function createPharmacyPromotionFlushCoordinator(): PharmacyPromotionFlushCoordinator {
  let active: Promise<unknown> | null = null
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      if (active) return active as Promise<T>
      const current = Promise.resolve().then(work)
      active = current
      void current.then(
        () => {
          if (active === current) active = null
        },
        () => {
          if (active === current) active = null
        },
      )
      return current
    },
    isRunning(): boolean {
      return active !== null
    },
  }
}

function createOutboxIndexes(store: IDBObjectStore) {
  if (!store.indexNames.contains("clientExecutionId")) {
    store.createIndex("clientExecutionId", "clientExecutionId", { unique: false })
  }
  if (!store.indexNames.contains("status")) {
    store.createIndex("status", "status", { unique: false })
  }
  if (!store.indexNames.contains("scopeKey")) {
    store.createIndex("scopeKey", "scopeKey", { unique: false })
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TARGET_CACHE_STORE_NAME)) {
        database.createObjectStore(TARGET_CACHE_STORE_NAME, { keyPath: "scopeKey" })
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        createOutboxIndexes(database.createObjectStore(STORE_NAME, {
          keyPath: ["scopeKey", "operationId"],
        }))
        return
      }
      const legacyStore = request.transaction!.objectStore(STORE_NAME)
      const keyPath = legacyStore.keyPath
      const compoundKey = Array.isArray(keyPath)
        && keyPath.length === 2
        && keyPath[0] === "scopeKey"
        && keyPath[1] === "operationId"
      if (compoundKey) {
        createOutboxIndexes(legacyStore)
        return
      }
      const legacyEntriesRequest = legacyStore.getAll()
      legacyEntriesRequest.onsuccess = () => {
        const legacyEntries = (legacyEntriesRequest.result as PharmacyPromotionOutboxEntry[])
          .filter((entry) => typeof entry.scopeKey === "string" && entry.scopeKey.length >= 16)
        database.deleteObjectStore(STORE_NAME)
        const scopedStore = database.createObjectStore(STORE_NAME, {
          keyPath: ["scopeKey", "operationId"],
        })
        createOutboxIndexes(scopedStore)
        for (const entry of legacyEntries) scopedStore.put(entry)
      }
      legacyEntriesRequest.onerror = () => request.transaction?.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listPharmacyPromotionOutboxEntries(
  scopeKey: string,
  clientExecutionId?: string,
): Promise<PharmacyPromotionOutboxEntry[]> {
  if (typeof indexedDB === "undefined") return []
  const normalizedScope = requiredText(scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const database = await openDb()
  try {
    const entries = await new Promise<PharmacyPromotionOutboxEntry[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly")
      const store = transaction.objectStore(STORE_NAME)
      const request = store.index("scopeKey").getAll(normalizedScope)
      request.onsuccess = () => resolve(
        Array.isArray(request.result)
          ? (request.result as PharmacyPromotionOutboxEntry[]).filter((entry) => (
              !clientExecutionId || entry.clientExecutionId === clientExecutionId
            ))
          : [],
      )
      request.onerror = () => reject(request.error)
    })
    return entries
      .map((entry) => freezeEntry(entry))
      .sort((left, right) => {
        const timestampOrder = left.queuedAt.localeCompare(right.queuedAt)
        return timestampOrder === 0 ? left.operationId.localeCompare(right.operationId) : timestampOrder
      })
  } finally {
    database.close()
  }
}

export async function readPharmacyPromotionTargetCache(
  scopeKey: string,
): Promise<PharmacyPromotionTargetCache | null> {
  if (typeof indexedDB === "undefined") return null
  const normalizedScope = requiredText(scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const database = await openDb()
  try {
    const record = await new Promise<PharmacyPromotionTargetCacheRecord | undefined>((resolve, reject) => {
      const transaction = database.transaction(TARGET_CACHE_STORE_NAME, "readonly")
      const request = transaction.objectStore(TARGET_CACHE_STORE_NAME).get(normalizedScope)
      request.onsuccess = () => resolve(request.result as PharmacyPromotionTargetCacheRecord | undefined)
      request.onerror = () => reject(request.error)
    })
    if (
      !record
      || typeof record.payloadJson !== "string"
      || typeof record.updatedAt !== "string"
      || Number.isNaN(new Date(record.updatedAt).getTime())
    ) return null
    const targets: unknown = JSON.parse(record.payloadJson)
    return Array.isArray(targets) ? { targets, updatedAt: record.updatedAt } : null
  } catch {
    return null
  } finally {
    database.close()
  }
}

export async function writePharmacyPromotionTargetCache(
  scopeKey: string,
  targets: readonly unknown[],
  now = Date.now(),
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const normalizedScope = requiredText(scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const record: PharmacyPromotionTargetCacheRecord = {
    scopeKey: normalizedScope,
    payloadJson: canonicalPharmacyPromotionPayload(targets),
    updatedAt: new Date(now).toISOString(),
  }
  const database = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TARGET_CACHE_STORE_NAME, "readwrite")
      transaction.objectStore(TARGET_CACHE_STORE_NAME).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function putPharmacyPromotionOutboxEntries(
  entries: readonly PharmacyPromotionOutboxEntry[],
): Promise<void> {
  if (entries.length === 0) return
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
  const uniqueEntries = new Map<string, PharmacyPromotionOutboxEntry>()
  for (const entry of entries) {
    const storageKey = `${entry.scopeKey}\u0000${entry.operationId}`
    const duplicate = uniqueEntries.get(storageKey)
    if (duplicate && !sameImmutableOperation(duplicate, entry)) throw immutableOperationError()
    uniqueEntries.set(storageKey, entry)
  }
  const database = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      let immutableError: Error | undefined
      for (const entry of uniqueEntries.values()) {
        const request = store.get([entry.scopeKey, entry.operationId])
        request.onsuccess = () => {
          const existing = request.result as PharmacyPromotionOutboxEntry | undefined
          if (existing && !sameImmutableOperation(existing, entry)) {
            immutableError = immutableOperationError()
            transaction.abort()
            return
          }
          store.put(entry)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(
        immutableError ?? transaction.error ?? new Error("IndexedDB transaction aborted"),
      )
    })
  } finally {
    database.close()
  }
}

export async function removePharmacyPromotionOutboxEntries(
  scopeKey: string,
  operationIds: readonly string[],
): Promise<void> {
  if (operationIds.length === 0) return
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
  const normalizedScope = requiredText(scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const database = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      for (const operationId of operationIds) store.delete([normalizedScope, operationId])
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export const pharmacyPromotionIndexedDbStore: PharmacyPromotionOutboxStore = {
  list: (scopeKey) => listPharmacyPromotionOutboxEntries(scopeKey),
  put: putPharmacyPromotionOutboxEntries,
  remove: (scopeKey, operationIds) => removePharmacyPromotionOutboxEntries(scopeKey, operationIds),
}

export async function persistPharmacyPromotionOperation(
  entry: PharmacyPromotionOutboxEntry,
): Promise<PharmacyPromotionOutboxEntry> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
  const database = await openDb()
  try {
    let persisted = entry
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      const store = transaction.objectStore(STORE_NAME)
      let immutableError: Error | undefined
      const request = store.get([entry.scopeKey, entry.operationId])
      request.onsuccess = () => {
        const existing = request.result as PharmacyPromotionOutboxEntry | undefined
        if (existing) {
          if (!sameImmutableOperation(existing, entry)) {
            immutableError = immutableOperationError()
            transaction.abort()
            return
          }
          persisted = freezeEntry(existing)
          return
        }
        store.put(entry)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(
        immutableError ?? transaction.error ?? new Error("IndexedDB transaction aborted"),
      )
    })
    return persisted
  } finally {
    database.close()
  }
}

const defaultFlushCoordinators = new Map<string, PharmacyPromotionFlushCoordinator>()

function defaultFlushCoordinator(scopeKey: string): PharmacyPromotionFlushCoordinator {
  const existing = defaultFlushCoordinators.get(scopeKey)
  if (existing) return existing
  const coordinator = createPharmacyPromotionFlushCoordinator()
  defaultFlushCoordinators.set(scopeKey, coordinator)
  return coordinator
}

type PharmacyPromotionWebLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

function runWithPharmacyPromotionCrossTabLock<T>(
  scopeKey: string,
  work: () => Promise<T>,
): Promise<T> {
  const lockManager = typeof navigator === "undefined"
    ? undefined
    : (navigator as unknown as { locks?: PharmacyPromotionWebLockManager }).locks
  if (!lockManager) return work()
  return lockManager.request(`leaddrive:mtm:pharmacy-promotion:${scopeKey}`, work)
}

async function flushPharmacyPromotionOutboxOnce(options: {
  scopeKey: string
  store: PharmacyPromotionOutboxStore
  send: (
    requests: readonly PharmacyPromotionOutboxRequest[],
  ) => Promise<readonly PharmacyPromotionServerOutcome[]>
  now: () => number
  batchSize: number
}): Promise<PharmacyPromotionFlushSummary> {
  let entries = await options.store.list(options.scopeKey)
  const planningNow = options.now()
  const summary: PharmacyPromotionFlushSummary = {
    batches: 0,
    attempted: 0,
    accepted: 0,
    errors: 0,
    conflicts: 0,
  }

  while (true) {
    const plannedBatch = pharmacyPromotionOperationBatches(
      entries,
      planningNow,
      options.batchSize,
    )[0]
    if (!plannedBatch) break
    const operationIds = plannedBatch.map((entry) => entry.operationId)
    const claimedAt = options.now()
    entries = markPharmacyPromotionOperationsSyncing(entries, operationIds, claimedAt)
    const selected = new Set(operationIds)
    const claimed = entries.filter((entry) => (
      selected.has(entry.operationId)
      && entry.status === "syncing"
      && entry.leaseStartedAt === claimedAt
    ))
    if (claimed.length === 0) break

    await options.store.put(claimed)
    summary.batches += 1
    summary.attempted += claimed.length

    let outcomes: readonly PharmacyPromotionServerOutcome[]
    try {
      outcomes = await options.send(claimed.map(pharmacyPromotionOutboxRequest))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcomes = claimed.map((entry) => ({
        operationId: entry.operationId,
        status: "error" as const,
        error: message || "MTM_PHARMACY_SYNC_REQUEST_FAILED",
      }))
    }

    const appliedAt = options.now()
    const applied = applyPharmacyPromotionServerOutcomes(
      entries,
      claimed.map((entry) => entry.operationId),
      outcomes,
      appliedAt,
    )
    entries = applied.entries
    const conflictIds = new Set(applied.conflictOperationIds)
    const conflictedDraftExecutions = new Set(
      claimed
        .filter((entry) => entry.kind === "DRAFT" && conflictIds.has(entry.operationId))
        .map((entry) => entry.clientExecutionId),
    )
    const dependencyConflicts: PharmacyPromotionOutboxEntry[] = []
    if (conflictedDraftExecutions.size > 0) {
      entries = entries.map((entry) => {
        if (
          entry.kind !== "SUBMIT"
          || entry.status === "conflict"
          || !conflictedDraftExecutions.has(entry.clientExecutionId)
        ) return entry
        const conflicted = conflictedOperation(entry, {
          operationId: entry.operationId,
          status: "conflict",
          error: "MTM_PHARMACY_SYNC_DRAFT_CONFLICT",
          serverData: { clientExecutionId: entry.clientExecutionId },
        }, appliedAt)
        dependencyConflicts.push(conflicted)
        return conflicted
      })
    }
    const retained = entries.filter((entry) => selected.has(entry.operationId))
    await options.store.remove(options.scopeKey, applied.acceptedOperationIds)
    await options.store.put([...retained, ...dependencyConflicts])

    summary.accepted += applied.acceptedOperationIds.length
    summary.errors += applied.errorOperationIds.length
    summary.conflicts += applied.conflictOperationIds.length + dependencyConflicts.length
  }

  return summary
}

/**
 * Drain the due snapshot in sequential batches. Concurrent callers share the
 * same in-flight promise, so they cannot issue overlapping server requests.
 */
export function flushPharmacyPromotionOutbox(options: {
  scopeKey: string
  send: (
    requests: readonly PharmacyPromotionOutboxRequest[],
  ) => Promise<readonly PharmacyPromotionServerOutcome[]>
  store?: PharmacyPromotionOutboxStore
  coordinator?: PharmacyPromotionFlushCoordinator
  now?: () => number
  batchSize?: number
}): Promise<PharmacyPromotionFlushSummary> {
  const scopeKey = requiredText(options.scopeKey, "scopeKey", { minimum: 16, maximum: 128 })
  const coordinator = options.coordinator ?? defaultFlushCoordinator(scopeKey)
  const drain = () => flushPharmacyPromotionOutboxOnce({
      scopeKey,
      store: options.store ?? pharmacyPromotionIndexedDbStore,
      send: options.send,
      now: options.now ?? Date.now,
      batchSize: options.batchSize ?? PHARMACY_PROMOTION_OUTBOX_BATCH_MAX,
    })
  return coordinator.run(() => (
    options.store
      ? drain()
      : runWithPharmacyPromotionCrossTabLock(scopeKey, drain)
  ))
}
