import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceRiskDetailsSchema, type AttendanceRiskKind } from "@/lib/mtm/attendance-risk-contract"
import { notifyAttendanceRiskReviewers } from "@/lib/mtm/attendance-risk-notify"
import { lockAttendanceRiskPolicy, readAttendanceRiskPolicy, type AttendanceRiskPolicy } from "@/lib/mtm/attendance-risk-policy"
import { isValidTimezone } from "@/lib/timezone"
import { WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS } from "@/lib/mtm/workday"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"

export const ATTENDANCE_RISK_DETECTOR_VERSION = "mtm-attendance-risk-v1"
type Details = Parameters<typeof AttendanceRiskDetailsSchema.parse>[0]
// Prisma represents a PostgreSQL DATE as UTC midnight. Bind its calendar text,
// not a timestamptz whose implicit conversion depends on the session timezone.
const utcCalendarDate = (value: Date) => value.toISOString().slice(0, 10)
export type AttendanceRiskFact = { agentId: string; eventId: string; installationId: string; workDate: Date; claimedAt: Date; serverReceivedAt: Date;
  isMock: boolean | null; locationState: string; distanceMeters: number | null; branchRevisionId: string | null }
export function attendanceTimingRisk(claimedAt: Date, receivedAt: Date, threshold: number): { kind: AttendanceRiskKind; details: Details } | null {
  const deltaSeconds = Math.trunc((receivedAt.getTime() - claimedAt.getTime()) / 1000)
  if (!Number.isFinite(deltaSeconds)) return null
  // Offline delivery and clock difference cannot be distinguished from these
  // two times. Neither hint asserts clock manipulation or changes paid time.
  if (deltaSeconds * 1000 > WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS) return { kind: "DELAYED_CLAIM", details: { version: 1, deltaSeconds, thresholdSeconds: WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS / 1000 } }
  return Math.abs(deltaSeconds) > threshold ? { kind: "CLOCK_DIFFERENCE", details: { version: 1, deltaSeconds, thresholdSeconds: threshold } } : null
}
export function usualAttendanceInstallationUser(rows: readonly { agentId: string; workDate: Date }[]) {
  const all = new Set<string>(), days = new Map<string, Set<string>>()
  for (const row of rows) {
    const date = row.workDate.toISOString().slice(0, 10); all.add(date)
    if (!days.has(row.agentId)) days.set(row.agentId, new Set())
    days.get(row.agentId)!.add(date)
  }
  const ranked = [...days].map(([id, dates]) => ({ id, count: dates.size })).sort((a,b) => b.count-a.count || a.id.localeCompare(b.id))
  const first = ranked[0]
  const known = all.size >= 3 && first && first.count / all.size >= 0.8 && first.count > (ranked[1]?.count ?? 0)
  return { usualAgentId: known ? first.id : null, usualDays: known ? first.count : 0, observedDays: all.size }
}
export async function enforceAttendanceMockRule(tx: Prisma.TransactionClient, organizationId: string, isMock: boolean | null) {
  await lockAttendanceRiskPolicy(tx, organizationId)
  const policy = await readAttendanceRiskPolicy(tx, organizationId)
  if (isMock === true && policy.rejectMockLocations) throw new AttendanceRequestError("MTM_ATTENDANCE_LOCATION_MOCK_REJECTED", 422)
  return policy
}

/** Canonical workday → attendance request → location policy → risk policy →
 * installation lock. Never lock another employee's workday when adding their
 * review hint: two different people can safely submit on the same phone. */
