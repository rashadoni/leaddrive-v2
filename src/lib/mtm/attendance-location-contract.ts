import { z } from "zod"

const id = z.string().trim().min(1).max(191)
const consentText = z.object({ az: z.string().trim().max(8000), ru: z.string().trim().max(8000), en: z.string().trim().max(8000) }).strict()
/** No supplied legal text is treated as approved. Activation requires an
 * administrator to provide the client's text in all supported languages and
 * explicitly attest its review; the original publication is never rewritten. */
export const AttendanceLocationPolicyInputSchema = z.object({
  requestId: z.string().uuid(), expectedRevisionId: id.nullable(), enabled: z.boolean(),
  texts: consentText, legalReviewConfirmed: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && (!value.legalReviewConfirmed || Object.values(value.texts).some(text => text.length < 20))) {
    ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_LOCATION_LEGAL_TEXT_REQUIRED" })
  }
})
export const AttendanceLocationConsentInputSchema = z.object({
  requestId: z.string().uuid(), policyRevisionId: id, expectedConsentId: id.nullable(), accepted: z.boolean(),
}).strict()

export const AttendanceMarkSchema = z.object({
  version: z.literal(1), installationId: z.string().regex(/^rf-[a-z0-9-]{20,125}$/),
  // The exact own acceptance receipt, not the legal-text publication ID.
  locationState: z.enum(["AVAILABLE", "UNAVAILABLE", "NO_CONSENT"]), consentRevisionId: id.nullable(),
  location: z.object({
    latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(100000), capturedAt: z.string().datetime({ offset: true }),
    provider: z.enum(["FUSED", "GPS", "NETWORK", "PASSIVE", "UNKNOWN"]), isMock: z.boolean(),
  }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.locationState === "AVAILABLE") !== (value.location !== null)
    || (value.location !== null && !value.consentRevisionId)) {
    ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_MARK_LOCATION_INVALID" })
  }
})
export type AttendanceMark = z.infer<typeof AttendanceMarkSchema>
export type AttendanceLocationPolicy = { id: string; version: number; enabled: boolean; texts: { az: string; ru: string; en: string }; legalReviewConfirmed: boolean; createdAt: string }
export type OwnAttendanceLocation = { policy: AttendanceLocationPolicy | null; consent: { id: string; policyRevisionId: string; accepted: boolean; createdAt: string } | null; maySendLocation: boolean }
export type AttendanceBranchFix = { id: string; branchId: string; name: string; latitude: number; longitude: number; radiusMeters: number }
export type AttendanceLocationFinding = "INSIDE" | "OUTSIDE" | "UNCERTAIN" | "UNCONFIGURED" | "UNAVAILABLE" | "NO_CONSENT" | "BREAK_PRIVACY"

export function attendanceDistanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180
  const h = Math.sin((a.latitude-b.latitude)*radians/2)**2
    + Math.cos(a.latitude*radians)*Math.cos(b.latitude*radians)*Math.sin((a.longitude-b.longitude)*radians/2)**2
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)))
}
/** Accuracy and a stale fix cannot establish presence or an outside violation.
 * Boundaries use the accuracy circle, with a fixed documented 2-minute age. */
export function evaluateAttendanceLocation(mark: AttendanceMark, claimedAt: Date, branches: AttendanceBranchFix[], primaryBranchId: string | null) {
  const location = mark.location
  if (!location) return { finding: mark.locationState as "UNAVAILABLE" | "NO_CONSENT", branch: null, distanceMeters: null, fixAgeSeconds: null }
  const fixAgeSeconds = Math.max(-2147483648,Math.min(2147483647,Math.round((claimedAt.getTime()-new Date(location.capturedAt).getTime())/1000)))
  const candidates = branches.map(branch => ({ branch, distanceMeters: attendanceDistanceMeters(location, branch) }))
    .sort((a,b) => a.distanceMeters-b.distanceMeters || a.branch.id.localeCompare(b.branch.id))
  const inside = candidates.filter(value => value.distanceMeters + location.accuracy <= value.branch.radiusMeters)
  const chosen = inside.find(value => value.branch.branchId === primaryBranchId) ?? inside[0] ?? candidates[0] ?? null
  const finding: AttendanceLocationFinding = location.isMock || fixAgeSeconds < -30 || fixAgeSeconds > 120 || location.accuracy > 100
    ? "UNCERTAIN" : !chosen ? "UNCONFIGURED" : inside.length ? "INSIDE"
      : candidates.some(value => value.distanceMeters-location.accuracy <= value.branch.radiusMeters) ? "UNCERTAIN" : "OUTSIDE"
  return { finding, branch: chosen?.branch ?? null, distanceMeters: chosen ? Math.round(chosen.distanceMeters) : null, fixAgeSeconds }
}
