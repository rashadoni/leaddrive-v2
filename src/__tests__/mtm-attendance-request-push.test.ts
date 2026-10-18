import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mtm/route-permissions", async (original) => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { attendanceRequestPushBody, pushAttendanceRequestToReviewers } from "@/lib/mtm/attendance-request-push"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL } from "@/lib/mtm/push-notify"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import type { AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"

/**
 * Owner, 2026-10-18: «пусть о новой заявке сотрудника руководителю приходит
 * пуш на телефон, как сообщение «Komandaya yaz»».
 */
const organizationId = "push-fixture-org"
const agentId = "push-fixture-employee"
const dayKind = { key: "ANNUAL_LEAVE", code: "M", names: { az: "Məzuniyyət", ru: "Отпуск", en: "Leave" }, group: "LEAVE", unit: "DAY", countsAsWorked: false, color: "#000", paid: null, archived: false }
const request = (patch: Partial<AttendanceRequestDto["details"]> = {}, dates: { startDate?: string; endDate?: string } = {}) => ({
  id: "push-fixture-request", clientRequestId: "c01be938-a8bb-41e1-b08b-d1ea2394d0b3", agentId, status: "PENDING",
  startDate: dates.startDate ?? "2026-10-13", endDate: dates.endDate ?? "2026-10-13", reason: "Fictional reason that must not travel",
  submittedAt: "2026-10-18T09:00:00.000Z", decisionNote: null, decidedAt: null, cancelledAt: null, version: "v1",
  details: { version: 1, kind: "TIME_CORRECTION", unit: "HOURS", startTime: "10:21", endTime: "22:19", timezone: "Asia/Baku", dayKind, attachmentIds: [], ...patch },
}) as unknown as AttendanceRequestDto

beforeEach(() => {
  vi.resetAllMocks()
  // The reviewer lookup (shared with the CRM bell), then the manager cards and the employee.
  vi.mocked(prisma.mtmAgent.findMany)
    .mockResolvedValueOnce([{ userId: "manager-login" }] as never)
    .mockResolvedValueOnce([{ id: "manager-card", userId: "manager-login" }] as never)
  vi.mocked(prisma.mtmAgent.findFirst)
    .mockResolvedValueOnce({ userId: null } as never)
    .mockResolvedValueOnce({ name: "Fictional Employee" } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "manager-login", role: "manager", hiddenModules: [], preferredLanguage: "ru" }] as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER", agentId: "manager-card", scopedAgentIds: [agentId] } as never)
})

describe("a new attendance request reaches the manager's phone", () => {
  it("pops up on the manager's card, in their language, in the high-importance channel", async () => {
    const notify = vi.fn().mockResolvedValue({ sent: 1, failed: 0, retired: 0 })
    await expect(pushAttendanceRequestToReviewers({ organizationId, agentId, request: request() }, { notify, configured: true })).resolves.toEqual({ cards: 1 })
    expect(notify).toHaveBeenCalledTimes(1)
    const call = notify.mock.calls[0][0]
    expect(call).toMatchObject({
      organizationId,
      agentIds: ["manager-card"],
      title: ru.mtmAttendance.requestNotificationTitle,
      body: `Fictional Employee — ${ru.mtmAttendance.requestsTimeCorrection}, 13.10`,
      channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
      data: { target: "Approvals", channel: MTM_TEAM_MESSAGES_PUSH_CHANNEL, requestId: "push-fixture-request" },
    })
    // A push can show on a locked screen: no reason text.
    expect(JSON.stringify(call)).not.toContain("must not travel")
    // Only the employee's request is looked at, never the manager's own card.
    expect(vi.mocked(prisma.mtmAgent.findMany).mock.calls[1][0]).toMatchObject({
      where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, id: { not: agentId }, userId: { in: ["manager-login"] } },
    })
  })

  it("reaches nobody when no reviewer has a manager card — a CRM-only admin has no phone here", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockReset()
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin-login", role: "admin", hiddenModules: [], preferredLanguage: "az" }] as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN", agentId: null, scopedAgentIds: null } as never)
    const notify = vi.fn()
    await expect(pushAttendanceRequestToReviewers({ organizationId, agentId, request: request() }, { notify, configured: true })).resolves.toEqual({ cards: 0 })
    expect(notify).not.toHaveBeenCalled()
  })

  it("does not tell a manager outside the employee's scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER", agentId: "manager-card", scopedAgentIds: ["someone-else"] } as never)
    const notify = vi.fn()
    await pushAttendanceRequestToReviewers({ organizationId, agentId, request: request() }, { notify, configured: true })
    expect(notify).not.toHaveBeenCalled()
  })

  it("reads nothing at all where push is not configured", async () => {
    const notify = vi.fn()
    await expect(pushAttendanceRequestToReviewers({ organizationId, agentId, request: request() }, { notify, configured: false })).resolves.toEqual({ cards: 0 })
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it("says who, what and which days", () => {
    expect(attendanceRequestPushBody(request(), "Fictional Employee", "az")).toBe(`Fictional Employee — ${az.mtmAttendance.requestsTimeCorrection}, 13.10`)
    expect(attendanceRequestPushBody(request({ kind: "ANNUAL_LEAVE", unit: "DAYS" } as never, { startDate: "2026-10-20", endDate: "2026-10-24" }), "Fictional Employee", "ru"))
      .toBe("Fictional Employee — Отпуск, 20.10–24.10")
  })

  it("goes out after the request commits, and only for a new one", () => {
    const store = readFileSync(join(process.cwd(), "src/lib/mtm/attendance-request-store.ts"), "utf8")
    const submit = store.slice(store.indexOf("export async function submitAttendanceRequest("), store.indexOf("export async function listOwnAttendanceRequests("))
    expect(submit.indexOf("await prisma.$transaction(")).toBeLessThan(submit.indexOf("pushAttendanceRequestToReviewers("))
    expect(submit).toContain("if (!result.idempotent) {")
    expect(submit).toContain(".catch((error) =>")
  })
})
