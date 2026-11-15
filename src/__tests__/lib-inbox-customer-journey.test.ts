import { describe, expect, it } from "vitest"
import { buildJourney, SESSION_GAP_MS, type JourneyCall, type JourneyMessage } from "@/lib/inbox/customer-journey"
import { dealStageBar } from "@/lib/inbox/deal-stage-bar"

/**
 * «Müştəri yolu» of the inbox panel (owner-approved mock-up, 2026-11-15): one step per stretch of
 * talk in one conversation, one per call, oldest first; who said the last words; no amounts.
 */
const T0 = new Date("2026-11-12T08:00:00.000Z").getTime()
const at = (minutes: number) => new Date(T0 + minutes * 60_000)
let seq = 0
const msg = (conversationId: string, minutes: number, direction: "inbound" | "outbound", body: string, metadata: Record<string, unknown> = {}, messageType = "text"): JourneyMessage => ({
  id: `m${++seq}`, conversationId, direction, body, messageType, createdAt: at(minutes), metadata,
})
const call = (id: string, minutes: number, extra: Partial<JourneyCall> = {}): JourneyCall => ({
  id, conversationId: null, direction: "inbound", status: "completed", provider: "voip", duration: 72, startedAt: at(minutes), createdAt: at(minutes), ...extra,
})
const channelOf = (id: string) => ({ ig: "instagram", wa: "whatsapp", web: "web-chat" } as Record<string, string>)[id] ?? "inbox"

describe("customer journey", () => {
  it("puts Instagram, WhatsApp and a call in order, each with its last words and who said them", () => {
    const result = buildJourney({
      messages: [
        msg("ig", 0, "inbound", "Salam! Qara 42 var?"),
        msg("ig", 5, "outbound", "Salam! Var, 89 ₼ 😊", { authorType: "operator", authorName: "Günel" }),
        msg("wa", 24 * 60, "inbound", "Endirim var?"),
        msg("wa", 24 * 60 + 3, "outbound", "95 ₼, endirim bitib", { authorName: "Tural" }),
      ],
      calls: [call("c1", 48 * 60)],
      channelOf,
      currentConversationId: "ig",
    })
    expect(result.steps.map((step) => [step.kind, step.kind === "chat" ? step.channel : step.channel])).toEqual([
      ["chat", "instagram"], ["chat", "whatsapp"], ["call", "voip"],
    ])
    const [ig, wa, phone] = result.steps
    expect(ig).toMatchObject({ quote: "Salam! Var, 89 ₼ 😊", author: "operator", authorName: "Günel", messages: 2, current: true })
    expect(wa).toMatchObject({ quote: "95 ₼, endirim bitib", authorName: "Tural", current: false })
    expect(phone).toMatchObject({ durationSec: 72, direction: "inbound" })
    // The step carries the words as written; nothing reads a price out of them.
    expect(Object.keys(ig)).not.toContain("amount")
    expect(result.beyondCurrent).toBe(true)
  })

  it("starts a new step in the same conversation after a long pause, not before", () => {
    const result = buildJourney({
      messages: [
        msg("ig", 0, "inbound", "Salam"),
        msg("ig", SESSION_GAP_MS / 60_000 - 1, "inbound", "Burdasız?"),
        msg("ig", SESSION_GAP_MS / 60_000 * 2 + 5, "inbound", "Sabah gələrəm"),
      ],
      calls: [],
      channelOf,
      currentConversationId: "ig",
    })
    expect(result.steps).toHaveLength(2)
    expect(result.steps.map((step) => step.kind === "chat" && step.messages)).toEqual([2, 1])
  })

  it("is not worth a card when it shows only the open thread itself", () => {
    const result = buildJourney({
      messages: [msg("ig", 0, "inbound", "Salam"), msg("ig", 600, "inbound", "Yenə mən")],
      calls: [],
      channelOf,
      currentConversationId: "ig",
    })
    expect(result.beyondCurrent).toBe(false)
    const withCall = buildJourney({ messages: [msg("ig", 0, "inbound", "Salam")], calls: [call("c2", 5, { conversationId: "ig" })], channelOf, currentConversationId: "ig" })
    expect(withCall.beyondCurrent).toBe(true)
  })

  it("names the AI, the keyword bot and a photo without words", () => {
    const result = buildJourney({
      messages: [
        msg("wa", 0, "outbound", "Salam, sizə necə kömək edə bilərəm?", { aiAutoReply: true }),
        msg("ig", 10, "outbound", "İş saatlarımız 10:00–19:00", { autoReply: true }),
        msg("web", 20, "inbound", "", {}, "image"),
      ],
      calls: [],
      channelOf,
      currentConversationId: "web",
    })
    expect(result.steps.map((step) => step.kind === "chat" && [step.author, step.quote, step.media])).toEqual([
      ["ai", "Salam, sizə necə kömək edə bilərəm?", null],
      ["bot", "İş saatlarımız 10:00–19:00", null],
      ["customer", null, "image"],
    ])
  })

  it("keeps the last four steps and says how many there were", () => {
    // Seven hours apart: each message is a stretch of its own.
    const messages = Array.from({ length: 7 }, (_, i) => msg(i % 2 ? "wa" : "ig", i * 7 * 60, "inbound", `addım ${i}`))
    const result = buildJourney({ messages, calls: [], channelOf, currentConversationId: "ig" })
    expect(result.total).toBe(7)
    expect(result.steps.map((step) => step.kind === "chat" && step.quote)).toEqual(["addım 3", "addım 4", "addım 5", "addım 6"])
  })

  it("cuts a long message to one line's worth", () => {
    const result = buildJourney({ messages: [msg("ig", 0, "inbound", "a ".repeat(200))], calls: [], channelOf, currentConversationId: "ig" })
    const step = result.steps[0]
    expect(step.kind === "chat" && step.quote!.length).toBeLessThanOrEqual(90)
  })
})

describe("deal stage bar", () => {
  const stages = [
    { name: "LEAD", displayName: "Yeni" },
    { name: "PROPOSAL", displayName: "Təklif" },
    { name: "PAYMENT", displayName: "Ödəniş" },
    { name: "Təhvil", displayName: "Təhvil", isWon: true },
    { name: "Uduzdu", displayName: "Uduzdu", isLost: true },
  ]

  it("draws the organization's own stage names up to the deal's stage, without the lost one", () => {
    expect(dealStageBar(stages, "PROPOSAL")).toEqual([
      { label: "Yeni", done: true, current: false },
      { label: "Təklif", done: true, current: true },
      { label: "Ödəniş", done: false, current: false },
      { label: "Təhvil", done: false, current: false },
    ])
  })

  it("matches a stored spelling by meaning, not by letters", () => {
    // Prod stores «proposal» and «Proposal» beside «PROPOSAL»; a won deal stored as CLOSED_WON
    // must still land on the pipeline's own won stage.
    expect(dealStageBar(stages, "proposal").find((step) => step.current)?.label).toBe("Təklif")
    expect(dealStageBar(stages, "CLOSED_WON").find((step) => step.current)?.label).toBe("Təhvil")
  })

  it("marks nothing when the deal's stage is not in its pipeline", () => {
    expect(dealStageBar(stages, "SOMETHING_ELSE").some((step) => step.done || step.current)).toBe(false)
  })
})
