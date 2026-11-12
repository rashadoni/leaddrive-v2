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

/**
 * Which form the agent may send is one key in the organisation's settings,
 * written by this module and by nothing else. Here it is only watched: what
 * it writes, and when, is the difference between a published form and a form
 * clients never see.
 */
const setting = vi.fn(async (...args: unknown[]) => args.length)
vi.mock("@/lib/booking/db", () => ({ bookingDb: { $executeRawUnsafe: setting } }))
/** What the last write recorded in `flowId`, as JSON. */
const lastWritten = () => setting.mock.calls.at(-1)?.[2]

const { deleteBookingFlow, ensureBookingFlow, flowTap, flowsCapability, bookingFlowJson, BOOKING_FLOW_DAY_IDS, BOOKING_FLOW_NAME } = await import("@/lib/booking/whatsapp-flow")

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
  const form = screen.layout.children.find((child) => child.type === "Form") as { children: Record<string, unknown>[] } & Record<string, unknown>

  it("asks one question on one screen, and that screen ends the form", () => {
    // A salon's client answers «which time». Every extra screen is a tap
    // between them and a booking.
    expect(flow.screens).toHaveLength(1)
    expect(screen.terminal).toBe(true)
  })

  it("takes everything it shows from the message, not from the published form", () => {
    // One published form serves every service, master and day: the service,
    // its photo, the days and the times are handed to the screen when the
    // message is sent. Binding any of them into the form would mean
    // republishing it for every day of the week.
    for (const key of ["service", "details", "photo", "has_photo", "days", "day_init", "client", ...BOOKING_FLOW_DAY_IDS.map((ignored, index) => `t${index}`)]) {
      expect(screen.data, key).toHaveProperty(key)
    }
    const day = form.children.find((child) => child.name === "day")
    expect(day).toMatchObject({ type: "Dropdown", required: true, "data-source": "${data.days}" })
  })

  it("shows the times of the chosen day and no others", () => {
    // The day is a SLOT, never a date: the conditions that reveal a day's
    // times are part of the published form, and a date baked into one would
    // be wrong by tomorrow. What d2 means travels with the message.
    const blocks = form.children.filter((child) => child.type === "If") as { condition: string; then: Record<string, unknown>[] }[]
    expect(blocks).toHaveLength(BOOKING_FLOW_DAY_IDS.length)
    blocks.forEach((block, index) => {
      expect(block.condition).toBe(`\${form.day} == '${BOOKING_FLOW_DAY_IDS[index]}'`)
      expect(block.then[0]).toMatchObject({ type: "RadioButtonsGroup", name: `t${index}`, "data-source": `\${data.t${index}}` })
      // Never required: a hidden day's list must not hold the form shut.
      expect(block.then[0]).not.toHaveProperty("required")
    })
    expect(form.children.some((child) => child.type === "RadioButtonsGroup")).toBe(false)
  })

  it("lets a client change what is being booked, and with whom", () => {
    const service = form.children.find((child) => child.name === "service")
    const host = form.children.find((child) => child.name === "host")
    expect(service).toMatchObject({ type: "Dropdown", "data-source": "${data.services}", visible: "${data.has_services}" })
    expect(host).toMatchObject({ type: "Dropdown", "data-source": "${data.hosts}", visible: "${data.has_hosts}" })
    // Neither is required: a salon with one service and one master shows
    // neither control, and a form cannot be held shut by a hidden one.
    expect(service).not.toHaveProperty("required")
    expect(host).not.toHaveProperty("required")
    // They come back with the answer, or the agent cannot act on them.
    const footer = form.children.find((child) => child.type === "Footer") as { "on-click-action": { payload: Record<string, string> } }
    expect(footer["on-click-action"].payload.service).toBe("${form.service}")
    expect(footer["on-click-action"].payload.host).toBe("${form.host}")
  })

  it("shows the service the way a salon would: picture, name, price", () => {
    const children = screen.layout.children
    expect(children[0]).toMatchObject({ type: "Image", src: "${data.photo}", visible: "${data.has_photo}" })
    expect(children[1]).toMatchObject({ type: "TextHeading", text: "${data.service}" })
    expect(children[2]).toMatchObject({ type: "TextCaption", text: "${data.details}" })
  })

  it("pre-fills the name on the form, never on the field", () => {
    // Meta refuses `init-value` inside a TextInput outright, and that single
    // line was the whole reason the form would not publish (2026-11-11):
    // «Property 'init-value' is not allowed in 'TextInput' component».
    const field = form.children.find((child) => child.name === "client") as Record<string, unknown>
    expect(field).not.toHaveProperty("init-value")
    expect(form).toMatchObject({ "init-values": { client: "${data.client}" } })
  })

  it("sends back what was chosen, under names the agent reads", () => {
    const footer = form.children.find((child) => child.type === "Footer") as { "on-click-action": { name: string; payload: Record<string, string> } }
    expect(footer["on-click-action"].name).toBe("complete")
    expect(footer["on-click-action"].payload).toEqual({
      service: "${form.service}",
      host: "${form.host}",
      day: "${form.day}",
      ...Object.fromEntries(BOOKING_FLOW_DAY_IDS.map((ignored, index) => [`t${index}`, `\${form.t${index}}`])),
      client: "${form.client}",
      note: "${form.note}",
    })
  })

  it("stays inside what WhatsApp renders", () => {
    // Meta's own ceilings, and they are not advisory: a form over them is
    // refused at publish and the salon is left without one.
    const children = screen.layout.children
    const count = (items: Record<string, unknown>[]): number => items.reduce((total, child) => total
      + 1
      + count((child.children ?? child.then ?? []) as Record<string, unknown>[]), 0)
    expect(count(children)).toBeLessThanOrEqual(50)
    expect(children.filter((child) => child.type === "Image")).toHaveLength(1)
    expect(form.children.filter((child) => child.type === "Footer")).toHaveLength(1)
  })

  it("declares a schema version, because a form without one is refused", () => {
    expect(flow.version).toMatch(/^\d+\.\d+$/)
    expect(Number(flow.version)).toBeGreaterThanOrEqual(7.2)
  })
})

