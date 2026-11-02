import { describe, it, expect } from "vitest"
import { parseChatDescription, parseCommentSender } from "@/components/tickets/chat-history-view"

describe("parseChatDescription", () => {
  it("parses a WhatsApp ticket description into header + classified bubbles", () => {
    const raw = [
      "Создан из WhatsApp чата.",
      "Клиент: rrr (+994773201000)",
      "Категория: general · Срочность: normal",
      "Триггеры: AI marker [CREATE_TICKET]",
      "",
      "--- ИСТОРИЯ ЧАТА ---",
      "[Клиент] Salam. Outlook achilmir mende",
      "",
      "[Da Vinci] Salam! Outlook acilmadigini anliyorum.",
      "Asagidakilari yoxlayin:",
      "- Internet?",
      "",
      "[Клиент] Achilmir hech bir sehv yoxdu",
    ].join("\n")
    const p = parseChatDescription(raw)
    expect(p).toBeTruthy()
    if (!p) throw new Error("expected parse result")
    expect(p.platform).toBe("WhatsApp")
    expect(p.client).toBe("rrr")
    expect(p.phone).toBe("994773201000")
    expect(p.category).toBe("general")
    expect(p.urgency).toBe("normal")
    expect(p.triggers).toBe("AI marker [CREATE_TICKET]")
    expect(p.messages).toHaveLength(3)
    expect(p.messages[0]).toMatchObject({ sender: "customer", text: "Salam. Outlook achilmir mende" })
    // multi-line bot message keeps its body, classified as bot
    expect(p.messages[1].sender).toBe("bot")
    expect(p.messages[1].text).toContain("Asagidakilari yoxlayin")
    expect(p.messages[2].sender).toBe("customer")
  })

  it("parses the portal Da Vinci escalation (session header, no client, real \\n\\n join)", () => {
    // The portal producer joins messages with \n\n (vs WhatsApp's \n) — lock that invariant.
    const raw = "Автоматически создан при эскалации из Da Vinci чата.\n\nСессия: sess_abc123def456\n\n--- ИСТОРИЯ ЧАТА ---\n[Клиент] pomogite\n\n[Da Vinci] konechno"
    const p = parseChatDescription(raw)
    expect(p).toBeTruthy()
    if (!p) throw new Error("expected parse result")
    expect(p.platform).toBe("Da Vinci")
    expect(p.session).toBe("sess_abc123def456")
    expect(p.messages).toHaveLength(2)
    expect(p.messages[0].sender).toBe("customer")
    expect(p.messages[1].sender).toBe("bot")
  })

  it("does NOT mis-split a customer message whose body starts with [bracket] text", () => {
    const raw = "--- ИСТОРИЯ ЧАТА ---\n[Клиент] Я вижу ошибку\n[Error 0x80] не грузится\n[Da Vinci] понял"
    const p = parseChatDescription(raw)
    expect(p).toBeTruthy()
    if (!p) throw new Error("expected parse result")
    expect(p.messages).toHaveLength(2) // [Error 0x80] stays inside the customer bubble, not a 3rd msg
    expect(p.messages[0].sender).toBe("customer")
    expect(p.messages[0].text).toContain("[Error 0x80] не грузится")
    expect(p.messages[1].sender).toBe("bot")
  })

  it("reads the ticket one inbound WhatsApp text opened as a chat card, not as Russian headers", () => {
    // The agent of an Azerbaijani organization used to read this blob verbatim.
    const raw = "Создан из входящего WhatsApp сообщения.\nКлиент: Aysel (+994501234567)\n\n--- СООБЩЕНИЕ ---\nSalam, sifarişim gəlmədi.\nNə vaxt gələcək?"
    const p = parseChatDescription(raw)
    expect(p).toMatchObject({ platform: "WhatsApp", client: "Aysel", phone: "994501234567" })
    expect(p?.messages).toEqual([{ sender: "customer", label: "Клиент", text: "Salam, sifarişim gəlmədi.\nNə vaxt gələcək?" }])
  })

  it.each([
    ["az", "Da Vinci çatından yaradıldı.\n\n--- ÇAT TARİXÇƏSİ ---\n[Müştəri] Kömək edin\n\n[Da Vinci] Əlbəttə"],
    ["en", "Created from Da Vinci chat.\n\n--- CHAT HISTORY ---\n[Client] Help me\n\n[Da Vinci] Of course"],
    ["ru", "Создано из Da Vinci чата.\n\n--- ИСТОРИЯ ЧАТА ---\n[Клиент] Помогите\n\n[Da Vinci] Конечно"],
  ])("reads the transcript the portal chat widget writes in the customer's language (%s)", (_locale, raw) => {
    const p = parseChatDescription(raw)
    expect(p?.platform).toBe("Da Vinci")
    expect(p?.messages.map((m) => m.sender)).toEqual(["customer", "bot"])
  })

  it("returns null for a normal hand-typed description (no transcript marker)", () => {
    expect(parseChatDescription("Printer is broken, please help.")).toBeNull()
    expect(parseChatDescription("")).toBeNull()
    expect(parseChatDescription(null)).toBeNull()
  })
})

describe("parseCommentSender", () => {
  it("parses a customer comment, splitting name + channel from the label", () => {
    const r = parseCommentSender("[Клиент (WhatsApp)] Salam. Outlook achilmir")
    expect(r).toBeTruthy()
    if (!r) throw new Error("expected parse result")
    expect(r.sender).toBe("customer")
    expect(r.name).toBe("Клиент")
    expect(r.channel).toBe("WhatsApp")
    expect(r.body).toBe("Salam. Outlook achilmir")
  })

  it("parses a bot comment, stripping the trailing 'Bot'", () => {
    const r = parseCommentSender("[Da Vinci Bot] Başa düşdüm.\nİkinci sətir.")
    expect(r).toBeTruthy()
    if (!r) throw new Error("expected parse result")
    expect(r.sender).toBe("bot")
    expect(r.name).toBe("Da Vinci")
    expect(r.channel).toBeNull()
    expect(r.body).toContain("İkinci sətir") // multi-line body preserved
  })

  it("recognises the labels of tickets written before the Russian prefixes", () => {
    expect(parseCommentSender("[AI Bot] Hello")).toMatchObject({ sender: "bot", body: "Hello" })
    expect(parseCommentSender("[Customer (WhatsApp)] Hi")).toMatchObject({ sender: "customer", channel: "WhatsApp", body: "Hi" })
  })

  it("returns null for a normal agent/internal comment (no sender prefix)", () => {
    expect(parseCommentSender("Looking into this now.")).toBeNull()
    expect(parseCommentSender("[Note] internal only")).toBeNull() // bracket, but not a known sender
    expect(parseCommentSender("")).toBeNull()
    expect(parseCommentSender(null)).toBeNull()
  })
})
