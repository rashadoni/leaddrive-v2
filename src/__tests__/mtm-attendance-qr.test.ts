import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { issueAttendanceQrToken, verifyAttendanceQrToken } from "@/lib/mtm/attendance-qr-security"
import { AttendanceQrInputSchema } from "@/lib/mtm/attendance-qr-contract"
import { parseMtmWorkdayEvent, mtmWorkdayRequestHash } from "@/lib/mtm/workday"

const now = new Date("2026-10-13T06:00:00Z"), org = "fictional-qr-organization", branch = randomUUID(), revision = randomUUID()
const issue = () => issueAttendanceQrToken(org, branch, revision, now)
describe("short-lived branch QR", () => {
  it("authenticates the tenant, branch revision and fixed 60-second server window", () => {
    const result = issue()
    expect(result.expiresAt.toISOString()).toBe("2026-10-13T06:01:00.000Z")
    expect(verifyAttendanceQrToken(org, result.token, new Date(now.getTime() + 59000), now)).toMatchObject({ state: "VERIFIED", payload: { branchId: branch, revisionId: revision } })
    expect(verifyAttendanceQrToken("another-tenant", result.token, now, now)).toEqual({ state: "INVALID" })
    expect(issue().token).not.toBe(result.token)
  })
  it.each([-1, 60000, 120000])("rejects a received time outside the window (%s ms)", delta => {
    expect(verifyAttendanceQrToken(org, issue().token, new Date(now.getTime() + delta), now)).toEqual({ state: "EXPIRED" })
  })
  it.each([-6000, 60000])("does not attach current QR proof to a backdated or future claim (%s ms)", delta => {
    expect(verifyAttendanceQrToken(org, issue().token, now, new Date(now.getTime() + delta))).toEqual({ state: "INVALID" })
  })
  it.each(["", "https://example.invalid", "wa2.x.fake", "mtmq1.a.b", "x".repeat(2049)])("treats malformed scans as unverified", token => {
    expect(verifyAttendanceQrToken(org, token, now, now)).toEqual({ state: "INVALID" })
  })
  it("rejects tampering and appended data", () => {
    const token = issue().token, pieces = token.split(".")
    const value = JSON.parse(Buffer.from(pieces[1], "base64url").toString()); value.branchId = randomUUID()
    pieces[1] = Buffer.from(JSON.stringify(value)).toString("base64url")
    expect(verifyAttendanceQrToken(org, pieces.join("."), now, now)).toEqual({ state: "INVALID" })
    expect(verifyAttendanceQrToken(org, `${token}.extra`, now, now)).toEqual({ state: "INVALID" })
  })
  it("allows no employee, branch override or image in the proof", () => {
    expect(AttendanceQrInputSchema.safeParse({ version: 1, token: null }).success).toBe(true)
    expect(AttendanceQrInputSchema.safeParse({ version: 1, token: "demo", branchId: branch }).success).toBe(false)
  })
  it("binds the proof to the canonical request digest without changing legacy hashes", () => {
    const payload = { action: "START", id: "fictional-workday", occurredAt: now.toISOString() }
    const parse = (value: unknown) => parseMtmWorkdayEvent(value, "fictional-event", "Asia/Baku", now)
    const original = parse(payload).input!, token = issue().token
    const qr = parse({ ...payload, attendanceQr: { version: 1, token } }).input!
    expect(qr.attendanceQr?.token).toBe(token)
    const scope = { organizationId: org, agentId: "fictional-employee" }
    expect(mtmWorkdayRequestHash(scope, original)).toBe(mtmWorkdayRequestHash(scope, { ...original, attendanceQr: undefined }))
    expect(mtmWorkdayRequestHash(scope, qr)).not.toBe(mtmWorkdayRequestHash(scope, original))
    expect(mtmWorkdayRequestHash(scope, qr)).not.toBe(mtmWorkdayRequestHash(scope, { ...qr, attendanceQr: { version: 1, token: null } }))
    expect(parse({ ...payload, action: "PAUSE", workdayId: payload.id, attendanceQr: { version: 1, token } }).input).toBeNull()
  })
})
