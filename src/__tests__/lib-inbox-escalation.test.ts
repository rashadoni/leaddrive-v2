import { describe, it, expect, vi, beforeEach } from "vitest"

const { findMany, createNotification } = vi.hoisted(() => ({
  findMany: vi.fn(async (..._args: unknown[]) => [{ id: "u1" }, { id: "u2" }]),
  createNotification: vi.fn(async (..._args: unknown[]) => {}),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }))
vi.mock("@/lib/notifications", () => ({ createNotification }))

import { matchEscalationKeyword, notifyEscalationTeam } from "@/lib/inbox/escalation"

beforeEach(() => {
  findMany.mockClear()
  createNotification.mockClear()
  findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }])
})

describe("matchEscalationKeyword", () => {
  it("matches case-insensitively and returns the original keyword casing", () => {
    expect(matchEscalationKeyword("У меня ЖАЛОБА на сервис", ["жалоба"])).toBe("жалоба")
    expect(matchEscalationKeyword("позовите Менеджера пожалуйста", ["Менеджер"])).toBe("Менеджер")
  })
  it("matches as a substring (no word boundary needed)", () => {
    expect(matchEscalationKeyword("хочу жалобу написать", ["жалоб"])).toBe("жалоб")
    expect(matchEscalationKeyword("this is a COMPLAINT", ["complaint"])).toBe("complaint")
  })
  it("returns null when nothing matches / empty / null inputs", () => {
    expect(matchEscalationKeyword("всё отлично, спасибо", ["жалоба", "менеджер"])).toBeNull()
    expect(matchEscalationKeyword("жалоба", [])).toBeNull()
    expect(matchEscalationKeyword(null, ["жалоба"])).toBeNull()
    expect(matchEscalationKeyword("жалоба", undefined)).toBeNull()
  })
  it("returns the FIRST keyword in array order that matches", () => {
    const text = "это жалоба, позовите менеджер"
    expect(matchEscalationKeyword(text, ["жалоба", "менеджер"])).toBe("жалоба")
    expect(matchEscalationKeyword(text, ["менеджер", "жалоба"])).toBe("менеджер")
  })
})

describe("notifyEscalationTeam", () => {
  it("notifies every admin/manager/support member with the conversation + keyword", async () => {
    await notifyEscalationTeam({ orgId: "o1", conversationId: "c1", platform: "tiktok", keyword: "жалоба", contactName: "Ali" })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "o1", role: { in: ["admin", "manager", "support"] }, isActive: true }),
      }),
    )
    expect(createNotification).toHaveBeenCalledTimes(2)
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", entityId: "c1", organizationId: "o1", kind: "inbox.message" }))
    expect((createNotification.mock.calls[0][0] as { message: string }).message).toContain("жалоба")
  })
  it("never throws if the team query fails (best-effort)", async () => {
    findMany.mockRejectedValueOnce(new Error("db down"))
    await expect(
      notifyEscalationTeam({ orgId: "o1", conversationId: "c1", platform: "tiktok", keyword: "x", contactName: "Y" }),
    ).resolves.toBeUndefined()
    expect(createNotification).not.toHaveBeenCalled()
  })
})
