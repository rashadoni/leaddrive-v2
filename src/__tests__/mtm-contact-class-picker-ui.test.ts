// @vitest-environment jsdom
/**
 * The client's category (A, B, C, VIP) is set on the card's «Категории и
 * оценки» tab, one press per letter.
 *
 * The owner opened that tab to set a doctor's category and found a block about
 * reference lists and nothing to press (2026-10-04); the letter itself was a
 * dropdown inside the thirty-field edit form. Rendered for real with the
 * Russian copy; only the network is stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as { mtmContactDetail: Record<string, string> }
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => ru.mtmContactDetail[key] ?? key,
}))

import { MtmContactClassPicker } from "@/components/mtm/contact-class-picker"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const onChanged = vi.fn()
const letters = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
const letter = (value: string) => container.querySelector<HTMLButtonElement>(`[data-testid="mtm-contact-class-${value}"]`)

async function show(props: { value: string; classes?: unknown; canManage?: boolean }) {
  await act(async () => {
    root.render(createElement(MtmContactClassPicker, {
      contactId: "contact-1",
      value: props.value,
      classes: props.classes ?? ["A", "B", "C", "VIP"],
      contactUpdatedAt: "2026-10-04T10:00:00.000Z",
      canManage: props.canManage ?? true,
      onChanged,
    }))
  })
}
const press = async (value: string) => {
  await act(async () => { letter(value)?.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fetchMock.mockReset()
  onChanged.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("client card — category picker", () => {
  it("offers the tenant's letters and marks the one the client has", async () => {
    await show({ value: "B" })

    expect(container.textContent).toContain("Категория клиента")
    expect(letters().map((button) => [button.textContent, button.getAttribute("aria-checked")])).toEqual([
      ["A", "false"], ["B", "true"], ["C", "false"], ["VIP", "false"],
    ])
  })

  it("saves a press through the card's own update, with its concurrency token, and reloads", async () => {
    await show({ value: "B" })
    await press("VIP")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }]
    expect([url, init.method, JSON.parse(init.body)]).toEqual([
      "/api/v1/mtm/contacts/contact-1",
      "PUT",
      { expectedContactUpdatedAt: "2026-10-04T10:00:00.000Z", category: "VIP" },
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("does nothing when the letter the client already has is pressed", async () => {
    await show({ value: "B" })
    await press("B")

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps showing a letter the tenant no longer offers while this client still has it", async () => {
    await show({ value: "D" })

    expect(letters().map((button) => button.textContent)).toEqual(["A", "B", "C", "D", "VIP"])
    expect(letter("D")?.getAttribute("aria-checked")).toBe("true")
  })

  it("says the card was changed by someone else instead of a generic failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "MTM_CONTACT_CONFLICT" }) })
    await show({ value: "B" })
    await press("A")

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Карточку только что изменили. Обновите страницу и попробуйте ещё раз.")
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("is read-only for a person who may only propose changes, and says who can change it", async () => {
    await show({ value: "B", canManage: false })

    expect(container.textContent).toContain("Изменить категорию может руководитель.")
    expect(letters().every((button) => button.disabled)).toBe(true)
    await press("A")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
