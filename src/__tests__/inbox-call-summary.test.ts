/**
 * The call card says what happened in the reader's language, not Meta's journal (owner,
 * 2026-11-10: «и что это за информация?» — «Да, замени»). The journals below are the owner's
 * three test calls of that day, as the call rows hold them.
 */
import { describe, expect, it } from "vitest"
import { callStatusWord, callSummaryLine, whatsappCallAnsweredAt } from "@/lib/inbox/call-summary"

const ANSWERED = [
  "[WhatsApp Calling] 2026-11-10T10:47:34.027Z outbound connect requested (permission=permanent, canStartCall=true)",
  "[WhatsApp Calling] 2026-11-10T10:47:36.000Z webhook call (event=connect, status=in-progress, direction=outbound, session=answer)",
  "[WhatsApp Calling] 2026-11-10T10:47:37.000Z webhook status (raw=RINGING, status=ringing, direction=outbound)",
  "[WhatsApp Calling] 2026-11-10T10:47:46.000Z webhook status (raw=ACCEPTED, status=in-progress, direction=outbound)",
  "[WhatsApp Calling] 2026-11-10T10:48:00.000Z webhook call (event=terminate, status=completed, direction=outbound)",
].join("\n")

const RANG_OUT = [
  "[WhatsApp Calling] 2026-11-10T10:47:34.027Z outbound connect requested (permission=permanent, canStartCall=true)",
  "[WhatsApp Calling] 2026-11-10T10:47:37.000Z webhook status (raw=RINGING, status=ringing, direction=outbound)",
].join("\n")

/** UTC clock, so the test reads the same everywhere; the screen passes the reader's own. */
const utc = (at: Date) => at.toISOString().slice(11, 16)

describe("the call card's line", () => {
  it("says who called, when the customer picked up, how long, and how it ended — in Azerbaijani", () => {
    expect(callSummaryLine({ direction: "outbound", status: "completed", duration: 14, provider: "whatsapp", notes: ANSWERED }, "az", utc))
      .toBe("Gedən · cavab verdi 10:47 · 14 san · bitdi")
  })

  it("in Russian and English", () => {
    const call = { direction: "outbound", status: "completed", duration: 14, provider: "whatsapp", notes: ANSWERED }
    expect(callSummaryLine(call, "ru", utc)).toBe("Исходящий · ответил в 10:47 · 14 с · завершён")
    expect(callSummaryLine(call, "en", utc)).toBe("Outgoing · answered 10:47 · 14 s · ended")
  })

  it("an unanswered call has no answer time", () => {
    expect(callSummaryLine({ direction: "outbound", status: "no-answer", duration: 0, provider: "whatsapp", notes: RANG_OUT }, "az", utc))
      .toBe("Gedən · cavabsız")
  })

  it("an incoming call that failed", () => {
    expect(callSummaryLine({ direction: "inbound", status: "failed", provider: "whatsapp", notes: null }, "ru", utc))
      .toBe("Входящий · не состоялся")
  })

  it("prints none of Meta's journal", () => {
    const line = callSummaryLine({ direction: "outbound", status: "completed", duration: 14, provider: "whatsapp", notes: ANSWERED }, "az", utc)
    expect(line).not.toMatch(/WhatsApp Calling|webhook|raw=|completed|T10:/)
  })
})

describe("pieces", () => {
  it("the answer time is Meta's ACCEPTED, not the ring or the request", () => {
    expect(whatsappCallAnsweredAt(ANSWERED)?.toISOString()).toBe("2026-11-10T10:47:46.000Z")
    expect(whatsappCallAnsweredAt(RANG_OUT)).toBeNull()
    expect(whatsappCallAnsweredAt(null)).toBeNull()
  })

  it("a status the provider invented stays as written rather than disappearing", () => {
    expect(callStatusWord("completed", "az")).toBe("bitdi")
    expect(callStatusWord("voicemail", "az")).toBe("voicemail")
  })
})
