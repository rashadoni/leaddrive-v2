import bcrypt from "bcryptjs"
import type { Prisma } from "@prisma/client"
import { assertIdentityScope, normalizeIdentityPhone } from "./contract.js"
import type { RegistryClient } from "./registry.js"
import type { IdentityMobileApplication } from "./mobile-session-contract.js"
import { issueIdentityMobileSession, verifyIdentityMobileSession, type IdentitySessionSigningKey } from "./mobile-session.js"
import { readIdentityMobileState, withIdentityMobileReadSnapshot } from "./mobile-session-resolver.js"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

export type IdentityMobilePasswordInput = { phone: string; password: string; application: IdentityMobileApplication }
// Public, deliberately fictitious work factor. An absent candidate always
// returns null even if this comparison were ever true; it is not a credential.
const DUMMY_HASH = "$2b$12$" + "A".repeat(53)
const canonicalHash = (value: unknown): value is string => typeof value === "string" && value.length === 60 && /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(value)
async function credential(tx: Prisma.TransactionClient, organizationId: string, normalizedPhone: string) {
  const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone } }, select: { id: true, userId: true } })
  if (!claim) return null
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId: claim.userId } }, select: { passwordHash: true, credentialEpoch: true, cutoverAt: true } })
  if (!account?.cutoverAt || !canonicalHash(account.passwordHash)) return null
  return { userId: claim.userId, claimId: claim.id, hash: account.passwordHash, credentialEpoch: account.credentialEpoch }
}
/**
 * Internal canonical mobile login, no public route is exposed. The server must
 * resolve the company/key and enforce IP+tenant+principal rate limits first.
 * Only authoritative claim/account credentials are considered: no User/agent
 * phone/password/email fallback and no CRM/MFA session. Compare bounded cost12
 * outside transactions; reread claim/hash/epoch and actual entitlement/member
 * state afterwards before signing. Never log input, hashes or returned tokens.
 */
export async function authenticateIdentityMobilePassword(client: RegistryClient, organizationId: string,
  input: IdentityMobilePasswordInput, signingKey: IdentitySessionSigningKey) {
  try {
    assertIdentityScope(organizationId, "password-auth")
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3
      || !["phone", "password", "application"].every(key => Object.hasOwn(input, key))
      || typeof input.password !== "string" || input.password.length < 1 || input.password.length > 72 || Buffer.byteLength(input.password, "utf8") > 72
      || !["TIME", "ROUTE_FIELD"].includes(input.application)) return null
    const application = input.application, password = input.password
    const normalizedPhone = normalizeIdentityPhone(input.phone)
    if (!normalizedPhone) return null
    const initial = await withIdentityMobileReadSnapshot(client, organizationId, tx => credential(tx, organizationId, normalizedPhone))
    const candidate = initial.value
    const matched = await bcrypt.compare(password, candidate?.hash ?? DUMMY_HASH)
    if (!candidate || !matched) return null
    const final = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
      const current = await credential(tx, organizationId, normalizedPhone)
      if (!current || current.userId !== candidate.userId || current.claimId !== candidate.claimId
        || current.hash !== candidate.hash || current.credentialEpoch !== candidate.credentialEpoch) return null
      return readIdentityMobileState(tx, organizationId, current.userId, application, readIdentityMobileTenantPolicy)
    })
    if (!final.value) return null
    const token = issueIdentityMobileSession(final.value, application, signingKey, final.now)
    const context = verifyIdentityMobileSession(token, application, final.value, id => id === signingKey.id ? signingKey : null, final.now)
    return context ? { token, context } : null
  } catch { return null }
}
