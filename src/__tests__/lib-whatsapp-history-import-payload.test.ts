import { describe, expect, it } from "vitest"
import {
  addressBookOf,
  chunksOf,
  HISTORY_SHARING_DECLINED,
  mediaOf,
  outboundStatus,
  threadsOf,
} from "@/lib/whatsapp-history-import/payload"
import { isPersonAnswer } from "@/lib/inbox/learning/model"
import { selectUncoveredAiInboundBatch } from "@/lib/social/ai-autoreply"

/**
 * Reading Meta's coexistence sync webhooks (lib/whatsapp-history-import/payload), with the shapes
 * from Meta's webhook references for `history` and `smb_app_state_sync`. Every reader is total: a
 * chunk that threw would be a chunk never imported, and Meta does not send it again.
 */
const NOW = new Date("2026-11-15T12:00:00Z")
const ts = (iso: string) => String(Math.floor(Date.parse(iso) / 1000))
const metadata = { display_phone_number: "+994 51 206 08 38", phone_number_id: "1098" }

describe("history chunks", () => {
  it("keeps one row per history item, with Meta's phase, order and progress", () => {
    const chunks = chunksOf("history", {
      messaging_product: "whatsapp",
      metadata,
      history: [
        { metadata: { phase: 1, chunk_order: 3, progress: 40 }, threads: [{ id: "994501112233", messages: [{}, {}] }] },
        { metadata: { phase: 2, chunk_order: 1, progress: 90 }, threads: [] },
      ],
    }, "1098")
    expect(chunks.map((c) => [c.kind, c.phase, c.chunkOrder, c.progress, c.items, c.errorCode])).toEqual([
      ["history", 1, 3, 40, 2, null],
      ["history", 2, 1, 90, 0, null],
    ])
    expect(chunks[0].payload).toMatchObject({ businessPhone: "994512060838", phoneNumberId: "1098" })
    // The same item is the same fingerprint, so a redelivery is the same row.
    const again = chunksOf("history", { metadata, history: [{ metadata: { phase: 1, chunk_order: 3, progress: 40 }, threads: [{ id: "994501112233", messages: [{}, {}] }] }] }, "1098")
    expect(again[0].fingerprint).toBe(chunks[0].fingerprint)
  })

  it("records Meta's refusal to share history with nothing to import", () => {
    const [chunk] = chunksOf("history", {
      metadata,
      history: [{ errors: [{ code: 2593109, title: "History sync is turned off by the business from the WhatsApp Business App" }] }],
    }, "1098")
    expect(chunk).toMatchObject({ kind: "history", errorCode: HISTORY_SHARING_DECLINED, payload: null, items: 0 })
  })

  it("tells the media follow-up from a history chunk", () => {
    const [chunk] = chunksOf("history", {
      messages: [{ from: "994501112233", id: "wamid.M1", timestamp: ts("2026-11-14T10:00:00Z"), type: "image", image: { id: "media-1", caption: "Menyu" } }],
    }, "1098")
    expect(chunk.kind).toBe("media")
    expect(mediaOf(chunk.payload!)).toEqual([{ wamid: "wamid.M1", type: "image", mediaId: "media-1", caption: "Menyu" }])
  })

  it("keeps the address book in one chunk", () => {
    const [chunk] = chunksOf("smb_app_state_sync", { metadata, state_sync: [{ type: "contact" }, { type: "contact" }] }, "1098")
    expect(chunk).toMatchObject({ kind: "contacts", items: 2 })
  })
})

