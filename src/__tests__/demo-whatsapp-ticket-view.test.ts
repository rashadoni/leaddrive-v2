/**
 * The demo's real ticket as its customer sees it
 * (src/lib/demo-center/demo-whatsapp-ticket-view.ts): the customer portal's
 * own rules, and nothing of the team's.
 */
import { describe, expect, it } from "vitest"
import { DEMO_WHATSAPP_TICKET_MESSAGES, demoWhatsAppTicketView } from "@/lib/demo-center/demo-whatsapp-ticket-view"

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 9, minute))

function row(overrides: Record<string, unknown> = {}) {
  return {
    ticketNumber: "WA-0031",
    subject: "[WhatsApp müraciəti] Kassa çeki çap etmir",
    status: "open",
    createdAt: at(0),
    slaFirstResponseDueAt: at(30),
    firstResponseAt: null as Date | null,
    slaDueAt: at(240),
    comments: [
      { comment: "Müştəri ilə zəng etdim", userId: "agent-7", createdAt: at(9) },
      { comment: "[Da Vinci Bot] Printer siyahıda görünürmü? [ESCALATE]", userId: null, createdAt: at(2) },
      { comment: "[Клиент (WhatsApp)] Kassa çeki çap etmir", userId: null, createdAt: at(1) },
    ],
    publicCommentCount: 3,
    ...overrides,
  }
}

describe("the demo's ticket in its customer's view", () => {
  it("is the portal's view: the customer's subject, the next committed target only", () => {
    const view = demoWhatsAppTicketView(row())
    expect(view.number).toBe("WA-0031")
    expect(view.subject).not.toContain("[WhatsApp")
    expect(view.sla).toEqual({ kind: "firstResponse", dueAt: at(30).toISOString() })
    expect(demoWhatsAppTicketView(row({ firstResponseAt: at(5) })).sla).toEqual({ kind: "resolution", dueAt: at(240).toISOString() })
    expect(demoWhatsAppTicketView(row({ status: "resolved" })).sla).toEqual({ kind: "complete" })
  })

  it("shows a status the portal does not name as unknown — never «escalated»", () => {
    expect(demoWhatsAppTicketView(row({ status: "escalated" })).status).toBe("unknown")
  })

  it("names who wrote each message the way the portal does, oldest first, without the team's markers", () => {
    expect(demoWhatsAppTicketView(row()).messages.map((message) => [message.author, message.text])).toEqual([
      ["customer", "Kassa çeki çap etmir"],
      ["assistant", "Printer siyahıda görünürmü?"],
      ["agent", "Müştəri ilə zəng etdim"],
    ])
  })

  it("never shows a system comment without a prefix as the customer's own words", () => {
    const view = demoWhatsAppTicketView(row({ comments: [{ comment: "Müraciətiniz qəbul olundu.", userId: null, createdAt: at(1) }] }))
    expect(view.messages[0].author).toBe("assistant")
  })

  it("carries no id, no phone and no staff identity", () => {
    expect(JSON.stringify(demoWhatsAppTicketView(row()))).not.toMatch(/agent-7|userId|ticketId|994/)
  })

  it("keeps the latest messages and counts them all", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ comment: `[Клиент (WhatsApp)] mesaj ${9 - index}`, userId: null, createdAt: at(20 - index) }))
    const view = demoWhatsAppTicketView(row({ comments: many, publicCommentCount: 9 }))
    expect(view.messages).toHaveLength(DEMO_WHATSAPP_TICKET_MESSAGES)
    expect(view.messages.at(-1)!.text).toBe("mesaj 9")
    expect(view.messageCount).toBe(9)
  })

  it("says in Azerbaijani what a message without words was", () => {
    const view = demoWhatsAppTicketView(row({ subject: "[WhatsApp müraciəti] [Изображение]", comments: [{ comment: "[Клиент (WhatsApp)] [Голосовое сообщение]", userId: null, createdAt: at(1) }] }))
    expect(view.subject).toBe("Şəkil")
    expect(view.messages[0].text).toBe("Səsli mesaj")
  })
})

