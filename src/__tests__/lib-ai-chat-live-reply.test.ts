import { describe, expect, it } from "vitest"
import { LiveReply, liveHoldIndex, parseSseChunk, sseFrame, type LiveReplyEvent } from "@/lib/ai/chat-live-reply"

describe("what may be shown while Da Vinci writes", () => {
  it("holds from the first figure and from an unfinished placeholder, not for digits inside a whole one", () => {
    expect(liveHoldIndex("Привет, коллега")).toBe("Привет, коллега".length)
    expect(liveHoldIndex("Закрыто 12 сделок")).toBe("Закрыто ".length)
    expect(liveHoldIndex("Здравствуйте, [PER")).toBe("Здравствуйте, ".length)
    expect(liveHoldIndex("Здравствуйте, [PERSON_1]!")).toBe("Здравствуйте, [PERSON_1]!".length)
    expect(liveHoldIndex("[EMAIL_2] и 3 письма")).toBe("[EMAIL_2] и ".length)
  })

  it("sends each piece once, unmasked, and takes the round back when a tool is called", () => {
    const sent: LiveReplyEvent[] = []
    const live = new LiveReply((event) => sent.push(event), (text) => text.replace("[PERSON_1]", "Aysel"))
    live.startRound()
    live.text("Привет, [PERSON_")
    live.text("1]! Смотрю ")
    live.toolUse()
    live.text("ещё текст")
    expect(sent).toEqual([
      { type: "delta", text: "Привет, " },
      { type: "delta", text: "Aysel! Смотрю " },
      { type: "reset" },
    ])
  })
})

describe("server-sent events", () => {
  it("survive arriving in arbitrary pieces", () => {
    const wire = [
      sseFrame({ type: "delta", text: "Привет" }),
      sseFrame({ type: "reset" }),
      sseFrame({ type: "done", status: 200, body: { data: { reply: "Привет!" } } }),
    ].join("")
    const events: LiveReplyEvent[] = []
    let buffer = ""
    for (let at = 0; at < wire.length; at += 7) {
      const parsed = parseSseChunk(buffer + wire.slice(at, at + 7))
      events.push(...parsed.events)
      buffer = parsed.rest
    }
    expect(events).toEqual([
      { type: "delta", text: "Привет" },
      { type: "reset" },
      { type: "done", status: 200, body: { data: { reply: "Привет!" } } },
    ])
  })
})