describe("what the agent is allowed to send", () => {
  /** Meta answers every step «ok» and lists the form with this status. */
  const setupEnding = (status: string) => vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => url.includes("/flows?")
      ? { data: [{ id: "77", name: BOOKING_FLOW_NAME, status, categories: [] }] }
      : { success: true },
  })))

  it("writes down a published form, because that is the one clients can open", async () => {
    setupEnding("PUBLISHED")

    const result = await ensureBookingFlow("org-1")

    expect(result.ok).toBe(true)
    expect(result.flowId).toBe("77")
    expect(lastWritten()).toBe(JSON.stringify("77"))
    expect(result.steps.find((step) => step.step === "remember")).toMatchObject({ ok: true })
  })

  it("writes down nothing while Meta still calls it a draft", async () => {
    // Every call can answer «ok» and the form still not be publishable — that
    // is exactly what happened on 2026-11-11, when `init-value` inside a
    // TextInput left it a DRAFT. A form sent in that state opens as an error
    // on the client's phone, so the agent must go on sending the list.
    setupEnding("DRAFT")

    const result = await ensureBookingFlow("org-1")

    expect(result.ok).toBe(false)
    expect(lastWritten()).toBe("null")
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
    // And the agent stops sending it in the same breath: a form deleted at
    // Meta but still named in the settings is a message that fails for every
    // client until somebody notices.
    expect(lastWritten()).toBe("null")
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

describe("a form that comes back", () => {
  /** How Meta delivers a submitted form: one JSON string inside `nfm_reply`. */
  const submission = (answers: Record<string, unknown>) => ({
    type: "nfm_reply",
    nfm_reply: { response_json: JSON.stringify(answers), body: "Sent", name: "flow" },
  })

  it("is the time the client picked, the name they typed and their note", () => {
    // The id is the one a menu row carries, so the tap lands in the handler
    // that already books — the form adds a way in, not a second code path.
    // Only the day on screen has an answer in it; the rest are days the
    // client never saw.
    expect(flowTap(submission({ flow_token: "bkflow:conv-1", day: "d2", t0: "", t2: "bk:offer-9", client: "Günel", note: "Rəngə də baxaq", service: "page-1", host: "any" })))
      .toEqual({ replyId: "bk:offer-9", name: "Günel", note: "Rəngə də baxaq", serviceId: "page-1", hostId: "any" })
  })

  it("leaves the name alone when the form came back without one", () => {
    // Then the client keeps the name WhatsApp knows them by; an empty string
    // overwriting it is how a meeting ends up booked for nobody.
    expect(flowTap(submission({ day: "d1", t1: "bkt:service-3:host-1:2026-11-14T09:00:00.000Z", client: "   " })))
      .toEqual({ replyId: "bkt:service-3:host-1:2026-11-14T09:00:00.000Z", name: null, note: null, serviceId: null, hostId: null })
  })

  it("says which service and which master the client left the form on", () => {
    // Both are ordinary choices, not filters the form can apply: a published
    // form cannot ask us for another service's times, so what comes back is
    // what the client wants, and the agent answers with a new form.
    const chosen = flowTap(submission({ day: "d0", t0: "bk:offer-1", client: "Günel", service: "page-2", host: "host-7" }))!
    expect(chosen.serviceId).toBe("page-2")
    expect(chosen.hostId).toBe("host-7")
    // «No preference» is a choice too: it says the client does not mind,
    // which is not the same as never having been asked.
    expect(flowTap(submission({ day: "d0", t0: "bk:offer-1", host: "   " }))!.hostId).toBe("any")
    expect(flowTap(submission({ day: "d0", t0: "bk:offer-1" }))!.hostId).toBeNull()
  })

  it("reads a day with no time as the day it is", () => {
    // Closing the form on a day without picking a time still says something:
    // show me that day. The slot is all the form can give — what d3 meant is
    // known to the message that offered it.
    expect(flowTap(submission({ day: "d3", client: "Günel" })))
      .toEqual({ replyId: "bkds:d3", name: "Günel", note: null, serviceId: null, hostId: null })
    // A slot the published form does not have is not a day at all.
    expect(flowTap(submission({ day: "d9", client: "Günel" }))).toBeNull()
  })

  it("is nothing at all for a message that is not a form", () => {
    // A tapped row, a tapped button, a plain text: all already understood
    // elsewhere, and none of them must be read as a submission.
    expect(flowTap({ type: "list_reply", list_reply: { id: "bk:offer-9", title: "12:30" } })).toBeNull()
    expect(flowTap(undefined)).toBeNull()
    expect(flowTap({ nfm_reply: { response_json: "{not json" } })).toBeNull()
    // A form with no time in it books nothing: an answer whose shape we do
    // not recognise is not an answer.
    expect(flowTap(submission({ client: "Günel" }))).toBeNull()
  })
})
