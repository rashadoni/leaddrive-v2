// @vitest-environment jsdom
/**
 * The «device» block of the selected employee's card on the live map (owner,
 * 2026-10-09, of the Navixy demo: «бери почти всё, чего у нас нет», then
 * «добей до 100 %»): what is known about his phone.
 *
 * Tested on what the dispatcher sees: which lines stand before any answer has
 * come, which appear when the phone's own report is read, which do not appear
 * when the phone said nothing — and that a failed read invents none of them.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          let node: unknown = ru
          for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
          const raw = typeof node === "string" ? node : `${namespace}.${key}`
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})

import { LiveMapAgentDevice } from "@/components/mtm/live-map-agent-device"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

type DeviceAgent = Pick<MtmDashboardAgent, "agentId" | "isOnline" | "lastSeenAt" | "recordedAt" | "freshness" | "accuracy" | "battery" | "locationState">

const row = (over: Partial<DeviceAgent> = {}): DeviceAgent => ({
  agentId: "a1", isOnline: true, freshness: "ONLINE", locationState: "AVAILABLE",
  lastSeenAt: "2026-10-09T10:22:00.000Z", recordedAt: "2026-10-09T10:21:00.000Z", accuracy: 12.4, battery: 64, ...over,
})
/** What the page already holds says, with nothing read. */
const FROM_THE_ROW = [
  "Приложение: В сети",
  "Последняя связь: 10:22",
  "Координата записана: 10:21",
  "Свежесть GPS: Свежая",
  "Точность GPS: ±12 м",
  "Батарея: 64% · по данным на 10:21",
]
const REPORTED = { notificationsConnected: true, platform: "android", appVersion: "2.4.1", registeredAt: "2026-10-09T05:30:00.000Z" }

