import { afterEach, describe, expect, it, vi } from "vitest"
import { dispatchStagedPhoneProof, type ProofDispatchDependencies } from "./phone-proof-dispatch"
import { openPhoneProofDelivery, sealPhoneProof } from "./phone-proof"

const org = "tenant-a", proofId = "proof-a", at = new Date("2026-10-24T20:00:01.000Z")
const key = { id: "synthetic-dispatch", material: new Uint8Array(32).fill(23) }
const context = { organizationId: org, userId: "person-a", reservationId: "reservation-a", challengeId: proofId, normalizedPhone: "+994550001122",
  accountVersion: 1, credentialEpoch: 1, createdAt: "2026-10-24T20:00:00.000Z", expiresAt: "2026-10-24T20:10:00.000Z" }
function fixture() {
  const sealed = sealPhoneProof(context, key)
  const job = { proofId, leaseToken: "00000000-0000-4000-8000-000000000001", leaseUntil: "2026-10-24T20:00:31.000Z", context, sealed }
  const deps: ProofDispatchDependencies = { claim: vi.fn().mockResolvedValue(job), record: vi.fn().mockResolvedValue(undefined),
    resolveKey: () => key, send: vi.fn().mockResolvedValue({ status: "SENT", providerMessageId: "synthetic-provider-id" }), now: () => at }
  return { deps, job }
}
afterEach(() => vi.useRealTimers())

describe("one bounded private proof dispatch, no live transport", () => {
  it("opens the actual sealed code for exactly one transport call and returns no secret", async () => {
    const { deps, job } = fixture()
    const answer = await dispatchStagedPhoneProof(org, proofId, deps)
    expect(answer).toEqual({ status: "SENT", authenticationChanged: false })
    expect(deps.send).toHaveBeenCalledOnce()
    expect(deps.send).toHaveBeenCalledWith({ to: context.normalizedPhone, code: openPhoneProofDelivery(context, job.sealed, key, at), signal: expect.any(AbortSignal) })
    expect(deps.record).toHaveBeenCalledWith(org, { proofId, leaseToken: job.leaseToken, outcome: "SENT", providerMessageId: "synthetic-provider-id" })
    expect(Object.keys(answer)).toEqual(["status", "authenticationChanged"])
  })
  it("skips a closed/already leased job without opening or sending anything", async () => {
    const { deps } = fixture(); vi.mocked(deps.claim).mockResolvedValue(null)
    expect((await dispatchStagedPhoneProof(org, proofId, deps)).status).toBe("SKIPPED")
    expect(deps.send).not.toHaveBeenCalled(); expect(deps.record).not.toHaveBeenCalled()
  })
  it("refuses a broken store's cross-tenant/proof work item before transport", async () => {
    const { deps, job } = fixture(); vi.mocked(deps.claim).mockResolvedValue({ ...job, context: { ...context, organizationId: "tenant-b" } })
    await expect(dispatchStagedPhoneProof(org, proofId, deps)).rejects.toThrow("IDENTITY_DELIVERY_SCOPE_INVALID")
    expect(deps.send).not.toHaveBeenCalled(); expect(deps.record).not.toHaveBeenCalled()
  })
  it("records a local refusal without sending when the key or ciphertext is invalid", async () => {
    for (const kind of ["key", "cipher"]) {
      const { deps, job } = fixture()
      if (kind === "key") deps.resolveKey = () => null
      else vi.mocked(deps.claim).mockResolvedValue({ ...job, sealed: { ...job.sealed, codeHash: "0".repeat(64) } })
      expect((await dispatchStagedPhoneProof(org, proofId, deps)).status).toBe("FAILED")
      expect(deps.send).not.toHaveBeenCalled()
      expect(deps.record).toHaveBeenCalledWith(org, expect.objectContaining({ outcome: "FAILED", providerMessageId: null }))
    }
  })
  it("never sends at/after the exact lease deadline or after clock reversal", async () => {
    for (const instant of [new Date("2026-10-24T20:00:31.000Z"), new Date("2026-10-24T20:00:00.999Z")]) {
      const { deps } = fixture(); deps.now = vi.fn().mockReturnValueOnce(at).mockReturnValue(instant)
      expect((await dispatchStagedPhoneProof(org, proofId, deps)).status).toBe("FAILED")
      expect(deps.send).not.toHaveBeenCalled()
    }
  })
  it("treats a thrown provider call or missing acknowledgement ID as uncertain, without retry", async () => {
    for (const kind of ["throw", "missing-id"]) {
      const { deps } = fixture()
      if (kind === "throw") vi.mocked(deps.send).mockRejectedValue(new Error("private-provider-payload-must-not-leak"))
      else vi.mocked(deps.send).mockResolvedValue({ status: "SENT", providerMessageId: "" })
      expect((await dispatchStagedPhoneProof(org, proofId, deps)).status).toBe("UNCERTAIN")
      expect(deps.send).toHaveBeenCalledOnce()
      expect(deps.record).toHaveBeenCalledWith(org, expect.objectContaining({ outcome: "UNCERTAIN", providerMessageId: null }))
    }
  })
  it("bounds a transport that ignores abort, records uncertainty and does not retry", async () => {
    vi.useFakeTimers()
    const { deps } = fixture(); vi.mocked(deps.send).mockImplementation(() => new Promise(() => {}))
    const pending = dispatchStagedPhoneProof(org, proofId, deps)
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await pending).status).toBe("UNCERTAIN")
    expect(deps.send).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.send).mock.calls[0][0].signal.aborted).toBe(true)
  })
  it("does not resend after a receipt write failed following a provider acknowledgement", async () => {
    const { deps, job } = fixture()
    vi.mocked(deps.claim).mockResolvedValueOnce(job).mockResolvedValue(null)
    vi.mocked(deps.record).mockRejectedValue(new Error("private-database-payload-must-not-leak"))
    await expect(dispatchStagedPhoneProof(org, proofId, deps)).rejects.toThrow("IDENTITY_DELIVERY_RECEIPT_FAILED")
    expect((await dispatchStagedPhoneProof(org, proofId, deps)).status).toBe("SKIPPED")
    expect(deps.send).toHaveBeenCalledOnce()
  })
})
