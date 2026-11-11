import { describe, it, expect } from "vitest"
import { describeWaMessage } from "@/lib/whatsapp-message-text"

/**
 * One vocabulary for both sides of a coexistence thread.
 *
 * The placeholders below are not decoration: they are what the operator reads in the inbox and what
 * the AI reads as conversation history. Until coexistence only the inbound webhook produced them;
 * now a reply typed in the WhatsApp Business app arrives as an `smb_message_echoes` payload with the
 * same `type` + type-named-object shape. If the two readers drifted apart, one conversation would
 * show «[Изображение]» for the customer's photo and something else for the salon's — and the model
 * would see two different words for the same thing.
 *
 * The strings are asserted verbatim because they are a contract with the live database: rows written
 * before this refactor already carry exactly these words.
 */
describe("describeWaMessage", () => {
  it("takes the words when the message has words", () => {
    expect(describeWaMessage({ type: "text", text: { body: "Salam" } })).toEqual({ text: "Salam", messageType: "text" })
    expect(describeWaMessage({ type: "image", image: { caption: "Прайс" } })).toEqual({ text: "Прайс", messageType: "image" })
    expect(describeWaMessage({ type: "button", button: { text: "Gəlirəm" } })).toEqual({ text: "Gəlirəm", messageType: "button" })
    expect(describeWaMessage({ type: "interactive", interactive: { button_reply: { title: "11:30" } } }))
      .toEqual({ text: "11:30", messageType: "interactive" })
    expect(describeWaMessage({ type: "interactive", interactive: { list_reply: { title: "Manicure" } } }).text).toBe("Manicure")
  })

  it("describes a message that has no words at all", () => {
    expect(describeWaMessage({ type: "image" }).text).toBe("[Изображение]")
    expect(describeWaMessage({ type: "video" }).text).toBe("[Видео]")
    expect(describeWaMessage({ type: "audio" }).text).toBe("[Аудио сообщение]")
    expect(describeWaMessage({ type: "voice" }).text).toBe("[Голосовое сообщение]")
    expect(describeWaMessage({ type: "sticker" }).text).toBe("[Стикер]")
    expect(describeWaMessage({ type: "contacts" }).text).toBe("[Контакт]")
    expect(describeWaMessage({ type: "document" }).text).toBe("[Документ: file]")
    expect(describeWaMessage({ type: "document", document: { filename: "price.pdf" } }).text).toBe("[Документ: price.pdf]")
    expect(describeWaMessage({ type: "location", location: { latitude: 40.4, longitude: 49.8 } }).text).toBe("[Локация: 40.4, 49.8]")
    expect(describeWaMessage({ type: "reaction", reaction: { emoji: "👍" } }).text).toBe("[Реакция: 👍]")
  })

  it("keeps an empty text message empty, so it can be skipped rather than answered", () => {
    // The webhook and the agents both decide by `text.trim()`; a placeholder here would make an
    // empty body look like a question worth answering.
    expect(describeWaMessage({ type: "text" }).text).toBe("")
    expect(describeWaMessage({ type: "text", text: { body: "" } }).text).toBe("")
  })

  it("names an unknown type instead of swallowing it", () => {
    expect(describeWaMessage({ type: "order" })).toEqual({ text: "[order]", messageType: "order" })
    expect(describeWaMessage({})).toEqual({ text: "[unknown]", messageType: "text" })
  })

  it("says a form came back, and who filled it", () => {
    // A form filled inside WhatsApp (Flows) carries no title to show: what the
    // client picked is an id only the booking agent can resolve, and it answers
    // in the very next message of the thread. The name they typed is the one
    // thing in it a person reading the inbox can use.
    const form = (answers: Record<string, unknown>) => describeWaMessage({
      type: "interactive",
      interactive: { type: "nfm_reply", nfm_reply: { response_json: JSON.stringify(answers), body: "Sent", name: "flow" } },
    }).text

    expect(form({ flow_token: "bkflow:conv-1", time: "bk:offer-9", client: "Günel" })).toBe("[Форма: Günel]")
    expect(form({ time: "bk:offer-9" })).toBe("[Форма]")
    // Never empty: the webhook decides by `text.trim()`, and an empty one here
    // would be a submitted form the booking agent is never even offered.
    expect(form({ time: "bk:offer-9" }).trim()).not.toBe("")
    expect(describeWaMessage({ type: "interactive", interactive: { list_reply: { title: "12:30" } } }).text).toBe("12:30")
  })

  it("reads an echo of a reply typed on the phone exactly as it reads an inbound message", () => {
    // Same payload shape, opposite directions: inbound carries `from`, an echo carries `from` + `to`.
    const inbound = { from: "994501234567", id: "wamid.in", type: "text", text: { body: "Sabah 11:30 olar?" } }
    const echo = { from: "994103180049", to: "994501234567", id: "wamid.echo", type: "text", text: { body: "Sabah 11:30 olar?" } }
    expect(describeWaMessage(echo)).toEqual(describeWaMessage(inbound))
  })
})
