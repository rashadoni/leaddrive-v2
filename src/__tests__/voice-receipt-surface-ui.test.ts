// @vitest-environment jsdom

import { act, createElement, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VoiceReceiptSurface } from "@/components/ai/voice-receipt-surface"
import { VOICE_STATUS_LAYER_ID } from "@/components/ai/voice-inline-status"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatter: () => ({
    dateTime: (value: Date) => `DATE(${value.toISOString().slice(0, 10)})`,
  }),
}))

const SESSION = "voice-session-1"

function serverReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    voiceSessionId: SESSION,
    actionType: "create_lead",
    state: "awaiting_confirmation",
    revision: 3,
    payloadHash: "a".repeat(64),
    preview: {
      contract: 1,
      actionType: "create_lead",
      operation: "create",
      entityType: "lead",
      titleKey: "ai.voice.actions.create_lead.title",
      fields: [
        { key: "contactName", labelKey: "ai.voice.actions.fields.contactName", after: "Ali Mammadov" },
        { key: "phone", labelKey: "ai.voice.actions.fields.phone", after: "+994 50 123 45 67" },
      ],
    },
    warnings: [],
    target: null,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    replayed: false,
    ...overrides,
  }
}

function updateReceipt() {
  return serverReceipt({
    id: "intent-2",
    actionType: "update_lead",
    target: { entityType: "lead", id: "lead-7" },
    preview: {
      contract: 1,
      actionType: "update_lead",
      operation: "update",
      entityType: "lead",
      titleKey: "ai.voice.actions.update_lead.title",
      target: { entityType: "lead", id: "lead-7", label: "Ali Mammadov" },
      fields: [
        { key: "phone", labelKey: "x", before: "+994 50 111 11 11", after: "+994 50 123 45 67" },
        { key: "interest", labelKey: "x", before: "Tyres", after: "Tyres" },
        { key: "expectedUpdatedAt", labelKey: "x", before: null, after: "2026-09-20T11:00:00.000Z" },
      ],
    },
  })
}

let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

function setViewport(mobile: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve({ success: status < 400, data }),
  })
}

function errorResponse(status: number, code: string, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: false,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve({ error: "nope", code }),
  })
}

const proofResponse = () => jsonResponse({
  confirmationEventId: "event-1",
  confirmationToken: "t".repeat(43),
  intentId: "intent-1",
  revision: 3,
  payloadHash: "a".repeat(64),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
}, 201)

const commitResponse = (replayed = false) => jsonResponse({
  intentId: "intent-1",
  state: "succeeded",
  actionType: "create_lead",
  revision: 3,
  payloadHash: "a".repeat(64),
  result: { entityType: "lead", entityId: "lead-42" },
  replayed,
}, 200)

async function render(node: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(node)
  })
}

async function click(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(el, `missing [data-testid="${testId}"]`).not.toBeNull()
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="voice-receipt-panel"]')
}

function text(testId: string): string | undefined {
  return document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? undefined
}

function postCalls(): [string, RequestInit][] {
  return (fetchMock.mock.calls as [string, RequestInit][])
    .filter(([, init]) => init?.method === "POST")
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  const layer = document.createElement("div")
  layer.id = VOICE_STATUS_LAYER_ID
  document.body.appendChild(layer)
  root = createRoot(container)
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  setViewport(false)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", () => {})
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  document.getElementById(VOICE_STATUS_LAYER_ID)?.remove()
  vi.unstubAllGlobals()
})

