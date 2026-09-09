// @vitest-environment jsdom

/**
 * One call, one button.
 *
 * The lead card grew two: "call yourself", which rings the salesperson's own
 * phone, and "call from browser", which puts the call in this tab. They are not
 * two kinds of call — they are two places to pick up the same one, and the
 * customer cannot tell the difference. Offering both asks the salesperson to
 * understand a distinction that changes nothing for them, and the phone one is
 * the half that goes wrong: it needs a number in the profile, and with that
 * field empty it connects the customer to an extension nobody answers.
 *
 * So where the browser can take the call, the phone button is not shown.
 *
 * Hidden, not deleted: organisations without the softphone have only that path,
 * and the tests below pin both directions so a future change cannot quietly
 * take the phone button away from them.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { LeadManualCallAction } from "@/components/leads/lead-manual-call-action"

let container: HTMLDivElement
let root: Root

/** Resolve the capabilities call with a given answer, or never resolve it. */
function mockCapabilities(answer: { browserCalls: boolean } | "pending") {
  const fetchMock = vi.fn(() =>
    answer === "pending"
      ? new Promise(() => {})
      : Promise.resolve({ ok: true, json: () => Promise.resolve(answer) }),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function render() {
  await act(async () => {
    root.render(createElement(LeadManualCallAction, { leadId: "lead-1", phone: "+994501112233" }))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the phone-call button on a lead card", () => {
  it("steps aside where the browser can take the call", async () => {
    mockCapabilities({ browserCalls: true })
    await render()
    expect(container.textContent).toBe("")
  })

  it("is the only path where the browser cannot", async () => {
    mockCapabilities({ browserCalls: false })
    await render()
    expect(container.textContent).toContain("manualCall")
  })

  it("shows while the answer is still in flight", async () => {
    // Not a detail. Rendering nothing until the answer arrives would make the
    // button appear late on every load for the organisations that depend on
    // it, and a button that appears after the eye has moved on is a button
    // nobody presses.
    mockCapabilities("pending")
    await render()
    expect(container.textContent).toContain("manualCall")
  })

  it("shows when the capability check fails outright", async () => {
    // A network error must not remove the only way to call. Failing towards
    // the path with no moving parts is the safe direction.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    await render()
    expect(container.textContent).toContain("manualCall")
  })

  it("stays away when the lead has no number at all", async () => {
    mockCapabilities({ browserCalls: false })
    await act(async () => {
      root.render(createElement(LeadManualCallAction, { leadId: "lead-1", phone: null }))
    })
    expect(container.textContent).toBe("")
  })
})
