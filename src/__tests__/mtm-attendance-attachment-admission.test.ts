import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())
vi.mock("@/lib/mtm/attendance-request-store", () => ({ requireAttendanceSelf: vi.fn().mockResolvedValue("Asia/Baku") }))
vi.mock("@/lib/mtm/attendance-attachment", () => ({ MAX_ATTENDANCE_ATTACHMENT_BYTES: 5 * 1024 * 1024, uploadAttendanceDocument: vi.fn() }))
vi.mock("@/lib/public-abuse-guard", () => ({ consumePublicRateLimitBatch: vi.fn(), acquirePublicConcurrencySlot: vi.fn(), releasePublicConcurrencySlot: vi.fn().mockResolvedValue(undefined) }))
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { uploadAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { acquirePublicConcurrencySlot, consumePublicRateLimitBatch, releasePublicConcurrencySlot } from "@/lib/public-abuse-guard"
import { POST } from "@/app/api/v2/mtm/mobile/route-field/attendance/attachments/route"
const allowed = { allowed: true as const, unavailable: false, retryAfterSeconds: 0 }
const reservation = { ...allowed, backend: "memory" as const, key: "fixture-key", token: "fixture-token" }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: "fixture-org", agentId: "fixture-agent", role: "AGENT" } as never)
  vi.mocked(consumePublicRateLimitBatch).mockResolvedValue(allowed)
  vi.mocked(acquirePublicConcurrencySlot).mockResolvedValue(reservation)
})
const request = () => new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/attachments", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "--x--" })
describe("private document resource admission", () => {
  it("refuses a limited agent before reading bytes or decoding an image", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({ allowed: false, unavailable: false, retryAfterSeconds: 12 })
    const req = request()
    const response = await POST(req)
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("12")
    expect(req.bodyUsed).toBe(false)
    expect(uploadAttendanceDocument).not.toHaveBeenCalled()
    expect(acquirePublicConcurrencySlot).not.toHaveBeenCalled()
  })
  it("releases acquired slots when another agent/tenant limit denies admission", async () => {
    vi.mocked(acquirePublicConcurrencySlot).mockResolvedValueOnce(reservation).mockResolvedValueOnce({ allowed: false, unavailable: false, retryAfterSeconds: 10 })
    const req = request()
    expect((await POST(req)).status).toBe(429)
    expect(req.bodyUsed).toBe(false)
    expect(uploadAttendanceDocument).not.toHaveBeenCalled()
    expect(releasePublicConcurrencySlot).toHaveBeenCalledWith(reservation)
  })
  it("fails closed when shared admission is unavailable and releases slots on malformed multipart", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({ allowed: false, unavailable: true, retryAfterSeconds: 1 })
    expect((await POST(request())).status).toBe(503)
    expect(uploadAttendanceDocument).not.toHaveBeenCalled()
    expect((await POST(request())).status).toBe(400)
    expect(releasePublicConcurrencySlot).toHaveBeenCalledTimes(3)
  })
})
