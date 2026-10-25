import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { IdentityRegistryError, normalizeIdentityPhone } from "./contract"
import { withIdentityAdministrator, type IdentityAdministrator } from "./administrator"
import { stageIdentityAccountInTransaction, planIdentityApplicationInTransaction, type RegistryClient } from "./registry"
import { reviewIdentityActorInTransaction, planIdentityMembershipInTransaction } from "./membership-registry"
import { createIdentityOnboardingIntentInTransaction } from "./onboarding"
import { IdentityTimeOnboardingInput } from "./time-onboarding-contract"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"
import type { OnboardingPlan } from "./onboarding-contract"
const unavailable = () => new IdentityRegistryError("IDENTITY_TIME_REVIEW_REQUIRED")
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** Phone lookup only selects a candidate for a human review. Include suspended
 * and unlinked owners when detecting ambiguity; never adopt their number. The
 * revision contains lifecycle metadata, never password hashes or credentials. */
export async function readLegacyTimeCandidate(tx: Prisma.TransactionClient, administrator: IdentityAdministrator, phone: string) {
  if (administrator.mode !== "CANONICAL") return null
  const organizationId = administrator.organizationId
  const owners = await tx.$queryRaw<Array<{ userId: string | null }>>`SELECT id AS "userId" FROM users
    WHERE "organizationId"=${organizationId} AND identity_legacy_phone_conflicts(phone,${phone})
    UNION SELECT "userId" FROM mtm_agents WHERE "organizationId"=${organizationId} AND identity_legacy_phone_conflicts(phone,${phone}) LIMIT 3`
  if (owners.length !== 1 || !owners[0].userId) return null
  const userId = owners[0].userId
  const [person] = await tx.$queryRaw<Array<{ id: string; name: string; role: string; phone: string | null; updatedAt: Date }>>`
    SELECT id,name,role,phone,"updatedAt" FROM users WHERE "organizationId"=${organizationId} AND id=${userId}
    AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!person || !["admin", "manager", "sales", "support", "ticketing", "viewer"].includes(person.role)) return null
  const cards = await tx.$queryRaw<Array<{ id: string; name: string; role: string; status: string; phone: string | null;
    attendanceParticipant: boolean; attendanceExcluded: boolean; updatedAt: Date }>>`
    SELECT id,name,role,status,phone,"attendanceParticipant","attendanceExcluded","updatedAt" FROM mtm_agents
    WHERE "organizationId"=${organizationId} AND "userId"=${userId} ORDER BY id LIMIT 2 FOR SHARE`
  if (cards.length > 1 || cards.some(c => c.status !== "ACTIVE" || !["ADMIN", "AGENT", "SUPERVISOR", "MANAGER"].includes(c.role))) return null
  const [differentPhone] = await tx.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS(
    SELECT 1 FROM users WHERE "organizationId"=${organizationId} AND id=${userId} AND phone IS NOT NULL AND NOT identity_legacy_phone_conflicts(phone,${phone})
    UNION ALL SELECT 1 FROM mtm_agents WHERE "organizationId"=${organizationId} AND "userId"=${userId} AND phone IS NOT NULL AND NOT identity_legacy_phone_conflicts(phone,${phone})
  ) AS found`
  if (differentPhone.found) return null
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } },
    select: { version: true, credentialEpoch: true, contactRevision: true, cutoverAt: true } })
  if (account?.cutoverAt) return null
  const scope = { organizationId, userId }
  // An earlier manual reconciliation must not be overwritten by this form.
  if (await tx.identityApplicationGrant.findFirst({ where: scope, select: { userId: true } })
    || await tx.identityActorBinding.findFirst({ where: scope, select: { actorId: true } })
    || await tx.identityOnboardingIntent.findFirst({ where: { ...scope, status: "ACTIVE" }, select: { id: true } })) return null
  for (const application of cards.length ? ["TIME", "ROUTE_FIELD"] as const : ["TIME"] as const) {
    const policy = await readIdentityMobileTenantPolicy(tx, organizationId, application)
    if (!policy.identityEnabled || !policy.licensed) return null
  }
  return { kind: "legacy" as const, userId, name: person.name, crmRole: person.role, fieldActorId: cards[0]?.id ?? null,
    fieldRole: cards[0]?.role ?? null, sourceRevision: digest([1, organizationId, phone, person, cards, account]) }
}

