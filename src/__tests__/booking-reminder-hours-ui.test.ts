// @vitest-environment jsdom

/**
 * The reminder hours on «Запись через WhatsApp», as a salon uses them.
 *
 * Every reminder is money now — beyond Meta's free thousand delivered
 * messages a month Meta charges per message — so «send it or not» and «how
 * many hours before» are the two questions this card has to answer without a
 * support ticket. Three things are checked, and all three are about what the
 * screen sends to the server:
 *
 *   1. what the salon has is shown as hours, not as a hidden default;
 *   2. switching one reminder off sends exactly that, and leaves the other
 *      one alone — the pair is not rewritten around it;
 *   3. hours are saved when the field is left, and nonsense in the box
 *      changes nothing, because a half-typed «2» on the way to «24» must not
 *      reach the cron.
 *
 * Rendered through the real catalogue, so a missing key fails here.
 */
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BookingWhatsAppCard } from "@/components/booking/booking-whatsapp-card"
import type { WhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"
import ru from "../../messages/ru.json"

const stored = (reminders: WhatsAppBookingSetting["reminders"]): WhatsAppBookingSetting => ({
  mode: "book",
  channelConfigId: null,
  rules: { serviceIds: null, hostIds: null, hours: null, maxPrice: null, newClients: true },
  reminderTemplate: null,
  changeTemplate: null,
  cancelTemplate: null,
  reminders,
  flowId: null,
})

describe("reminder hours on the WhatsApp booking card", () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

  async function render(reminders: WhatsAppBookingSetting["reminders"]) {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "PUT") {
        return ok({ success: true, data: { setting: stored(reminders), channels: [{ id: "c1", name: "+994 10 531 80 49" }] } })
      }
      // The server answers with what it stored; the card shows that, not what
      // it hoped for.
      return ok({ success: true, data: { setting: JSON.parse(String(init.body)) } })
    })
    vi.stubGlobal("fetch", fetchMock)
    await act(async () => {
      root.render(createElement(NextIntlClientProvider, {
        locale: "ru", messages: ru,
        children: createElement(BookingWhatsAppCard, { services: [{ id: "s1", title: "Manikür" }], hosts: [{ id: "h1", name: "Usta" }] }),
      } as ComponentProps<typeof NextIntlClientProvider>))
    })
    await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
  }

  const block = () => {
    const found = container.querySelector<HTMLElement>('[data-testid="booking-reminder-hours"]')
    expect(found, "the reminders block").toBeTruthy()
    return found!
  }
  const boxes = () => [...block().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  const numbers = () => [...block().querySelectorAll<HTMLInputElement>('input[type="number"]')]
  /** The reminders of the last save the card asked for. */
  const saved = () => {
    const call = [...fetchMock.mock.calls].reverse().find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    expect(call, "a save").toBeTruthy()
    return JSON.parse(String((call![1] as RequestInit).body)).reminders
  }
  const puts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT").length

  async function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  async function leave(input: HTMLInputElement) {
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
  }

  it("shows the hours the salon is actually on", async () => {
    await render({ firstHours: 24, secondHours: 2 })

    expect(block().textContent).toContain("Напоминания клиенту")
    expect(boxes().map((box) => box.checked)).toEqual([true, true])
    expect(numbers().map((input) => input.value)).toEqual(["24", "2"])
  })

  it("shows a switched-off reminder as off, with its box empty rather than a default", async () => {
    await render({ firstHours: null, secondHours: 2 })

    expect(boxes().map((box) => box.checked)).toEqual([false, true])
    expect(numbers()[0].value).toBe("")
    expect(numbers()[0].disabled).toBe(true)
  })

  it("switching one off sends null for it and leaves the other one alone", async () => {
    await render({ firstHours: 24, secondHours: 2 })

    await act(async () => { boxes()[1].click() })
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })

    expect(saved()).toEqual({ firstHours: 24, secondHours: null })
  })

  it("saves typed hours when the field is left, and ignores what is not a number", async () => {
    await render({ firstHours: 24, secondHours: 2 })

    await typeInto(numbers()[0], "3")
    // Still nothing sent: a number half typed is not a decision.
    expect(puts()).toBe(0)
    await leave(numbers()[0])
    expect(saved()).toEqual({ firstHours: 3, secondHours: 2 })

    const before = puts()
    await typeInto(numbers()[0], "")
    await leave(numbers()[0])
    expect(puts(), "an empty box saves nothing").toBe(before)
    expect(numbers()[0].value).toBe("3")
  })
})