describe("threads", () => {
  const item = {
    threads: [{
      id: "994501112233",
      context: { wa_id: "994501112233", user_id: "AZ.1", username: "aysel" },
      messages: [
        { from: "994501112233", from_user_id: "AZ.1", id: "w1", timestamp: ts("2026-10-01T09:00:00Z"), type: "text", text: { body: "Salam" }, history_context: { status: "READ" } },
        { from: "994512060838", to: "994501112233", id: "w2", timestamp: ts("2026-10-01T09:05:00Z"), type: "text", text: { body: "Buyurun" }, history_context: { status: "delivered" } },
        { from: "994501112233", from_user_id: "AZ.1", id: "w3", timestamp: ts("2026-10-01T09:06:00Z"), type: "reaction", reaction: { emoji: "👍" } },
        { from: "994501112233", from_user_id: "AZ.1", id: "w4", timestamp: ts("2026-10-01T09:07:00Z"), type: "media_placeholder" },
        { from: "994501112233", id: "w5", timestamp: "", type: "text", text: { body: "no time" } },
        { from: "994501112233", id: "w6", timestamp: ts("2027-12-01T00:00:00Z"), type: "text", text: { body: "from the future" } },
      ],
    }],
  }

  it("tells the business's messages from the customer's by Meta's own marks", () => {
    const [thread] = threadsOf(item, "994512060838", NOW)
    expect(thread).toMatchObject({ threadKey: "994501112233", phone: "994501112233", userId: "AZ.1", username: "aysel" })
    expect(thread.messages.map((m) => [m.wamid, m.direction, m.text, m.historyStatus])).toEqual([
      ["w1", "inbound", "Salam", "read"],
      ["w2", "outbound", "Buyurun", "delivered"],
      ["w4", "inbound", "[Медиафайл]", null],
    ])
    // A reaction, a message without a time and a time a year ahead are not lines of the chat.
    expect(thread.skipped).toBe(3)
    expect(thread.messages[0].at.toISOString()).toBe("2026-10-01T09:00:00.000Z")
  })

  it("keys a thread without a phone by the customer's business-scoped id", () => {
    const [thread] = threadsOf({ threads: [{ context: { user_id: "AZ.9" }, messages: [{ from_user_id: "AZ.9", id: "w", timestamp: ts("2026-11-01T00:00:00Z"), type: "text", text: { body: "hi" } }] }] }, "994512060838", NOW)
    expect(thread).toMatchObject({ threadKey: "AZ.9", phone: null })
    expect(thread.messages[0].direction).toBe("inbound")
  })

  it("maps the phone's delivery state to ours", () => {
    expect(["read", "played", "delivered", "error", "pending", null].map(outboundStatus)).toEqual(["read", "read", "delivered", "failed", "sent", "sent"])
  })
})

describe("address book", () => {
  it("reads additions and removals, never inventing a phone", () => {
    expect(addressBookOf({
      state_sync: [
        { type: "contact", contact: { full_name: "Pablo Morales", first_name: "Pablo", phone_number: "16505551234" }, action: "add", metadata: { timestamp: "1739321024" } },
        { type: "contact", contact: { first_name: "Leyla", phone_number: "+994 55 222 33 44" }, action: "add" },
        { type: "contact", contact: { user_id: "US.1" }, action: "remove" },
      ],
    }, NOW)).toEqual([
      { action: "add", phone: "16505551234", fullName: "Pablo Morales", at: new Date(1739321024 * 1000) },
      { action: "add", phone: "994552223344", fullName: "Leyla", at: null },
      { action: "remove", phone: null, fullName: null, at: null },
    ])
  })
})

describe("what imported rows mean to the automations", () => {
  const at = (minute: number) => new Date(NOW.getTime() - (60 - minute) * 60_000)
  it("an imported customer message is never a turn for the AI to answer", () => {
    const batch = selectUncoveredAiInboundBatch([
      { id: "old", direction: "inbound", body: "Qiymət?", status: "read", createdAt: at(1), metadata: { historyImport: true } },
      { id: "live", direction: "inbound", body: "Salam?", status: "delivered", createdAt: at(50), metadata: {} },
    ])
    expect(batch.map((m) => m.id)).toEqual(["live"])
  })

  it("an imported reply is not a lesson for AI training", () => {
    expect(isPersonAnswer({ direction: "outbound", body: "25 AZN", metadata: { source: "business_app", sentFromBusinessApp: true, historyImport: true } })).toBe(false)
    expect(isPersonAnswer({ direction: "outbound", body: "25 AZN", metadata: { source: "business_app", sentFromBusinessApp: true } })).toBe(true)
  })
})
