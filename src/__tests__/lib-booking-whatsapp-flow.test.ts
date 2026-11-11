/**
 * Before building a form inside WhatsApp, ask the number whether it can show
 * one.
 *
 * WhatsApp Flows is the only way to put a real form — a day to pick, a time to
 * tap, a name to type — into a WhatsApp chat; three quick-reply buttons and a
 * ten-row list are the alternative. But the salon's number runs in coexistence
 * (the Business app and the Cloud API on one number), and Meta documents what
 * coexistence removes without mentioning Flows either way. A capability nobody
 * will confirm in writing is one you measure, so this module asks Meta and
 * reports the answer rather than assuming it.
 *
 * What is checked here is the reading of that answer, because getting it wrong
 * is how a feature ships against a number that cannot show it:
 *
 *   • a list of Flows means supported — and only a list does. Meta answers a
 *     request for a product an account does not have with an ordinary error,
 *     so an error is never read as «none yet».
 *   • no channel and no businessAccountId are their own answers, not a refusal
 *     by Meta: they are ours to fix, and the screen must say which.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const resolveWhatsAppConfig = vi.fn()

vi.mock("@/lib/whatsapp", () => ({
  resolveWhatsAppConfig,
  WHATSAPP_GRAPH_API_BASE: "https://graph.facebook.com/v21.0",
}))

const { deleteBookingFlow, flowsCapability, bookingFlowJson, BOOKING_FLOW_NAME } = await import("@/lib/booking/whatsapp-flow")

const CONFIG = { accessToken: "tok", phoneNumberId: "pn", businessAccountId: "waba-1" }

beforeEach(() => {
  resolveWhatsAppConfig.mockResolvedValue(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const answers = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: async () => body })))

describe("whether this number can show a form", () => {
  it("carries what Meta refuses to publish, in its own words", async () => {
    // Publishing answers only «make sure a valid Flow JSON is used»; what is
    // actually wrong lives on the flow, and without asking for it the next
    // step is guesswork (2026-11-11).
    answers({ data: [{
      id: "9", name: BOOKING_FLOW_NAME, status: "DRAFT", categories: [],
      validation_errors: [{ error_type: "INVALID_PROPERTY", message: "unknown property", pointers: [{ path: "screens[0]" }], line_start: 3, column_start: 5 }],
    }] })

    const capability = await flowsCapability("org-1")

    if (!capability.supported) throw new Error("unreachable")
    expect(capability.booking!.errors).toHaveLength(1)
    expect(capability.booking!.errors[0]).toContain("unknown property")
    expect(capability.booking!.errors[0]).toContain("INVALID_PROPERTY")
  })

  it("reads a list of Flows as yes, and finds the booking one by name", async () => {
    answers({ data: [
      { id: "1", name: "other", status: "PUBLISHED", categories: ["OTHER"] },
      { id: "2", name: BOOKING_FLOW_NAME, status: "DRAFT", categories: ["APPOINTMENT_BOOKING"] },
    ] })

    const capability = await flowsCapability("org-1")

    expect(capability).toMatchObject({ supported: true })
    if (!capability.supported) throw new Error("unreachable")
    expect(capability.flows.map((flow) => flow.id)).toEqual(["1", "2"])
    expect(capability.flows.every((flow) => Array.isArray(flow.errors))).toBe(true)
    expect(capability.booking).toMatchObject({ id: "2", status: "DRAFT" })
  })

  it("reads an empty list as yes with nothing in it — the account can hold Flows", async () => {
    answers({ data: [] })

    expect(await flowsCapability("org-1")).toEqual({ supported: true, flows: [], booking: null })
  })

  it("never reads Meta's refusal as «no Flows yet», and keeps its words", async () => {
    // The failure this guards: treating an error as an empty list would let the
    // screen say «no form yet» about a number that can never have one.
    answers({ error: { message: "(#100) Unsupported get request", code: 100 } }, false)

    expect(await flowsCapability("org-1")).toEqual({
      supported: false, reason: "refused", detail: "(#100) Unsupported get request",
    })
  })

  it("says what is ours to fix instead of blaming Meta", async () => {
    resolveWhatsAppConfig.mockResolvedValueOnce(null)
    expect(await flowsCapability("org-1")).toMatchObject({ supported: false, reason: "no-channel" })

    resolveWhatsAppConfig.mockResolvedValueOnce({ ...CONFIG, businessAccountId: null })
    const noAccount = await flowsCapability("org-1")
    expect(noAccount).toMatchObject({ supported: false, reason: "no-business-account" })
    if (noAccount.supported) throw new Error("unreachable")
    expect(noAccount.detail).toContain("businessAccountId")
  })

  it("survives a network that never answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up") }))

    expect(await flowsCapability("org-1")).toEqual({ supported: false, reason: "refused", detail: "socket hang up" })
  })

  it("asks the number the setting names, not whichever WhatsApp comes first", async () => {
    answers({ data: [] })

    await flowsCapability("org-1", { channelConfigId: "chan-7" })

    expect(resolveWhatsAppConfig).toHaveBeenCalledWith("org-1", { channelConfigId: "chan-7" })
  })
})

describe("the form a client fills in", () => {
  const flow = bookingFlowJson() as {
    version: string
    screens: { id: string; terminal?: boolean; data: Record<string, unknown>; layout: { children: Record<string, unknown>[] } }[]
  }
  const screen = flow.screens[0]
  const form = screen.layout.children.find((child) => child.type === "Form") as { children: Record<string, unknown>[] }

  it("asks one question on one screen, and that screen ends the form", () => {
    // A salon's client answers «which time». Every extra screen is a tap
    // between them and a booking.
    expect(flow.screens).toHaveLength(1)
    expect(screen.terminal).toBe(true)
  })

  it("takes its times from the message, not from the published form", () => {
    // One published form serves every service, master and day: the times are
    // handed to the screen when the message is sent. Binding them into the
    // form would mean republishing it for every day of the week.
    const times = form.children.find((child) => child.name === "time")
    expect(times).toMatchObject({ type: "RadioButtonsGroup", required: true, "data-source": "${data.times}" })
    expect(screen.data).toHaveProperty("times")
  })

  it("sends back what was chosen, under names the agent reads", () => {
    const footer = form.children.find((child) => child.type === "Footer") as { "on-click-action": { name: string; payload: Record<string, string> } }
    expect(footer["on-click-action"].name).toBe("complete")
    expect(footer["on-click-action"].payload).toEqual({ time: "${form.time}", client: "${form.client}" })
  })

  it("declares a schema version, because a form without one is refused", () => {
    expect(flow.version).toMatch(/^\d+\.\d+$/)
    expect(Number(flow.version)).toBeGreaterThanOrEqual(7.2)
  })
})

describe("taking the form back off an account", () => {
  // It was created on the wrong tenant once (2026-11-11), and the only way out
  // must not be somebody's Meta console.
  it("deletes a form that was never published", async () => {
    const calls: { url: string; method?: string }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method })
      return { ok: true, status: 200, json: async () => init?.method === "DELETE"
        ? { success: true }
        : { data: [{ id: "77", name: BOOKING_FLOW_NAME, status: "DRAFT", categories: [] }] } }
    }))

    expect(await deleteBookingFlow("org-1")).toEqual({ ok: true, detail: JSON.stringify({ success: true }) })
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" })
    expect(calls.at(-1)!.url).toContain("/77")
  })

  it("refuses to delete a published one, and says why", async () => {
    // A published form may be open on a client's phone right now; deleting it
    // turns that into an error they cannot answer.
    answers({ data: [{ id: "77", name: BOOKING_FLOW_NAME, status: "PUBLISHED", categories: [] }] })

    const result = await deleteBookingFlow("org-1")

    expect(result.ok).toBe(false)
    expect(result.detail).toContain("published")
  })

  it("says there is nothing to delete rather than failing", async () => {
    answers({ data: [] })

    expect(await deleteBookingFlow("org-1")).toEqual({ ok: true, detail: "nothing to delete" })
  })
})
