/**
 * G — MTM route-change push: notify the affected agent, but not on self-change
 * and not when the agent has no CRM user (native-app-only).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { mtmAgent: { findFirst: vi.fn() } } }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))

import { notifyMtmAgentOfVisitChange } from "@/lib/mtm/notify-visit-change"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

const base = { organizationId: "org-1", agentId: "agent-1", visitId: "v-1" as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createNotification).mockResolvedValue({} as never)
})

describe("notifyMtmAgentOfVisitChange", () => {
  it("notifies the agent's user (with push) when a manager reassigns the visit", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "agent-user" } as never)
    const sent = await notifyMtmAgentOfVisitChange({ ...base, actorUserId: "manager-user", change: "assigned" })
    expect(sent).toBe(true)
    const arg = vi.mocked(createNotification).mock.calls[0][0]
    expect(arg).toMatchObject({ organizationId: "org-1", userId: "agent-user", push: true, entityType: "mtm_visit", entityId: "v-1", kind: "mtm.visit.assigned" })
  })

  it("maps cancelled → warning type", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "agent-user" } as never)
    await notifyMtmAgentOfVisitChange({ ...base, actorUserId: "manager-user", change: "cancelled" })
    expect(vi.mocked(createNotification).mock.calls[0][0]).toMatchObject({ type: "warning", kind: "mtm.visit.cancelled" })
  })

  it("does NOT notify when the agent changed it themselves", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: "same-user" } as never)
    const sent = await notifyMtmAgentOfVisitChange({ ...base, actorUserId: "same-user", change: "cancelled" })
    expect(sent).toBe(false)
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled()
  })

  it("does NOT notify a native-app-only agent (no CRM user)", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ userId: null } as never)
    const sent = await notifyMtmAgentOfVisitChange({ ...base, actorUserId: "manager-user", change: "assigned" })
    expect(sent).toBe(false)
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled()
  })

  it("swallows errors (non-fatal) and returns false", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockRejectedValue(new Error("db down"))
    const sent = await notifyMtmAgentOfVisitChange({ ...base, actorUserId: "m", change: "assigned" })
    expect(sent).toBe(false)
  })
})
