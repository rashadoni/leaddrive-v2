/** Stage 1 only: comparison never authorizes a login or infers app access. */
export const IDENTITY_APPLICATIONS = ["CRM", "TIME", "ROUTE_FIELD"] as const
export type IdentityApplication = typeof IDENTITY_APPLICATIONS[number]
export type IdentityGrantStatus = "ACTIVE" | "REVOKED"

export type StagedApplicationGrantInput = {
  userId: string
  application: IdentityApplication
  status: IdentityGrantStatus
  role: string | null
  expectedAccountVersion: number
  expectedGrantVersion: number
  requestId: string
}

export class IdentityRegistryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "IdentityRegistryError" }
}

/** Canonical, explicitly international only. Never infer a country or a suffix. */
export function normalizeIdentityPhone(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 128 || !/^[+\d\s().-]+$/.test(value)) return null
  let phone = value.replace(/[\s().-]/g, "")
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_.:-]/.test(value)
}

export function assertIdentityScope(organizationId: string, userId: string): void {
  if (![organizationId, userId].every(validKey)) {
    throw new IdentityRegistryError("IDENTITY_SCOPE_INVALID")
  }
}

export function assertIdentityRequestId(value: string): void {
  if (!validKey(value)) {
    throw new IdentityRegistryError("IDENTITY_REQUEST_INVALID")
  }
}

/** Planning is separate from live entitlement/enrollment/auth activation. */
export function assertStagedApplicationGrant(input: StagedApplicationGrantInput): void {
  assertIdentityRequestId(input.requestId)
  if (!IDENTITY_APPLICATIONS.includes(input.application) || !["ACTIVE", "REVOKED"].includes(input.status)
    || !Number.isSafeInteger(input.expectedAccountVersion) || input.expectedAccountVersion < 1
    || !Number.isSafeInteger(input.expectedGrantVersion) || input.expectedGrantVersion < 0
    || (input.role !== null && (typeof input.role !== "string" || !input.role.trim() || input.role.length > 50 || /[\u0000-\u001f\u007f]/.test(input.role)))
    || (input.status === "ACTIVE" && input.role === null)
    || (input.role !== null && input.application === "TIME" && !["EMPLOYEE", "REVIEWER"].includes(input.role))
    || (input.role !== null && input.application === "ROUTE_FIELD" && !["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"].includes(input.role))) {
    throw new IdentityRegistryError("IDENTITY_GRANT_PLAN_INVALID")
  }
}

export type IdentityShadowInput = {
  account: { version: number } | null
  canonicalPhone: string | null
  userPhone: string | null
  agentPhones: Array<string | null>
  grants: Array<{ application: IdentityApplication; status: IdentityGrantStatus; role: string | null; version: number }>
}

export function compareIdentityShadow(input: IdentityShadowInput) {
  const issues: string[] = []
  if (!input.account) issues.push("ACCOUNT_NOT_STAGED")
  if (input.agentPhones.length > 1) issues.push("MULTIPLE_LEGACY_ACTORS")
  const rawPhones = [input.userPhone, ...input.agentPhones].filter((value): value is string => value !== null && value !== "")
  const phones = rawPhones.map(normalizeIdentityPhone)
  if (phones.some(phone => phone === null)) issues.push("LEGACY_PHONE_REVIEW_REQUIRED")
  const legacyPhones = new Set(phones.filter((phone): phone is string => phone !== null))
  if (legacyPhones.size > 1) issues.push("LEGACY_PHONE_DISAGREEMENT")
  const canonical = normalizeIdentityPhone(input.canonicalPhone)
  if (!canonical) issues.push("VERIFIED_PHONE_MISSING")
  else if (Array.from(legacyPhones).some(phone => phone !== canonical)) issues.push("CANONICAL_PHONE_DISAGREEMENT")
  const applications = IDENTITY_APPLICATIONS.map(application => {
    const grants = input.grants.filter(grant => grant.application === application)
    if (grants.length > 1) throw new IdentityRegistryError("IDENTITY_GRANT_AMBIGUOUS")
    const grant = grants[0]
    if (grant && (!Number.isSafeInteger(grant.version) || grant.version < 1
      || !["ACTIVE", "REVOKED"].includes(grant.status)
      || (grant.status === "ACTIVE" && (!grant.role || !grant.role.trim())))) {
      throw new IdentityRegistryError("IDENTITY_GRANT_INVALID")
    }
    return { application, status: grant?.status ?? "NOT_GRANTED", role: grant?.role ?? null, version: grant?.version ?? 0 }
  })
  return {
    mode: "SHADOW" as const,
    authenticationChanged: false as const,
    status: !input.account ? "UNSTAGED" as const : issues.length ? "REVIEW" as const : "CONSISTENT" as const,
    accountVersion: input.account?.version ?? null,
    issues,
    applications,
  }
}
