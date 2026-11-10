// @vitest-environment jsdom
/**
 * The inbox rail lists a platform's numbers and pages one by one (owner, 2026-11-10: «не понятно на
 * какой ватсап пишут или же инстаграм, фейсбук… тут только одна вкладка от каждого»), and keeps
 * them open — «если номеров несколько, то должно быть раскрытым всегда, не только ватсап».
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InboxChannelAccounts } from "@/components/inbox/inbox-channel-accounts"
import { inboxAccountsByChannel, normalizeInboxChannelAccounts } from "@/lib/inbox-channels"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** LeadDrive Inc. on 2026-11-10, as GET /api/v1/inbox lists it. */
const WORKSPACE = normalizeInboxChannelAccounts([
  { id: "wa-3065", channelType: "whatsapp", name: "LeadDrive WhatsApp", number: "+994 10 531 30 65", numberIsMetaId: false },
  { id: "wa-1000", channelType: "whatsapp", name: "Lead Drive", number: "+994 77 320 10 00", numberIsMetaId: false },
  { id: "wa-8049", channelType: "whatsapp", name: "Fanum Sec", number: "+994 10 531 80 49", numberIsMetaId: false },
  { id: "fb-nokaut", channelType: "facebook", name: "Nokaut.az", number: null, numberIsMetaId: false },
  { id: "fb-andro", channelType: "facebook", name: "Andrologiya.az", number: null, numberIsMetaId: false },
  { id: "tg-bot", channelType: "telegram", name: "Telegram Bot", number: null, numberIsMetaId: false },
  { id: "wa-legacy", channelType: "whatsapp", name: "Old WA", number: "984538588084578", numberIsMetaId: true },
])

describe("which platforms list their accounts", () => {
  const grouped = inboxAccountsByChannel(WORKSPACE)

  it("every platform with two or more — not only WhatsApp", () => {
    expect(Object.keys(grouped).sort()).toEqual(["facebook", "whatsapp"])
    expect(grouped.facebook.map((a) => a.name)).toEqual(["Nokaut.az", "Andrologiya.az"])
  })

  it("not a platform with one account: its line stands alone", () => {
    expect(grouped.telegram).toBeUndefined()
  })
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(channel: string, activeId: string | null, onSelect = vi.fn()) {
  const accounts = inboxAccountsByChannel(WORKSPACE)[channel] ?? []
  act(() => {
    root.render(createElement(InboxChannelAccounts, {
      channel,
      accounts,
      counts: { "wa-3065": 16, "wa-1000": 3 },
      activeId,
      fallbackLabel: channel,
      onSelect,
    }))
  })
  return onSelect
}

const rows = () => [...container.querySelectorAll("button")].map((b) => b.textContent)

describe("the rail under a platform", () => {
  it("shows every number with its channel name and count, open without a click", () => {
    render("whatsapp", null)
    expect(rows()).toEqual([
      "+994 10 531 30 65LeadDrive WhatsApp16",
      "+994 77 320 10 00Lead Drive3",
      "+994 10 531 80 49Fanum Sec",
      // Meta's internal id is no number to show — the channel's name stands in.
      "Old WA",
    ])
  })

  it("shows a page by its name where there is no number", () => {
    render("facebook", null)
    expect(rows()).toEqual(["Nokaut.az", "Andrologiya.az"])
  })

  it("renders nothing for a platform with one account", () => {
    render("telegram", null)
    expect(container.querySelector("[data-testid]")).toBeNull()
  })

  it("a click picks that number; a second click on it returns to all numbers", () => {
    const onSelect = render("whatsapp", null)
    act(() => { container.querySelectorAll("button")[1].click() })
    expect(onSelect).toHaveBeenLastCalledWith("wa-1000")

    render("whatsapp", "wa-1000", onSelect)
    const active = container.querySelectorAll("button")[1]
    expect(active.getAttribute("aria-pressed")).toBe("true")
    act(() => { active.click() })
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })
})
