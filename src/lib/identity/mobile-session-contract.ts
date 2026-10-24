import { assertIdentityRequestId, assertIdentityScope } from "./contract.js"

export type IdentityMobileApplication = "TIME" | "ROUTE_FIELD"
export const IDENTITY_MOBILE_ISSUER = "leaddrive:identity:mobile:v1"
export const IDENTITY_MOBILE_AUDIENCES = { TIME: "leaddrive:time:v1", ROUTE_FIELD: "leaddrive:route-field:v1" } as const
export type IdentityMobileClaims = {
  version: 1; iss: typeof IDENTITY_MOBILE_ISSUER; aud: string; sub: string; organizationId: string;
  application: IdentityMobileApplication; actorId: string; phoneClaimId: string; credentialEpoch: number;
  grantVersion: number; membershipVersion: number; iat: number; exp: number; jti: string;
}
type Subject = { organizationId: string; userId: string }
/** Fresh server-owned, tenant-scoped state. Never deserialize this from a request. */
export type IdentityMobileState = {
  company: { id: string; isActive: boolean; identityMobileEnabled: boolean };
  person: Subject & { isActive: boolean; anonymizedAt: Date | null };
  account: Subject & { version: number; credentialEpoch: number; cutoverAt: Date | null };
  claim: (Subject & { id: string }) | null;
  grant: (Subject & { application: IdentityMobileApplication; status: string; role: string | null; version: number }) | null;
  membership: (Subject & { application: IdentityMobileApplication; actorId: string; active: boolean; version: number }) | null;
  binding: (Subject & { actorId: string; status: string }) | null;
  actor: { organizationId: string; userId: string | null; id: string; status: string } | null;
  license: { application: IdentityMobileApplication; enabled: boolean };
}
const NAMES = ["version", "iss", "aud", "sub", "organizationId", "application", "actorId", "phoneClaimId", "credentialEpoch", "grantVersion", "membershipVersion", "iat", "exp", "jti"]
const integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647
const unix = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0
const roleAllowed = (app: IdentityMobileApplication, role: string | null): role is string => typeof role === "string"
  && (app === "TIME" ? ["EMPLOYEE", "REVIEWER"] : ["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"]).includes(role)

/**
 * Authorization policy only: claims MUST first pass a real JWT verifier with
 * a dedicated identity signing key, pinned issuer/algorithm and exact audience.
 * Do not reuse JWT_SECRET, accept a body/header as verified claims, or fall
 * back to legacy auth on refusal. No current login/route calls this contract.
 * The expected app is owned by the server route; CRM is never admitted here.
 */
export function authorizeIdentityMobileSession(raw: unknown, expectedApp: IdentityMobileApplication, state: IdentityMobileState, now: Date) {
  if (!["TIME", "ROUTE_FIELD"].includes(expectedApp) || !raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).length !== NAMES.length || NAMES.some(name => !Object.hasOwn(raw, name))
    || !(now instanceof Date) || !Number.isFinite(now.valueOf())) return null
  const claims = raw as IdentityMobileClaims
  if (claims.version !== 1 || claims.iss !== IDENTITY_MOBILE_ISSUER || claims.application !== expectedApp
    || claims.aud !== IDENTITY_MOBILE_AUDIENCES[expectedApp] || !integer(claims.credentialEpoch) || !integer(claims.grantVersion) || !integer(claims.membershipVersion)
    || !unix(claims.iat) || !unix(claims.exp) || claims.exp <= claims.iat || claims.exp - claims.iat > 604_800
    || claims.iat * 1000 > now.valueOf() || claims.exp * 1000 <= now.valueOf()) return null
  try {
    assertIdentityScope(claims.organizationId, claims.sub)
    for (const id of [claims.actorId, claims.phoneClaimId, claims.jti]) assertIdentityRequestId(id)
  } catch { return null }
  if (!state || !state.company || !state.person || !state.account || !state.license) return null
  const { company, person, account, claim, grant, membership, binding, actor, license } = state
  if (company.id !== claims.organizationId || company.isActive !== true || company.identityMobileEnabled !== true
    || person.isActive !== true || person.anonymizedAt !== null || !integer(account.version)
    || !(account.cutoverAt instanceof Date) || !Number.isFinite(account.cutoverAt.valueOf()) || account.cutoverAt > now
    || claims.iat < Math.floor(account.cutoverAt.valueOf() / 1000)
    || account.credentialEpoch !== claims.credentialEpoch || !claim || claim.id !== claims.phoneClaimId
    || !grant || grant.application !== expectedApp || grant.status !== "ACTIVE" || grant.version !== claims.grantVersion || !roleAllowed(expectedApp, grant.role)
    || !membership || membership.application !== expectedApp || membership.actorId !== claims.actorId || membership.active !== true || membership.version !== claims.membershipVersion
    || !binding || binding.actorId !== claims.actorId || binding.status !== "REVIEWED"
    || !actor || actor.id !== claims.actorId || actor.status !== "ACTIVE"
    || license.application !== expectedApp || license.enabled !== true) return null
  if ([person, account, claim, grant, membership, binding, actor].some(row => row.organizationId !== claims.organizationId || row.userId !== claims.sub)) return null
  // account.version is a write-CAS revision, deliberately NOT a session epoch:
  // revoking Field changes it but must not invalidate an unchanged Time grant.
  // Return actorId/app explicitly; adapting to legacy agentId/role is not safe.
  return { organizationId: claims.organizationId, userId: claims.sub, actorId: claims.actorId, application: expectedApp,
    role: grant.role, grantVersion: grant.version, membershipVersion: membership.version, credentialEpoch: account.credentialEpoch, phoneClaimId: claim.id, sessionId: claims.jti }
}
