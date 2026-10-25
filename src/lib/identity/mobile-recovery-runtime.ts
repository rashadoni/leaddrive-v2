import { createHash, randomUUID } from "node:crypto"
import type { RegistryClient } from "./registry"
import type { IdentityMobileApplication } from "./mobile-session-contract"
import { normalizeIdentityPhone } from "./contract"
import { identityRuntimeKeys } from "./runtime-keys"
import { withIdentityMobileReadSnapshot } from "./mobile-session-resolver"
import { identityMobileLogin } from "./mobile-login-runtime"
import { issueCanonicalRecovery, confirmCanonicalRecovery, resetCanonicalPassword } from "./canonical-recovery"
import { phoneProofContext, claimStagedPhoneProofDelivery, recordStagedPhoneProofDelivery, type SharedPasswordPolicy } from "./phone-proof-registry"
import { phoneProofAttemptHash } from "./phone-proof"
import { credentialSetupHint } from "./credential-setup"
import { dispatchStagedPhoneProof, type ProofDispatchDependencies } from "./phone-proof-dispatch"

async function selection(client: RegistryClient, organizationId: string, phone: string, challengeId?: string) {
  const normalized = normalizeIdentityPhone(phone)
  const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
    const claim = normalized ? await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone: normalized } },
      select: { account: { select: { cutoverAt: true } } } }) : null
    const proof = challengeId ? await tx.identityPhoneProof.findFirst({ where: { organizationId, id: challengeId } }) : null
    return { canonical: !!claim?.account.cutoverAt || !!proof, normalized, proof }
  })
  return snapshot.value
}

/** HTTP composition after company selection and existing distributed limits.
 * All canonical outcomes share the public generic sent response. No fallback
 * to legacy after selecting a canonical claim or challenge. */
export async function requestIdentityMobileRecovery(client: RegistryClient, organizationId: string,
  input: { phone: string; application: IdentityMobileApplication }, send: ProofDispatchDependencies["send"]) {
  const fake = { status: "HANDLED" as const, challengeId: randomUUID() }
  try {
    const selected = await selection(client, organizationId, input.phone)
    if (!selected.canonical) return { status: "LEGACY" as const }
    const keys = identityRuntimeKeys()
    if (!keys.proof || !keys.mobile) return fake
    const issued = await issueCanonicalRecovery(client, organizationId, { ...input, requestId: randomUUID() }, keys.proof.active)
    if (!issued) return fake
    await dispatchStagedPhoneProof(organizationId, issued.proofId, {
      claim: (org, id) => claimStagedPhoneProofDelivery(client, org, id),
      record: (org, receipt) => recordStagedPhoneProofDelivery(client, org, receipt), resolveKey: keys.proof.resolve, send,
    })
    return { status: "HANDLED" as const, challengeId: issued.proofId }
  } catch { return fake } // No private DB/provider/proof payload reaches logs.
}

export async function verifyIdentityMobileRecovery(client: RegistryClient, organizationId: string,
  input: { phone: string; application: IdentityMobileApplication; challengeId?: string; code: string }) {
  try {
    const selected = await selection(client, organizationId, input.phone, input.challengeId)
    if (!selected.canonical) return { status: "LEGACY" as const }
    const proof = selected.proof, ring = identityRuntimeKeys().proof
    if (!proof || !ring || proof.contextVersion !== 3 || proof.normalizedPhone !== selected.normalized) return { status: "DENIED" as const }
    const key = ring.resolve(proof.keyId)
    if (!key) return { status: "DENIED" as const }
    // Stable retries without storing an enumerable hash of the six-digit code.
    const requestId = `recovery-confirm:${phoneProofAttemptHash(phoneProofContext(proof), key, "http-confirm", input.code)}`
    const result = await confirmCanonicalRecovery(client, organizationId, { proofId: proof.id, application: input.application, code: input.code, requestId }, ring.resolve)
    if (!result) return { status: "DENIED" as const }
    const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, tx => tx.user.findFirst({
      where: { organizationId, id: result.userId, isActive: true, anonymizedAt: null }, select: { name: true } }))
    if (!snapshot.value) return { status: "DENIED" as const }
    return { status: "CONFIRMED" as const, setupToken: result.setupToken, name: snapshot.value.name }
  } catch { return { status: "DENIED" as const } }
}

export async function finishIdentityMobileRecovery(client: RegistryClient, organizationId: string,
  input: { setupToken: string; application: IdentityMobileApplication; password: string }, policy: SharedPasswordPolicy) {
  try {
    const keys = identityRuntimeKeys(), hint = credentialSetupHint(input.setupToken)
    if (!keys.proof || !keys.mobile || !hint || !input.setupToken.startsWith("lds3.")) return { status: "DENIED" as const }
    const requestId = `recovery-password:${createHash("sha256").update(input.setupToken).digest("hex")}`
    const result = await resetCanonicalPassword(client, organizationId, { ...input, requestId }, keys.proof.resolve, policy)
    const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, tx => tx.identityPhoneProof.findFirst({
      where: { organizationId, id: hint.proofId, userId: result.userId, contextVersion: 3 }, select: { normalizedPhone: true } }))
    if (!snapshot.value) return { status: "DENIED" as const }
    const login = await identityMobileLogin(client, organizationId, { phone: snapshot.value.normalizedPhone, password: input.password, application: input.application })
    return login.status === "AUTHENTICATED" ? login : { status: "DENIED" as const }
  } catch { return { status: "DENIED" as const } }
}
