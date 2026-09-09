import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, create, update, ticketFindFirst, ticketCategoryFindFirst, createNotification } = vi.hoisted(() => ({
  findFirst: vi.fn(async (..._a: unknown[]) => null as unknown),
  create: vi.fn(async (..._a: unknown[]) => ({})),
  update: vi.fn(async (..._a: unknown[]) => ({})),
  ticketFindFirst: vi.fn(async (..._a: unknown[]) => ({ ticketNumber: "DV-7", subject: "Bad service", assignedTo: "u1", priority: "normal" }) as { ticketNumber: string | null; subject: string | null; assignedTo: string | null; priority: string | null } | null),
  ticketCategoryFindFirst: vi.fn(async (..._a: unknown[]) => null),
  createNotification: vi.fn(async (..._a: unknown[]) => ({})),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { complaintMeta: { findFirst, create }, ticket: { update, findFirst: ticketFindFirst }, ticketCategory: { findFirst: ticketCategoryFindFirst } } }))
vi.mock("@/lib/notifications", () => ({ createNotification }))

import { ensureComplaintRegistered, notifyComplaintRegistered } from "@/lib/inbox/complaint-register"

beforeEach(() => {
  findFirst.mockReset(); findFirst.mockResolvedValue(null)
  create.mockReset(); create.mockResolvedValue({})
  update.mockReset(); update.mockResolvedValue({})
  ticketFindFirst.mockReset(); ticketFindFirst.mockResolvedValue({ ticketNumber: "DV-7", subject: "Bad service", assignedTo: "u1", priority: "normal" })
  ticketCategoryFindFirst.mockReset(); ticketCategoryFindFirst.mockResolvedValue(null)
  createNotification.mockReset(); createNotification.mockResolvedValue({})
})

describe("ensureComplaintRegistered", () => {
  it("creates ComplaintMeta + upgrades the ticket to the complaint category when none exists", async () => {
    findFirst.mockResolvedValueOnce(null)
    const r = await ensureComplaintRegistered({ orgId: "o1", ticketId: "tk1" })
    expect(r.created).toBe(true)
    expect((create.mock.calls[0][0] as any).data).toMatchObject({ ticketId: "tk1", organizationId: "o1", complaintType: "complaint" })
    expect((update.mock.calls[0][0] as any).where).toEqual({ id: "tk1" })
    expect((update.mock.calls[0][0] as any).data).toMatchObject({ category: "complaint", tags: { push: "complaint" } })
  })

  it("is idempotent — no-op when a ComplaintMeta already exists (no duplicate, no re-tag, no notify)", async () => {
    findFirst.mockResolvedValueOnce({ id: "cm1" })
    const r = await ensureComplaintRegistered({ orgId: "o1", ticketId: "tk1" })
    expect(r.created).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })
})

describe("notifyComplaintRegistered", () => {
  it("fires a complaint notification mirroring the new-ticket one (title+number, push to assignee)", async () => {
    await notifyComplaintRegistered("o1", "tk1")
    expect(ticketFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tk1", organizationId: "o1" } }))
    const arg = createNotification.mock.calls[0][0] as any
    expect(arg).toMatchObject({
      organizationId: "o1",
      userId: "u1",
      type: "warning",
      title: "Новая жалоба DV-7",
      message: "Bad service",
      entityType: "complaint",
      entityId: "tk1",
      push: true,
      kind: "complaint.created",
    })
  })

  it("falls back to org-wide (userId '') + generic copy when ticket lookup is empty", async () => {
    ticketFindFirst.mockResolvedValueOnce(null)
    await notifyComplaintRegistered("o1", "tk1")
    const arg = createNotification.mock.calls[0][0] as any
    expect(arg.userId).toBe("")
    expect(arg.title).toBe("Новая жалоба")
    expect(arg.message).toBe("Жалоба от клиента")
  })

  it("escalates a critical-priority complaint to an error (red) notification", async () => {
    ticketFindFirst.mockResolvedValueOnce({ ticketNumber: "DV-9", subject: "Угроза", assignedTo: "u1", priority: "critical" })
    await notifyComplaintRegistered("o1", "tk9")
    expect((createNotification.mock.calls[0][0] as any).type).toBe("error")
  })

  it("never throws if createNotification fails (best-effort)", async () => {
    createNotification.mockRejectedValueOnce(new Error("notif down"))
    await expect(notifyComplaintRegistered("o1", "tk1")).resolves.toBeUndefined()
  })
})
