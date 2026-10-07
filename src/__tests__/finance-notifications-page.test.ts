// @vitest-environment jsdom
/**
 * The «Уведомления об оплатах» settings page, as an administrator uses it to
 * point finance notices at the organization's own Telegram bot and chat.
 *
 * Who the notices reach is finance-telegram-recipient-postgres.test.ts. This is
 * the screen: the finance screens used to ignore the server's answer, so a
 * refused save read «Сохранено!». With a token to get wrong, that would leave
 * an organization believing it is connected while every notice goes nowhere.
 *
 * The page is rendered for real and its requests are answered by the real
 * route handlers over one in-memory organization row; api.telegram.org is the
 * only host `fetch` answers for besides the app itself.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ settings: structuredClone(db.settings) })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        db.settings = structuredClone(data.settings)
        return {}
      }),
    },
  },
}))
// Who may call these handlers is finance-api-authorization.test.ts, with the
// real `requireAuth`. Here an administrator is already signed in.
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(async () => ({ orgId: "org-1", userId: "user-1", role: "admin", email: "", name: "", principalType: "session" })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/ru.json")
  // One translator per namespace, as next-intl gives.
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "ru", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
// A stable object: the page loads its settings when the session's organization appears.
const session = { data: { user: { organizationId: "org-1", role: "admin" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined, useTour: () => ({}) }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import FinanceNotificationsPage from "@/app/(dashboard)/settings/finance-notifications/page"
import { GET, PUT } from "@/app/api/finance/payment-orders/notification-settings/route"
import { POST as SEND_TEST } from "@/app/api/finance/payment-orders/notification-settings/test/route"
import messages from "../../messages/ru.json"

const t = messages.finance.notif
const BOT = "111111111:org-own-finance-bot-token-for-tests"
const CHAT = "-1001111111111"
const SETTINGS_PATH = "/api/finance/payment-orders/notification-settings"

let container: HTMLDivElement
let root: Root
let telegram: { bot: string; chat: string }[] = []
let telegramAnswer: (() => Response) | null = null

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`input #${id} not found`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`button «${label}» not found`)
  return found
}

async function press(label: string) {
  await act(async () => { button(label).click() })
  await settle()
}

const tokenField = () => container.querySelector<HTMLInputElement>("#fin-notif-telegram-token")!.value
const text = () => container.textContent ?? ""
const occurrences = (needle: string) => text().split(needle).length - 1
const storedTelegram = () => {
  const saved = (db.settings.financeNotifications ?? {}) as Record<string, unknown>
  return [saved.telegramBotToken, saved.telegramChatId]
}

beforeEach(async () => {
  db.settings = {}
  telegram = []
  telegramAnswer = null
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const sendMessage = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/)
    if (sendMessage) {
      telegram.push({ bot: sendMessage[1], chat: String(JSON.parse(String(init?.body)).chat_id) })
      return telegramAnswer ? telegramAnswer() : new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const request = new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      headers: init?.headers as HeadersInit,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    })
    if (url === SETTINGS_PATH) return request.method === "PUT" ? PUT(request) : GET(request)
    if (url === `${SETTINGS_PATH}/test`) return SEND_TEST(request)
    throw new Error(`unexpected request to ${url}`)
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(FinanceNotificationsPage)) })
  await settle()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("finance notification settings page", () => {
  it("says under every Telegram checkbox that nothing is sent until a bot and a chat are set", () => {
    // Four kinds of notice are listed; the advance warning shares the wording.
    expect(occurrences(t.telegramNotConfigured)).toBe(4)
    expect(button(t.telegramTestButton).disabled).toBe(true)
  })

  it("shows a refused token as an error, not as «Сохранено!»", async () => {
    await type("fin-notif-telegram-token", "not-a-bot-token")
    await type("fin-notif-telegram-chat", CHAT)

    await press(t.save)

    expect(container.querySelector("[role=alert]")?.textContent).toBe(t.telegramBotTokenInvalid)
    expect(text()).not.toContain(t.saved)
    expect(storedTelegram()).toEqual([undefined, undefined])
  })

  it("saves the form and sends a message through the saved bot in one click, then shows the token masked", async () => {
    await type("fin-notif-telegram-token", BOT)
    await type("fin-notif-telegram-chat", CHAT)

    await press(t.telegramTestButton)

    expect(storedTelegram()).toEqual([BOT, CHAT])
    expect(telegram).toEqual([{ bot: BOT, chat: CHAT }])
    expect(container.querySelector("[role=status]")?.textContent).toBe(t.telegramTestSent)
    expect(tokenField()).not.toContain(BOT)
    expect(container.innerHTML).not.toContain(BOT)
    expect(occurrences(t.telegramNotConfigured)).toBe(0)

    // Saving again with the mask still in the field keeps the bot.
    await press(t.save)
    expect(text()).toContain(t.saved)
    expect(storedTelegram()).toEqual([BOT, CHAT])
  })

  it("says next to the test button when the form could not be saved, and sends nothing", async () => {
    await type("fin-notif-telegram-token", BOT)
    await type("fin-notif-telegram-chat", "the finance chat")

    await press(t.telegramTestButton)

    expect(container.querySelector("[role=status]")?.textContent).toBe(t.telegramChatIdInvalid)
    expect(telegram).toEqual([])
    expect(storedTelegram()).toEqual([undefined, undefined])
  })

  it("shows why Telegram refused the test message", async () => {
    telegramAnswer = () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })
    await type("fin-notif-telegram-token", BOT)
    await type("fin-notif-telegram-chat", CHAT)

    await press(t.telegramTestButton)

    expect(container.querySelector("[role=status]")?.textContent).toBe(
      t.telegramTestRejected.replace("{reason}", "Bad Request: chat not found"),
    )
  })
})
