import { z } from "zod"

export const AttendanceQrInputSchema = z.object({ version: z.literal(1), token: z.string().min(1).max(2048).nullable() }).strict()
export const ATTENDANCE_QR_STATES = ["VERIFIED", "NOT_PROVIDED", "EXPIRED", "INVALID", "BRANCH_CHANGED", "REUSED"] as const
export type AttendanceQrState = typeof ATTENDANCE_QR_STATES[number]
export type AttendanceQrInput = z.infer<typeof AttendanceQrInputSchema>
export type AttendanceQrReceipt = { eventId: string; state: AttendanceQrState; branch: { id: string; name: string } | null }
export type AttendanceQrDirectory = { enabled: boolean; canConfigure: boolean; branches: { id: string; name: string }[] }
export type AttendanceQrDisplay = { branch: { id: string; name: string }; dataUrl: string; serverNow: string; expiresAt: string }
