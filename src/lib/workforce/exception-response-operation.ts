import { MAX_WORKFORCE_EXCEPTION_DECISIONS } from "@/lib/workforce/exception-workbench"

const OPERATION_KEY_PREFIX = "workforce-exception-response:v1"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WorkforceExceptionResponseOperationStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type WorkforceExceptionResponseAttempt = {
  requestId: number
  organizationId: string
  caseId: string
  operationKey: string
  phase: "SUBMITTING" | "RECONCILING"
  reconcileAfterLoadRequestId: number | null
}

export function createWorkforceExceptionResponseAttempt(input: {
  requestId: number
  organizationId: string
  caseId: string
  operationKey: string
}): WorkforceExceptionResponseAttempt {
  return {
    ...input,
    phase: "SUBMITTING",
    reconcileAfterLoadRequestId: null,
  }
}

export function reconcileWorkforceExceptionResponseAttempt(
  attempt: WorkforceExceptionResponseAttempt,
  afterLoadRequestId: number,
): WorkforceExceptionResponseAttempt {
  return {
    ...attempt,
    phase: "RECONCILING",
    reconcileAfterLoadRequestId: afterLoadRequestId,
  }
}

export function isCurrentWorkforceExceptionResponseAttempt(input: {
  active: WorkforceExceptionResponseAttempt | null
  expected: WorkforceExceptionResponseAttempt
  organizationId: string
}): boolean {
  return input.active?.requestId === input.expected.requestId
    && input.active.organizationId === input.organizationId
    && input.expected.organizationId === input.organizationId
    && input.active.caseId === input.expected.caseId
    && input.active.operationKey === input.expected.operationKey
}

export function canReconcileWorkforceExceptionResponseAttempt(input: {
  attempt: WorkforceExceptionResponseAttempt | null
  organizationId: string
  loadRequestId: number
}): boolean {
  return input.attempt?.phase === "RECONCILING"
    && input.attempt.organizationId === input.organizationId
    && input.attempt.reconcileAfterLoadRequestId !== null
    && input.loadRequestId > input.attempt.reconcileAfterLoadRequestId
}

export function workforceExceptionResponseOperationKey(input: {
  organizationId: string
  caseId: string
  expectedCaseRevision: number
}): string | null {
  if (!input.organizationId
    || !input.caseId
    || !Number.isInteger(input.expectedCaseRevision)
    || input.expectedCaseRevision < 0
    || input.expectedCaseRevision >= MAX_WORKFORCE_EXCEPTION_DECISIONS) {
    return null
  }
  return [
    OPERATION_KEY_PREFIX,
    encodeURIComponent(input.organizationId),
    encodeURIComponent(input.caseId),
    input.expectedCaseRevision,
  ].join(":")
}

function validOperationId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/**
 * Keeps one browser operation id stable across network failures and page
 * reloads until a fresh GET reconciles the presented case revision.
 * sessionStorage is best-effort; the in-memory map remains the safe fallback
 * when browser storage is unavailable.
 */
export function resolveWorkforceExceptionResponseOperationId(input: {
  key: string
  inMemory: Map<string, string>
  storage: WorkforceExceptionResponseOperationStorage | null
  createOperationId: () => string
}): string {
  const inMemory = input.inMemory.get(input.key)
  if (validOperationId(inMemory)) return inMemory

  let stored: string | null = null
  try {
    stored = input.storage?.getItem(input.key) ?? null
  } catch {
    stored = null
  }
  if (validOperationId(stored)) {
    input.inMemory.set(input.key, stored)
    return stored
  }

  const created = input.createOperationId()
  if (!validOperationId(created)) throw new Error("INVALID_WORKFORCE_EXCEPTION_RESPONSE_OPERATION_ID")
  input.inMemory.set(input.key, created)
  try {
    input.storage?.setItem(input.key, created)
  } catch {
    // The in-memory id still preserves exact retry semantics for this mount.
  }
  return created
}

export function clearWorkforceExceptionResponseOperationId(input: {
  key: string
  inMemory: Map<string, string>
  storage: WorkforceExceptionResponseOperationStorage | null
}): void {
  input.inMemory.delete(input.key)
  try {
    input.storage?.removeItem(input.key)
  } catch {
    // A stale browser-storage entry is inert once the server stops offering
    // this exact case revision, and can be overwritten by a later safe mount.
  }
}
