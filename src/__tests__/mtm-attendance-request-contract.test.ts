import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { AttendanceRequestInputSchema, attendanceRequestMinutes, attendanceRequestWindowsOverlap } from "@/lib/mtm/attendance-request-contract"
import { prepareAttendanceDocument, attendanceAttachmentPath } from "@/lib/mtm/attendance-attachment"
import { agentPermissionStates, agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { isMtmMobileApiPath } from "@/lib/mtm/mobile-api-path"

const input = { clientRequestId: randomUUID(), kind: "ANNUAL_LEAVE", unit: "DAYS", startDate: "2026-10-13", endDate: "2026-10-15", reason: "Fixture leave" }
describe("attendance request intervals and backward compatibility", () => {
  it("accepts all seven requested kinds with days or a bounded hourly interval", () => {
    for (const kind of ["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF", "BUSINESS_TRIP", "REMOTE_WORK"]) expect(AttendanceRequestInputSchema.safeParse({ ...input, kind }).success).toBe(true)
    for (const kind of ["HOURLY_ABSENCE", "OVERTIME"]) expect(AttendanceRequestInputSchema.safeParse({ ...input, kind, unit: "HOURS", endDate: input.startDate, startTime: "09:00", endTime: "11:30" }).success).toBe(true)
  })
  it.each([
    { endDate: "2026-02-30" }, { endDate: "2027-10-15" }, { endDate: "2026-10-12" }, { agentId: "other" },
    { kind: "HOLIDAY" }, { reason: "  " }, { unit: "HOURS" }, { kind: "OVERTIME" },
    { unit: "HOURS", endDate: input.startDate, startTime: "10:00", endTime: "09:00" },
    { unit: "HOURS", endDate: input.startDate, startTime: "25:00", endTime: "26:00" },
    { attachmentIds: ["https://example.test/private.jpg"] },
  ])("rejects malformed or caller-controlled data %j", (change) => expect(AttendanceRequestInputSchema.safeParse({ ...input, ...change }).success).toBe(false))
  it("allows adjacent hourly requests but refuses actual and whole-day overlaps", () => {
    const left = { startDate: input.startDate, endDate: input.startDate, unit: "HOURS" as const, startTime: "09:00", endTime: "10:00" }
    expect(attendanceRequestWindowsOverlap(left, { ...left, startTime: "10:00", endTime: "11:00" })).toBe(false)
    expect(attendanceRequestWindowsOverlap(left, { ...left, startTime: "09:59", endTime: "11:00" })).toBe(true)
    expect(attendanceRequestWindowsOverlap(left, { ...left, unit: "DAYS" })).toBe(true)
    expect(attendanceRequestWindowsOverlap(left, { ...left, startDate: "2026-10-14", endDate: "2026-10-14" })).toBe(false)
    expect(attendanceRequestMinutes(left)).toBe(60)
  })
  it("omits every new bootstrap key until the one attendance switch is explicitly on", () => {
    for (const value of [undefined, false, "true"] as const) {
      expect(agentPermissionStates({ attendanceEnabled: value as boolean })).not.toHaveProperty("attendanceRequests")
      expect(agentPermissionEnabled({ attendanceEnabled: value as boolean }, "attendanceRequests")).toBe(false)
    }
    expect(agentPermissionStates({ attendanceEnabled: true })).toHaveProperty("attendanceRequests", true)
  })
  it("admits the authenticated mobile paths at the edge without reviving a withdrawn path", () => {
    expect(isMtmMobileApiPath("/api/v1/mtm/mobile/attendance/requests")).toBe(true)
    expect(isMtmMobileApiPath(`/api/v1/mtm/mobile/attendance/attachments/${randomUUID()}`)).toBe(true)
  })
})

describe("private request photos", () => {
  it("re-encodes an actual image and removes embedded EXIF", async () => {
    const original = await sharp({ create: { width: 12, height: 12, channels: 3, background: "white" } }).jpeg()
      .withExif({ IFD0: { ImageDescription: "PRIVATE_GPS_AND_DOCUMENT_MARKER" } }).toBuffer()
    expect((await sharp(original).metadata()).exif).toBeDefined()
    const prepared = await prepareAttendanceDocument(original)
    const metadata = await sharp(prepared.bytes).metadata()
    expect(metadata.format).toBe("jpeg")
    expect(metadata.exif).toBeUndefined()
    expect(prepared.bytes.includes(Buffer.from("PRIVATE_GPS_AND_DOCUMENT_MARKER"))).toBe(false)
    expect(prepared.sourceSha256).not.toBe(prepared.checksumSha256)
  })
  it("rejects non-images, oversized files and traversal keys", async () => {
    await expect(prepareAttendanceDocument(Buffer.from("<svg onload='alert(1)'></svg>"))).rejects.toMatchObject({ code: "MTM_ATTENDANCE_DOCUMENT_IMAGE_REQUIRED" })
    await expect(prepareAttendanceDocument(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
    expect(() => attendanceAttachmentPath("../other")).toThrow()
    expect(attendanceAttachmentPath("a".repeat(48))).toContain("mtm-attendance")
  })
})
