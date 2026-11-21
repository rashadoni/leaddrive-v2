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
import { WhatsAppNumberPurposeDialog, WhatsAppNumberPurposeLine } from "@/components/channels/whatsapp-number-purpose"

/**
 * «Куда попадают сообщения с этого номера» — the window a WhatsApp number's purpose is chosen in
 * and the line under the number's row (owner's mock, 2026-11-21). On real React in jsdom: what the
 * person reads, what a click picks, and what Save sends.
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
const card = (purpose: string) => document.querySelector<HTMLButtonElement>(`[data-testid="whatsapp-number-purpose-${purpose}"]`)!
const saveButton = () => document.querySelector<HTMLButtonElement>('[data-testid="whatsapp-number-purpose-save"]')!

async function renderDialog(props: Partial<Parameters<typeof WhatsAppNumberPurposeDialog>[0]> = {}) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  await act(async () => {
    root.render(createElement(WhatsAppNumberPurposeDialog, {
      open: true,
      channelId: "wa-1",
      numberLabel: "Zeytun Pharma",
      initial: "support",
      locale: "ru",
      onOpenChange,
      onSaved,
      ...props,
    }))
  })
  return { onSaved, onOpenChange }
}

describe("the window that says what a WhatsApp number is for", () => {
  it("offers the two choices in words and marks the one the number has today", async () => {
    await renderDialog({ initial: "support" })

    expect(document.body.textContent).toContain("Куда попадают сообщения с этого номера")
    expect(document.body.textContent).toContain("Zeytun Pharma")
    expect(card("conversations").textContent).toContain("Переписка")
    expect(card("conversations").textContent).toContain("Сообщения видны только в Omni-Channel")
    expect(card("support").textContent).toContain("Поддержка")
    expect(card("support").textContent).toContain("Каждое обращение становится тикетом в Service Desk")
    expect(card("support").getAttribute("aria-checked")).toBe("true")
    expect(card("conversations").getAttribute("aria-checked")).toBe("false")
    expect(saveButton().textContent).toBe("Сохранить")
  })

  it("sends nothing until Save, then saves the picked choice for this number and closes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ purpose: "conversations" })))
    vi.stubGlobal("fetch", fetchMock)
    const { onSaved, onOpenChange } = await renderDialog({ initial: "support" })

    await act(async () => card("conversations").click())
    expect(card("conversations").getAttribute("aria-checked")).toBe("true")
    // Leaving «Поддержка»: what happens to the tickets that are already open is said before Save.
    expect(document.querySelector('[data-testid="whatsapp-number-purpose-note"]')?.textContent).toContain("Уже открытые тикеты остаются")
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => saveButton().click())
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/v1/channels/wa-1/whatsapp-purpose")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(String(init.body))).toEqual({ purpose: "conversations" })
    expect(onSaved).toHaveBeenCalledWith("conversations")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("stays open and says so when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })))
    const { onSaved, onOpenChange } = await renderDialog({ initial: "conversations" })

    await act(async () => card("support").click())
    await act(async () => saveButton().click())
    await flush()

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Не удалось сохранить. Попробуйте ещё раз.")
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("opens for a number that was just connected with «Переписка» chosen and says the number is connected", async () => {
    await renderDialog({ initial: "conversations", justConnected: true })

    expect(document.body.textContent).toContain("Номер подключён. Выберите, для чего он.")
    expect(card("conversations").getAttribute("aria-checked")).toBe("true")
    expect(document.querySelector('[data-testid="whatsapp-number-purpose-note"]')).toBeNull()
  })
})

describe("the line under a WhatsApp number's row", () => {
  async function renderLine(settings: unknown) {
    const onChange = vi.fn()
    await act(async () => {
      root.render(createElement(WhatsAppNumberPurposeLine, { settings, locale: "ru", onChange }))
    })
    return onChange
  }
  const line = () => container.querySelector<HTMLElement>('[data-testid="whatsapp-number-purpose-line"]')!

  it("says a number from before the choice turns every request into a ticket", async () => {
    await renderLine({ replyMode: "agent" })

    expect(line().dataset.purpose).toBe("support")
    expect(line().textContent).toContain("Сообщения с этого номера: Поддержка — каждое обращение становится тикетом в Service Desk")
  })

  it("says a «Переписка» number opens no tickets, and «Изменить» asks for the window", async () => {
    const onChange = await renderLine({ inboundPurpose: "conversations" })

    expect(line().dataset.purpose).toBe("conversations")
    expect(line().textContent).toContain("Переписка — только Omni-Channel, тикеты не создаются")
    const change = Array.from(line().querySelectorAll("button")).find((button) => button.textContent === "Изменить")!
    await act(async () => change.click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