export async function recordAttendanceRisks(tx: Prisma.TransactionClient, input: { organizationId: string; eventId: string; policy: AttendanceRiskPolicy }) {
  const { organizationId, eventId, policy } = input
  if (!await readAttendanceFeature(tx, organizationId)) return
  const [fact] = await tx.$queryRaw<AttendanceRiskFact[]>`SELECT m."agentId",m."eventId",m."installationId",m."claimedAt",m."serverReceivedAt",m."isMock",m."locationState",m."distanceMeters",m."branchRevisionId",w."workDate"
    FROM mtm_attendance_mark_evidence m JOIN mtm_agent_workday_events e ON e."organizationId"=m."organizationId" AND e.id=m."eventId"
    JOIN mtm_agent_workdays w ON w."organizationId"=e."organizationId" AND w.id=e."workdayId"
    WHERE m."organizationId"=${organizationId} AND m."eventId"=${eventId}`
  if (!fact) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_EVIDENCE_MISSING", 409)
  // The ID is not an authentication credential or proof of physical hardware.
  const lock = `mtm-attendance-risk-installation:${organizationId}:${fact.installationId}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`
  const timezoneRow = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } })
  const timezone = typeof timezoneRow?.value === "string" && isValidTimezone(timezoneRow.value) ? timezoneRow.value : "Asia/Baku"
  async function add(subject: Pick<AttendanceRiskFact, "eventId" | "agentId" | "workDate">, kind: AttendanceRiskKind, values: Details) {
    const details = AttendanceRiskDetailsSchema.parse(values)
    const created = await tx.$queryRaw<{ id: string }[]>`INSERT INTO mtm_attendance_risk_cases
      (id,"organizationId","agentId","eventId",kind,"workDate",timezone,"detectorVersion","policySnapshot",details)
      VALUES (${randomUUID()},${organizationId},${subject.agentId},${subject.eventId},${kind},${utcCalendarDate(subject.workDate)}::date,${timezone},${ATTENDANCE_RISK_DETECTOR_VERSION},${JSON.stringify(policy)}::jsonb,${JSON.stringify(details)}::jsonb)
      ON CONFLICT ("organizationId","eventId",kind) DO NOTHING RETURNING id`
    if (created[0]) await notifyAttendanceRiskReviewers(tx, { organizationId, agentId: subject.agentId, caseId: created[0].id })
  }
  const timing = attendanceTimingRisk(fact.claimedAt, fact.serverReceivedAt, policy.clockDifferenceSeconds)
  if (timing) await add(fact, timing.kind, timing.details)
  if (fact.isMock === true) await add(fact, "MOCK_LOCATION", { version: 1 })
  if (fact.locationState === "OUTSIDE") await add(fact, "OUTSIDE_BRANCH", { version: 1, distanceMeters: fact.distanceMeters, branchRevisionId: fact.branchRevisionId })
  // A first-ever observed installation is an unknown baseline. Signing out
  // and back in preserves the same ID; reinstall/restore may produce a new one.
  const [prior] = await tx.$queryRaw<{ anySeen: boolean; sameSeen: boolean }[]>`SELECT
    EXISTS(SELECT 1 FROM mtm_attendance_mark_evidence WHERE "organizationId"=${organizationId} AND "agentId"=${fact.agentId} AND "eventId"<>${eventId}) AS "anySeen",
    EXISTS(SELECT 1 FROM mtm_attendance_mark_evidence WHERE "organizationId"=${organizationId} AND "agentId"=${fact.agentId} AND "eventId"<>${eventId} AND "installationId"=${fact.installationId}) AS "sameSeen"`
  if (prior?.anySeen && !prior.sameSeen) await add(fact, "NEW_INSTALLATION", { version: 1 })
  if (policy.allowSharedInstallations) return
  const peers = await tx.$queryRaw<Pick<AttendanceRiskFact, "agentId" | "eventId" | "workDate">[]>`SELECT m."agentId",m."eventId",w."workDate"
    FROM mtm_attendance_mark_evidence m JOIN mtm_agent_workday_events e ON e."organizationId"=m."organizationId" AND e.id=m."eventId"
    JOIN mtm_agent_workdays w ON w."organizationId"=e."organizationId" AND w.id=e."workdayId"
    WHERE m."organizationId"=${organizationId} AND m."installationId"=${fact.installationId} AND w."workDate"=${utcCalendarDate(fact.workDate)}::date
    ORDER BY m."agentId",m."eventId" LIMIT 10001`
  if (peers.length > 10000) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_COHORT_TOO_LARGE", 422)
  const agents = [...new Set(peers.map(row => row.agentId))].sort()
  if (agents.length < 2) return
  const from = new Date(fact.workDate.getTime() - 30*86400000)
  const history = await tx.$queryRaw<{ agentId: string; workDate: Date }[]>`SELECT DISTINCT m."agentId",w."workDate"
    FROM mtm_attendance_mark_evidence m JOIN mtm_agent_workday_events e ON e."organizationId"=m."organizationId" AND e.id=m."eventId"
    JOIN mtm_agent_workdays w ON w."organizationId"=e."organizationId" AND w.id=e."workdayId"
    WHERE m."organizationId"=${organizationId} AND m."installationId"=${fact.installationId} AND w."workDate">=${utcCalendarDate(from)}::date AND w."workDate"<${utcCalendarDate(fact.workDate)}::date`
  const usual = usualAttendanceInstallationUser(history)
  for (const peer of peers) await add(peer, "SHARED_INSTALLATION", { version: 1, relatedAgentIds: agents.filter(id => id !== peer.agentId), ...usual })
}
