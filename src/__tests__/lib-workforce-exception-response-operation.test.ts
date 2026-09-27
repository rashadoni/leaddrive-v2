import { describe, expect, it, vi } from "vitest"
import {
  canReconcileWorkforceExceptionResponseAttempt,
  clearWorkforceExceptionResponseOperationId,
  createWorkforceExceptionResponseAttempt,
  isCurrentWorkforceExceptionResponseAttempt,
  reconcileWorkforceExceptionResponseAttempt,
  resolveWorkforceExceptionResponseOperationId,
  workforceExceptionResponseOperationKey,
  type WorkforceExceptionResponseOperationStorage,
} from "@/lib/workforce/exception-response-operation"

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const NEXT_OPERATION_ID = "22222222-2222-4222-8222-222222222222"
const RECONCILED_OPERATION_ID = "33333333-3333-4333-8333-333333333333"

function storage(): WorkforceExceptionResponseOperationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe("Workforce exception response browser operation", () => {
  it("keeps one operation id across retries and a remount until reconciliation", () => {
    const persistent = storage()
    const key = workforceExceptionResponseOperationKey({
      organizationId: "org-1",
      caseId: "case-1",
      expectedCaseRevision: 2,
    })!
    const createOperationId = vi.fn(() => OPERATION_ID)

    const first = resolveWorkforceExceptionResponseOperationId({
      key,
      inMemory: new Map(),
      storage: persistent,
      createOperationId,
    })
    const retry = resolveWorkforceExceptionResponseOperationId({
      key,
      inMemory: new Map(),
      storage: persistent,
      createOperationId,
    })

    expect(first).toBe(OPERATION_ID)
    expect(retry).toBe(OPERATION_ID)
    expect(createOperationId).toHaveBeenCalledTimes(1)
  })

  it("uses a new operation only for a new revision or after reconciliation", () => {
    const persistent = storage()
    const inMemory = new Map<string, string>()
    const revisionOne = workforceExceptionResponseOperationKey({
      organizationId: "org-1", caseId: "case-1", expectedCaseRevision: 1,
    })!
    const revisionTwo = workforceExceptionResponseOperationKey({
      organizationId: "org-1", caseId: "case-1", expectedCaseRevision: 2,
    })!
    const createOperationId = vi.fn()
      .mockReturnValueOnce(OPERATION_ID)
      .mockReturnValueOnce(NEXT_OPERATION_ID)
      .mockReturnValueOnce(RECONCILED_OPERATION_ID)

    expect(resolveWorkforceExceptionResponseOperationId({
      key: revisionOne, inMemory, storage: persistent, createOperationId,
    })).toBe(OPERATION_ID)
    expect(resolveWorkforceExceptionResponseOperationId({
      key: revisionTwo, inMemory, storage: persistent, createOperationId,
    })).toBe(NEXT_OPERATION_ID)

    clearWorkforceExceptionResponseOperationId({ key: revisionOne, inMemory, storage: persistent })
    expect(resolveWorkforceExceptionResponseOperationId({
      key: revisionOne, inMemory, storage: persistent, createOperationId,
    })).toBe(RECONCILED_OPERATION_ID)
    expect(createOperationId).toHaveBeenCalledTimes(3)
  })

  it("falls back to memory when browser storage fails and rejects invalid scope", () => {
    const failingStorage: WorkforceExceptionResponseOperationStorage = {
      getItem: () => { throw new Error("blocked") },
      setItem: () => { throw new Error("blocked") },
      removeItem: () => { throw new Error("blocked") },
    }
    const inMemory = new Map<string, string>()
    const key = workforceExceptionResponseOperationKey({
      organizationId: "org-1", caseId: "case-1", expectedCaseRevision: 0,
    })!
    const createOperationId = vi.fn(() => OPERATION_ID)

    expect(resolveWorkforceExceptionResponseOperationId({
      key, inMemory, storage: failingStorage, createOperationId,
    })).toBe(OPERATION_ID)
    expect(resolveWorkforceExceptionResponseOperationId({
      key, inMemory, storage: failingStorage, createOperationId,
    })).toBe(OPERATION_ID)
    expect(createOperationId).toHaveBeenCalledTimes(1)
    expect(workforceExceptionResponseOperationKey({
      organizationId: "", caseId: "case-1", expectedCaseRevision: 0,
    })).toBeNull()
    expect(workforceExceptionResponseOperationKey({
      organizationId: "org-1", caseId: "case-1", expectedCaseRevision: 64,
    })).toBeNull()
  })

  it("reconciles only the matching organization and a GET started after POST completion", () => {
    const submitting = createWorkforceExceptionResponseAttempt({
      requestId: 7,
      organizationId: "org-1",
      caseId: "case-1",
      operationKey: "operation-key",
    })

    expect(canReconcileWorkforceExceptionResponseAttempt({
      attempt: submitting,
      organizationId: "org-1",
      loadRequestId: 10,
    })).toBe(false)

    const reconciling = reconcileWorkforceExceptionResponseAttempt(submitting, 10)
    expect(canReconcileWorkforceExceptionResponseAttempt({
      attempt: reconciling,
      organizationId: "org-1",
      loadRequestId: 10,
    })).toBe(false)
    expect(canReconcileWorkforceExceptionResponseAttempt({
      attempt: reconciling,
      organizationId: "org-2",
      loadRequestId: 11,
    })).toBe(false)
    expect(canReconcileWorkforceExceptionResponseAttempt({
      attempt: reconciling,
      organizationId: "org-1",
      loadRequestId: 11,
    })).toBe(true)

    expect(isCurrentWorkforceExceptionResponseAttempt({
      active: reconciling,
      expected: reconciling,
      organizationId: "org-1",
    })).toBe(true)
    expect(isCurrentWorkforceExceptionResponseAttempt({
      active: { ...reconciling, requestId: 8 },
      expected: reconciling,
      organizationId: "org-1",
    })).toBe(false)
    expect(isCurrentWorkforceExceptionResponseAttempt({
      active: { ...reconciling, operationKey: "other-operation-key" },
      expected: reconciling,
      organizationId: "org-1",
    })).toBe(false)
    expect(isCurrentWorkforceExceptionResponseAttempt({
      active: reconciling,
      expected: reconciling,
      organizationId: "org-2",
    })).toBe(false)
  })
})
