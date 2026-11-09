import { describe, it, expect } from "vitest"
import { decideNumberOnboarding, isCoexistenceChannel, COEXISTENCE_FINISH_EVENT } from "@/lib/whatsapp-number-onboarding"
import { deferredReplyEnabled, holdsAutomaticReply, readReplyHoldSetting } from "@/lib/inbox/whatsapp-reply-hold"

/**
 * Register this number, or leave it alone.
 *
 * Both signals this decision rests on are still guesses: we have never watched a real coexistence
 * number go through, so we do not know what `is_on_biz_app` answers for one, nor whether the
 * completion event carries the number. This file is where those guesses are written down as
 * behaviour, so that when one turns out wrong there is one place to correct and one test to change.
 *
 * The asymmetry is the whole design: not registering a number that needed it costs a failed send
 * and a retry; registering a number Meta told us to skip touches a live registration we cannot undo
 * (the Deregister API does not work on such a number). So every uncertainty leans the same way.
 */
describe("decideNumberOnboarding", () => {
  const event = COEXISTENCE_FINISH_EVENT

  it("never registers a number Graph says is in the WhatsApp Business app", () => {
    const decision = decideNumberOnboarding({ facts: { isOnBizApp: true, platformType: "CLOUD_API" }, signupEvent: "FINISH" })

    // Graph outranks the browser: the number is in the app whatever our page reported.
    expect(decision).toMatchObject({ mode: "coexistence", register: false, reason: "graph_says_business_app" })
  })

  it("registers an ordinary Cloud API number, exactly as before", () => {
    const decision = decideNumberOnboarding({ facts: { isOnBizApp: false, platformType: "CLOUD_API" }, signupEvent: "FINISH" })

    expect(decision).toMatchObject({ mode: "cloud_api", register: true, reason: "graph_says_cloud_api" })
  })

  it("keeps today's behaviour when neither signal mentions the app", () => {
    // The live path: our own numbers, connected before any of this existed.
    const decision = decideNumberOnboarding({ facts: { isOnBizApp: null, platformType: null }, signupEvent: null })

    expect(decision).toMatchObject({ mode: "cloud_api", register: true, reason: "no_signal" })
  })

  it("believes the customer's own choice when Graph says nothing readable", () => {
    // `is_on_biz_app` may simply not exist on the version our app may call. Silence is not "no".
    const decision = decideNumberOnboarding({ facts: { isOnBizApp: null, platformType: null }, signupEvent: event })

    expect(decision).toMatchObject({ mode: "coexistence", register: false, reason: "signup_event_says_business_app" })
  })

  it("refuses the whole signup when Meta's two answers disagree", () => {
    const decision = decideNumberOnboarding({ facts: { isOnBizApp: false, platformType: "CLOUD_API" }, signupEvent: event })

    // Neither registering nor connecting: a number we cannot describe would become a workspace's
    // live channel with nobody watching, and registering might be the irreversible mistake.
    expect(decision.mode).toBe("contradiction")
    expect(decision.register).toBe(false)
    expect(decision.error).toBeTruthy()
  })

  it("registers nothing it is not sure about", () => {
    // The property that matters, stated once over every combination: `register` is true only when
    // Graph or silence says Cloud API, never on the strength of a coexistence signal.
    for (const isOnBizApp of [true, false, null]) {
      for (const signupEvent of [event, "FINISH", "FINISH_ONLY_WABA", null]) {
        const decision = decideNumberOnboarding({ facts: { isOnBizApp, platformType: null }, signupEvent })
        const anySignalSaysApp = isOnBizApp === true || signupEvent === event
        if (anySignalSaysApp) expect(decision.register).toBe(false)
      }
    }
  })
})

describe("isCoexistenceChannel", () => {
  it("reads the flag the signup wrote, and nothing else", () => {
    expect(isCoexistenceChannel({ coexistence: true })).toBe(true)
    expect(isCoexistenceChannel({ coexistence: false })).toBe(false)
    expect(isCoexistenceChannel({ embeddedSignup: true })).toBe(false)
    // A string must not pass for the truth here: it would hold the replies of a normal channel.
    expect(isCoexistenceChannel({ coexistence: "true" })).toBe(false)
    expect(isCoexistenceChannel(null)).toBe(false)
    expect(isCoexistenceChannel("coexistence")).toBe(false)
  })
})

describe("holdsAutomaticReply", () => {
  it("holds on a number that also lives in the app, and only there", () => {
    expect(holdsAutomaticReply({ coexistence: true })).toBe(true)
    expect(holdsAutomaticReply({ coexistence: false })).toBe(false)
    // Every number connected before this existed keeps answering immediately.
    expect(holdsAutomaticReply({})).toBe(false)
    expect(holdsAutomaticReply(null)).toBe(false)
  })

  it("lets the owner override it per channel in both directions", () => {
    expect(holdsAutomaticReply({ coexistence: true, replyHold: "never" })).toBe(false)
    expect(holdsAutomaticReply({ coexistence: false, replyHold: "always" })).toBe(true)
  })

  it("treats an unreadable setting as the default rather than as an answer", () => {
    expect(readReplyHoldSetting({ replyHold: "sometimes" })).toBe("auto")
    expect(readReplyHoldSetting({})).toBe("auto")
    expect(holdsAutomaticReply({ coexistence: true, replyHold: "sometimes" })).toBe(true)
  })
})

describe("deferredReplyEnabled", () => {
  it("is on exactly where a held reply is meant to arrive later", () => {
    // Held now, answered a minute later by lib/booking/whatsapp-deferred-turn.
    expect(deferredReplyEnabled({ coexistence: true })).toBe(true)
    expect(deferredReplyEnabled({ coexistence: true, replyHold: "auto" })).toBe(true)
  })

  it("is off where the owner reserved the channel for people", () => {
    // `always` is held and stays held: the deferred worker must not answer here, which is why it
    // asks this question instead of holdsAutomaticReply.
    expect(holdsAutomaticReply({ coexistence: true, replyHold: "always" })).toBe(true)
    expect(deferredReplyEnabled({ coexistence: true, replyHold: "always" })).toBe(false)
  })

  it("is off on a channel that was never held", () => {
    // Nothing to defer: these answer inside the webhook, as they always have.
    expect(deferredReplyEnabled({ embeddedSignup: true })).toBe(false)
    expect(deferredReplyEnabled({ coexistence: true, replyHold: "never" })).toBe(false)
    expect(deferredReplyEnabled(null)).toBe(false)
  })
})
