import { describe, expect, it } from "vitest"
import {
  changedTerms,
  deleteRefusal,
  freeContractNumber,
  isContractNumberTaken,
  isSignedContract,
  needsReapproval,
} from "@/lib/clm/contract-safety"

/** «Опасные места» (src/lib/clm/contract-safety.ts), the pure part. */
describe("what may be deleted", () => {
  it("only a contract never signed and never in force", () => {
    for (const status of ["draft", "rejected", "cancelled"]) expect(deleteRefusal({ status, signedAt: null })).toBeNull()
    for (const status of ["pending_approval", "approved", "active", "renewing", "expired", "terminated", "renewed"]) {
      expect(deleteRefusal({ status, signedAt: null })).toBe("CONTRACT_DELETE_LOCKED")
    }
    // cancelled after it was signed on paper, say — the signature stays
    expect(deleteRefusal({ status: "cancelled", signedAt: "2026-11-20T00:00:00Z" })).toBe("CONTRACT_DELETE_LOCKED")
  })
})

describe("what a change to the terms means", () => {
  it("in approval or approved and unsigned: approval again", () => {
    expect(needsReapproval({ status: "pending_approval", signedAt: null })).toBe(true)
    expect(needsReapproval({ status: "approved", signedAt: null })).toBe(true)
    expect(needsReapproval({ status: "draft", signedAt: null })).toBe(false)
    expect(needsReapproval({ status: "approved", signedAt: "2026-11-20T00:00:00Z" })).toBe(false)
  })
  it("signed or in force: an administrator's change", () => {
    for (const status of ["active", "renewing", "expired", "terminated", "renewed"]) expect(isSignedContract({ status, signedAt: null })).toBe(true)
    expect(isSignedContract({ status: "approved", signedAt: "2026-11-20" })).toBe(true)
    expect(isSignedContract({ status: "draft", signedAt: null })).toBe(false)
  })
  it("only the terms the patch carries and changes", () => {
    const current = { valueAmount: "120000.0000", currency: "AZN", startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z") }
    expect(changedTerms(current, { valueAmount: 120000, currency: "AZN", startDate: "2026-01-01", endDate: "2026-12-31" })).toEqual([])
    expect(changedTerms(current, {})).toEqual([])
    expect(changedTerms(current, { valueAmount: 125000, endDate: "2027-12-31" })).toEqual(["valueAmount", "endDate"])
    expect(changedTerms(current, { currency: "USD", startDate: "2026-02-01" })).toEqual(["currency", "startDate"])
    expect(changedTerms(current, { endDate: null })).toEqual(["endDate"])
  })
})

describe("the contract number", () => {
  it("recognizes the unique violation on the number, and nothing else", () => {
    expect(isContractNumberTaken({ code: "P2002", meta: { target: ["organizationId", "contractNumber"] } })).toBe(true)
    expect(isContractNumberTaken({ code: "P2002", meta: { target: "contracts_org_number_uniq" } })).toBe(true)
    expect(isContractNumberTaken({ code: "P2002", meta: { target: ["spawnedFromQuoteId"] } })).toBe(false)
    expect(isContractNumberTaken({ code: "P2003" })).toBe(false)
    expect(isContractNumberTaken(new Error("x"))).toBe(false)
  })
  it("a made-up number takes the next free one", async () => {
    const db = (taken: string[]) => ({ contract: { findMany: async () => taken.map((contractNumber) => ({ contractNumber })) } })
    expect(await freeContractNumber(db([]), "org", "INT-00005")).toBe("INT-00005")
    expect(await freeContractNumber(db(["INT-00005"]), "org", "INT-00005")).toBe("INT-00005-2")
    expect(await freeContractNumber(db(["INT-00005", "INT-00005-2", "INT-00005-3"]), "org", "INT-00005")).toBe("INT-00005-4")
  })
})
