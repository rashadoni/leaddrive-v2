import { z } from "zod"

export const AttendanceQrInputSchema = z.object({ version: z.literal(1), token: z.string().min(1).max(2048).nullable() }).strict()
/**
 * AWAY_FROM_BRANCH: a good code, but the phone's own fix was plainly outside that branch.
 * NO_PHONE_FIX: a good code, while the organization collects the place of a mark,
 * but the phone gave no fresh, precise fix at that branch — a code alone confirms nothing.
 */
export const ATTENDANCE_QR_STATES = ["VERIFIED", "NOT_PROVIDED", "EXPIRED", "INVALID", "BRANCH_CHANGED", "REUSED", "AWAY_FROM_BRANCH", "NO_PHONE_FIX"] as const
export type AttendanceQrState = typeof ATTENDANCE_QR_STATES[number]
/**
 * What a phone is told. Every released app build validates the state against
 * exactly these six and drops a receipt with any other, so a newer outcome is
 * told as the nearest old one: an away code "does not fit" the branch.
 */
export const ATTENDANCE_QR_PHONE_STATES = ["VERIFIED", "NOT_PROVIDED", "EXPIRED", "INVALID", "BRANCH_CHANGED", "REUSED"] as const
export type AttendanceQrPhoneState = typeof ATTENDANCE_QR_PHONE_STATES[number]
export function attendanceQrPhoneState(state: string | null | undefined): AttendanceQrPhoneState | null {
  if (state === "AWAY_FROM_BRANCH" || state === "NO_PHONE_FIX") return "INVALID"
  return (ATTENDANCE_QR_PHONE_STATES as readonly string[]).includes(state ?? "") ? state as AttendanceQrPhoneState : null
}
export type AttendanceQrInput = z.infer<typeof AttendanceQrInputSchema>
export type AttendanceQrReceipt = { eventId: string; state: AttendanceQrPhoneState; branch: { id: string; name: string } | null }
export type AttendanceQrDirectory = { enabled: boolean; canConfigure: boolean; branches: { id: string; name: string }[] }
/** Where the screen last said it stood: at its branch, away from it, or it could not tell. Never the coordinates. */
/** NETWORK: on the branch's remembered office network, which stands for its place (owner, 2026-11-04). */
export type AttendanceBranchScreenPlace = { state: "AT_BRANCH" | "AWAY" | "NO_FIX" | "NETWORK"; distanceMeters: number | null; checkedAt: string }
/** `employee`: a desk screen, the employee's own computer; null — a shared reception screen. */
export type AttendanceBranchScreenSummary = { id: string; pairedAt: string; lastSeenAt: string | null; place: AttendanceBranchScreenPlace | null; employee: { id: string; name: string } | null }
/** `deskEnabled`: employees may pair their own computer. `networks`: how many office addresses the branch remembers. */
export type AttendanceBranchScreenDirectory = Omit<AttendanceQrDirectory, "branches"> & { deskEnabled: boolean; branches: { id: string; name: string; markMethod?: "QR_GPS" | "GPS_ONLY"; networks: number; screens: AttendanceBranchScreenSummary[] }[] }
/**
 * What a desk screen shows of its employee (`attendance-desk-rules.ts`): never a
 * place, never the journal — the day's state, its times, and the kinds of a break.
 */
export type AttendanceDeskDay = {
  employeeName: string
  state: "NOT_STARTED" | "RUNNING" | "PAUSED" | "COMPLETED"
  startedAt: string | null; pausedAt: string | null; workedSeconds: number | null; pausedSeconds: number | null
  breaks: { kinds: { id: string; name: string | null; limitMinutes: number | null; usedSeconds: number }[]; currentKindId: string | null } | null
}
export type AttendanceBranchScreenPairing = { branch: { id: string; name: string }; code: string; expiresAt: string }
/** What the branch screen shows; `state` other than SHOWING carries no code. */
export type AttendanceBranchScreenQr =
  | { state: "SHOWING"; organizationName: string; branch: { id: string; name: string }; dataUrl: string; serverNow: string; expiresAt: string; place?: "AT_BRANCH" | "NETWORK"; desk?: AttendanceDeskDay }
  | { state: "UNPAIRED" | "QR_OFF" | "BRANCH_UNAVAILABLE"; organizationName?: string; branch?: { id: string; name: string }; desk?: AttendanceDeskDay }
  // The screen is not at its branch, or could not say precisely where it is: no code.
  | { state: "NOT_AT_BRANCH"; reason: "AWAY" | "NO_FIX"; distanceMeters: number | null; organizationName: string; branch: { id: string; name: string }; desk?: AttendanceDeskDay }
