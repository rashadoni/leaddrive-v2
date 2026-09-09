import { describe, expect, it } from "vitest"
import {
  applyContactTransferReconciliation,
  contactTransferReceiptFromResult,
  isContactTransferReceipt,
} from "@/lib/mtm/contact-transfer-receipt"

const SCOPE = "a".repeat(64)

describe("MTM contact transfer receipt", () => {
  it("projects the completed server result into a scope-bound verified receipt", () => {
    const receipt = contactTransferReceiptFromResult(SCOPE, {
      operationId: "operation-1",
      effectiveFrom: "2026-07-22",
      sourceAgent: { id: "source", name: "Old Agent" },
      targetAgent: { id: "target", name: "New Agent" },
      summary: { selected: 4, transferred: 3, excluded: 1 },
    }, "2026-07-22T12:00:00.000Z")

    expect(receipt).toMatchObject({
      scopeKey: SCOPE,
      operationId: "operation-1",
      summary: { selected: 4, transferred: 3, excluded: 1 },
      reconciliation: { status: "VERIFIED", expected: 3, verified: 3, mismatched: 0 },
    })
    expect(isContactTransferReceipt(receipt)).toBe(true)
  })

  it("applies only reconciliation data for the same operation", () => {
    const receipt = contactTransferReceiptFromResult(SCOPE, {
      operationId: "operation-1",
      effectiveFrom: "2026-07-22",
      sourceAgent: { id: "source", name: "Old Agent" },
      targetAgent: { id: "target", name: "New Agent" },
      summary: { selected: 2, transferred: 2, excluded: 0 },
    })
    const mismatch = applyContactTransferReconciliation(receipt, {
      operationId: "operation-1",
      effectiveFrom: "2026-07-22",
      sourceAgent: receipt.sourceAgent,
      targetAgent: receipt.targetAgent,
      summary: receipt.summary,
      reconciliation: {
        status: "MISMATCH",
        expected: 2,
        verified: 1,
        mismatched: 1,
        checkedAt: "2026-07-23T10:00:00.000Z",
      },
    })
    expect(mismatch.reconciliation).toMatchObject({ status: "MISMATCH", verified: 1, mismatched: 1 })

    const ignored = applyContactTransferReconciliation(receipt, {
      operationId: "another-operation",
      effectiveFrom: receipt.effectiveFrom,
      sourceAgent: receipt.sourceAgent,
      targetAgent: receipt.targetAgent,
      summary: receipt.summary,
      reconciliation: mismatch.reconciliation,
    })
    expect(ignored).toBe(receipt)
  })

  it("rejects a receipt from another or malformed browser scope", () => {
    expect(isContactTransferReceipt({ scopeKey: "wrong" })).toBe(false)
  })
})
