import type { Prisma } from "@prisma/client"
import { createHash } from "node:crypto"
import { withIdentityAdministrator, withIdentityAdministratorInTransaction, type IdentityAdministrator } from "./administrator"
import type { RegistryClient } from "./registry"
import { IdentityRegistryError, normalizeIdentityPhone } from "./contract"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"
import { prepareIdentityApplicationActorInTransaction } from "./application-actor"
import { enrollIdentityApplicationInTransaction } from "./application-enrollment"
import { IdentityTimeEnrollmentInput, type IdentityTimePerson } from "./time-enrollment-contract"
import { resolveAttendanceUnit, recordAttendanceInitialHire } from "../mtm/attendance-employee-store"
import { readLegacyTimeCandidate } from "./time-onboarding"
import { isValidTimezone } from "../timezone"

/** Private administrator lookup; a phone is a candidate for explicit review,
 * never permission to add a grant or rewrite the existing person's name. */
export async function lookupIdentityTimePerson(client: RegistryClient, administrator: IdentityAdministrator, phone: string): Promise<IdentityTimePerson> {
  const normalizedPhone = normalizeIdentityPhone(phone)
  if (!normalizedPhone) throw new IdentityRegistryError("IDENTITY_PHONE_INVALID")
  return withIdentityAdministrator(client, administrator, async tx => {
    const organizationId = administrator.organizationId
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone } },
      include: { account: { select: { cutoverAt: true, version: true } } } })
    if (!claim?.account.cutoverAt) {
      const policy = await readIdentityMobileTenantPolicy(tx, organizationId, "TIME")
      if (administrator.mode === "LEGACY" && policy.identityEnabled && policy.licensed) return { kind: "administrator_setup" }
      if (administrator.mode === "CANONICAL" && policy.identityEnabled && policy.licensed) {
        const pending = await tx.identityOnboardingIntent.findFirst({ where: { organizationId, normalizedPhone, application: "TIME", status: "ACTIVE" },
          select: { id: true, userId: true, expiresAt: true } })
        if (pending) {
          const person = await tx.user.findFirst({ where: { organizationId, id: pending.userId, isActive: true, anonymizedAt: null }, select: { name: true } })
          if (person) return { kind: "pending", userId: pending.userId, name: person.name, intentId: pending.id, expiresAt: pending.expiresAt.toISOString() }
        }
      }
      return await readLegacyTimeCandidate(tx, administrator, normalizedPhone) ?? { kind: "none" }
    }
    const policy = await readIdentityMobileTenantPolicy(tx, organizationId, "TIME")
    if (!policy.identityEnabled || !policy.licensed) throw new IdentityRegistryError("IDENTITY_APPLICATION_DISABLED")
    const person = await tx.user.findFirst({ where: { organizationId, id: claim.userId, isActive: true, anonymizedAt: null }, select: { name: true } })
    if (!person) throw new IdentityRegistryError("IDENTITY_SUBJECT_UNAVAILABLE")
    const cards = await tx.mtmAgent.findMany({ where: { organizationId, userId: claim.userId, role: "EMPLOYEE" }, select: { id: true, status: true, attendanceParticipant: true, attendanceExcluded: true }, take: 2 })
    if (cards.length > 1) throw new IdentityRegistryError("IDENTITY_EXISTING_ACTOR_REVIEW_REQUIRED")
    const timeKey = { organizationId_userId_application: { organizationId, userId: claim.userId, application: "TIME" } }
    const grant = await tx.identityApplicationGrant.findUnique({ where: timeKey })
    const member = await tx.identityApplicationMembership.findUnique({ where: timeKey })
    const card = cards[0]
    const timeEnrolled = !!card && card.status === "ACTIVE" && card.attendanceParticipant && !card.attendanceExcluded
      && grant?.status === "ACTIVE" && grant.role === "EMPLOYEE" && member?.status === "ACTIVE" && member.actorId === card.id
    return { kind: "canonical", userId: claim.userId, name: person.name, claimId: claim.id, accountVersion: claim.account.version, timeActorId: card?.id ?? null, timeEnrolled, timeEnrollmentBlocked: !!card && (card.status !== "ACTIVE" || card.attendanceExcluded) }
  })
}

/** Explicitly connect an owned Time card or create a separate one, atomically
 * with its grant/membership. Existing HR metadata/history and exclusions are
 * preserved. No second User, credential, phone claim or Field mutation. */
export async function enrollExistingIdentityInTime(client: RegistryClient, administrator: IdentityAdministrator, raw: unknown) {
  return withIdentityAdministrator(client, administrator, tx => enrollExistingIdentityInTimeInTransaction(tx, administrator, raw))
}

