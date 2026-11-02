// @vitest-environment jsdom
/**
 * The click-to-call card follows ITS OWN call to the end.
 *
 * It used to poll `GET /api/v1/calls?limit=1` — the newest row the user can
 * see — and update only when that row was its own call. Any newer visible
 * row (an inbound call, a teammate's call: agents see their team's human
 * calls) froze the card on «Bağlantı var» with the timer running; it never
 * reached «Zəng bitdi» or the outcome picker.
 *
 * The network stub below answers like the real route: with `?id=` it returns
 * that row, without it the newest visible row — which here is somebody
 * else's call. The component is rendered for real with the Azerbaijani copy.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
function message(namespace: string | undefined, key: string): string | undefined {
  let node: string | Messages | undefined = az
  for (const part of [...(namespace ? namespace.split(".") : []), ...key.split(".")]) {
    node = typeof node === "object" ? node[part] : undefined
  }
  return typeof node === "string" ? node : undefined
}
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      (message(namespace, key) ?? `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
    t.has = (key: string) => message(namespace, key) !== undefined
    return t
  },
  useLocale: () => "az",
}))

import { CallWidget } from "@/components/call-widget"

const OWN_CALL = "call-own"
const voip = (key: string) => message("voip", key)!

interface Row { id: string; status: string; duration: number | null }
/** What the server holds right now. `newer` is a call created after ours. */
let own: Row
const newer: Row = { id: "call-colleague-newer", status: "in-progress", duration: null }

let pollUrls: string[]
let heldPoll: { resolve: () => void } | null
let holdNextPoll: boolean

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

function callsResponse(url: URL) {
  const id = url.searchParams.get("id")
  const rows = id ? [own, newer].filter((row) => row.id === id) : [newer, own]
  const limit = Number(url.searchParams.get("limit") || "25")
  return json({ success: true, data: rows.slice(0, limit).map((row) => ({ ...row })) })
}

let root: Root
let container: HTMLDivElement

const text = () => container.textContent ?? ""
const outcomePicker = () => container.querySelector<HTMLSelectElement>(`#call-widget-disposition-${OWN_CALL}`)
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)

async function render() {
  await act(async () => {
    root.render(createElement(CallWidget, {
      callLogId: OWN_CALL,
      phoneNumber: "+994 50 000 00 00",
      onClose: () => {},
    }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
  own = { id: OWN_CALL, status: "initiated", duration: null }
  pollUrls = []
  heldPoll = null
  holdNextPoll = false
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost")
    if (url.pathname === "/api/v1/calls") {
      pollUrls.push(url.pathname + url.search)
      if (holdNextPoll) {
        holdNextPoll = false
        // Snapshot taken now, delivered later — a reply already on its way.
        const reply = callsResponse(url)
        return new Promise<Response>((resolve) => { heldPoll = { resolve: () => resolve(reply) } })
      }
      return callsResponse(url)
    }
    if (url.pathname === `/api/v1/calls/${OWN_CALL}/end`) {
      own = { ...own, status: "completed" }
      return json({ success: true })
    }
    return json({ success: true, data: [] })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("call widget follows its own call", () => {
  it("reaches «Zəng bitdi» and the outcome picker although a newer, unrelated call exists", async () => {
    await render()
    expect(text()).toContain(voip("activeCall"))
    expect(text()).toContain(voip("statusLabels.initiated"))

    own = { ...own, status: "in-progress" }
    await wait(2_000)
    expect(text()).toContain(voip("connected"))
    expect(outcomePicker()).toBeNull()

    own = { ...own, status: "completed", duration: 42 }
    await wait(2_000)
    expect(text()).toContain(voip("callEnded"))
    expect(text()).not.toContain(voip("activeCall"))
    expect(text()).toContain("0:42")
    expect(outcomePicker()).not.toBeNull()

    // Every request named this call; none read "the newest visible row".
    expect(pollUrls.length).toBeGreaterThan(0)
    for (const url of pollUrls) {
      expect(new URL(url, "http://localhost").searchParams.get("id")).toBe(OWN_CALL)
    }

    // Terminal: no more polling, and the duration stays the server's.
    const asked = pollUrls.length
    await wait(10_000)
    expect(pollUrls.length).toBe(asked)
    expect(text()).toContain("0:42")
  })

  it("treats dispatch-uncertain as over: the timer stops and polling ends", async () => {
    await render()
    own = { ...own, status: "dispatch-uncertain" }
    await wait(2_000)
    expect(text()).toContain(voip("callEnded"))
    expect(outcomePicker()).not.toBeNull()

    const asked = pollUrls.length
    const shown = text()
    await wait(10_000)
    expect(pollUrls.length).toBe(asked)
    // The duration on the card no longer counts up.
    expect(text()).toBe(shown)
  })

  it("stops polling when it is unmounted", async () => {
    await render()
    own = { ...own, status: "in-progress" }
    await wait(2_000)
    const asked = pollUrls.length
    expect(asked).toBeGreaterThan(1)

    act(() => root.unmount())
    await wait(10_000)
    expect(pollUrls.length).toBe(asked)
    root = createRoot(container)
  })

  it("stays ended when a poll reply with «in progress» lands after the hang-up", async () => {
    await render()
    own = { ...own, status: "in-progress" }
    await wait(2_000)
    expect(text()).toContain(voip("connected"))

    holdNextPoll = true
    await wait(2_000)
    expect(heldPoll).not.toBeNull()

    await act(async () => { button(voip("endCall"))?.click() })
    await wait(0)
    expect(text()).toContain(voip("callEnded"))

    await act(async () => { heldPoll?.resolve() })
    await wait(0)
    expect(text()).toContain(voip("callEnded"))
    expect(text()).not.toContain(voip("connected"))
  })
})
