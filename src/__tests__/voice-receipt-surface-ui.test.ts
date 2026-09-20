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
}))

const SESSION = "voice-session-1"

function serverReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    voiceSessionId: SESSION,
    actionType: "create_lead",
    state: "awaiting_confirmation",
    revision: 1,
    payloadHash: "a".repeat(64),
    preview: {
      contract: 1,
      actionType: "create_lead",
      operation: "create",
      entityType: "lead",
      titleKey: "voice.receipt.action.create_lead",
      fields: [
        { key: "contactName", labelKey: "leads.contactName", after: "Ali Mammadov" },
        { key: "phone", labelKey: "leads.phone", after: "+994 50 123 45 67" },
      ],
    },
    warnings: [{ code: "possible_duplicate_lead", leadId: "lead-9" }],
    target: null,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    replayed: false,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

/** Drive the media query the surface listens to. */
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

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ success: status < 400, data }),
  })
}

async function render(node: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(node)
  })
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="voice-receipt-panel"]')
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
    const node = panel()
    expect(node).not.toBeNull()
    expect(node?.dataset.receiptId).toBe("intent-1")
    expect(node?.dataset.actionType).toBe("create_lead")
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
    // Positioned relative to the orb's own right edge, not a fixed corner.
    expect(node?.style.right).toBe(`${Math.max(8, window.innerWidth - 960)}px`)
    // It hangs in the shell's dedicated layer, above page content and below
    // in-place dialogs.
    expect(node?.parentElement?.id).toBe(VOICE_STATUS_LAYER_ID)
    // Never a full-screen takeover: the CRM record stays visible.
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
    // A sheet, not a modal: no inset-0 backdrop and no inner scroll region.
    expect(node?.className).not.toMatch(/inset-0\b/)
    expect(node?.querySelector("[class*='overflow-y']")).toBeNull()
  })

  it("renders in the page flow when no orb anchor is given", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    const node = panel()
    expect(node?.dataset.layout).toBe("inline")
    expect(container.contains(node)).toBe(true)
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

  it("stays silent when the session has no active receipt or the read fails", async () => {
    fetchMock.mockReturnValue(jsonResponse(null))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(panel()).toBeNull()

    fetchMock.mockReturnValue(jsonResponse(null, 403))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: "voice-session-3" }))
    expect(panel()).toBeNull()
  })

  it("closes locally without cancelling the server draft", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    const dismiss = document.querySelector<HTMLButtonElement>('[data-testid="voice-receipt-dismiss"]')
    expect(dismiss).not.toBeNull()
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(panel()).toBeNull()
    // Exactly the one GET from mount. Hiding a draft is not a CRM operation.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("never issues a write request in shadow mode", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    const node = panel()
    expect(node?.dataset.commitEnabled).toBe("false")
    // No confirm control exists yet; the only button is the local dismiss.
    expect(node?.querySelectorAll("button")).toHaveLength(1)
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).not.toMatch(/commit|confirmation|cancel|draft/)
      expect((init?.method ?? "GET").toUpperCase()).toBe("GET")
    }
  })

  it("states plainly that nothing has been written", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
    expect(
      document.querySelector('[data-testid="voice-receipt-shadow-notice"]')?.textContent,
    ).toBe("receipt.shadowNotice")
  })

  it("carries the accessibility foundation the roadmap requires", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    const node = panel()
    expect(node?.getAttribute("role")).toBe("region")
    expect(node?.getAttribute("aria-label")).toBe("receipt.ariaLabel")
    expect(node?.getAttribute("aria-live")).toBe("polite")
    expect(node?.querySelector("h2")?.textContent).toBe("receipt.action.create_lead")

    const dismiss = document.querySelector<HTMLButtonElement>('[data-testid="voice-receipt-dismiss"]')
    expect(dismiss?.getAttribute("aria-label")).toBe("receipt.dismiss")
    // 44 px touch target and a visible keyboard focus ring.
    expect(dismiss?.className).toMatch(/h-11 w-11/)
    expect(dismiss?.className).toMatch(/focus-visible:ring-2/)
  })

  it("counts the prepared fields and warnings it was given", async () => {
    fetchMock.mockReturnValue(jsonResponse(serverReceipt()))
    await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))

    expect(document.querySelector('[data-testid="voice-receipt-summary"]')?.textContent)
      .toBe('receipt.fieldsPrepared:{"count":2}')
    expect(document.querySelector('[data-testid="voice-receipt-warning-count"]')?.textContent)
      .toBe('receipt.warningsPrepared:{"count":1}')
  })

  it("stops showing a receipt once its server TTL has passed", async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockReturnValue(
        jsonResponse(serverReceipt({ expiresAt: new Date(Date.now() + 1_000).toISOString() })),
      )
      await render(createElement(VoiceReceiptSurface, { voiceSessionId: SESSION }))
      expect(panel()).not.toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(20_000)
      })
      expect(panel()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
