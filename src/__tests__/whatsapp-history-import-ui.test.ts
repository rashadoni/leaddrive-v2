// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WhatsAppEmbeddedSignup } from "@/components/channels/whatsapp-embedded-signup"
import { WhatsAppHistoryImportStatus } from "@/components/channels/whatsapp-history-import-status"
import type { HistoryImportView } from "@/lib/whatsapp-history-import/status"

/**
 * The two screens of the WhatsApp coexistence import (lib/whatsapp-history-import): what the person
 * is told before Meta's window opens, and how the import is shown under the number afterwards.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe("before Meta's window", () => {
  it("says, before the click, what to scan and what comes over", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true, appId: "1", configId: "2" }))))
    const steps = ["Scan the QR code with the WhatsApp Business app.", "The number stays on the phone.", "Contacts and 6 months of chats come over."]
    await act(async () => {
      root.render(createElement(WhatsAppEmbeddedSignup, {
        labels: {
          title: "Connect", description: "", working: "…", connected: "{number}", paymentHint: "", cancelled: "", failed: "",
          keepAppButton: "Keep my WhatsApp Business app", keepAppHint: "Keeps working.", keepAppSteps: steps,
          moveButton: "Move to the API", moveHint: "", agentBlockedHint: "", offboardingHint: "",
        },
      }))
    })
    await flush()
    const list = container.querySelector('[data-testid="whatsapp-keep-app-steps"]')
    expect(Array.from(list?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual(steps)
    // Under the button that opens Meta's window, before the other path.
    const text = container.textContent || ""
    expect(text.indexOf(steps[0])).toBeGreaterThan(text.indexOf("Keep my WhatsApp Business app"))
    expect(text.indexOf(steps[2])).toBeLessThan(text.indexOf("Move to the API"))
  })
})

describe("the import under the number", () => {
  const view = (patch: Partial<HistoryImportView>): HistoryImportView => ({
    state: "importing",
    onboardedAt: "2026-11-15T10:00:00.000Z",
    windowEndsAt: "2026-11-16T10:00:00.000Z",
    canRetry: false,
    requests: { contacts: { requestedAt: "x", requestId: "r1" }, history: { requestedAt: "x", requestId: "r2" } },
    contacts: { received: 120, created: 80, matched: 40, overPlanLimit: 0, pending: 0 },
    history: { progress: 55, conversations: 31, messages: 912, pendingChunks: 1, failedChunks: 0, declined: false },
    ...patch,
  })

  async function show(answer: HistoryImportView, locale: "az" | "ru" | "en" = "ru") {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer)))
    vi.stubGlobal("fetch", fetchMock)
    await act(async () => { root.render(createElement(WhatsAppHistoryImportStatus, { channelId: "cfg 1", locale })) })
    await flush()
    return fetchMock
  }

  it("shows Meta's percentage and what has already come over", async () => {
    const fetchMock = await show(view({}))
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/channels/cfg%201/whatsapp-history")
    const box = container.querySelector('[data-testid="whatsapp-history-import"]')!
    expect(box.getAttribute("data-state")).toBe("importing")
    expect(box.textContent).toContain("Импорт идёт: 55%")
    expect(box.textContent).toContain("контакты: 80 новых, 40 уже были")
    expect(box.textContent).toContain("переписка: 31 диалогов, 912 сообщений")
  })

  it("says it in words when the business did not share its history", async () => {
    await show(view({ state: "declined", history: { progress: null, conversations: 0, messages: 0, pendingChunks: 0, failedChunks: 0, declined: true } }), "az")
    expect(container.textContent).toContain("tarixçənin paylaşılması söndürülüb")
  })

  it("offers to ask again only what Meta refused, inside its 24 hours", async () => {
    await show(view({
      state: "request_failed",
      canRetry: true,
      requests: { contacts: { requestedAt: "x", error: "(#100) temporarily unavailable" }, history: { requestedAt: "x", error: "(#100) temporarily unavailable" } },
      contacts: { received: 0, created: 0, matched: 0, overPlanLimit: 0, pending: 0 },
      history: { progress: null, conversations: 0, messages: 0, pendingChunks: 0, failedChunks: 0, declined: false },
    }), "en")
    expect(container.textContent).toContain("Chats: (#100) temporarily unavailable")
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Request again")
    expect(retry).toBeTruthy()
  })

  it("is silent for a number that does not live in the app", async () => {
    await show(view({ state: "not_coexistence" }))
    expect(container.querySelector('[data-testid="whatsapp-history-import"]')).toBeNull()
  })

  it("says plainly when the import is done", async () => {
    await show(view({ state: "done", history: { progress: 100, conversations: 31, messages: 1200, pendingChunks: 0, failedChunks: 0, declined: false } }))
    expect(container.textContent).toContain("Готово: контакты и переписка за 6 месяцев в CRM.")
  })
})
