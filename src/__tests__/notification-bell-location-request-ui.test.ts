// @vitest-environment jsdom
/**
 * The bell, when an agent's «Клиент здесь» arrives.
 *
 * «Route & Field» pop-ups are off by default, and an ordinary pop-up is gone
 * in four seconds. Owner, 2026-10-12: «оно должно быть заметным… агент может
 * быть рядом с клиентом, и чтоб долго не ждать». So this one is drawn by the
 * real component over the answers the two APIs really give, and the test reads
 * what was raised on the screen.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"

const push = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => Object.assign(vi.fn(), { warning: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1" } } }) }))
vi.mock("sonner", () => ({ toast }))

import { NotificationBell } from "@/components/notification-bell"

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

const REQUEST = {
  id: "n-1",
  type: "warning",
  title: "Адрес клиента: агент ждёт решения",
  message: "Nigar у клиента «Klinika» и сообщает, что точка стоит не там — в 9,7 км от прежней.",
  entityType: "mtm_location_request",
  entityId: "req-1",
  url: "/mtm/routes?view=approvals",
  targetMissing: false,
  isRead: false,
  createdAt: "2026-10-12T18:04:00.000Z",
}
const ORDER = { ...REQUEST, id: "n-2", type: "info", title: "Заказ создан", message: "№ 17", entityType: "order", entityId: "o-17", url: null }

/** What the preferences API answers a person who never opened the settings: «Route & Field» is off. */
const untouchedPrefs = (kindEnabled = true) => ({
  success: true,
  data: {
    sections: [
      { key: "CRM", accessible: true, push: true, types: [] },
      {
        key: "Route & Field", accessible: true, push: false,
        types: [{ key: "order.created", enabled: true }, { key: "mtm.locationRequest.submitted", enabled: kindEnabled }],
      },
    ],
  },
})

let container: HTMLElement
let root: Root | null = null
let inbox: unknown[] = []
let patched: unknown[] = []

function serve(prefs: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("notification-preferences")) return json(prefs)
    if (init?.method === "PATCH") {
      patched.push(JSON.parse(String(init.body)))
      return json({ success: true })
    }
    return json({ success: true, data: { notifications: inbox, unreadCount: inbox.length } })
  }))
}

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

async function render() {
  const messages = JSON.parse(readFileSync("messages/ru.json", "utf8")) as AbstractIntlMessages
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(IntlProvider, { locale: "ru", messages, timeZone: "Asia/Baku" }, createElement(NotificationBell)))
  })
  await settle()
}

/** The bell asks again every ten seconds. */
async function nextPoll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  inbox = []
  patched = []
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

describe("an agent's «Клиент здесь» arriving in an open CRM", () => {
  it("is raised as a pop-up that stays, with a button to the queue — though the section's pop-ups are off", async () => {
    serve(untouchedPrefs())
    await render()
    expect(toast.warning).not.toHaveBeenCalled()

    inbox = [REQUEST, ORDER]
    await nextPoll()

    expect(toast.warning).toHaveBeenCalledTimes(1)
    const [title, options] = toast.warning.mock.calls[0] as [string, { description: string; duration: number; closeButton: boolean; action: { label: string; onClick: () => void } }]
    expect(title).toBe("Адрес клиента: агент ждёт решения")
    expect(options.description).toContain("в 9,7 км от прежней")
    // Two minutes, where an ordinary one is gone in four seconds.
    expect(options.duration).toBe(120_000)
    expect(options.closeButton).toBe(true)
    expect(options.action.label).toBe("Открыть запрос")
    // The order notice of the same section stays behind the section's switch.
    expect(toast).not.toHaveBeenCalled()

    await act(async () => { options.action.onClick() })
    expect(push).toHaveBeenCalledWith("/mtm/routes?view=approvals")
    expect(patched).toEqual([{ ids: ["n-1"] }])
  })

  it("is raised once, not at every poll", async () => {
    serve(untouchedPrefs())
    await render()
    inbox = [REQUEST]
    await nextPoll()
    await nextPoll()
    await nextPoll()
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it("is not raised for a request that was already there when the page opened", async () => {
    inbox = [REQUEST]
    serve(untouchedPrefs())
    await render()
    await nextPoll()
    expect(toast.warning).not.toHaveBeenCalled()
    // It is still in the bell, counted.
    expect(container.textContent).toContain("1")
  })

  it("keeps quiet for a person who switched off this very kind", async () => {
    serve(untouchedPrefs(false))
    await render()
    inbox = [REQUEST]
    await nextPoll()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
