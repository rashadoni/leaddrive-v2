import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { notifyAttendanceRequestReviewers } from "@/lib/mtm/attendance-request-notify"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { shouldPush } from "@/lib/notifications/prefs"
import { deriveSection } from "@/lib/notifications/taxonomy"
import { MTM_ATTENDANCE_REQUEST_NOTIFICATION_ENTITY as entity, MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND as kind } from "@/lib/mtm/attendance-request-notification"
const scope = { organizationId: "notification-fixture-org", agentId: "notification-fixture-employee", requestId: "notification-fixture-request" }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ userId: "reviewer" }] as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "employee-user", name: "Fixture Employee" } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "reviewer", role: "manager", hiddenModules: [], preferredLanguage: "ru" }] as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER", agentId: null, scopedAgentIds: [scope.agentId] })
  vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.notification.findFirst).mockImplementation((async ({ where }: { where: object }) => ({ ...where })) as never)
})
const run = () => notifyAttendanceRequestReviewers(prisma as unknown as Prisma.TransactionClient, scope)
describe("attendance request durable reviewer notification", () => {
  it("writes a stable private preview inside the request transaction and honours explicit kind opt-out", async () => {
    await run(); await run()
    const first = vi.mocked(prisma.notification.createMany).mock.calls[0][0]
    expect(first).toEqual(vi.mocked(prisma.notification.createMany).mock.calls[1][0])
    expect(first).toMatchObject({ skipDuplicates: true, data: { entityType: entity, entityId: scope.requestId, userId: "reviewer", organizationId: scope.organizationId } })
    expect(JSON.stringify(first)).not.toMatch(/reason|attachment|latitude|employee-user|notification-fixture-employee/)
    // Whose request (owner, 2026-11-01), never what kind: the push may land on a locked screen.
    expect((first as { data: { message: string } }).data.message).toBe("Заявка по учёту рабочего дня от: Fixture Employee. Откройте очередь и примите решение.")
    expect(JSON.stringify(first)).not.toMatch(/LEAVE|SICK|ABSENCE|TIME_CORRECTION/)
    const section = deriveSection(entity)!
    expect(shouldPush({}, section, kind)).toBe(true)
    expect(shouldPush({ [section]: { push: true, types: { [kind]: false } } }, section, kind)).toBe(false)
  })
  it.each(["other-team", "self-card", "read-only", "hidden", "no-actor"])("does not notify %s", async (mode) => {
    if (mode === "other-team") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER", agentId: null, scopedAgentIds: ["other-agent"] })
    if (mode === "self-card") vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: scope.agentId, scopedAgentIds: null })
    if (mode === "read-only") vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "reviewer", role: "viewer", hiddenModules: [] }] as never)
    if (mode === "hidden") vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "reviewer", role: "manager", hiddenModules: ["mtm"] }] as never)
    if (mode === "no-actor") vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
    await run()
    expect(prisma.notification.createMany).not.toHaveBeenCalled()
  })
  it("falls back to the plain text when the card has no name", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "employee-user", name: null } as never)
    await run()
    expect((vi.mocked(prisma.notification.createMany).mock.calls[0][0] as { data: { message: string } }).data.message).not.toContain("{name}")
  })
  it("fails the caller's transaction if a durable bell row cannot be persisted", async () => {
    vi.mocked(prisma.notification.createMany).mockRejectedValue(new Error("fixture persistence failure"))
    await expect(run()).rejects.toThrow("MTM_ATTENDANCE_NOTIFICATION_UNAVAILABLE")
  })
})
