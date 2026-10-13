import { createHash, randomUUID } from "node:crypto"
import { enforceAttendanceOutsideRule } from "@/lib/mtm/attendance-outside-rule"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { lockAttendanceRequests, requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceLocationPolicyInputSchema, AttendanceLocationConsentInputSchema, evaluateAttendanceLocation,
  type AttendanceLocationPolicy, type OwnAttendanceLocation, type AttendanceBranchFix } from "@/lib/mtm/attendance-location-contract"
import { mtmWorkdayRequestHash, type MtmWorkdayEventInput, type MtmWorkdayPostEventContext } from "@/lib/mtm/workday"
import { MTM_WORKDAY_PAUSE_EVENT_TYPES, mtmWorkdayPauses, isDuringMtmWorkdayPause } from "@/lib/mtm/workday-pauses"

type Tx = Prisma.TransactionClient
type PolicyRow = Omit<AttendanceLocationPolicy,"createdAt"> & { createdAt: Date; requestHash: string; createdBy: string }
type ConsentRow = { id: string; policyRevisionId: string; accepted: boolean; createdAt: Date; version: number; requestHash: string }
const reject = (suffix: string, status = 409): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_LOCATION_${suffix}`,status) }
const digest = (owner: string, data: unknown) => createHash("sha256").update(JSON.stringify({ owner,data })).digest("hex")
const policyDto = (row: PolicyRow): AttendanceLocationPolicy => ({ id:row.id,version:row.version,enabled:row.enabled,texts:row.texts,legalReviewConfirmed:row.legalReviewConfirmed,createdAt:row.createdAt.toISOString() })
async function currentPolicy(tx: Tx, organizationId: string) {
  const [row] = await tx.$queryRaw<PolicyRow[]>`SELECT * FROM mtm_attendance_location_policies WHERE "organizationId"=${organizationId} ORDER BY version DESC LIMIT 1`
  return row ?? null
}
async function currentConsent(tx: Tx, self: Pick<AttendanceSelf,"organizationId"|"agentId">) {
  const [row] = await tx.$queryRaw<ConsentRow[]>`SELECT * FROM mtm_attendance_location_consents WHERE "organizationId"=${self.organizationId} AND "agentId"=${self.agentId} ORDER BY version DESC LIMIT 1`
  return row ?? null
}
async function lockLocationPolicy(tx: Tx, organizationId: string, exclusive = false) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-location:${organizationId}`},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`mtm-attendance-location:${organizationId}`},0))`
}
async function requireAdministrator(tx: Tx, reviewer: AttendanceReviewer) {
  await resolveAttendanceReviewerScope(tx,reviewer)
  const [user] = await tx.$queryRaw<{role:string}[]>`SELECT role FROM users WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !["admin","superadmin"].includes(user.role)) return reject("ADMIN_REQUIRED",403)
}
export async function readAttendanceLocationPolicy(reviewer: AttendanceReviewer) {
  return prisma.$transaction(async tx => {
    await requireAdministrator(tx,reviewer)
    const row = await currentPolicy(tx,reviewer.organizationId)
    return { policy:row ? policyDto(row):null }
  },{ isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead })
}
export async function publishAttendanceLocationPolicy(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceLocationPolicyInputSchema.safeParse(raw)
  if (!parsed.success) return reject("POLICY_INVALID",400)
  const input = parsed.data, hash = digest(reviewer.userId,input)
  return prisma.$transaction(async tx => {
    await lockLocationPolicy(tx,reviewer.organizationId,true)
    await tx.$queryRaw`SELECT id FROM mtm_settings WHERE "organizationId"=${reviewer.organizationId} AND key='attendanceEnabled' FOR SHARE`
    await requireAdministrator(tx,reviewer)
    const [replay] = await tx.$queryRaw<PolicyRow[]>`SELECT * FROM mtm_attendance_location_policies WHERE "organizationId"=${reviewer.organizationId} AND "requestId"=${input.requestId}`
    if (replay) {
      if (replay.requestHash!==hash || replay.createdBy!==reviewer.userId) return reject("REPLAY_MISMATCH")
      return { policy:policyDto(replay),idempotent:true }
    }
    const before = await currentPolicy(tx,reviewer.organizationId)
    if ((before?.id ?? null)!==input.expectedRevisionId) return reject("POLICY_CHANGED")
    const [row] = await tx.$queryRaw<PolicyRow[]>`INSERT INTO mtm_attendance_location_policies
      (id,"organizationId",version,"previousId","requestId","requestHash",enabled,texts,"legalReviewConfirmed","createdBy")
      VALUES (${randomUUID()},${reviewer.organizationId},${(before?.version??0)+1},${before?.id??null},${input.requestId},${hash},${input.enabled},${JSON.stringify(input.texts)}::jsonb,${input.legalReviewConfirmed},${reviewer.userId}) RETURNING *`
    await tx.mtmAuditLog.create({data:{organizationId:reviewer.organizationId,actorUserId:reviewer.userId,action:"MTM_ATTENDANCE_LOCATION_POLICY_PUBLISHED",entity:"mtm_attendance_location_policy",entityId:row.id,metadataKind:"mtm_attendance_location_policy",newData:{revisionId:row.id,enabled:row.enabled,legalReviewConfirmed:row.legalReviewConfirmed}}})
    return { policy:policyDto(row),idempotent:false }
  },{timeout:15_000})
}
export async function readOwnAttendanceLocation(self: AttendanceSelf): Promise<OwnAttendanceLocation> {
  return prisma.$transaction(async tx => {
    await requireAttendanceSelf(tx,self,"attendanceLocation")
    const policy = await currentPolicy(tx,self.organizationId), consent = await currentConsent(tx,self)
    return {policy:policy ? policyDto(policy):null,consent:consent ? {id:consent.id,policyRevisionId:consent.policyRevisionId,accepted:consent.accepted,createdAt:consent.createdAt.toISOString()}:null,
      maySendLocation:policy?.enabled===true && consent?.accepted===true && consent.policyRevisionId===policy.id}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})
}
export async function recordOwnAttendanceLocationConsent(self: AttendanceSelf, raw: unknown) {
  const parsed = AttendanceLocationConsentInputSchema.safeParse(raw)
  if (!parsed.success) return reject("CONSENT_INVALID",400)
  const input = parsed.data, hash = digest(self.agentId,input)
  return prisma.$transaction(async tx => {
    await lockAttendanceRequests(tx,self)
    await requireAttendanceSelf(tx,self,"attendanceLocation")
    await lockLocationPolicy(tx,self.organizationId)
    const [replay] = await tx.$queryRaw<ConsentRow[]>`SELECT * FROM mtm_attendance_location_consents WHERE "organizationId"=${self.organizationId} AND "agentId"=${self.agentId} AND "requestId"=${input.requestId}`
    if (replay) {
      if (replay.requestHash!==hash) return reject("REPLAY_MISMATCH")
      return {consent:{id:replay.id,accepted:replay.accepted,policyRevisionId:replay.policyRevisionId,createdAt:replay.createdAt.toISOString()},idempotent:true}
    }
    const policy = await currentPolicy(tx,self.organizationId), before = await currentConsent(tx,self)
    if ((before?.id??null)!==input.expectedConsentId) return reject("CONSENT_CHANGED")
    if (input.accepted && (!policy?.enabled || policy.id!==input.policyRevisionId)) return reject("POLICY_CHANGED")
    // Withdrawal remains possible after the tenant has replaced/disabled the
    // text. It references exactly the employee's preceding acceptance.
    if (!input.accepted && (!before || before.policyRevisionId!==input.policyRevisionId)) return reject("CONSENT_CHANGED")
    const [row] = await tx.$queryRaw<ConsentRow[]>`INSERT INTO mtm_attendance_location_consents
      (id,"organizationId","agentId","policyRevisionId",version,"previousId","requestId","requestHash",accepted)
      VALUES (${randomUUID()},${self.organizationId},${self.agentId},${input.policyRevisionId},${(before?.version??0)+1},${before?.id??null},${input.requestId},${hash},${input.accepted}) RETURNING *`
    return {consent:{id:row.id,accepted:row.accepted,policyRevisionId:row.policyRevisionId,createdAt:row.createdAt.toISOString()},idempotent:false}
  },{timeout:15_000})
}