/** Explicit selected-person review stages the account, exact retained access,
 * immutable historical actor binding and seven-day Time invitation together.
 * It sends nothing and does not change any current credential or legacy card. */
export async function prepareLegacyPersonForTime(client: RegistryClient, administrator: IdentityAdministrator, raw: unknown) {
  const parsed = IdentityTimeOnboardingInput.safeParse(raw)
  if (!parsed.success || administrator.mode !== "CANONICAL") throw unavailable()
  const input = parsed.data, organizationId = administrator.organizationId, phone = normalizeIdentityPhone(input.phone)
  if (!phone) throw unavailable()
  const reviewReference = `time-legacy:${digest([1, organizationId, administrator.userId, { ...input, phone }])}`
  return withIdentityAdministrator(client, administrator, async tx => {
    const previous = await tx.identityOnboardingIntent.findUnique({ where: { organizationId_requestId: { organizationId, requestId: input.requestId } } })
    if (previous) {
      if (previous.reviewReference !== reviewReference || previous.issuedByUserId !== administrator.userId || previous.userId !== input.userId
        || previous.application !== "TIME") throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { intentId: previous.id, expiresAt: previous.expiresAt.toISOString(), status: previous.status, replayed: true }
    }
    const candidate = await readLegacyTimeCandidate(tx, administrator, phone)
    if (!candidate || candidate.userId !== input.userId || candidate.sourceRevision !== input.sourceRevision) throw unavailable()
    const scope = { organizationId, userId: input.userId }
    let version = (await stageIdentityAccountInTransaction(tx, administrator, { userId: input.userId, requestId: `time-stage:${input.requestId}` })).accountVersion
    const applications: OnboardingPlan[] = []
    if (input.preserveCrm) {
      const grant = await planIdentityApplicationInTransaction(tx, administrator, { userId: input.userId, application: "CRM", role: candidate.crmRole,
        status: "ACTIVE", expectedAccountVersion: version, expectedGrantVersion: 0, requestId: `time-crm:${input.requestId}` })
      version = grant.accountVersion
      applications.push({ application: "CRM", role: candidate.crmRole, status: "ACTIVE", grantVersion: grant.grantVersion,
        actorId: null, membershipVersion: 0, membershipStatus: null })
    }
    if (candidate.fieldActorId) {
      const actorId = candidate.fieldActorId
      version = (await reviewIdentityActorInTransaction(tx, administrator, { userId: input.userId, actorId, expectedAccountVersion: version,
        reviewReference, requestId: `time-binding:${input.requestId}` })).accountVersion
      const grant = await planIdentityApplicationInTransaction(tx, administrator, { userId: input.userId, application: "ROUTE_FIELD", role: candidate.fieldRole,
        status: "ACTIVE", expectedAccountVersion: version, expectedGrantVersion: 0, requestId: `time-field:${input.requestId}` })
      version = grant.accountVersion
      const member = await planIdentityMembershipInTransaction(tx, administrator, { userId: input.userId, actorId, application: "ROUTE_FIELD", status: "ACTIVE",
        expectedAccountVersion: version, expectedGrantVersion: grant.grantVersion, expectedMembershipVersion: 0, requestId: `time-member:${input.requestId}` })
      version = member.accountVersion
      applications.push({ application: "ROUTE_FIELD", role: candidate.fieldRole, status: "ACTIVE", grantVersion: grant.grantVersion,
        actorId, membershipVersion: member.membershipVersion, membershipStatus: "ACTIVE" })
    }
    const account = await tx.identityAccount.findUniqueOrThrow({ where: { organizationId_userId: scope } })
    return createIdentityOnboardingIntentInTransaction(tx, administrator, { userId: input.userId, phone, application: "TIME", applications,
      expectedAccountVersion: version, expectedCredentialEpoch: account.credentialEpoch, expectedContactRevision: account.contactRevision,
      timeEnrollment: input.timeEnrollment, requestId: input.requestId, reviewReference })
  })
}
