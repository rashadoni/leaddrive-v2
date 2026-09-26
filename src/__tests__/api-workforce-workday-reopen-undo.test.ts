import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(async () => ({ timezone: "Asia/Baku" })),
}))
vi.mock("@/lib/workforce/workday-reopen-undo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workforce/workday-reopen-undo")>()),
  undoWorkforceWorkdayReopen: vi.fn(),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  workforceAttendanceSecurityMfaSatisfied: vi.fn(),
}))
vi.mock("@/lib/workforce/direct-time-correction-rate-limit", () => ({
  requireWorkforceDirectTimeCorrectionRateLimit: vi.fn(),
}))

import { POST as undoPost } from "@/app/api/v1/workforce/workdays/[id]/reopen/undo/route"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { prisma } from "@/lib/prisma"
import { workforceAttendanceSecurityMfaSatisfied } from "@/lib/workforce/attendance-route"
import { requireWorkforceDirectTimeCorrectionRateLimit } from "@/lib/workforce/direct-time-correction-rate-limit"
import { undoWorkforceWorkdayReopen } from "@/lib/workforce/workday-reopen-undo"

// The session wrapper is applied when the route module loads, before any
// beforeEach clears mock history.
const sessionWrapperActions = vi.mocked(withWorkforceSessionAuth).mock.calls.map((call) => call[0])

const AUTH = {
  orgId: "org-workforce",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.test",
  name: "Workforce Admin",
}

const body = {
  operationId: "undo-operation-1",
  expectedUpdatedAt: "2026-09-15T14:30:00.000Z",
  reason: "Reopened the wrong employee's day",
}

const restoredWorkday = {
  id: "workday-1",
  workDate: "2026-09-15",
  status: "COMPLETED",
  startedAt: "2026-09-15T05:00:00.000Z",
  pausedAt: null,
  completedAt: "2026-09-15T14:00:00.000Z",
  totalPausedSeconds: 0,
}

type Invoke = (
  req: NextRequest,
  auth: typeof AUTH,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>

const invoke = undoPost as unknown as Invoke

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/v1/workforce/workdays/workday-1/reopen/undo", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  })
}

function post(payload: unknown = body, id = "workday-1", auth = AUTH) {
  return invoke(request(payload), auth, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workforceAttendanceSecurityMfaSatisfied).mockResolvedValue(true)
  vi.mocked(requireWorkforceDirectTimeCorrectionRateLimit).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
})