/** Forget queued location without changing the identity or time of its action.
 * This fingerprint is written atomically with the original evidence. A retry
 * can shed location, but can never add/change it or alter another input field. */
export function attendanceMarkRedactedHash(self: Pick<AttendanceSelf,"organizationId"|"agentId">, input: MtmWorkdayEventInput) {
  if (!input.attendanceMark) return null
  return mtmWorkdayRequestHash(self,{...input,attendanceMark:{...input.attendanceMark,locationState:"NO_CONSENT",location:null,consentRevisionId:null}})
}
export async function isAttendanceMarkRedactedReplay(tx: Pick<Tx,"$queryRaw">, self: Pick<AttendanceSelf,"organizationId"|"agentId">, input: MtmWorkdayEventInput, originalHash: string | null | undefined) {
  const mark=input.attendanceMark
  if (!originalHash || !mark || mark.locationState!=="NO_CONSENT" || mark.location!==null || mark.consentRevisionId!==null) return false
  const hash=mtmWorkdayRequestHash(self,input)
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT m.id FROM mtm_attendance_mark_evidence m
    JOIN mtm_agent_workday_events e ON e."organizationId"=m."organizationId" AND e.id=m."eventId" AND e."agentId"=m."agentId"
    WHERE m."organizationId"=${self.organizationId} AND m."agentId"=${self.agentId}
      AND e."clientEventId"=${input.clientEventId} AND e."requestHash"=${originalHash}
      AND m."redactedRequestHash"=${hash} LIMIT 1`
  return rows.length===1
}

/** Runs inside the canonical workday transaction. It does not update an event
 * or a closed day. A failure rolls back the event and its receipt together. */
export async function recordAttendanceMarkEvidence(tx: Tx, context: MtmWorkdayPostEventContext, self: AttendanceSelf) {
  const mark = context.input.attendanceMark
  if (!mark) return
  if (!["START","FINISH"].includes(context.input.action)) return reject("BREAK_PRIVACY",400)
  await lockLocationPolicy(tx,self.organizationId)
  let onBreak = context.input.action==="FINISH" && context.beforeWorkday?.status==="PAUSED"
  if (!onBreak && mark.location) {
    // Also covers a new START whose cached fix belongs to yesterday's break.
    // Read the employee's journal up to capture time, including the previous
    // closing boundary and any REOPEN at that same instant. Only the shared
    // reader decides whether this context describes a private interval.
    const capturedAt=new Date(mark.location.capturedAt)
    const boundary=await tx.mtmAgentWorkdayEvent.findFirst({where:{organizationId:self.organizationId,agentId:self.agentId,type:"FINISH",occurredAt:{lte:capturedAt}},select:{occurredAt:true},orderBy:[{occurredAt:"desc"},{appliedAt:"desc"},{id:"desc"}]})
    const events = await tx.mtmAgentWorkdayEvent.findMany({where:{organizationId:self.organizationId,agentId:self.agentId,type:{in:[...MTM_WORKDAY_PAUSE_EVENT_TYPES]},occurredAt:{lte:capturedAt,...(boundary?{gte:boundary.occurredAt}:{})}},
      select:{type:true,occurredAt:true,appliedAt:true},orderBy:[{occurredAt:"asc"},{appliedAt:"asc"},{id:"asc"}],take:10001})
    onBreak=events.length>10000||isDuringMtmWorkdayPause(capturedAt,mtmWorkdayPauses(events))
  }
  let consent: ConsentRow | null = null
  let location = onBreak ? null : mark.location
  if (location) {
    const policy = await currentPolicy(tx,self.organizationId)
    consent = await currentConsent(tx,self)
    // Consent can be withdrawn while a phone is offline. Keep its time mark,
    // but discard the now-unapproved location before any evidence is written.
    if (!policy?.enabled || !consent?.accepted || consent.id!==mark.consentRevisionId || consent.policyRevisionId!==policy.id
      || new Date(location.capturedAt)<consent.createdAt) {
      location=null;consent=null
    }
  }
  const primary = location ? (await tx.$queryRaw<{branchId:string|null}[]>`SELECT "branchId" FROM mtm_attendance_primary_branch_revisions WHERE "organizationId"=${self.organizationId} AND "agentId"=${self.agentId} AND "createdAt"<=${context.input.claimedAt} ORDER BY version DESC LIMIT 1`)[0]?.branchId??null:null
  const branches = location ? await tx.$queryRaw<AttendanceBranchFix[]>`SELECT id,"branchId",name,latitude,longitude,"radiusMeters" FROM
    (SELECT DISTINCT ON ("branchId") * FROM mtm_attendance_branch_revisions WHERE "organizationId"=${self.organizationId} AND "createdAt"<=${context.input.claimedAt} ORDER BY "branchId",version DESC) versions WHERE active LIMIT 1001`:[]
  if (branches.length>1000) return reject("BRANCHES_TOO_LARGE",422)
  const evaluation = evaluateAttendanceLocation({...mark,location,locationState:location?"AVAILABLE":mark.location?"NO_CONSENT":mark.locationState},context.input.claimedAt,branches,primary)
  const finding = onBreak ? "BREAK_PRIVACY":evaluation.finding
  await enforceAttendanceOutsideRule(tx,self.organizationId,finding)
  await tx.$executeRaw`INSERT INTO mtm_attendance_mark_evidence
    (id,"organizationId","agentId","eventId","installationId",action,"claimedAt","serverReceivedAt","locationState",latitude,longitude,accuracy,"fixCapturedAt","fixAgeSeconds",provider,"isMock","consentId","branchRevisionId","primaryBranchId","distanceMeters","redactedRequestHash")
    VALUES (${randomUUID()},${self.organizationId},${self.agentId},${context.event.id},${mark.installationId},${context.input.action},${context.input.claimedAt},${context.input.serverReceivedAt},${finding},${location?.latitude??null},${location?.longitude??null},${location?.accuracy??null},${location?new Date(location.capturedAt):null},${evaluation.fixAgeSeconds},${location?.provider??null},${location?.isMock??null},${consent?.id??null},${evaluation.branch?.id??null},${primary},${evaluation.distanceMeters},${attendanceMarkRedactedHash(self,context.input)})`
}