describe("the «device» block of the card", () => {
  let root: Root
  let container: HTMLDivElement
  let requests: string[]
  /** What the server answers; `null` leaves the question unanswered for good. */
  let respond: ((agentId: string) => Response) | null

  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  /** Every line of the block, top to bottom, as it reads. */
  const lines = () => [...(byTestId("live-map-agent-device")?.children ?? [])].map((line) => line.textContent)
  const settle = async (ms = 10) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const render = async (element: ReturnType<typeof createElement>) => { await act(async () => { root.render(element) }) }
  const device = (agent: DeviceAgent = row(), refreshKey = "k1") => createElement(LiveMapAgentDevice, {
    agent, refreshKey, formatTime: (value: string) => value.slice(11, 16),
  })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    requests = []
    respond = () => Response.json({ success: true, data: REPORTED })
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      requests.push(url.pathname + url.search)
      const reply = respond
      if (!reply) {
        // Never answered — but it does give way when the card lets go of it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
      return Promise.resolve().then(() => reply(url.searchParams.get("agentId") ?? ""))
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("shows what the page already holds at once — the phone's own report is not waited for", async () => {
    respond = null
    await render(device())
    await settle(30)
    // The question is out and will never be answered; the first group stands all the same.
    expect(requests).toEqual(["/api/v1/mtm/locations/device?agentId=a1"])
    expect(lines()).toEqual(FROM_THE_ROW)
  })

  it("the battery is the newest coordinate's, so it is said with that coordinate's time", async () => {
    respond = null
    await render(device(row({ battery: 12.3, recordedAt: "2026-10-09T09:05:00.000Z" })))
    expect(byTestId("live-map-device-battery")?.textContent).toBe("Батарея: 12% · по данным на 09:05")
    expect(byTestId("live-map-device-recorded")?.textContent).toBe("Координата записана: 09:05")
  })

  it("adds the version and the notifications when the read answers — the version with the time the phone named it; the platform is never drawn", async () => {
    await render(device())
    await settle()
    expect(requests).toEqual(["/api/v1/mtm/locations/device?agentId=a1"])
    expect(lines()).toEqual([
      ...FROM_THE_ROW,
      "Версия приложения: 2.4.1 · по данным на 05:30",
      "Уведомления: Подключены",
    ])
  })

  it("draws a line only for what the phone did report — a silent phone adds no «нет данных» rows", async () => {
    respond = () => Response.json({ success: true, data: { notificationsConnected: false, platform: null, appVersion: null, registeredAt: null } })
    await render(device())
    await settle()
    // No registration at all: the one thing known is that a notification has nowhere to go.
    expect(lines()).toEqual([...FROM_THE_ROW, "Уведомления: Не подключены"])

    // A version without a registration time: each line by itself.
    respond = () => Response.json({ success: true, data: { notificationsConnected: true, platform: "something-else", appVersion: "2.4.1+153", registeredAt: null } })
    await render(device(row(), "k2"))
    await settle()
    expect(lines()).toEqual([...FROM_THE_ROW, "Версия приложения: 2.4.1+153", "Уведомления: Подключены"])
  })

  it("the same goes for the row: a phone that sent no battery, no accuracy and no coordinate has no such lines", async () => {
    respond = null
    await render(device(row({
      isOnline: false, freshness: "NO_LOCATION", lastSeenAt: null, recordedAt: undefined, accuracy: null, battery: undefined,
    })))
    expect(lines()).toEqual(["Приложение: Не в сети", "Свежесть GPS: Нет координаты"])

    // A battery with no coordinate time beside it is said bare, not with an invented time.
    await render(device(row({ recordedAt: undefined, battery: 80 })))
    expect(byTestId("live-map-device-battery")?.textContent).toBe("Батарея: 80%")
  })

  it("says in the server's own words why there is no coordinate — and nothing about a permission it was not told of", async () => {
    respond = null
    await render(device(row({ freshness: "NO_LOCATION", locationState: "NO_LOCATION_REPORTED", recordedAt: undefined, accuracy: null, battery: null })))
    expect(byTestId("live-map-device-location-state")?.textContent).toBe("Приложение доступно, но координата не передана")

    await render(device())
    expect(byTestId("live-map-device-location-state")).toBeNull()
  })

  it("a failed read leaves the first group as it was, says so, and makes nothing up", async () => {
    respond = () => new Response("{}", { status: 500 })
    await render(device())
    await settle()
    expect(lines()).toEqual([...FROM_THE_ROW, "Не удалось обновить версию приложения и уведомления"])
    // In particular not «не подключены»: nobody said that.
    expect(byTestId("live-map-device-notifications")).toBeNull()
    expect(byTestId("live-map-device-app-version")).toBeNull()
    expect(byTestId("live-map-device-platform")).toBeNull()
  })

  it("an answer that does not say whether notifications are connected is a failed read, not «не подключены»", async () => {
    for (const body of [{ success: true }, { success: true, data: {} }, { success: true, data: { platform: "android", appVersion: "2.4.1" } }, null]) {
      act(() => root.unmount())
      root = createRoot(container)
      respond = () => Response.json(body)
      await render(device())
      await settle()
      expect(lines(), JSON.stringify(body)).toEqual([...FROM_THE_ROW, "Не удалось обновить версию приложения и уведомления"])
    }
  })

  it("draws nothing the phone does not report, whatever else an answer carries", async () => {
    respond = () => Response.json({
      success: true,
      data: {
        ...REPORTED,
        permission: "denied", gpsEnabled: false, batterySaver: true, mockLocation: true,
        osVersion: "14", deviceModel: "Phone X", token: "push-address-of-the-phone", deviceId: "installation-1",
      },
    })
    await render(device())
    await settle()
    // The same nine lines as without the extras, and none of the extras' values.
    expect([...(byTestId("live-map-agent-device")?.children ?? [])].map((line) => line.getAttribute("data-testid"))).toEqual([
      "live-map-device-app",
      "live-map-device-last-contact",
      "live-map-device-recorded",
      "live-map-device-freshness",
      "live-map-device-accuracy",
      "live-map-device-battery",
      "live-map-device-app-version",
      "live-map-device-notifications",
    ])
    expect(container.textContent).not.toMatch(/denied|Phone X|push-address|installation-1/)
  })

  it("five refreshes of the map with the same key are one request; a new key asks once more", async () => {
    await render(device())
    await settle()
    for (let refresh = 0; refresh < 5; refresh += 1) {
      // The roster answered again: a new row object, a later contact, the same key.
      await render(device(row({ lastSeenAt: `2026-10-09T10:2${3 + refresh}:00.000Z` })))
      await settle()
    }
    expect(requests).toEqual(["/api/v1/mtm/locations/device?agentId=a1"])
    // The first group follows the row with no request of its own.
    expect(byTestId("live-map-device-last-contact")?.textContent).toBe("Последняя связь: 10:27")

    await render(device(row(), "k2"))
    await settle()
    expect(requests).toHaveLength(2)
  })

  it("a refresh that fails keeps what was read, with a word that it is not fresh", async () => {
    await render(device())
    await settle()
    respond = () => new Response("{}", { status: 503 })
    await render(device(row(), "k2"))
    await settle()
    expect(requests).toHaveLength(2)
    expect(lines()).toEqual([
      ...FROM_THE_ROW,
      "Версия приложения: 2.4.1 · по данным на 05:30",
      "Уведомления: Подключены",
      "Не удалось обновить версию приложения и уведомления",
    ])
    // The next good answer takes the word away.
    respond = () => Response.json({ success: true, data: REPORTED })
    await render(device(row(), "k3"))
    await settle()
    expect(byTestId("live-map-device-failed")).toBeNull()
  })

  it("another employee is asked about himself, and is never shown the previous one's phone meanwhile", async () => {
    await render(device())
    await settle()
    expect(byTestId("live-map-device-app-version")).not.toBeNull()

    // His answer never comes: the first employee's version must not stand in for it.
    respond = null
    await render(device(row({ agentId: "a2", battery: 31, lastSeenAt: "2026-10-09T08:00:00.000Z" })))
    await settle()
    expect(requests).toEqual(["/api/v1/mtm/locations/device?agentId=a1", "/api/v1/mtm/locations/device?agentId=a2"])
    expect(byTestId("live-map-device-app-version")).toBeNull()
    expect(byTestId("live-map-device-notifications")).toBeNull()
    expect(byTestId("live-map-device-last-contact")?.textContent).toBe("Последняя связь: 08:00")
  })
})