/** Used by reviewed first login to commit cutover and the complete Time card together. */
export async function enrollExistingIdentityInTimeInTransaction(tx: Prisma.TransactionClient, administrator: IdentityAdministrator, raw: unknown) {
  const parsed = IdentityTimeEnrollmentInput.safeParse(raw)
  if (!parsed.success) throw new IdentityRegistryError("IDENTITY_TIME_ENROLLMENT_INVALID")
  const input = parsed.data, organizationId = administrator.organizationId
  const requestHash = createHash("sha256").update(JSON.stringify([1, organizationId, administrator.userId,
    input.userId, input.expectedActorId ?? null, input.expectedClaimId, input.expectedAccountVersion, input.position, input.departmentId, input.newDepartmentName ?? null,
    input.teamId, input.newTeamName ?? null, input.hireDate])).digest("hex")
  return withIdentityAdministratorInTransaction(tx, administrator, async tx => {
    const previous = await tx.mtmAuditLog.findFirst({ where: { organizationId, action: "MTM_IDENTITY_TIME_ENROLLED",
      newData: { path: ["clientRequestId"], equals: input.requestId } }, select: { agentId: true, newData: true } })
    if (previous) {
      const data = previous.newData as Record<string, unknown> | null
      if (data?.requestHash !== requestHash || !previous.agentId || typeof data.name !== "string") throw new IdentityRegistryError("IDENTITY_REQUEST_REUSED")
      return { agentId: previous.agentId, name: data.name, replayed: true }
    }
    await tx.$queryRaw`SELECT id FROM identity_phone_claims WHERE "organizationId"=${organizationId} AND "userId"=${input.userId} FOR SHARE`
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_userId: { organizationId, userId: input.userId } } })
    if (claim?.id !== input.expectedClaimId) throw new IdentityRegistryError("IDENTITY_ACCOUNT_STALE")
    const actorInput = { userId: input.userId, application: "TIME" as const, role: "EMPLOYEE", actorId: input.expectedActorId ?? null,
      expectedAccountVersion: input.expectedAccountVersion, reviewReference: `time-review:${input.requestId}`, requestId: `time-card:${input.requestId}` }
    const card = await prepareIdentityApplicationActorInTransaction(tx, administrator, actorInput)
    const timeKey = { organizationId_userId_application: { organizationId, userId: input.userId, application: "TIME" } }
    const existingGrant = await tx.identityApplicationGrant.findUnique({ where: timeKey })
    const existingMember = await tx.identityApplicationMembership.findUnique({ where: timeKey })
    const oldCard = input.expectedActorId ? await tx.mtmAgent.findFirst({ where: { organizationId, id: card.actorId },
      select: { attendanceParticipant: true, attendanceExcluded: true } }) : null
    if (input.expectedActorId && (!oldCard || oldCard.attendanceExcluded)) throw new IdentityRegistryError("IDENTITY_TIME_CARD_REVIEW_REQUIRED")
    if (oldCard?.attendanceParticipant && !oldCard.attendanceExcluded && existingGrant?.status === "ACTIVE" && existingMember?.status === "ACTIVE") {
      throw new IdentityRegistryError("IDENTITY_TIME_ALREADY_ENROLLED")
    }
    await enrollIdentityApplicationInTransaction(tx, administrator, { userId: input.userId, actorId: card.actorId, application: "TIME", role: "EMPLOYEE", status: "ACTIVE",
      expectedAccountVersion: card.accountVersion, expectedGrantVersion: existingGrant?.version ?? 0, expectedMembershipVersion: existingMember?.version ?? 0, requestId: `time-grant:${input.requestId}` })
    // Existing history/profile has its own editor. Connecting its access must
    // not overwrite it with the new-person form's default empty fields.
    const unit = input.expectedActorId ? null : await resolveAttendanceUnit(tx, organizationId, input)
    const person = await tx.mtmAgent.update({ where: { organizationId, id: card.actorId }, data: input.expectedActorId
      ? { attendanceParticipant: true } : { position: input.position, ...unit },
      select: { name: true, position: true, teamId: true, departmentId: true } })
    if (input.hireDate && !input.expectedActorId) {
      await tx.$queryRaw`SELECT id FROM mtm_settings WHERE "organizationId"=${organizationId} AND key='timezone' FOR SHARE`
      const setting = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } })
      const timezone = setting?.value ?? "Asia/Baku"
      if (typeof timezone !== "string" || !isValidTimezone(timezone)) throw new IdentityRegistryError("IDENTITY_TIMEZONE_INVALID")
      await recordAttendanceInitialHire(tx, { organizationId, userId: administrator.userId, principalType: "session" }, card.actorId, input.hireDate, timezone)
    }
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: administrator.userId, agentId: card.actorId, entity: "agent", entityId: card.actorId,
      action: "MTM_IDENTITY_TIME_ENROLLED", metadataKind: "mtm_attendance_employment", ...(oldCard ? { oldData: oldCard } : {}), newData: {
        clientRequestId: input.requestId, requestHash, userId: input.userId, claimId: claim.id, name: person.name,
        position: person.position, teamId: person.teamId, departmentId: person.departmentId, hireDate: input.expectedActorId ? null : input.hireDate, reusedActor: !!input.expectedActorId,
      } } })
    return { agentId: card.actorId, name: person.name, replayed: false }
  })
}
