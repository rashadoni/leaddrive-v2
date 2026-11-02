import { assertIdentityRequestId, assertIdentityScope, IdentityRegistryError } from "./contract"
import { openPhoneProofDelivery, type PhoneProofKey } from "./phone-proof"
import type { StagedProofDelivery, StagedProofDeliveryReceipt } from "./phone-proof-registry"

export type ProofTransportResult = { status: "SENT"; providerMessageId: string } | { status: "FAILED" | "UNCERTAIN" }
export type ProofDispatchDependencies = {
  claim: (organizationId: string, proofId: string) => Promise<StagedProofDelivery | null>;
  record: (organizationId: string, receipt: StagedProofDeliveryReceipt) => Promise<unknown>;
  resolveKey: (keyId: string) => PhoneProofKey | null;
  /** Fixed bounded transport only. Alternate templates are allowed solely after
   * an explicit no-send rejection; never retry timeout, network or ambiguous
   * acknowledgement. Honor signal before every request; never log secrets. */
  send: (input: { to: string; code: string; signal: AbortSignal }) => Promise<ProofTransportResult>;
  /** Server clock; injection is for deterministic tests, never request input. */
  now?: () => Date;
}
const result = (status: "SKIPPED" | "SENT" | "FAILED" | "UNCERTAIN") => ({ status, authenticationChanged: false as const })

/**
 * Inactive worker composition, no scheduler or provider is wired here. The
 * store owns authorization, one lease and durable outcome. This function opens
 * the code only for the fixed transport, enforces the lease deadline and never
 * retries an uncertain provider request. It returns no private work item/code.
 */
export async function dispatchStagedPhoneProof(organizationId: string, proofId: string, deps: ProofDispatchDependencies) {
  assertIdentityScope(organizationId, "phone-proof-dispatch"); assertIdentityRequestId(proofId)
  const job = await deps.claim(organizationId, proofId)
  if (!job) return result("SKIPPED")
  if (job.proofId !== proofId || job.context.organizationId !== organizationId || job.context.challengeId !== proofId) throw new IdentityRegistryError("IDENTITY_DELIVERY_SCOPE_INVALID")
  const now = deps.now ?? (() => new Date())
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined, code = ""
  let receipt: StagedProofDeliveryReceipt = { proofId, leaseToken: job.leaseToken, outcome: "FAILED", providerMessageId: null }
  try {
    const current = now(), leaseUntil = new Date(job.leaseUntil).valueOf(), expiresAt = new Date(job.context.expiresAt).valueOf()
    if (!(current instanceof Date) || !Number.isFinite(current.valueOf()) || !Number.isFinite(leaseUntil) || !Number.isFinite(expiresAt)) throw new Error("CLOCK")
    const key = deps.resolveKey(job.sealed.keyId)
    if (!key || key.id !== job.sealed.keyId) throw new Error("KEY")
    code = openPhoneProofDelivery(job.context, job.sealed, key, current)
    const checked = now().valueOf(), remaining = Math.floor(Math.min(leaseUntil, expiresAt) - checked)
    if (!Number.isFinite(checked) || remaining <= 0 || remaining > 30_000 || checked < current.valueOf()) throw new Error("DEADLINE")
    // Mark uncertain BEFORE entering provider code: a synchronous throw can
    // occur after a request was sent. A timeout never becomes a safe retry.
    receipt = { ...receipt, outcome: "UNCERTAIN" }
    const timedOut = new Promise<ProofTransportResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ status: "UNCERTAIN" }) }, remaining)
    })
    const sent = await Promise.race([Promise.resolve().then(() => deps.send({ to: job.context.normalizedPhone, code, signal: controller.signal })), timedOut])
    if (sent.status === "FAILED") receipt = { ...receipt, outcome: "FAILED" }
    else if (sent.status === "SENT" && typeof sent.providerMessageId === "string" && sent.providerMessageId.length >= 1
      && sent.providerMessageId.length <= 300 && !/[^\x21-\x7e]/.test(sent.providerMessageId)) receipt = { ...receipt, outcome: "SENT", providerMessageId: sent.providerMessageId }
  } catch {
    // Fixed outcome only; neither provider payloads nor plaintext enter logs.
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort(); code = ""
  }
  try { await deps.record(organizationId, receipt) }
  catch { throw new IdentityRegistryError("IDENTITY_DELIVERY_RECEIPT_FAILED") }
  return result(receipt.outcome)
}
