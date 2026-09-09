export type ContactTransferReconciliationStatus = "VERIFIED" | "MISMATCH"

export type ContactTransferReceipt = {
  scopeKey: string
  operationId: string
  savedAt: string
  effectiveFrom: string
  sourceAgent: { id: string; name: string } | null
  targetAgent: { id: string; name: string } | null
  summary: {
    selected: number
    transferred: number
    excluded: number
  }
  reconciliation: {
    status: ContactTransferReconciliationStatus
    expected: number
    verified: number
    mismatched: number
    checkedAt: string
  }
}

export type ContactTransferReceiptResult = {
  operationId: string
  effectiveFrom: string
  sourceAgent: { id: string; name: string } | null
  targetAgent: { id: string; name: string } | null
  summary: {
    selected: number
    transferred: number
    excluded: number
  }
}

export type ContactTransferReconciliation = {
  operationId: string
  effectiveFrom: string
  sourceAgent: { id: string; name: string } | null
  targetAgent: { id: string; name: string } | null
  summary: ContactTransferReceipt["summary"]
  reconciliation: ContactTransferReceipt["reconciliation"]
}

const DB_NAME = "leaddrive-mtm-contact-transfer-receipts"
const STORE_NAME = "receipts"
const DB_VERSION = 1

function validAgent(value: unknown): value is { id: string; name: string } | null {
  if (value === null) return true
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === "string" && typeof candidate.name === "string"
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

export function isContactTransferReceipt(value: unknown): value is ContactTransferReceipt {
  if (!value || typeof value !== "object") return false
  const receipt = value as Record<string, unknown>
  const summary = receipt.summary as Record<string, unknown> | undefined
  const reconciliation = receipt.reconciliation as Record<string, unknown> | undefined
  return (
    typeof receipt.scopeKey === "string"
    && receipt.scopeKey.length === 64
    && typeof receipt.operationId === "string"
    && receipt.operationId.length > 0
    && typeof receipt.savedAt === "string"
    && typeof receipt.effectiveFrom === "string"
    && validAgent(receipt.sourceAgent)
    && validAgent(receipt.targetAgent)
    && Boolean(summary)
    && validNonNegativeInteger(summary?.selected)
    && validNonNegativeInteger(summary?.transferred)
    && validNonNegativeInteger(summary?.excluded)
    && Boolean(reconciliation)
    && (reconciliation?.status === "VERIFIED" || reconciliation?.status === "MISMATCH")
    && validNonNegativeInteger(reconciliation?.expected)
    && validNonNegativeInteger(reconciliation?.verified)
    && validNonNegativeInteger(reconciliation?.mismatched)
    && typeof reconciliation?.checkedAt === "string"
  )
}

export function contactTransferReceiptFromResult(
  scopeKey: string,
  result: ContactTransferReceiptResult,
  checkedAt = new Date().toISOString(),
): ContactTransferReceipt {
  return {
    scopeKey,
    operationId: result.operationId,
    savedAt: checkedAt,
    effectiveFrom: result.effectiveFrom,
    sourceAgent: result.sourceAgent,
    targetAgent: result.targetAgent,
    summary: {
      selected: result.summary.selected,
      transferred: result.summary.transferred,
      excluded: result.summary.excluded,
    },
    reconciliation: {
      status: "VERIFIED",
      expected: result.summary.transferred,
      verified: result.summary.transferred,
      mismatched: 0,
      checkedAt,
    },
  }
}

export function applyContactTransferReconciliation(
  receipt: ContactTransferReceipt,
  server: ContactTransferReconciliation,
): ContactTransferReceipt {
  if (receipt.operationId !== server.operationId) return receipt
  return {
    ...receipt,
    effectiveFrom: server.effectiveFrom,
    sourceAgent: server.sourceAgent,
    targetAgent: server.targetAgent,
    summary: server.summary,
    reconciliation: server.reconciliation,
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadContactTransferReceipt(scopeKey: string): Promise<ContactTransferReceipt | null> {
  if (typeof indexedDB === "undefined" || scopeKey.length !== 64) return null
  try {
    const db = await openDb()
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly")
      const request = transaction.objectStore(STORE_NAME).get(scopeKey)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return isContactTransferReceipt(value) && value.scopeKey === scopeKey ? value : null
  } catch {
    return null
  }
}

export async function saveContactTransferReceipt(receipt: ContactTransferReceipt): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !isContactTransferReceipt(receipt)) return false
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite")
      transaction.objectStore(STORE_NAME).put(receipt, receipt.scopeKey)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    return true
  } catch {
    return false
  }
}

export async function removeContactTransferReceipt(scopeKey: string): Promise<void> {
  if (typeof indexedDB === "undefined" || scopeKey.length !== 64) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite")
      transaction.objectStore(STORE_NAME).delete(scopeKey)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } catch {
    // Best effort: a stale receipt is harmless and remains scope-bound.
  }
}
