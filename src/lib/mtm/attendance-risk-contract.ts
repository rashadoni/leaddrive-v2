import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
export const ATTENDANCE_RISK_KINDS = ["SHARED_INSTALLATION", "MOCK_LOCATION", "OUTSIDE_BRANCH", "CLOCK_DIFFERENCE", "DELAYED_CLAIM", "NEW_INSTALLATION"] as const
export const AttendanceRiskKindSchema = z.enum(ATTENDANCE_RISK_KINDS)
export type AttendanceRiskKind = z.infer<typeof AttendanceRiskKindSchema>
export const ATTENDANCE_RISK_LIMIT = 10000
export const AttendanceRiskQuerySchema = z.object({
  from: z.string().refine(isDateKey), to: z.string().refine(isDateKey),
  status: z.enum(["ALL", "OPEN", "DISMISSED"]).default("OPEN"),
  kind: z.enum(["ALL", ...ATTENDANCE_RISK_KINDS]).default("ALL"),
  teamId: z.string().trim().max(128).default(""), employeeId: z.string().trim().max(128).default(""),
}).strict().refine(q => q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) < 366 * 86400000)
export type AttendanceRiskQuery = z.infer<typeof AttendanceRiskQuerySchema>
export const AttendanceRiskDismissSchema = z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).strict()
export const AttendanceRiskSnapshotSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), asOf: z.string().datetime(), query: AttendanceRiskQuerySchema }).strict()
export const AttendanceRiskExportSchema = z.object({ snapshot: AttendanceRiskSnapshotSchema, locale: z.enum(["az", "ru", "en"]), format: z.enum(["xlsx", "pdf"]) }).strict()
export const AttendanceRiskDetailsSchema = z.object({
  version: z.literal(1), relatedAgentIds: z.array(z.string()).max(10000).optional(), usualAgentId: z.string().nullable().optional(),
  usualDays: z.number().int().nonnegative().optional(), observedDays: z.number().int().nonnegative().optional(),
  deltaSeconds: z.number().finite().optional(), thresholdSeconds: z.number().nonnegative().finite().optional(),
  branchRevisionId: z.string().nullable().optional(), distanceMeters: z.number().nonnegative().finite().nullable().optional(),
})
export type AttendanceRiskItem = {
  id: string; employeeId: string; employeeName: string; teamId: string | null; teamName: string | null;
  kind: AttendanceRiskKind; workDate: string; timezone: string; claimedAt: string; serverReceivedAt: string;
  action: "START" | "FINISH"; createdAt: string; canDismiss: boolean;
  relatedNames: string[]; relatedNamesRestricted: boolean; usualName: string | null; usualDays: number | null; observedDays: number | null;
  deltaSeconds: number | null; thresholdSeconds: number | null; branchName: string | null; distanceMeters: number | null;
  dismissal: { at: string; byName: string | null; reason: string } | null;
}
export type AttendanceRiskReport = { directory: { id: string; name: string; teamId: string | null; teamName: string | null }[]; items: AttendanceRiskItem[]; snapshot: z.infer<typeof AttendanceRiskSnapshotSchema> }
export const ATTENDANCE_RISK_MESSAGES = {
  SHARED_INSTALLATION: "riskSharedInstallation", MOCK_LOCATION: "riskMockLocation", OUTSIDE_BRANCH: "riskOutsideBranch",
  CLOCK_DIFFERENCE: "riskClockDifference", DELAYED_CLAIM: "riskDelayedClaim", NEW_INSTALLATION: "riskNewInstallation",
} as const
