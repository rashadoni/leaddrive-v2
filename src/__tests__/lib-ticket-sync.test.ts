import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, create } = vi.hoisted(() => ({
  findFirst: vi.fn(async (..._a: unknown[]) => null as unknown),
  create: vi.fn(async (..._a: unknown[]) => ({})),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { ticket: { findFirst }, ticketComment: { create } } }))

import { syncWhatsAppExchangeToTicket } from "@/lib/inbox/ticket-sync"

const before = new Date("2026-06-20T10:35:00Z")

beforeEach(() => {
  findFirst.mockReset()
  findFirst.mockResolvedValue(null)
  create.mockReset()
  create.mockResolvedValue({})
})

describe("syncWhatsAppExchangeToTicket", () => {
  it("appends customer + bot comments to a PRE-EXISTING open whatsapp ticket", async () => {
    findFirst.mockResolvedValueOnce({ id: "tk_1" })
    const r = await syncWhatsAppExchangeToTicket({
      orgId: "o1", phone: "994773201000", before, customerMessage: "Beliteshekkur", botReply: "Xahiş edirəm!",
    })
    expect(r.appended).toBe(true)
    // lookup: OPEN whatsapp ticket for this phone, created BEFORE this turn (no double of the snapshot)
    const where = (findFirst.mock.calls[0][0] as any).where
    expect(where.sourceMeta).toEqual({ path: ["phone"], equals: "994773201000" })
    expect(where.status).toEqual({ in: ["open", "in_progress"] })
    expect(where.createdAt).toEqual({ lt: before })
    expect(where.tags).toEqual({ has: "whatsapp" })
    // both appended sequentially (customer BEFORE bot → distinct createdAt → deterministic order)
    expect(create).toHaveBeenCalledTimes(2)
    expect((create.mock.calls[0][0] as any).data).toMatchObject({ ticketId: "tk_1", comment: "[Клиент (WhatsApp)] Beliteshekkur", isInternal: false })
    expect((create.mock.calls[1][0] as any).data).toMatchObject({ ticketId: "tk_1", comment: "[Da Vinci Bot] Xahiş edirəm!", isInternal: false })
  })

  it("no-op when there is no pre-existing open ticket", async () => {
    findFirst.mockResolvedValueOnce(null)
    const r = await syncWhatsAppExchangeToTicket({ orgId: "o1", phone: "x", before, customerMessage: "hi", botReply: "hello" })
    expect(r.appended).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it("appends ONLY the customer message when the bot reply is null (send failed)", async () => {
    findFirst.mockResolvedValueOnce({ id: "tk_1" })
    await syncWhatsAppExchangeToTicket({ orgId: "o1", phone: "p", before, customerMessage: "hi", botReply: null })
    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls[0][0] as any).data.comment).toBe("[Клиент (WhatsApp)] hi")
  })

  it("never throws on a DB error (best-effort, must not break the webhook)", async () => {
    findFirst.mockRejectedValueOnce(new Error("db down"))
    await expect(
      syncWhatsAppExchangeToTicket({ orgId: "o1", phone: "p", before, customerMessage: "hi" }),
    ).resolves.toEqual({ appended: false })
  })
})
