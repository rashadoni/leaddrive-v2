import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

const state = vi.hoisted(() => ({
  auth: {} as AuthResult,
  booking: { findFirst: vi.fn(), findMany: vi.fn() },
  task: { findFirst: vi.fn(), updateMany: vi.fn() },
  grants: { findMany: vi.fn() }, update: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { booking: state.booking, task: state.task, bookingCoordinatorGrant: state.grants }, logAudit: vi.fn() }))
vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: unknown) => handler,
  withRlsAuth: (_module: string, _action: string, handler: (req: NextRequest, auth: AuthResult, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, state.auth, ctx),
}))
vi.mock("@/lib/crm-commands/task/update-task", () => ({ updateTaskCommand: state.update }))
vi.mock("@/lib/field-filter", () => ({ getFieldPermissions: vi.fn(async () => ({})), filterWritableFields: (body: unknown) => body, filterEntityFields: (body: unknown) => body }))

import { GET } from "@/app/api/v1/bookings/task-link/route"
import { PATCH, DELETE } from "@/app/api/v1/tasks/[id]/route"
import { CrmCommandError } from "@/lib/crm-commands/errors"

const ctx = { params: Promise.resolve({ id: "task-a" }) }
const lookup = (taskId = "task-a") => GET(new NextRequest(`https://app.example.test/api/v1/bookings/task-link?taskId=${encodeURIComponent(taskId)}`))
const mutate = (method: "PATCH" | "DELETE") => new NextRequest("https://app.example.test/api/v1/tasks/task-a", {
  method, ...(method === "PATCH" ? { body: JSON.stringify({ title: "Changed" }), headers: { "Content-Type": "application/json" } } : {}),
})
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = { orgId: "org-a", userId: "staff-a", role: "sales", principalType: "session", name: "Staff", email: "synthetic@example.test" }
  state.grants.findMany.mockResolvedValue([])
  state.booking.findFirst.mockResolvedValue(null)
  state.booking.findMany.mockResolvedValue([])
  state.task.findFirst.mockResolvedValue({ id: "task-a", title: "Meeting", projectId: null })
  state.update.mockResolvedValue({ entity: { id: "task-a" } })
})

describe("task to meeting navigation", () => {
  it("returns only an own-scoped reference and forbids caching", async () => {
    state.booking.findMany.mockResolvedValue([{ id: "booking-a" }])
    const response = await lookup()
    expect(await response.json()).toEqual({ success: true, data: { bookingId: "booking-a" } })
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(state.booking.findMany).toHaveBeenCalledWith({
      where: { AND: [{ organizationId: "org-a", hostUserId: { in: ["staff-a"] } }, { taskId: "task-a" }] },
      select: { id: true }, take: 2,
    })
  })

  it("does not infer Booking access from wildcard or API-key task access", async () => {
    for (const role of ["viewer", "reviewer"] as const) {
      state.auth.role = role
      expect((await lookup()).status).toBe(403)
    }
    state.auth.role = "admin"
    state.auth.principalType = "api_key"
    expect((await lookup()).status).toBe(403)
    expect(state.booking.findMany).not.toHaveBeenCalled()
  })

  it("re-reads team grants so a revoked colleague does not remain in the scope", async () => {
    state.grants.findMany.mockResolvedValueOnce([{ hostUserId: "colleague", canManage: false }]).mockResolvedValueOnce([])
    await lookup(); await lookup()
    expect(state.booking.findMany.mock.calls[0][0].where.AND[0].hostUserId.in).toEqual(["staff-a", "colleague"])
    expect(state.booking.findMany.mock.calls[1][0].where.AND[0].hostUserId.in).toEqual(["staff-a"])
  })

  it("keeps administrators tenant-scoped and does not guess ambiguous historical links", async () => {
    state.auth.role = "admin"
    state.booking.findMany.mockResolvedValue([{ id: "one" }, { id: "two" }])
    expect(await (await lookup()).json()).toEqual({ success: true, data: { bookingId: null } })
    expect(state.booking.findMany.mock.calls[0][0].where.AND[0]).toEqual({ organizationId: "org-a" })
  })

  it("returns no reference for an unlinked or invisible meeting", async () => {
    expect(await (await lookup()).json()).toEqual({ success: true, data: null })
  })

  it.each(["", " ", "x".repeat(65)])("rejects an invalid task identifier without reading bookings", async (id) => {
    expect((await lookup(id)).status).toBe(400)
    expect(state.booking.findMany).not.toHaveBeenCalled()
  })
})

describe("individual booking-managed task mutations", () => {
  it.each(["PATCH", "DELETE"] as const)("returns an intentional conflict for %s without mutation or meeting identity", async (method) => {
    state.booking.findFirst.mockResolvedValue({ version: 0 })
    if (method === "PATCH") state.update.mockRejectedValueOnce(new Error("synthetic database guard"))
    const response = await (method === "PATCH" ? PATCH(mutate(method), ctx) : DELETE(mutate(method), ctx))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: "BOOKING_MANAGED_TASK", error: expect.any(String) })
    expect(state.update).toHaveBeenCalledTimes(method === "PATCH" ? 1 : 0)
    expect(state.task.updateMany).not.toHaveBeenCalled()
    expect(state.booking.findFirst).toHaveBeenCalledWith({ where: { organizationId: "org-a", taskId: "task-a" }, select: { version: true } })
  })

  it("keeps a missing or foreign task404 without inspecting its booking", async () => {
    state.task.findFirst.mockResolvedValue(null)
    expect((await PATCH(mutate("PATCH"), ctx)).status).toBe(404)
    expect(state.booking.findFirst).not.toHaveBeenCalled()
  })

  it("does not retry a guarded mutation when a concurrent link appears", async () => {
    state.booking.findFirst.mockResolvedValueOnce({ version: 1 })
    state.update.mockRejectedValueOnce(new Error("synthetic guarded database failure"))
    const response = await PATCH(mutate("PATCH"), ctx)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("BOOKING_MANAGED_TASK")
    expect(state.update).toHaveBeenCalledTimes(1)
  })

  it("preserves board/field denials before inspecting booking linkage", async () => {
    state.update.mockRejectedValueOnce(new CrmCommandError("FORBIDDEN", "Board access denied", 403))
    state.booking.findFirst.mockResolvedValue({ version: 1 })
    expect((await PATCH(mutate("PATCH"), ctx)).status).toBe(403)
    expect(state.booking.findFirst).not.toHaveBeenCalled()
  })

  it("preserves normal task updates", async () => {
    const response = await PATCH(mutate("PATCH"), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { id: "task-a" } })
    expect(state.update).toHaveBeenCalledTimes(1)
  })
})
