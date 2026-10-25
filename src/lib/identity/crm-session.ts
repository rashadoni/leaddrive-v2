import bcrypt from "bcryptjs"
import type { Prisma } from "@prisma/client"
import { assertIdentityScope, normalizeIdentityPhone } from "./contract"
import type { RegistryClient } from "./registry"
import { withIdentityMobileReadSnapshot } from "./mobile-session-resolver"
import { IDENTITY_AUTH_SETTING_KEY, isIdentityAuthExplicitlyEnabled } from "./tenant-policy"
import { IDENTITY_PASSWORD_DUMMY_HASH, isCanonicalIdentityPasswordHash } from "./canonical-password"
import { REVIEWER_ROLE } from "../reviewer-grant"

const CRM_ROLES = ["admin", "manager", "sales", "support", "ticketing", "viewer"] as const
export type IdentityCrmRole = typeof CRM_ROLES[number]
/** Private Auth.js authority hint. Not a JWT, cookie, bearer token or MFA proof.
 * Only verified server code may put this inside an Auth.js signed token.
 * account.version deliberately is not a session epoch: sibling grants change it.
 */
export type IdentityCrmClaims = {
  mode: "IDENTITY_CRM_V1"; organizationId: string; userId: string;
  claimId: string; credentialEpoch: number; grantVersion: number;
}
const FIELDS = ["mode", "organizationId", "userId", "claimId", "credentialEpoch", "grantVersion"] as const
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647

export function parseIdentityCrmClaims(value: unknown): IdentityCrmClaims | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (Object.keys(row).length !== FIELDS.length || FIELDS.some(key => !Object.hasOwn(row, key))
      || row.mode !== "IDENTITY_CRM_V1" || typeof row.organizationId !== "string"
      || typeof row.userId !== "string" || typeof row.claimId !== "string"
      || !revision(row.credentialEpoch) || !revision(row.grantVersion)) return null
    assertIdentityScope(row.organizationId, row.userId)
    assertIdentityScope(row.organizationId, row.claimId)
    return Object.freeze({ mode: "IDENTITY_CRM_V1", organizationId: row.organizationId, userId: row.userId,
      claimId: row.claimId, credentialEpoch: row.credentialEpoch, grantVersion: row.grantVersion })
  } catch { return null }
}
function sameClaims(a: IdentityCrmClaims, b: IdentityCrmClaims) {
  return FIELDS.every(key => a[key] === b[key])
}
export async function readIdentityCrmAuthorityInTransaction(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const scope = { organizationId, userId }
  const [company, person, account, claim, grant, setting] = await Promise.all([
    tx.organization.findFirst({ where: { id: organizationId }, select: { id: true, isActive: true } }),
    tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, isActive: true, anonymizedAt: true, role: true } }),
    tx.identityAccount.findUnique({ where: { organizationId_userId: scope }, select: { cutoverAt: true, credentialEpoch: true } }),
    tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: scope }, select: { id: true, normalizedPhone: true } }),
    tx.identityApplicationGrant.findUnique({ where: { organizationId_userId_application: { ...scope, application: "CRM" } }, select: { status: true, role: true, version: true } }),
    tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: IDENTITY_AUTH_SETTING_KEY } }, select: { value: true } }),
  ])
  if (company?.id !== organizationId || company.isActive !== true || person?.id !== userId
    || person.isActive !== true || person.anonymizedAt !== null || person.role === "superadmin" || person.role === REVIEWER_ROLE
    || !account?.cutoverAt || !revision(account.credentialEpoch) || !claim
    || normalizeIdentityPhone(claim.normalizedPhone) !== claim.normalizedPhone
    || grant?.status !== "ACTIVE" || !revision(grant.version) || !CRM_ROLES.includes(grant.role as IdentityCrmRole)
    || !isIdentityAuthExplicitlyEnabled(setting?.value)) return null
  const claims = parseIdentityCrmClaims({ mode: "IDENTITY_CRM_V1", organizationId, userId,
    claimId: claim.id, credentialEpoch: account.credentialEpoch, grantVersion: grant.version })
  return claims ? { claims, role: grant.role as IdentityCrmRole } : null
}
async function credential(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const state = await readIdentityCrmAuthorityInTransaction(tx, organizationId, userId)
  if (!state) return null
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { passwordHash: true } })
  if (!account || !isCanonicalIdentityPasswordHash(account.passwordHash)) return null
  return { ...state, hash: account.passwordHash }
}

/** Server-selected tenant/User only; callers authenticate/rate-limit the login
 * request and retain Auth.js fingerprint, MFA, reviewer and module checks.
 * This proves a shared password, not completed CRM MFA; Auth.js enforces MFA.
 * No legacy User/actor hash, phone or role fallback, and no platform conversion.
 */
export async function authenticateIdentityCrmPassword(client: RegistryClient, organizationId: string, userId: string, password: string) {
  try {
    assertIdentityScope(organizationId, userId)
    if (typeof password !== "string" || !password.length || Buffer.byteLength(password, "utf8") > 72) return null
    const before = (await withIdentityMobileReadSnapshot(client, organizationId, tx => credential(tx, organizationId, userId))).value
    const valid = await bcrypt.compare(password, before?.hash ?? IDENTITY_PASSWORD_DUMMY_HASH)
    if (!before || !valid) return null
    const after = (await withIdentityMobileReadSnapshot(client, organizationId, tx => credential(tx, organizationId, userId))).value
    if (!after || after.hash !== before.hash || after.role !== before.role || !sameClaims(after.claims, before.claims)) return null
    return { claims: after.claims, role: after.role }
  } catch { return null }
}

/** Fresh canonical authority for a verified Auth.js subject/private token.
 * A missing/invalid hint is never upgraded into canonical authority; callers
 * must independently deny legacy sessions after the irreversible marker.
 */
export async function resolveIdentityCrmSession(client: RegistryClient, organizationId: string, userId: string, hint: unknown) {
  try {
    const claims = parseIdentityCrmClaims(hint)
    if (!claims || claims.organizationId !== organizationId || claims.userId !== userId) return null
    const current = (await withIdentityMobileReadSnapshot(client, organizationId, tx => readIdentityCrmAuthorityInTransaction(tx, organizationId, userId))).value
    return current && sameClaims(current.claims, claims) ? current : null
  } catch { return null }
}
