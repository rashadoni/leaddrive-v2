// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WhatsAppDeliveryCheck } from "@/components/channels/whatsapp-delivery-check"

/**
 * «Проверить приём сообщений» under a WhatsApp number's row: what a press asks, what the person is
 * told, and when «Подписать заново» is offered. Real React in jsdom; the network is a recorder.
 */
let container: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string }>

const base = { subscribed: true, callback: null, canResubscribe: false, number: { status: "CONNECTED", platformType: "CLOUD_API" }, subscribedApps: ["LeadDrive"], metaError: null, lastInboundAt: null, checkedAt: "2026-11-22T12:00:00.000Z" }

function answer(byMethod: Record<string, { status?: number; body: unknown }>) {
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method || "GET"
    calls.push({ url: String(input), method })
    const reply = byMethod[method]
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }))
}

beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  calls = []
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const render = () => act(async () => { root.render(createElement(WhatsAppDeliveryCheck, { channelId: "wa-1", locale: "ru" })) })
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)
const verdict = () => container.querySelector('[data-testid="whatsapp-delivery-verdict"]')?.textContent ?? null
async function press(text: string) {
  await act(async () => button(text)!.click())
  await flush()
}

describe("the delivery check under a WhatsApp number", () => {
  it("asks Meta nothing until the button is pressed", async () => {
    answer({ GET: { body: { ...base, verdict: "ok" } } })
    await render()
    await flush()

    expect(button("Проверить приём сообщений")).toBeDefined()
    expect(calls).toEqual([])
    expect(verdict()).toBeNull()
  })

  it("says in words that delivery works, and when the last message came", async () => {
    answer({ GET: { body: { ...base, verdict: "ok", lastInboundAt: "2026-10-26T18:20:00.000Z" } } })
    await render()
    await press("Проверить приём сообщений")

    expect(calls).toEqual([{ url: "/api/v1/channels/wa-1/whatsapp-delivery", method: "GET" }])
    expect(verdict()).toBe("Приём работает: номер подключён к Cloud API, приложение подписано на уведомления аккаунта.")
    expect(container.textContent).toContain("Последнее входящее сообщение в CRM:")
    expect(container.querySelector('[data-testid="whatsapp-delivery-resubscribe"]')).toBeNull()
    expect(button("Проверить ещё раз")).toBeDefined()
  })

  it("names a missing subscription, offers «Подписать заново», and shows the check after it", async () => {
    answer({
      GET: { body: { ...base, verdict: "not_subscribed", subscribed: false, canResubscribe: true, subscribedApps: [] } },
      POST: { body: { ...base, verdict: "ok" } },
    })
    await render()
    await press("Проверить приём сообщений")

    expect(verdict()).toContain("Приложение не подписано на уведомления этого аккаунта WhatsApp")
    expect(container.textContent).toContain("Входящих сообщений на этот номер в CRM ещё не было.")
    expect(container.textContent).toContain("сбросит отдельный адрес аккаунта")

    await press("Подписать заново")

    expect(calls.at(-1)).toEqual({ url: "/api/v1/channels/wa-1/whatsapp-delivery", method: "POST" })
    expect(verdict()).toContain("Приём работает")
    expect(container.querySelector('[data-testid="whatsapp-delivery-resubscribe"]')).toBeNull()
  })

  it("says where Meta really sends the number's notifications", async () => {
    answer({ GET: { body: { ...base, verdict: "callback_elsewhere", callback: { host: "hooks.other-crm.example", level: "number", ours: false } } } })
    await render()
    await press("Проверить приём сообщений")

    expect(verdict()).toBe("Meta отправляет уведомления этого номера на другой адрес: hooks.other-crm.example (адрес задан у самого номера). В CRM они не приходят.")
    expect(container.querySelector('[data-testid="whatsapp-delivery-resubscribe"]')).toBeNull()
  })

  it("names the number's Meta status when it is not connected", async () => {
    answer({ GET: { body: { ...base, verdict: "number_not_connected", number: { status: "PENDING", platformType: null } } } })
    await render()
    await press("Проверить приём сообщений")

    expect(verdict()).toContain("Номер не подключён к Cloud API (статус Meta: PENDING)")
  })

  it("keeps the check on screen and says Meta's words when the subscription is refused", async () => {
    const notSubscribed = { ...base, verdict: "not_subscribed", subscribed: false, canResubscribe: true }
    answer({ GET: { body: notSubscribed }, POST: { status: 502, body: { error: "meta_refused", message: "(#200) Permissions error", view: notSubscribed } } })
    await render()
    await press("Проверить приём сообщений")
    await press("Подписать заново")

    expect(verdict()).toContain("Приложение не подписано")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Meta не приняла подписку: (#200) Permissions error")
  })

  it("says the check could not be run when the server does not answer with one", async () => {
    answer({ GET: { status: 500, body: {} } })
    await render()
    await press("Проверить приём сообщений")

    expect(verdict()).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Не удалось выполнить проверку. Попробуйте ещё раз.")
  })
})
