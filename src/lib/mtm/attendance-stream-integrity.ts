import type { Prisma } from "@prisma/client"
import { currentAttendanceStreamConsent } from "@/lib/mtm/attendance-location-store"

export type AttendanceStreamSignal = { isMock?: boolean; attendanceConsentId?: string }

/** Unknown remains absent; strings such as "false" must never become truthy. */
export function parseAttendanceStreamSignal(value: Record<string, unknown>): AttendanceStreamSignal | null {
  if (value.isMock!==undefined && typeof value.isMock!=="boolean") return null
  if (value.attendanceConsentId!==undefined && (typeof value.attendanceConsentId!=="string" || value.attendanceConsentId.length<1 || value.attendanceConsentId.length>128)) return null
  return {...(typeof value.isMock==="boolean"?{isMock:value.isMock}:{}),
    ...(typeof value.attendanceConsentId==="string"?{attendanceConsentId:value.attendanceConsentId}:{})}
}

export async function prepareAttendanceStreamIntegrity(tx: Prisma.TransactionClient,
  self: {organizationId:string;agentId:string}, points: AttendanceStreamSignal[]) {
  if (!points.some(p=>typeof p.isMock==="boolean" && p.attendanceConsentId)) return null
  return currentAttendanceStreamConsent(tx,self)
}

/** A separate private row keeps legacy location responses byte-shape compatible.
 * The first accepted GPS point owns its immutable signal. Replays never enrich
 * or replace it, including a replay after withdrawing consent. */
export async function recordAttendanceStreamIntegrity(tx: Prisma.TransactionClient,
  input: AttendanceStreamSignal & {organizationId:string;agentId:string;locationId:string;recordedAt:Date},
  consent: {id:string;createdAt:Date}|null) {
  if (!consent || typeof input.isMock!=="boolean" || input.attendanceConsentId!==consent.id || input.recordedAt<consent.createdAt) return
  await tx.$executeRaw`INSERT INTO mtm_attendance_stream_integrity
    ("locationId","organizationId","agentId","consentId","isMock")
    VALUES (${input.locationId},${input.organizationId},${input.agentId},${consent.id},${input.isMock})`
}