describe("voice receipt surface", () => {
  it("renders nothing before a voice session exists, and asks the server for nothing", async () => {
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: null }))
    expect(panel()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("restores the session's active receipt over the active endpoint", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/ai/voice/actions/active?voiceSessionId=${SESSION}`,
    )
    expect(panel()?.dataset.receiptId).toBe("intent-1")
  })

  it("renders an anchored desktop panel beside the orb", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    const anchorRef = createRef<HTMLElement>()
    const anchor = document.createElement("div")
    anchor.getBoundingClientRect = () => ({
      top: 10, bottom: 50, left: 900, right: 960, width: 60, height: 40, x: 900, y: 10,
      toJSON: () => ({}),
    }) as DOMRect
    document.body.appendChild(anchor)
    anchorRef.current = anchor

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION, anchorRef }))

    const node = panel()
    expect(node?.dataset.layout).toBe("anchored")
    expect(node?.style.top).toBe("62px")
    expect(node?.style.right).toBe(`${Math.max(8, window.innerWidth - 960)}px`)
    expect(node?.parentElement?.id).toBe(VOICE_STATUS_LAYER_ID)
    expect(node?.className).not.toMatch(/inset-0/)
    anchor.remove()
  })

  it("becomes a bottom sheet below the desktop breakpoint", async () => {
    setViewport(true)
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    const anchorRef = createRef<HTMLElement>()
    anchorRef.current = document.createElement("div")

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION, anchorRef }))

    const node = panel()
    expect(node?.dataset.layout).toBe("sheet")
    expect(node?.className).toMatch(/fixed inset-x-0 bottom-0/)
    expect(node?.className).toMatch(/safe-area-inset-bottom/)
    expect(node?.className).not.toMatch(/inset-0\b/)
    expect(node?.querySelector("[class*='overflow-y']")).toBeNull()
  })

  it("does not render a receipt issued for a different voice session", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt({ voiceSessionId: "voice-session-2" })))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(panel()).toBeNull()
  })

  it("does not render a terminal receipt", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt({ state: "succeeded" })))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(panel()).toBeNull()
  })
})

describe("what the receipt shows", () => {
  it("names every prepared field with its value", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    expect(text("voice-receipt-after-contactName")).toBe("Ali Mammadov")
    expect(text("voice-receipt-after-phone")).toBe("+994 50 123 45 67")
    expect(document.querySelectorAll("[data-field]")).toHaveLength(2)
  })

  it("shows before and after for a changed field on an update", async () => {
    fetchMock.mockReturnValue(jsonResponse(updateReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    expect(text("voice-receipt-before-phone")).toBe("+994 50 111 11 11")
    expect(text("voice-receipt-after-phone")).toBe("+994 50 123 45 67")
    expect(document.querySelector('[data-field="phone"]')?.getAttribute("data-changed")).toBe("true")

    // An unchanged field is listed but not dressed up as an edit.
    expect(document.querySelector('[data-field="interest"]')?.getAttribute("data-changed")).toBe("false")
    expect(document.querySelector('[data-testid="voice-receipt-before-interest"]')).toBeNull()
  })

  it("hides the optimistic-lock token, which is not the user's field", async () => {
    fetchMock.mockReturnValue(jsonResponse(updateReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(document.querySelector('[data-field="expectedUpdatedAt"]')).toBeNull()
  })

  it("names the record an update will touch", async () => {
    fetchMock.mockReturnValue(jsonResponse(updateReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(text("voice-receipt-target")).toBe("Ali Mammadov")
  })

  it("says which existing record a duplicate warning matched, and links to it", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt({
      warnings: [{
        code: "POSSIBLE_DUPLICATE",
        candidates: [{ id: "lead-9", contactName: "Ali Mammadov" }],
      }],
    })))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    const link = document.querySelector<HTMLAnchorElement>(
      '[data-testid="voice-receipt-duplicate-candidate"]',
    )
    expect(link?.textContent).toBe("Ali Mammadov")
    expect(link?.getAttribute("href")).toBe("/leads/lead-9")
  })

  it("states that nothing happens until the button is pressed", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(text("voice-receipt-press-notice")).toBe("receipt.pressNotice")
  })

  it("labels the button with the operation, not with the word confirm", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(text("voice-receipt-confirm")).toBe("receipt.confirm.create_lead")

    fetchMock.mockReturnValue(jsonResponse(updateReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: "voice-session-9" }))
  })
})

describe("confirming an action", () => {
  it("confirms then commits, carrying the reviewed revision and hash", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(proofResponse())
      .mockReturnValueOnce(commitResponse())

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")

    const posts = postCalls()
    expect(posts.map(([url]) => url)).toEqual([
      "/api/v1/ai/voice/actions/intent-1/confirmation",
      "/api/v1/ai/voice/actions/intent-1/commit",
    ])
    expect(JSON.parse(String(posts[0][1].body))).toEqual({
      expectedRevision: 3,
      payloadHash: "a".repeat(64),
      confirmed: true,
    })
    expect(panel()?.dataset.outcome).toBe("succeeded")
    expect(text("voice-receipt-outcome")).toBe("receipt.result.done")
  })

  it("sends nothing until the button is pressed", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(postCalls()).toHaveLength(0)
  })

  it("offers the created record instead of a second press", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(proofResponse())
      .mockReturnValueOnce(commitResponse())

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")

    expect(document.querySelector('[data-testid="voice-receipt-confirm"]')).toBeNull()
    expect(document.querySelector('[data-testid="voice-receipt-cancel"]')).toBeNull()
    expect(
      document.querySelector<HTMLAnchorElement>('[data-testid="voice-receipt-open-result"]')
        ?.getAttribute("href"),
    ).toBe("/leads/lead-42")
  })

  it("says so when the commit only replayed an earlier success", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(proofResponse())
      .mockReturnValueOnce(commitResponse(true))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")
    expect(text("voice-receipt-outcome")).toBe("receipt.result.alreadyDone")
  })

  // The double click. The server would refuse the second proof, but a client
  // that sends one is a client that would duplicate a write if it ever stopped.
  it("turns a double press into one commit", async () => {
    let releaseProof: ((value: unknown) => void) | null = null
    const pending = new Promise((resolve) => {
      releaseProof = resolve
    })

    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(commitResponse())

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    const button = document.querySelector<HTMLElement>('[data-testid="voice-receipt-confirm"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(postCalls()).toHaveLength(1)

    await act(async () => {
      releaseProof?.(await proofResponse())
      await pending
    })
    expect(postCalls()).toHaveLength(2)
  })

  it("reports a refused action without pretending it ran", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(errorResponse(403, "MODULE_FORBIDDEN"))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")

    expect(panel()?.dataset.outcome).toBe("forbidden")
    expect(text("voice-receipt-outcome")).toBe("receipt.result.forbidden")
    expect(document.querySelector('[data-testid="voice-receipt-open-result"]')).toBeNull()
  })

  it("turns a recoverable failure into a retry on the same button", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(errorResponse(429, "RATE_LIMITED", { "Retry-After": "30" }))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")

    expect(text("voice-receipt-outcome")).toBe('receipt.result.rateLimited:{"seconds":30}')
    expect(text("voice-receipt-confirm")).toBe("receipt.retry")

    fetchMock.mockReturnValueOnce(proofResponse()).mockReturnValueOnce(commitResponse())
    await click("voice-receipt-confirm")
    expect(panel()?.dataset.outcome).toBe("succeeded")
  })

  it("offers a reload when the draft no longer matches the record", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(errorResponse(409, "TARGET_VERSION_MISMATCH"))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")
    expect(text("voice-receipt-outcome")).toBe("receipt.result.stale")

    fetchMock.mockReturnValueOnce(jsonResponse(serverReceipt({ revision: 4 })))
    await click("voice-receipt-refresh")
    expect(panel()?.dataset.outcome).toBe("pending")
  })

  it("cancels the server draft and closes, without ever touching commit", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(jsonResponse({ id: "intent-1", state: "cancelled" }))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-cancel")

    expect(panel()).toBeNull()
    const posts = postCalls()
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe("/api/v1/ai/voice/actions/intent-1/cancel")
    expect(JSON.parse(String(posts[0][1].body))).toEqual({ expectedRevision: 3 })
  })

  it("closes locally without cancelling the server draft", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-dismiss")

    expect(panel()).toBeNull()
    expect(postCalls()).toHaveLength(0)
  })
})

describe("accessibility", () => {
  it("carries the region, labels and touch targets the roadmap requires", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    const node = panel()
    expect(node?.getAttribute("role")).toBe("region")
    expect(node?.getAttribute("aria-label")).toBe("receipt.ariaLabel")
    expect(node?.getAttribute("aria-live")).toBe("polite")
    expect(node?.querySelector("h2")?.textContent).toBe("receipt.action.create_lead")

    for (const testId of ["voice-receipt-confirm", "voice-receipt-cancel", "voice-receipt-dismiss"]) {
      const control = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      expect(control?.className, testId).toMatch(/h-11/)
      expect(control?.className, testId).toMatch(/focus-visible:ring-2/)
    }
  })

  it("announces a failed outcome as an alert", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(serverReceipt()))
      .mockReturnValueOnce(errorResponse(400, "LEAD_INVALID"))

    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    await click("voice-receipt-confirm")

    expect(document.querySelector('[data-testid="voice-receipt-outcome"]')?.getAttribute("role"))
      .toBe("alert")
  })
})
