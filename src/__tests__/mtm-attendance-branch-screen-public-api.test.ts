import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/mtm/attendance-branch-screen-store", () => ({ pairAttendanceBranchScreen: vi.fn(), issueAttendanceScreenQr: vi.fn() }))
vi.mock("@/lib/public-abuse-guard", () => ({ consumePublicRateLimit: vi.fn() }))
import * as store from "@/lib/mtm/attendance-branch-screen-store"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { POST as PAIR } from "@/app/api/v1/public/attendance-screen/pair/route"
import { POST as QR } from "@/app/api/v1/public/attendance-screen/qr/route"
import { generateBranchScreenCode, generateBranchScreenSecret, hashBranchScreenCode, hashBranchScreenSecret, normalizeBranchScreenCode } from "@/lib/mtm/attendance-branch-screen-security"

const SECRET = generateBranchScreenSecret().secret
const pair = (body: string) => new NextRequest("http://localhost/api/v1/public/attendance-screen/pair", { method: "POST", body, headers: { "content-type": "application/json" } })
const qr = (cookie?: string) => new NextRequest("http://localhost/api/v1/public/attendance-screen/qr", { method: "POST", headers: cookie ? { cookie: `ld_branch_screen=${cookie}` } : {} })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false } as never)
  vi.mocked(store.pairAttendanceBranchScreen).mockResolvedValue({ secret: SECRET })
  vi.mocked(store.issueAttendanceScreenQr).mockResolvedValue({ state: "SHOWING", organizationName: "Demo", branch: { id: "b", name: "B" }, dataUrl: "data:image/png;base64,AA", serverNow: "2026-10-29T10:00:00Z", expiresAt: "2026-10-29T10:01:00Z" })
})
describe("branch screen codes", () => {
  it("read a typed code the same way however it is typed, and refuse what cannot be one", () => {
    const { code, codeHash } = generateBranchScreenCode()
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
    expect(hashBranchScreenCode(` ${code.toLowerCase().replace("-", " ")} `)).toBe(codeHash)
    for (const bad of ["", "ABCD-EFG", "ABCD-EFGO", "ABCD-EFG1", 42, null, "A".repeat(33)]) expect(normalizeBranchScreenCode(bad)).toBeNull()
    expect(hashBranchScreenSecret(SECRET)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashBranchScreenSecret(`${SECRET}x`)).toBeNull()
    expect(generateBranchScreenSecret().secret).not.toBe(SECRET)
  })
})
describe("public branch screen routes", () => {
  it("pairs once and keeps the secret only in an httpOnly cookie of its own path", async () => {
    const response = await PAIR(pair(JSON.stringify({ code: "ABCD-EFGH" })))
    expect(response.status).toBe(200)
    expect(store.pairAttendanceBranchScreen).toHaveBeenCalledWith("ABCD-EFGH")
    const body = await response.text()
    expect(body).not.toContain(SECRET)
    const cookie = response.headers.get("set-cookie") ?? ""
    expect(cookie).toContain(`ld_branch_screen=${SECRET}`)
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Secure/i); expect(cookie).toMatch(/SameSite=strict/i)
    expect(cookie).toContain("Path=/api/v1/public/attendance-screen")
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it("answers every refused code alike and sets no cookie", async () => {
    vi.mocked(store.pairAttendanceBranchScreen).mockResolvedValue(null)
    const response = await PAIR(pair(JSON.stringify({ code: "ZZZZ-ZZZZ" })))
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ success: false, state: "CODE_REFUSED" })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect((await PAIR(pair("{"))).status).toBe(400)
  })
  it("stops guessing at the rate limit, before the database", async () => {
    vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 600, unavailable: false } as never)
    const response = await PAIR(pair(JSON.stringify({ code: "ABCD-EFGH" })))
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("600")
    expect(store.pairAttendanceBranchScreen).not.toHaveBeenCalled()
    expect(consumePublicRateLimit).toHaveBeenCalledWith("mtm-attendance-screen-pair:ip", expect.any(String), { maxRequests: 10, windowSeconds: 900 })
  })
  it("gives the paired screen its code and clears the cookie of an unpaired one", async () => {
    const shown = await QR(qr(SECRET))
    expect(store.issueAttendanceScreenQr).toHaveBeenCalledWith(SECRET)
    expect(await shown.json()).toMatchObject({ success: true, data: { state: "SHOWING", branch: { id: "b" } } })
    vi.mocked(store.issueAttendanceScreenQr).mockResolvedValue({ state: "UNPAIRED" })
    const gone = await QR(qr("mtms1.revoked"))
    expect(await gone.json()).toEqual({ success: true, data: { state: "UNPAIRED" } })
    expect(gone.headers.get("set-cookie")).toMatch(/ld_branch_screen=;.*Max-Age=0/i)
  })
  it("hides failures behind one answer", async () => {
    vi.mocked(store.issueAttendanceScreenQr).mockRejectedValue(new Error("private DB payload"))
    const response = await QR(qr(SECRET))
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private DB payload")
  })
})
