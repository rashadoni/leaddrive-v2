// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))
import { WhatsAppEmbeddedSignup } from "@/components/channels/whatsapp-embedded-signup"
import { WhatsAppHistoryImportStatus } from "@/components/channels/whatsapp-history-import-status"
import type { HistoryImportDetail, HistoryImportView } from "@/lib/whatsapp-history-import/status"
import { WhatsAppImportBanner, WhatsAppImportPanel } from "@/components/inbox/whatsapp-import-screen"

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
  it("says, before Meta's window opens, what to scan and what comes over — and only its button opens it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true, appId: "1", configId: "2" }))))
    process.env.NEXT_PUBLIC_APP_URL = window.location.origin
    const login = vi.fn()
    window.FB = { init: vi.fn(), login }
    await act(async () => {
      root.render(createElement(WhatsAppEmbeddedSignup, {
        locale: "ru",
        labels: {
          title: "Connect", description: "", working: "…", connected: "{number}", paymentHint: "", cancelled: "", failed: "",
          keepAppButton: "Keep my WhatsApp Business app", keepAppHint: "Keeps working.",
          moveButton: "Move to the API", moveHint: "", agentBlockedHint: "", offboardingHint: "",
        },
      }))
    })
    await flush()
    const keep = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Keep my WhatsApp Business app"))!
    await act(async () => keep.click())
    const dialog = container.querySelector('[data-testid="whatsapp-keep-app-dialog"]')!
    expect(Array.from(dialog.querySelectorAll('[data-testid="whatsapp-keep-app-steps"] li')).map((li) => li.textContent)).toEqual([
      "1Откройте приложение WhatsApp Business на телефоне",
      "2Отсканируйте приложением QR-код в окне Meta",
      "3Готово — сообщения приходят и в телефон, и сюда",
    ])
    expect(dialog.textContent).toContain("Ваши контакты переносятся в LeadDrive")
    expect(dialog.textContent).toContain("Приходит переписка за последние 6 месяцев")
    expect(dialog.textContent).toContain("официальный поставщик технологий Meta")
    expect(login).not.toHaveBeenCalled()

    const go = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Продолжить с Meta")!
    await act(async () => go.click())
    await flush()
    expect(login).toHaveBeenCalledTimes(1)
    expect((login.mock.calls[0][1] as { extras: Record<string, unknown> }).extras.featureType).toBe("whatsapp_business_app_onboarding")
    delete window.FB
    delete process.env.NEXT_PUBLIC_APP_URL
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
    media: { received: 0, stored: 0, pending: 0 },
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

describe("the import screen in the inbox", () => {
  const detail = (patch: Partial<HistoryImportDetail>): HistoryImportDetail => ({
    state: "importing",
    onboardedAt: "2026-11-15T10:00:00.000Z",
    windowEndsAt: "2026-11-16T10:00:00.000Z",
    canRetry: false,
    requests: { contacts: { requestedAt: "x", requestId: "r1" }, history: { requestedAt: "x", requestId: "r2" } },
    contacts: { received: 40, created: 14, matched: 26, overPlanLimit: 0, pending: 0 },
    media: { received: 0, stored: 0, pending: 0 },
    history: { progress: 55, conversations: 31, messages: 912, pendingChunks: 1, failedChunks: 0, declined: false },
    channelId: "cfg-1",
    configName: "Mağaza Baku",
    displayPhoneNumber: "+994 51 206 08 38",
    phone: "connected",
    counts: { conversations: 31, messages: 912, media: 0, mediaFiles: 0 },
    months: [{ month: "2026-09", messages: 200 }, { month: "2026-10", messages: 400 }, { month: "2026-11", messages: 312 }],
    newContacts: { total: 14, shown: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, name: `Kontakt ${i}` })) },
    feed: [{ conversationId: "conv-1", name: "Aysel Məmmədova", lastMessage: "95 ₼, endirim bitib", at: "2026-11-13T11:31:00.000Z" }],
    ...patch,
  })

  async function showPanel(answer: HistoryImportDetail, locale = "az") {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer))))
    const onClose = vi.fn()
    await act(async () => { root.render(createElement(WhatsAppImportPanel, { channelId: "cfg-1", locale, onClose })) })
    await flush()
    return onClose
  }

  it("shows what is really counted, in the mock-up's order", async () => {
    const onClose = await showPanel(detail({}))
    const panel = container.querySelector('[data-testid="whatsapp-import-panel"]')!
    expect(panel.textContent).toContain("WhatsApp idxalı")
    expect(panel.textContent).toContain("+994 51 206 08 38 · Mağaza Baku · son 6 ay")
    expect(panel.textContent).toContain("Telefon qoşulub")
    expect(panel.textContent).toContain("55%")
    expect(Array.from(panel.querySelectorAll("[data-step]")).map((el) => [el.getAttribute("data-step"), el.getAttribute("data-step-state")])).toEqual([
      ["connect", "done"], ["contacts", "done"], ["chats", "run"], ["media", "wait"],
    ])
    // Counters with something in them only: no photos yet, so no «0 foto və səs»; and no «of N»,
    // because Meta never says how many chats there are in all.
    expect(panel.textContent).toContain("912mesaj")
    expect(panel.textContent).not.toContain("foto və səs")
    expect(panel.textContent).not.toMatch(/\/\s*\d/)
    expect(panel.querySelectorAll('[data-testid="whatsapp-import-months"] > div')).toHaveLength(3)
    // Twelve places: eleven people and «+3 daha».
    const grid = panel.querySelector('[data-testid="whatsapp-import-new-contacts"]')!
    expect(grid.children).toHaveLength(12)
    expect(grid.textContent).toContain("+3daha")
    expect(panel.querySelector('[data-testid="whatsapp-import-feed"]')?.textContent).toContain("95 ₼, endirim bitib")
    // The import teaches the AI nothing, so the mock-up's training block is not here at all.
    expect(panel.textContent).not.toMatch(/AI köməkçi|öyrən/)

    const back = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === "Arxa fonda davam et")!
    await act(async () => back.click())
    expect(onClose).toHaveBeenCalled()
  })

  it("leaves out the blocks that have nothing yet, instead of drawing zeros", async () => {
    await showPanel(detail({
      state: "waiting",
      contacts: { received: 0, created: 0, matched: 0, overPlanLimit: 0, pending: 0 },
      history: { progress: null, conversations: 0, messages: 0, pendingChunks: 0, failedChunks: 0, declined: false },
      counts: { conversations: 0, messages: 0, media: 0, mediaFiles: 0 },
      months: [], newContacts: { total: 0, shown: [] }, feed: [],
    }), "ru")
    const panel = container.querySelector('[data-testid="whatsapp-import-panel"]')!
    expect(panel.textContent).toContain("Meta присылает контакты и переписку за 6 месяцев частями")
    expect(panel.querySelector('[data-testid="whatsapp-import-months"]')).toBeNull()
    expect(panel.querySelector('[data-testid="whatsapp-import-new-contacts"]')).toBeNull()
    expect(panel.querySelector('[data-testid="whatsapp-import-feed"]')).toBeNull()
    expect(panel.textContent).not.toMatch(/(^|\D)0\s?(сообщений|переписок|контактов)/)
  })

  it("puts a card over the conversation list that opens the screen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ imports: [{ channelId: "cfg-1", displayPhoneNumber: "+994 51 206 08 38", state: "importing", progress: 78, conversations: 1248, contacts: 312 }] }))))
    const onOpen = vi.fn()
    await act(async () => { root.render(createElement(WhatsAppImportBanner, { locale: "az", onOpen })) })
    await flush()
    const card = container.querySelector('[data-testid="whatsapp-import-banner"] button')!
    expect(card.textContent).toContain("WhatsApp idxalı · son 6 ay")
    expect(card.textContent).toContain("1 248 yazışma · 312 kontakt")
    expect(card.textContent).toContain("78%")
    await act(async () => (card as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledWith("cfg-1")
  })
})
