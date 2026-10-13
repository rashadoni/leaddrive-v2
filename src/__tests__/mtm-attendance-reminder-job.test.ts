import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn(), tenant: vi.fn((_org: string, fn: () => unknown) => fn()), lease: vi.fn(), bypass: vi.fn((fn: () => unknown) => fn()) }))
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mocks.query } }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: mocks.tenant, runWithRlsBypass: mocks.bypass }))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.lease }))
vi.mock("@/lib/mtm/attendance-reminder-store", () => ({ createAttendanceReminders: mocks.create }))
import { executeMtmAttendanceReminderJob, runMtmAttendanceReminderJob } from "@/lib/cron/mtm-attendance-reminder-job"
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue(1) })
describe("bounded reminder worker progress", () => {
  it("resumes an opaque offset and enters each tenant separately", async () => {
    const cursor = { read: vi.fn().mockResolvedValue("v1:100"), compareAndSet: vi.fn().mockResolvedValue(true) }
    mocks.query.mockResolvedValue([{ organizationId: "a", id: "x" }, { organizationId: "b", id: "y" }])
    expect(await executeMtmAttendanceReminderJob(new Date("2026-10-12T06:00:00Z"), cursor)).toMatchObject({ scanned: 2, processed: 2, created: 2 })
    expect(mocks.tenant.mock.calls.map(call => call[0])).toEqual(["a", "b"])
    expect(mocks.query.mock.calls[0].at(-1)).toBe(100)
    expect(cursor.compareAndSet).toHaveBeenCalledWith("mtm-attendance-reminders", "v1:100", "v1:0")
  })
  it("advances beyond a failing employee without logging private identifiers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const cursor = { read: vi.fn().mockResolvedValue(null), compareAndSet: vi.fn().mockResolvedValue(true) }
    mocks.query.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ organizationId: "private-org", id: `private-${index}` })))
    mocks.create.mockRejectedValueOnce(new Error("private-employee"))
    expect(await executeMtmAttendanceReminderJob(new Date(), cursor)).toMatchObject({ processed: 100, failed: 1, created: 99 })
    expect(cursor.compareAndSet).toHaveBeenCalledWith("mtm-attendance-reminders", null, "v1:100")
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-")
    log.mockRestore()
  })
  it("uses the database lease and refuses a lost cursor compare-and-set", async () => {
    mocks.query.mockResolvedValue([])
    await expect(executeMtmAttendanceReminderJob(new Date(), { read: async () => "corrupt", compareAndSet: async () => false })).rejects.toThrow("CURSOR_CHANGED")
    runMtmAttendanceReminderJob()
    expect(mocks.bypass).toHaveBeenCalled()
    expect(mocks.lease).toHaveBeenCalledWith({ name: "mtm-attendance-reminders", ttlMs: 120000 }, expect.any(Function))
  })
})