describe("POST /api/v1/workforce/workdays/:id/reopen/undo", () => {
  it("is a signed-in human write, never an integration-key action", () => {
    expect(sessionWrapperActions).toEqual(["write"])
  })

  it("undoes through the Workforce service with the admin actor and trusted audit metadata", async () => {
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: { eventId: "event-undo", workday: restoredWorkday },
    } as never)

    const response = await invoke(request(body, {
      "x-forwarded-for": "198.51.100.72, 198.51.100.73",
      "x-real-ip": "203.0.113.72",
      "user-agent": "workforce-undo-test-agent".repeat(40),
    }), AUTH, { params: Promise.resolve({ id: "workday-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({
      success: true,
      idempotent: false,
      data: { eventId: "event-undo", workday: restoredWorkday },
    })
    expect(undoWorkforceWorkdayReopen).toHaveBeenCalledWith({
      organizationId: "org-workforce",
      userId: "admin-1",
      actor: { agentId: null, role: "ADMIN", scopedAgentIds: null },
      workdayId: "workday-1",
      input: body,
      audit: { ipAddress: "203.0.113.72", userAgent: expect.stringMatching(/^workforce-undo-test-agent/), mfaEnrolled: true },
    })
    const audit = vi.mocked(undoWorkforceWorkdayReopen).mock.calls[0]?.[0]?.audit
    expect(audit?.userAgent).toHaveLength(500)
    expect(workforceAttendanceSecurityMfaSatisfied).toHaveBeenCalledWith(expect.anything(), "org-workforce", AUTH)
    expect(requireWorkforceDirectTimeCorrectionRateLimit).toHaveBeenCalledWith({
      organizationId: "org-workforce",
      principalUserId: "admin-1",
    })
  })

  it("reports an acknowledged retry as idempotent", async () => {
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({
      kind: "success",
      idempotent: true,
      data: { eventId: "event-undo", workday: restoredWorkday },
    } as never)

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true, data: { eventId: "event-undo" } })
  })

  it.each([
    "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
    "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY",
    "WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT",
    "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
    "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH",
  ] as const)("answers %s with 409 and the current workday", async (code) => {
    const currentWorkday = { ...restoredWorkday, status: "STARTED", completedAt: null }
    const withWorkday = code !== "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH"
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({
      kind: "conflict",
      code,
      message: "internal detail that must not be echoed",
      ...(withWorkday ? { currentWorkday } : {}),
    } as never)

    const response = await post()
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(json).toEqual({
      error: "Unable to undo the Workforce workday reopen.",
      code,
      ...(withWorkday ? { data: { workday: currentWorkday } } : {}),
    })
    expect(JSON.stringify(json)).not.toContain("internal detail")
  })

  it("answers 403 WORKFORCE_SCOPE_DENIED for a self-undo or an out-of-scope manager", async () => {
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({ kind: "forbidden" })

    const response = await post(body, "workday-1", { ...AUTH, userId: "agent-user-1", role: "user" })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_SCOPE_DENIED" })
    expect(undoWorkforceWorkdayReopen).toHaveBeenCalledWith(expect.objectContaining({ userId: "agent-user-1", actor: null }))
  })

  it("answers 404 for an unknown workday", async () => {
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({ kind: "not_found" })

    expect((await post()).status).toBe(404)
  })

  it("rejects a malformed workday id before parsing, rate limiting or lookups", async () => {
    const response = await post(body, "workday/../other")

    expect(response.status).toBe(404)
    expect(requireWorkforceDirectTimeCorrectionRateLimit).not.toHaveBeenCalled()
    expect(undoWorkforceWorkdayReopen).not.toHaveBeenCalled()
  })

  it.each([
    ["no reason", { operationId: body.operationId, expectedUpdatedAt: body.expectedUpdatedAt }],
    ["a blank reason", { ...body, reason: "  " }],
    ["a time field the undo does not accept", { ...body, completedAt: "2026-09-15T14:00:00.000Z" }],
    ["no expected version", { operationId: body.operationId, reason: body.reason }],
  ])("rejects a body with %s before the rate guard or actor lookup", async (_label, payload) => {
    const response = await post(payload)

    expect(response.status).toBe(400)
    expect(requireWorkforceDirectTimeCorrectionRateLimit).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(undoWorkforceWorkdayReopen).not.toHaveBeenCalled()
  })

  // Owner decision 2026-09-21: 2FA is recommended, not required, for the
  // manager's workday actions; the audit records whether it was enrolled.
  it("proceeds without 2FA and records that it was off", async () => {
    vi.mocked(workforceAttendanceSecurityMfaSatisfied).mockResolvedValueOnce(false)
    vi.mocked(undoWorkforceWorkdayReopen).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: { eventId: "event-undo", workday: restoredWorkday },
    } as never)

    const response = await post()

    expect(response.status).toBe(200)
    expect(vi.mocked(undoWorkforceWorkdayReopen).mock.calls[0]?.[0]?.audit).toMatchObject({ mfaEnrolled: false })
  })

  it("shares the manager time-correction rate budget", async () => {
    vi.mocked(requireWorkforceDirectTimeCorrectionRateLimit).mockResolvedValueOnce(new Response(null, { status: 429 }) as never)

    const response = await post()

    expect(response.status).toBe(429)
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(undoWorkforceWorkdayReopen).not.toHaveBeenCalled()
  })

  it("contains failures without logging sensitive error details", async () => {
    const sensitiveFailure = new Error("private undo reason undo-secret-42")
    vi.mocked(undoWorkforceWorkdayReopen).mockRejectedValueOnce(sensitiveFailure)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await post()

    expect(response.status).toBe(500)
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "review-workday-reopen-undo" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sensitiveFailure.message)
    consoleError.mockRestore()
  })
})
