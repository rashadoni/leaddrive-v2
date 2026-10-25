import type { IdentityOnboardingIntent, IdentityPhoneProof, Prisma } from "@prisma/client"
import { IdentityRegistryError } from "./contract"
import { IdentityOnboardingPlan, orderedOnboardingPlans } from "./onboarding-contract"
import { identityProofAuthorityHash, parseIdentityProofAuthority, revalidateIdentityProofAuthority } from "./proof-authority"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

const unavailable = () => new IdentityRegistryError("IDENTITY_ONBOARDING_UNAVAILABLE")
export async function assertOnboardingApplicationPlan(tx: Prisma.TransactionClient, intent: Pick<IdentityOnboardingIntent, "organizationId" | "userId" | "application" | "applications">) {
  const scope = { organizationId: intent.organizationId, userId: intent.userId }
  const parsed = IdentityOnboardingPlan.array().min(1).max(3).safeParse(intent.applications)
  if (!parsed.success) throw unavailable()
  await tx.$queryRaw`SELECT application FROM identity_application_grants WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY application FOR SHARE`
  await tx.$queryRaw`SELECT application FROM identity_application_memberships WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} ORDER BY application FOR SHARE`
  const grants = await tx.identityApplicationGrant.findMany({ where: scope, take: 4 })
  const members = await tx.identityApplicationMembership.findMany({ where: scope, take: 3 })
  const plans = IdentityOnboardingPlan.array().safeParse(grants.map(g => {
    const m = members.find(row => row.application === g.application)
    return { application: g.application, role: g.role, status: g.status, grantVersion: g.version,
      actorId: m?.actorId ?? null, membershipVersion: m?.version ?? 0, membershipStatus: m?.status ?? null }
  }))
  if (!plans.success || JSON.stringify(orderedOnboardingPlans(parsed.data)) !== JSON.stringify(orderedOnboardingPlans(plans.data))) throw unavailable()
  const selected = plans.data.find(p => p.application === intent.application)
  if (!selected || selected.status !== "ACTIVE" || !selected.actorId || selected.membershipStatus !== "ACTIVE") throw unavailable()
  for (const p of plans.data.filter(p => p.status === "ACTIVE" && p.application !== "CRM")) {
    const policy = await readIdentityMobileTenantPolicy(tx, scope.organizationId, p.application as "TIME" | "ROUTE_FIELD")
    if (!policy.identityEnabled || !policy.licensed) throw unavailable()
    await tx.$queryRaw`SELECT id FROM mtm_agents WHERE "organizationId"=${scope.organizationId} AND id=${p.actorId} FOR SHARE`
    const card = await tx.mtmAgent.findFirst({ where: { organizationId: scope.organizationId, id: p.actorId!, userId: scope.userId, status: "ACTIVE" },
      select: { role: true, attendanceParticipant: true, attendanceExcluded: true } })
    const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId: scope.organizationId, actorId: p.actorId! } } })
    if (!card || binding?.userId !== scope.userId || card.role !== p.role
      || (p.application === "TIME" ? card.role !== "EMPLOYEE" || !card.attendanceParticipant || card.attendanceExcluded : card.role === "EMPLOYEE")) throw unavailable()
  }
  return plans.data
}

/** The stored review, not a newly supplied administrator, authorizes delayed
 * first login. Revocation, logout/MFA changes and expiry cannot be refreshed by
 * a resend. Caller holds the tenant fence. */
export async function revalidateOnboardingIntent(tx: Prisma.TransactionClient, organizationId: string, intentId: string) {
  const [intent] = await tx.$queryRaw<IdentityOnboardingIntent[]>`SELECT * FROM identity_onboarding_intents WHERE "organizationId"=${organizationId} AND id=${intentId} FOR UPDATE`
  const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now
  if (!intent || intent.status !== "ACTIVE" || now >= intent.expiresAt || now < intent.createdAt) throw unavailable()
  const authority = await revalidateIdentityProofAuthority(tx, intent.issuerAuthority, organizationId, intent.issuedByUserId)
  await tx.$queryRaw`SELECT id FROM users WHERE "organizationId"=${organizationId} AND id=${intent.userId} FOR SHARE`
  const person = await tx.user.findFirst({ where: { organizationId, id: intent.userId, isActive: true, anonymizedAt: null }, select: { id: true } })
  await tx.$queryRaw`SELECT "userId" FROM identity_accounts WHERE "organizationId"=${organizationId} AND "userId"=${intent.userId} FOR UPDATE`
  const account = await tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId: intent.userId } } })
  if (!person || !account || account.cutoverAt || account.contactRevision !== intent.contactRevision) throw unavailable()
  const applications = await assertOnboardingApplicationPlan(tx, intent)
  return { intent, authority, account, applications, now }
}

export async function revalidateOnboardingProof(tx: Prisma.TransactionClient, proof: IdentityPhoneProof) {
  if (!proof.onboardingIntentId) return
  if (proof.contextVersion !== 2) throw unavailable()
  const { intent, authority } = await revalidateOnboardingIntent(tx, proof.organizationId, proof.onboardingIntentId)
  const frozen = parseIdentityProofAuthority(proof.issuerAuthority)
  if (intent.userId !== proof.userId || intent.currentProofId !== proof.id || intent.normalizedPhone !== proof.normalizedPhone
    || intent.issuedByUserId !== proof.issuedByUserId || !frozen || identityProofAuthorityHash(frozen) !== identityProofAuthorityHash(authority)) throw unavailable()
}

/** Only receipts from this intent's current challenge may advance its reviewed
 * starting revisions. An unrelated password/contact/grant edit requires review. */
export async function assertOnboardingProgress(tx: Prisma.TransactionClient, intent: IdentityOnboardingIntent, account: { version: number; credentialEpoch: number }) {
  if (account.version === intent.issuedAccountVersion && account.credentialEpoch === intent.issuedCredentialEpoch) return
  if (intent.currentProofId) {
    const receipt = await tx.identityEvent.findFirst({ where: { organizationId: intent.organizationId, userId: intent.userId, proofId: intent.currentProofId,
      action: { in: ["PHONE_CONFIRMED", "CREDENTIAL_STAGED"] }, accountVersion: account.version, credentialEpoch: account.credentialEpoch } })
    if (receipt) return
  }
  throw unavailable()
}
