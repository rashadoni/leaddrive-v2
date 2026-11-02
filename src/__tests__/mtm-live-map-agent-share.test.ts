// @vitest-environment jsdom
/**
 * The «Ссылка на местоположение» block of the selected employee's card on the
 * live map: a manager makes a link by which somebody outside the organization
 * sees where this one employee is now, copies it, and takes it back.
 *
 * Tested on what the manager sees and presses, against a stand-in for the
 * three routes that keeps links the way the real ones do: which buttons
 * there are and what each asks for, where the link appears and that it
 * appears once, what the list says of each link, and what is said — in
 * words, in the block — when the server refuses or cannot be reached.
 *
 * The sentences are the catalog's own, through the real formatter: «Открыта
 * 2 раза» is declined here as it will be on screen.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl")
  const { readFileSync: read } = await import("node:fs")
  const messages = JSON.parse(read("messages/ru.json", "utf8"))
  const translators = new Map<string, unknown>()
  return {
    useLocale: () => "ru",
    // As in the app, the translator of a namespace is the same object from one render to the next.
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({
          locale: "ru", messages, namespace: namespace as never,
          // A sentence that is not in the catalog is a failed test, not «mtmMap.share.…» on screen.
          onError: (error) => { throw error },
        }))
      }
      return translators.get(namespace)
    },
  }
})

import { LiveMapAgentShare, resetLiveMapShareLinkCacheForTests } from "@/components/mtm/live-map-agent-share"

/** The server's clock: what «still works» is judged by. Two in the afternoon in Baku. */
const NOW = Date.parse("2026-10-12T10:00:00.000Z")
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString()
/** The organization's zone. Its day ends ten hours from NOW — at 20:00 by the UTC clock the stand-in formatter prints. */
const ZONE = "Asia/Baku"
const END_OF_DAY = iso(600)
const LIST = "/api/v1/mtm/locations/share-links"
const OFF = "Ссылки выключены, сейчас ни одна не открывается. Включаются в настройках MTM: вкладка «Оповещения», блок «Карта агентов»."
const SHOWS = "Как в такси: отправьте ссылку — человек без входа увидит на карте, где сотрудник сейчас."

interface KeptLink {
  id: string
  agentId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
  createdByName: string | null
}

describe("the «Ссылка на местоположение» block of the card", () => {
  let root: Root
  let container: HTMLDivElement
  /** The table behind the three routes. */
  let table: KeptLink[]
  let made: number
  let requests: Array<{ method: string; path: string; body: unknown }>
  /** The organization's switch and this viewer, as the list reports them. */
  let access: { enabled: boolean; canWrite: boolean }
  /** What the list says of «does a link to him show a point now»; `undefined` — it does not say. */
  let showsNow: unknown
  /** The server's clock, when a case moves it on from NOW. */
  let serverNow: number
  /** Set to make the server refuse: what was asked for → the answer. */
  let refuse: Partial<Record<"list" | "create" | "revoke", () => Response>>
  /** The connection is down: nothing is answered. */
  let offline: boolean
  /** While set, reads of the list are not answered until released — with the list as it was when asked. */
  let heldLists: Array<() => void> | null
  /** What the server sends as the link of a creation, when it is not the usual one. */
  let urlOf: (token: string) => unknown
  const writeText = vi.fn<(value: string) => Promise<void>>()
  const execCommand = vi.fn<(command: string) => boolean>()

  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const text = (testId: string) => byTestId(testId)?.textContent ?? null
  const settle = async (ms = 10) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const render = async (element: ReturnType<typeof createElement>) => { await act(async () => { root.render(element) }) }
  const press = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error("element not found")
    await act(async () => { element.click() })
    await settle()
  }
  const share = (over: Partial<{ agentId: string; canWrite: boolean; refreshKey: string; nowMs: number; timeZone: string | undefined }> = {}) => createElement(LiveMapAgentShare, {
    agentId: "a1", agentName: "Нигяр Примерова", canWrite: true, refreshKey: "k1", nowMs: NOW, timeZone: ZONE, ...over,
    formatTime: (value: string) => value.slice(11, 16),
    formatPastTime: (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)} ${value.slice(11, 16)}`,
  })
  const open = async (over: Parameters<typeof share>[0] = {}) => {
    await render(share(over))
    await settle()
  }
  /** Folding the block, or selecting another employee, takes it off the screen altogether. */
  const takeAway = () => {
    act(() => root.unmount())
    root = createRoot(container)
  }
  const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent)
  const durationButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid^="live-map-share-create-"]')]
  /** The working links on screen, each as its two lines read: until when, then who made it and whether it was opened. */
  const working = () => [...container.querySelectorAll('[data-testid="live-map-share-alive"] li')].map((row) => [
    row.querySelector('[data-testid="live-map-share-link-until"]')?.textContent,
    row.querySelector('[data-testid="live-map-share-link-facts"]')?.textContent,
  ])
  const past = () => [...container.querySelectorAll('[data-testid="live-map-share-past"] li')].map((row) => row.textContent)
  const field = () => container.querySelector<HTMLInputElement>('input[data-testid^="live-map-share-url-"]')
  const asked = (method: string) => requests.filter((request) => request.method === method)
  /** «Отозвать», then «Отозвать» again under the question: the two presses it takes. */
  const revoke = async (linkId: string) => {
    await press(byTestId(`live-map-share-revoke-${linkId}`))
    await press(byTestId(`live-map-share-revoke-confirm-${linkId}`))
  }
  /** Is `first` before `second` in the page — which is the order the keyboard walks it in. */
  const comesBefore = (first: Element | null, second: Element | null) =>
    Boolean(first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)

  const keep = (over: Partial<KeptLink> = {}): KeptLink => {
    made += 1
    const link: KeptLink = {
      id: `link-${made}`, agentId: "a1", createdAt: iso(-made), expiresAt: iso(60), revokedAt: null,
      viewCount: 0, lastViewedAt: null, createdByName: "Старший Первый", ...over,
    }
    table.push(link)
    return link
  }
  const sent = (link: KeptLink) => ({
    id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt, revokedAt: link.revokedAt,
    viewCount: link.viewCount, lastViewedAt: link.lastViewedAt, createdByName: link.createdByName,
    alive: link.revokedAt === null && Date.parse(link.expiresAt) > serverNow,
  })
  /** GET: the working links, newest first, then the ones that no longer work. */
  const listOf = (agentId: string) => {
    const own = table.filter((link) => link.agentId === agentId).map(sent).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      success: true,
      data: { links: [...own.filter((link) => link.alive), ...own.filter((link) => !link.alive)], access: { ...access }, ...(showsNow === undefined ? {} : { showsNow }) },
    }
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetLiveMapShareLinkCacheForTests()
    table = []
    made = 0
    requests = []
    access = { enabled: true, canWrite: true }
    showsNow = undefined
    serverNow = NOW
    refuse = {}
    offline = false
    heldLists = null
    urlOf = (token) => `https://app.example.test/share/location/${token}?lang=ru`
    writeText.mockReset().mockResolvedValue(undefined)
    execCommand.mockReset().mockReturnValue(true)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      const method = init?.method ?? "GET"
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
      requests.push({ method, path: url.pathname + url.search, body })
      if (offline) return Promise.reject(new TypeError("Failed to fetch"))
      if (method === "GET" && url.pathname === LIST) {
        if (refuse.list) return Promise.resolve(refuse.list())
        // The list as it is at the moment it is asked for.
        const answer = listOf(url.searchParams.get("agentId") ?? "")
        const held = heldLists
        if (held) {
          return new Promise<Response>((resolve, reject) => {
            held.push(() => resolve(Response.json(answer)))
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
          })
        }
        return Promise.resolve(Response.json(answer))
      }
      if (method === "POST" && url.pathname === LIST) {
        if (refuse.create) return Promise.resolve(refuse.create())
        const minutes = body?.duration === "1h" ? 60 : body?.duration === "4h" ? 240 : 600
        const link = keep({ agentId: String(body?.agentId), expiresAt: iso(minutes), createdByName: "Менеджер Второй" })
        return Promise.resolve(Response.json({ success: true, data: { link: sent(link), url: urlOf(`${made}`.padStart(64, "0")) } }, { status: 201 }))
      }
      if (method === "DELETE" && url.pathname.startsWith(`${LIST}/`)) {
        if (refuse.revoke) return Promise.resolve(refuse.revoke())
        const link = table.find((row) => row.id === decodeURIComponent(url.pathname.slice(LIST.length + 1)) && row.revokedAt === null)
        if (!link) return Promise.resolve(Response.json({ error: "Not found", code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" }, { status: 404 }))
        link.revokedAt = iso(5)
        return Promise.resolve(Response.json({ success: true, data: { id: link.id, revokedAt: link.revokedAt } }))
      }
      return Promise.reject(new Error(`unexpected request: ${method} ${url.pathname}`))
    }))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe("making a link", () => {
    it("says what the outsider will see, and offers a manager three worded buttons", async () => {
      await open()
      expect(text("live-map-share-shows")).toBe(SHOWS)
      expect(byTestId("live-map-share-create")?.textContent).toBe("Создать ссылку:На 1 часНа 4 часаДо конца дня")
      expect(durationButtons().map((button) => button.textContent)).toEqual(["На 1 час", "На 4 часа", "До конца дня"])
      // With no link working nothing is headed «Действующие ссылки»: the three buttons are the whole block.
      expect(byTestId("live-map-share-alive")).toBeNull()
      expect(byTestId("live-map-share-loading")).toBeNull()
      // Asked once, about him.
      expect(requests).toEqual([{ method: "GET", path: `${LIST}?agentId=a1`, body: null }])
    })

    // Beside the buttons the label pushed the third of them under itself on
    // a phone, so it stands on a line of its own above them. jsdom lays
    // nothing out; what is held here is the structure that makes the line
    // break — the label first in the group and a block of its own, the three
    // buttons in one row that the label is not in, and the group itself not
    // a row. (How it looks at phone width was seen in a browser when the
    // layout was decided; this keeps it from being undone unnoticed.)
    it("puts «Создать ссылку:» on a line of its own above the three buttons, never beside them", async () => {
      /** An element's class names, with any breakpoint or state prefix taken off. */
      const classNames = (element: Element | null | undefined) =>
        (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).map((name) => name.split(":").pop() ?? name)
      /** Does it put its children side by side — a flex row, at any width? */
      const isRow = (element: Element | null | undefined) =>
        ["flex", "inline-flex"].some((name) => classNames(element).includes(name)) && !classNames(element).includes("flex-col")
      /** Does it stand in a line with its neighbours instead of taking a line to itself? */
      const isInline = (element: Element | null | undefined) =>
        !["DIV", "P"].includes(element?.tagName ?? "") || classNames(element).some((name) => name.startsWith("inline") || name.startsWith("float-") || name === "contents")

      await open()
      const group = byTestId("live-map-share-create")
      const label = document.getElementById(group?.getAttribute("aria-labelledby") ?? "")
      expect(label?.textContent).toBe("Создать ссылку:")
      // The first thing in the group, and a block: it takes its line whole.
      expect(group?.firstChild).toBe(label)
      expect(isInline(label)).toBe(false)
      // The three buttons share one row — the next thing after the label — and the label is not in it.
      const rows = [...new Set(durationButtons().map((button) => button.parentElement))]
      expect(durationButtons()).toHaveLength(3)
      expect(rows).toHaveLength(1)
      const [row] = rows
      expect(row).not.toBe(group)
      expect(row?.parentElement).toBe(group)
      expect(row?.contains(label)).toBe(false)
      expect(label?.nextElementSibling).toBe(row)
      // That row is where the buttons stand side by side (so `isRow` does know a row when it sees one), and it starts a line of its own…
      expect(isRow(row)).toBe(true)
      expect(isInline(row)).toBe(false)
      // …while the group that holds the label and the row stacks them: it is not a row itself.
      expect(isRow(group)).toBe(false)
      expect(classNames(group).filter((name) => name.startsWith("grid-cols-") || name === "grid-flow-col")).toEqual([])
    })

    it.each([
      ["На 1 час", "1h", "Действует до 11:00"],
      ["На 4 часа", "4h", "Действует до 14:00"],
      ["До конца дня", "day", "Действует до конца дня"],
    ])("«%s» asks the server for «%s» and nothing else — when the link ends is the server's to decide", async (label, duration, until) => {
      await open()
      await press(durationButtons().find((button) => button.textContent === label))
      expect(asked("POST")).toEqual([{ method: "POST", path: LIST, body: { agentId: "a1", duration } }])
      // The moment on screen is the one the server answered with.
      expect(working()).toEqual([[until, "Менеджер Второй · Ещё не открывали"]])
    })

    it("shows the link once it is made: in a field, with «Скопировать» beside it and the word that it will not be shown again — and copies nothing by itself", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      const url = `https://app.example.test/share/location/${"1".padStart(64, "0")}?lang=ru`
      expect(field()?.value).toBe(url)
      expect(field()?.readOnly).toBe(true)
      expect(field()?.getAttribute("aria-label")).toBe("Ссылка на местоположение сотрудника")
      expect(text("live-map-share-fresh-link-1")).toBe("Ссылка готова — отправьте еёОтправить в WhatsAppСкопироватьОтправьте сейчас: потом ссылку здесь не увидеть.")
      expect(text("live-map-share-copy-link-1")).toBe("Скопировать")
      // Nothing went to the clipboard that no press asked for.
      expect(writeText).not.toHaveBeenCalled()
      expect(execCommand).not.toHaveBeenCalled()
      // The row came from the answer to the creation: the list was not read again for it.
      expect(requests.map((request) => request.method)).toEqual(["GET", "POST"])
      expect(byTestId("live-map-share-alive")).not.toBeNull()
    })

    it("while the server is making the link, says so and takes no second press", async () => {
      let answer: (response: Response) => void = () => {}
      await open()
      vi.mocked(fetch).mockImplementationOnce((_input, init) => {
        requests.push({ method: "POST", path: LIST, body: JSON.parse(String(init?.body)) })
        return new Promise<Response>((resolve) => { answer = resolve })
      })
      await press(byTestId("live-map-share-create-4h"))
      expect(text("live-map-share-creating")).toBe("Создаю ссылку…")
      expect(durationButtons().map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"])
      await press(byTestId("live-map-share-create-1h"))
      expect(asked("POST")).toHaveLength(1)
      const link = keep({ expiresAt: iso(240) })
      await act(async () => { answer(Response.json({ success: true, data: { link: sent(link), url: urlOf("9".repeat(64)) } }, { status: 201 })) })
      await settle()
      expect(byTestId("live-map-share-creating")).toBeNull()
      expect(durationButtons().map((button) => button.getAttribute("aria-disabled"))).toEqual(["false", "false", "false"])
      expect(field()?.value).toContain("9".repeat(64))
    })

    it("offers nothing to copy when the answer does not carry an address of the public page — and says the link was not handed over", async () => {
      urlOf = () => "https://elsewhere.example.test/login"
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(field()).toBeNull()
      expect(text("live-map-share-notice")).toBe("Не получилось. Попробуйте ещё раз.")
      // The link exists on the server: the list is read again and shows it, to be revoked.
      expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "GET"])
      expect(working()).toHaveLength(1)
      expect(byTestId("live-map-share-revoke-link-1")).not.toBeNull()
    })
  })

  describe("copying it", () => {
    const made1 = `https://app.example.test/share/location/${"1".padStart(64, "0")}?lang=ru`

    it("«Скопировать» puts exactly the link on the clipboard and says «Скопировано» for a moment", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      await act(async () => { byTestId("live-map-share-copy-link-1")?.click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(writeText.mock.calls).toEqual([[made1]])
      expect(text("live-map-share-copy-link-1")).toBe("Скопировано")
      expect(byTestId("live-map-share-copy-failed")).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(text("live-map-share-copy-link-1")).toBe("Скопировать")
      // The link is still there to be copied again.
      expect(field()?.value).toBe(made1)
    })

    it("a browser that refuses the clipboard is asked the old way", async () => {
      writeText.mockRejectedValue(new Error("NotAllowedError"))
      await open()
      await press(byTestId("live-map-share-create-1h"))
      await press(byTestId("live-map-share-copy-link-1"))
      expect(execCommand).toHaveBeenCalledWith("copy")
      expect(text("live-map-share-copy-link-1")).toBe("Скопировано")
    })

    it("says in words, beside the link, when it could not be copied at all — and leaves the link selected to be copied by hand", async () => {
      writeText.mockRejectedValue(new Error("NotAllowedError"))
      execCommand.mockReturnValue(false)
      await open()
      await press(byTestId("live-map-share-create-1h"))
      await press(byTestId("live-map-share-copy-link-1"))
      expect(text("live-map-share-copy-failed")).toBe("Не удалось скопировать. Выделите ссылку и скопируйте вручную.")
      expect(byTestId("live-map-share-copy-failed")?.closest('[data-testid="live-map-share-fresh-link-1"]')).not.toBeNull()
      expect(text("live-map-share-copy-link-1")).toBe("Скопировать")
      expect([field()?.selectionStart, field()?.selectionEnd]).toEqual([0, made1.length])
      // A press that works takes the sentence away.
      execCommand.mockReturnValue(true)
      await press(byTestId("live-map-share-copy-link-1"))
      expect(byTestId("live-map-share-copy-failed")).toBeNull()
    })
  })

  describe("the list", () => {
    it("says of each working link until when it works, who made it and how many times it was opened — declined by the number", async () => {
      keep({ viewCount: 21, lastViewedAt: iso(-3), expiresAt: iso(600) })
      keep({ viewCount: 5, lastViewedAt: iso(-10) })
      keep({ viewCount: 2, lastViewedAt: iso(-20), createdByName: null })
      keep({ viewCount: 1, lastViewedAt: iso(-30) })
      keep({ viewCount: 0 })
      await open()
      expect(working()).toEqual([
        ["Действует до конца дня", "Старший Первый · Открыта 21 раз · последний раз в 09:57"],
        ["Действует до 11:00", "Старший Первый · Открыта 5 раз · последний раз в 09:50"],
        // The author's name could not be read: nobody is named in his place.
        ["Действует до 11:00", "Открыта 2 раза · последний раз в 09:40"],
        ["Действует до 11:00", "Старший Первый · Открыта 1 раз · последний раз в 09:30"],
        ["Действует до 11:00", "Старший Первый · Ещё не открывали"],
      ])
    })

    it("keeps the ones that no longer work below, each with why and when — and «не открывали», never «открыта 0 раз»", async () => {
      keep()
      keep({ revokedAt: "2026-10-11T15:20:00.000Z", viewCount: 22 })
      keep({ expiresAt: "2026-10-10T20:00:00.000Z", viewCount: 0 })
      await open()
      expect(working()).toHaveLength(1)
      expect(text("live-map-share-past")).toContain("Больше не работают")
      // Not «ещё не открывали» either: that one promises an opening, and this link will have none.
      expect(past()).toEqual(["Отозвана: 11.10 15:20 · Открыта 22 раза", "Срок истёк: 10.10 20:00 · Не открывали"])
      // Nothing can be done with them.
      expect(container.querySelectorAll('[data-testid="live-map-share-past"] button')).toHaveLength(0)
    })

    it("draws nothing of a link but those lines, whatever else an answer carries", async () => {
      refuse.list = () => Response.json({
        success: true,
        data: {
          links: [{
            id: "link-x", createdAt: iso(-5), expiresAt: iso(60), revokedAt: null, viewCount: 1, lastViewedAt: iso(-1), createdByName: "Старший Первый", alive: true,
            tokenHash: "f".repeat(64), url: "https://app.example.test/share/location/leaked", createdBy: "user-7", lastViewerAddress: "203.0.113.9",
          }],
          access: { enabled: true, canWrite: true },
        },
      })
      await open()
      expect(working()).toHaveLength(1)
      expect(container.innerHTML).not.toMatch(/ffffffff|leaked|user-7|203\.0\.113\.9/)
      // A link read from the list has no address: only the hash was ever kept.
      expect(field()).toBeNull()
    })

    it("five refreshes of the map with the same key are one request; a new key reads once more and shows what changed", async () => {
      const link = keep()
      await open()
      for (let refresh = 0; refresh < 5; refresh += 1) await open()
      expect(asked("GET")).toHaveLength(1)
      link.viewCount = 4
      link.lastViewedAt = iso(-1)
      await open({ refreshKey: "k2" })
      expect(asked("GET")).toHaveLength(2)
      expect(working()[0][1]).toBe("Старший Первый · Открыта 4 раза · последний раз в 09:59")
    })
  })

  describe("revoking", () => {
    it("«Отозвать» asks first, in the row: one press revokes nothing, and «Не отзывать» leaves the link as it was", async () => {
      const link = keep({ viewCount: 3, lastViewedAt: iso(-2) })
      const other = keep()
      await open()
      await press(byTestId(`live-map-share-revoke-${link.id}`))
      // Nothing was asked of the server, and the link still works.
      expect(asked("DELETE")).toEqual([])
      expect(link.revokedAt).toBeNull()
      expect(working()).toHaveLength(2)
      expect(past()).toEqual([])
      // The row's action has become a question with two worded answers — in the row, not over the map.
      const step = byTestId(`live-map-share-revoke-step-${link.id}`)
      expect(step?.closest(`[data-testid="live-map-share-link-${link.id}"]`)).not.toBeNull()
      expect(step?.textContent).toBe("Отозвать ссылку? По ней сразу перестанет открываться карта.ОтозватьНе отзывать")
      expect(byTestId(`live-map-share-revoke-${link.id}`)).toBeNull()
      expect(container.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
      // The keyboard stands on the answer that changes nothing.
      expect(document.activeElement).toBe(byTestId(`live-map-share-revoke-keep-${link.id}`))
      expect(document.activeElement?.textContent).toBe("Не отзывать")
      // The other row is not asked about.
      expect(byTestId(`live-map-share-revoke-step-${other.id}`)).toBeNull()
      expect(text(`live-map-share-revoke-${other.id}`)).toBe("Отозвать")

      await press(byTestId(`live-map-share-revoke-keep-${link.id}`))
      expect(byTestId(`live-map-share-revoke-step-${link.id}`)).toBeNull()
      expect(asked("DELETE")).toEqual([])
      expect(working()).toHaveLength(2)
      // …and the keyboard is back on the row's own «Отозвать», not on the page.
      expect(document.activeElement).toBe(byTestId(`live-map-share-revoke-${link.id}`))
    })

    it("Escape answers the question as «Не отзывать» does", async () => {
      const link = keep()
      await open()
      await press(byTestId(`live-map-share-revoke-${link.id}`))
      await act(async () => {
        byTestId(`live-map-share-revoke-keep-${link.id}`)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      })
      expect(byTestId(`live-map-share-revoke-step-${link.id}`)).toBeNull()
      expect(asked("DELETE")).toEqual([])
      expect(working()).toHaveLength(1)
    })

    it("the second «Отозвать» stops that link: it leaves the working ones and stands below as revoked, with the moment the server stopped it", async () => {
      const first = keep({ viewCount: 3, lastViewedAt: iso(-2) })
      const second = keep()
      await open()
      expect(text(`live-map-share-revoke-${first.id}`)).toBe("Отозвать")
      // A screen reader is told which of the two it is about — on the first press and on the second.
      expect(byTestId(`live-map-share-revoke-${first.id}`)?.getAttribute("aria-label")).toBe("Отозвать: Действует до 11:00")
      await press(byTestId(`live-map-share-revoke-${first.id}`))
      expect(byTestId(`live-map-share-revoke-confirm-${first.id}`)?.getAttribute("aria-label")).toBe("Отозвать: Действует до 11:00")
      await press(byTestId(`live-map-share-revoke-confirm-${first.id}`))
      expect(asked("DELETE")).toEqual([{ method: "DELETE", path: `${LIST}/${first.id}`, body: null }])
      expect(working()).toHaveLength(1)
      expect(byTestId(`live-map-share-link-${second.id}`)).not.toBeNull()
      expect(past()).toEqual(["Отозвана: 12.10 10:05 · Открыта 3 раза"])
      expect(byTestId("live-map-share-notice")).toBeNull()
      // From the answer: the list was not read again.
      expect(asked("GET")).toHaveLength(1)
      // The row is gone; the keyboard is on the «Отозвать» of the row that took its place, not on the page.
      expect(document.activeElement).toBe(byTestId(`live-map-share-revoke-${second.id}`))
    })

    it("while the server is revoking, says «Отзываю…» and takes no second press — on either answer", async () => {
      const link = keep()
      await open()
      let answer: (response: Response) => void = () => {}
      await press(byTestId(`live-map-share-revoke-${link.id}`))
      vi.mocked(fetch).mockImplementationOnce((input, init) => {
        requests.push({ method: String(init?.method), path: new URL(String(input), "http://localhost").pathname, body: null })
        return new Promise<Response>((resolve) => { answer = resolve })
      })
      await press(byTestId(`live-map-share-revoke-confirm-${link.id}`))
      expect(text(`live-map-share-revoke-confirm-${link.id}`)).toBe("Отзываю…")
      await press(byTestId(`live-map-share-revoke-confirm-${link.id}`))
      await press(byTestId(`live-map-share-revoke-keep-${link.id}`))
      expect(asked("DELETE")).toHaveLength(1)
      // Still the question: «Не отзывать» cannot take back what is already on its way.
      expect(byTestId(`live-map-share-revoke-step-${link.id}`)).not.toBeNull()
      await act(async () => { answer(Response.json({ success: true, data: { id: link.id, revokedAt: iso(1) } })) })
      await settle()
      expect(working()).toEqual([])
      expect(past()).toEqual(["Отозвана: 12.10 10:01 · Не открывали"])
    })

    it("a link made a moment ago goes with its address when it is revoked", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(field()).not.toBeNull()
      await revoke("link-1")
      expect(field()).toBeNull()
      expect(working()).toEqual([])
      expect(byTestId("live-map-share-alive")).toBeNull()
      // No row is left to stand on: the keyboard goes to the first of the three buttons.
      expect(document.activeElement).toBe(byTestId("live-map-share-create-1h"))
    })

    it("in a row that was just made the field and «Скопировать» come before «Отозвать» — and before its question", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      const copyButton = byTestId("live-map-share-copy-link-1")
      expect(comesBefore(field(), copyButton)).toBe(true)
      expect(comesBefore(copyButton, byTestId("live-map-share-revoke-link-1"))).toBe(true)
      await press(byTestId("live-map-share-revoke-link-1"))
      expect(comesBefore(copyButton, byTestId("live-map-share-revoke-step-link-1"))).toBe(true)
      // The keyboard walks the page in that order: nothing in the block is given a place of its own.
      // (A value with a hint is reachable — tabindex 0 — but in the page's order, not ahead of it.)
      expect(container.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])')).toHaveLength(0)
    })

    it("a link somebody else has already stopped: said in words, the row goes, and the list is read again", async () => {
      const link = keep()
      await open()
      link.revokedAt = iso(-1)
      await revoke(link.id)
      expect(text("live-map-share-notice")).toBe("Этой ссылки уже нет: её отозвали или срок истёк.")
      expect(working()).toEqual([])
      expect(asked("GET")).toHaveLength(2)
      // The server's own account of it, not one made up on the page.
      expect(past()).toEqual(["Отозвана: 12.10 09:59 · Не открывали"])
    })

    it.each([
      ["too many requests", () => Response.json({ error: "Too many", code: "MTM_LOCATION_SHARE_LINK_RATE_LIMITED", retryAfterSeconds: 60 }, { status: 429 }), "Слишком много действий подряд. Подождите минуту."],
      ["no right any more", () => Response.json({ error: "Read only", code: "MTM_LOCATION_SHARE_LINK_READ_ONLY" }, { status: 403 }), "У вас нет права создавать и отзывать ссылки."],
      ["a failure of the server", () => Response.json({ error: "Failed", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 }), "Не получилось. Попробуйте ещё раз."],
    ])("%s: said in words, and the link is still shown as working — it is", async (_what, answer, sentence) => {
      const link = keep()
      await open()
      refuse.revoke = answer
      await revoke(link.id)
      expect(text("live-map-share-notice")).toBe(sentence)
      expect(working()).toHaveLength(1)
      expect(past()).toEqual([])
      // The question is closed, and the keyboard is back on the row's «Отозвать».
      expect(byTestId(`live-map-share-revoke-step-${link.id}`)).toBeNull()
      expect(document.activeElement).toBe(byTestId(`live-map-share-revoke-${link.id}`))
      // Asked again once the server is itself, it goes.
      refuse.revoke = undefined
      await revoke(link.id)
      expect(byTestId("live-map-share-notice")).toBeNull()
      expect(working()).toEqual([])
    })

    it("with no connection the link is not shown as revoked", async () => {
      const link = keep()
      await open()
      offline = true
      await revoke(link.id)
      expect(text("live-map-share-notice")).toBe("Нет связи с сервером. Попробуйте ещё раз.")
      expect(working()).toHaveLength(1)
      expect(link.revokedAt).toBeNull()
    })
  })

  describe("who may", () => {
    it("a supervisor sees the links and who may make them — and not one button", async () => {
      keep({ viewCount: 2, lastViewedAt: iso(-4) })
      keep({ revokedAt: iso(-30) })
      access.canWrite = false
      await open({ canWrite: false })
      expect(text("live-map-share-shows")).toBe(SHOWS)
      expect(working()).toEqual([["Действует до 11:00", "Старший Первый · Открыта 2 раза · последний раз в 09:56"]])
      expect(past()).toHaveLength(1)
      expect(text("live-map-share-read-only")).toBe("Создавать и отзывать ссылки могут администратор и менеджер.")
      // After both lists: it is about him, not about any link above it.
      expect(comesBefore(byTestId("live-map-share-alive"), byTestId("live-map-share-past"))).toBe(true)
      expect(comesBefore(byTestId("live-map-share-past"), byTestId("live-map-share-read-only"))).toBe(true)
      expect(buttons()).toEqual([])
      expect(byTestId("live-map-share-create")).toBeNull()
    })

    it("has no button before the list has answered either: «may» is the map's word, not the list's", async () => {
      heldLists = []
      await open({ canWrite: false })
      expect(buttons()).toEqual([])
      expect(text("live-map-share-read-only")).toBe("Создавать и отзывать ссылки могут администратор и менеджер.")
    })

    it("the list can take the buttons away from somebody the map let write, never give them to somebody it did not", async () => {
      keep()
      // The role changed since the map last answered.
      access.canWrite = false
      await open({ canWrite: true })
      expect(buttons()).toEqual([])
      expect(text("live-map-share-read-only")).not.toBeNull()

      takeAway()
      access.canWrite = true
      await open({ canWrite: false })
      expect(buttons()).toEqual([])
    })

    it("a manager has no read-only sentence", async () => {
      await open()
      expect(byTestId("live-map-share-read-only")).toBeNull()
    })
  })

  describe("the limit of working links", () => {
    it("with five working links there is nothing to press: the block says why, and what to do", async () => {
      for (let count = 0; count < 5; count += 1) keep()
      await open()
      expect(byTestId("live-map-share-create")).toBeNull()
      expect(text("live-map-share-limit")).toBe("Действующих ссылок у сотрудника уже 5 — это предел. Отзовите ненужную, чтобы создать новую.")
      // One revoked, and a link can be made again.
      await revoke("link-5")
      expect(byTestId("live-map-share-limit")).toBeNull()
      expect(durationButtons()).toHaveLength(3)
    })

    it("a colleague made the fifth meanwhile: the server's refusal is said in words, nothing is added, and the list is read again", async () => {
      for (let count = 0; count < 4; count += 1) keep()
      await open()
      keep({ createdByName: "Коллега Третий" })
      refuse.create = () => Response.json({ error: "limit", code: "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED", limit: 5 }, { status: 409 })
      await press(byTestId("live-map-share-create-1h"))
      expect(field()).toBeNull()
      expect(asked("GET")).toHaveLength(2)
      expect(working()).toHaveLength(5)
      // Said once: by the line that stands where the buttons were.
      expect(text("live-map-share-limit")).toBe("Действующих ссылок у сотрудника уже 5 — это предел. Отзовите ненужную, чтобы создать новую.")
      expect(byTestId("live-map-share-notice")).toBeNull()
      expect(byTestId("live-map-share-create")).toBeNull()
    })

    it("says the limit in words also when the list could not show it", async () => {
      await open()
      refuse.list = () => new Response("{}", { status: 500 })
      refuse.create = () => Response.json({ error: "limit", code: "MTM_LOCATION_SHARE_LINK_LIMIT_REACHED", limit: 5 }, { status: 409 })
      await press(byTestId("live-map-share-create-day"))
      expect(text("live-map-share-notice")).toBe("Действующих ссылок у сотрудника уже 5 — это предел. Отзовите ненужную, чтобы создать новую.")
      expect(field()).toBeNull()
    })
  })

  describe("when the server refuses to make a link", () => {
    it("the organization switched the links off meanwhile: said in words, the buttons go — and what was made before can still be revoked", async () => {
      const link = keep()
      await open()
      refuse.create = () => Response.json({ error: "off", code: "MTM_LOCATION_SHARE_LINK_DISABLED", setting: "locationShareLinksEnabled" }, { status: 403 })
      await press(byTestId("live-map-share-create-4h"))
      expect(text("live-map-share-off")).toBe(OFF)
      // Said once, not also as an error.
      expect(byTestId("live-map-share-notice")).toBeNull()
      expect(byTestId("live-map-share-create")).toBeNull()
      expect(field()).toBeNull()
      expect(working()).toHaveLength(1)
      await revoke(link.id)
      expect(working()).toEqual([])
      expect(asked("DELETE")).toHaveLength(1)
    })

    it("the list itself says the links are switched off: no buttons, the same sentence, nothing asked of the server", async () => {
      access.enabled = false
      keep()
      await open()
      expect(text("live-map-share-off")).toBe(OFF)
      expect(byTestId("live-map-share-create")).toBeNull()
      expect(asked("POST")).toEqual([])
      // Switched on again, the buttons are back with the next read.
      access.enabled = true
      await open({ refreshKey: "k2" })
      expect(byTestId("live-map-share-off")).toBeNull()
      expect(durationButtons()).toHaveLength(3)
    })

    it.each([
      ["the employee is not this manager's any more, or was deactivated", () => Response.json({ error: "Not found", code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" }, { status: 404 }), "Сотрудник недоступен: он не в вашей команде или отключён."],
      ["too many requests", () => Response.json({ error: "Too many", code: "MTM_LOCATION_SHARE_LINK_RATE_LIMITED", retryAfterSeconds: 60 }, { status: 429, headers: { "Retry-After": "60" } }), "Слишком много действий подряд. Подождите минуту."],
      ["the viewer may only look", () => Response.json({ error: "Read only", code: "MTM_LOCATION_SHARE_LINK_READ_ONLY" }, { status: 403 }), "У вас нет права создавать и отзывать ссылки."],
      ["the sign-in page came back instead of an answer", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }), "Вход устарел. Обновите страницу и войдите снова."],
      ["nobody is signed in", () => Response.json({ error: "Unauthorized" }, { status: 401 }), "Вход устарел. Обновите страницу и войдите снова."],
      ["the server failed", () => Response.json({ error: "Failed", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 }), "Не получилось. Попробуйте ещё раз."],
    ])("%s: said in words in the block, and no link is shown", async (_what, answer, sentence) => {
      await open()
      refuse.create = answer
      await press(byTestId("live-map-share-create-1h"))
      expect(text("live-map-share-notice")).toBe(sentence)
      expect(byTestId("live-map-share-notice")?.getAttribute("role")).toBe("alert")
      expect(field()).toBeNull()
      expect(working()).toEqual([])
      expect(table).toEqual([])
    })

    it("with no connection it says so, and the same press works once the connection is back", async () => {
      await open()
      offline = true
      await press(byTestId("live-map-share-create-1h"))
      expect(text("live-map-share-notice")).toBe("Нет связи с сервером. Попробуйте ещё раз.")
      expect(field()).toBeNull()
      expect(durationButtons().map((button) => button.getAttribute("aria-disabled"))).toEqual(["false", "false", "false"])
      offline = false
      await press(byTestId("live-map-share-create-1h"))
      expect(byTestId("live-map-share-notice")).toBeNull()
      expect(field()).not.toBeNull()
    })
  })

  describe("when the list cannot be read", () => {
    it("says so with «Повторить», heads nothing «Действующие ссылки», and still lets a manager make a link", async () => {
      refuse.list = () => new Response("{}", { status: 500 })
      await open()
      expect(byTestId("live-map-share-read-failed")?.firstElementChild?.textContent).toBe("Не удалось загрузить ссылки.")
      expect(byTestId("live-map-share-alive")).toBeNull()
      expect(byTestId("live-map-share-loading")).toBeNull()
      expect(durationButtons()).toHaveLength(3)
      refuse.list = undefined
      keep()
      await press(byTestId("live-map-share-retry"))
      expect(text("live-map-share-retry")).toBeNull()
      expect(asked("GET")).toHaveLength(2)
      expect(working()).toHaveLength(1)
    })

    it("a refresh that fails keeps what was read, with a word that it is not fresh", async () => {
      keep()
      await open()
      refuse.list = () => new Response("{}", { status: 503 })
      await open({ refreshKey: "k2" })
      expect(working()).toHaveLength(1)
      expect(byTestId("live-map-share-read-failed")?.firstElementChild?.textContent).toBe("Не удалось обновить список ссылок.")
      refuse.list = undefined
      await open({ refreshKey: "k3" })
      expect(byTestId("live-map-share-read-failed")).toBeNull()
    })

    it.each([
      ["no connection", null, "Нет связи с сервером. Попробуйте ещё раз.", 3],
      ["too many requests", () => Response.json({ code: "MTM_LOCATION_SHARE_LINK_RATE_LIMITED" }, { status: 429 }), "Слишком много действий подряд. Подождите минуту.", 3],
      ["the sign-in page instead of an answer", () => new Response("<html>login</html>", { status: 200 }), "Вход устарел. Обновите страницу и войдите снова.", 3],
      // The server will refuse a link for him as well: the buttons are not drawn.
      ["the employee is not this manager's any more", () => Response.json({ code: "MTM_LOCATION_SHARE_LINK_NOT_FOUND" }, { status: 404 }), "Сотрудник недоступен: он не в вашей команде или отключён.", 0],
    ])("%s: said in its own words", async (_what, answer, sentence, offered) => {
      if (answer) refuse.list = answer
      else offline = true
      await open()
      expect(byTestId("live-map-share-read-failed")?.firstElementChild?.textContent).toBe(sentence)
      expect(durationButtons()).toHaveLength(offered)
      expect(text("live-map-share-retry")).toBe("Повторить")
    })

    it("an answer that is not a list of links is a failed read, not «ссылок нет»", async () => {
      for (const body of [{ success: true }, { success: true, data: {} }, { success: true, data: { links: "none" } }]) {
        takeAway()
        refuse.list = () => Response.json(body)
        await open()
        expect(byTestId("live-map-share-alive"), JSON.stringify(body)).toBeNull()
        expect(byTestId("live-map-share-read-failed")?.firstElementChild?.textContent, JSON.stringify(body)).toBe("Не удалось загрузить ссылки.")
      }
    })
  })

  describe("a link made in this tab, when the block is taken off the screen and comes back", () => {
    const made1 = `https://app.example.test/share/location/${"1".padStart(64, "0")}?lang=ru`

    it("stands there again with its field after the block was folded — at once, before the list has answered", async () => {
      await open()
      await press(byTestId("live-map-share-create-4h"))
      takeAway()
      const onItsWay: Array<() => void> = []
      heldLists = onItsWay
      await open()
      // The list is on its way; the link that cannot be shown twice is not waiting for it.
      expect(field()?.value).toBe(made1)
      expect(text("live-map-share-shown-once")).toBe("Отправьте сейчас: потом ссылку здесь не увидеть.")
      await act(async () => { onItsWay.forEach((release) => release()) })
      await settle()
      expect(field()?.value).toBe(made1)
      expect(working()).toEqual([["Действует до 14:00", "Менеджер Второй · Ещё не открывали"]])
    })

    it("stands there again after another employee was looked at — who is shown none of it", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      await open({ agentId: "a2" })
      expect(asked("GET").map((request) => request.path)).toEqual([`${LIST}?agentId=a1`, `${LIST}?agentId=a2`])
      expect(field()).toBeNull()
      expect(working()).toEqual([])
      expect(container.innerHTML).not.toContain(made1)
      await open({ agentId: "a1" })
      expect(field()?.value).toBe(made1)
    })

    it("another employee is not shown the first one's links while his own list is on its way", async () => {
      keep()
      await open()
      await press(byTestId("live-map-share-create-1h"))
      heldLists = []
      await open({ agentId: "a2" })
      expect(working()).toEqual([])
      expect(field()).toBeNull()
      expect(text("live-map-share-loading")).toBe("Загружаю ссылки…")
    })

    it("is not shown to somebody who may only look, even in the tab it was made in", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      takeAway()
      access.canWrite = false
      await open({ canWrite: false })
      expect(working()).toHaveLength(1)
      expect(field()).toBeNull()
      expect(container.innerHTML).not.toContain(made1)
    })

    it("is forgotten, address and all, once the server says the link no longer works", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      // A colleague revoked it from his own screen.
      table[0].revokedAt = iso(2)
      await open({ refreshKey: "k2" })
      expect(field()).toBeNull()
      expect(past()).toHaveLength(1)
      // Even if a later answer named it as working again, the address is gone for good.
      table[0].revokedAt = null
      await open({ refreshKey: "k3" })
      expect(working()).toHaveLength(1)
      expect(field()).toBeNull()
    })

    it("is not taken off the screen by a list that was asked for before the link was made", async () => {
      const stale: Array<() => void> = []
      heldLists = stale
      await open()
      // The list is still on its way when the manager presses.
      await press(byTestId("live-map-share-create-1h"))
      expect(field()?.value).toBe(made1)
      heldLists = null
      // It answers now — describing the moment before the link existed.
      await act(async () => { stale.forEach((release) => release()) })
      await settle()
      expect(field()?.value).toBe(made1)
      expect(working()).toHaveLength(1)
      // That answer was not believed: the list was asked again.
      expect(asked("GET")).toHaveLength(2)
    })

    it("is gone after a reload — as the block says", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      takeAway()
      // What a reload does to the tab's memory.
      resetLiveMapShareLinkCacheForTests()
      await open()
      expect(working()).toHaveLength(1)
      expect(field()).toBeNull()
    })
  })

  describe("what the manager is told about this moment", () => {
    const NOTHING_NOW = "Сейчас точки на карте не будет: рабочий день не идёт, перерыв или телефон не на связи. Появится сама."

    it("says in amber, above the buttons, that a link shows no point right now — on the server's own «no»", async () => {
      showsNow = false
      await open()
      expect(text("live-map-share-shows-nothing-now")).toBe(NOTHING_NOW)
      expect(byTestId("live-map-share-shows-nothing-now")?.className).toContain("text-amber-700")
      expect(comesBefore(byTestId("live-map-share-shows-nothing-now"), byTestId("live-map-share-create"))).toBe(true)
      // He can still make a link: it will show the point when there is one.
      expect(durationButtons()).toHaveLength(3)
    })

    it("tells a supervisor the same: he is the one who will be asked why the client sees nothing", async () => {
      showsNow = false
      access.canWrite = false
      await open({ canWrite: false })
      expect(text("live-map-share-shows-nothing-now")).toBe(NOTHING_NOW)
    })

    it("says nothing of it when a point is shown, when the answer does not say, and when it says something that is neither yes nor no", async () => {
      for (const said of [true, undefined, null, "false", 0, "no", {}]) {
        takeAway()
        showsNow = said
        await open()
        expect(byTestId("live-map-share-shows-nothing-now"), JSON.stringify(said)).toBeNull()
        // The list was read: the three buttons stand, and nothing is still loading.
        expect(durationButtons(), JSON.stringify(said)).toHaveLength(3)
        expect(byTestId("live-map-share-loading"), JSON.stringify(said)).toBeNull()
      }
    })

    it("says nothing of it while the links are switched off: there «точка появится сама» would be untrue", async () => {
      showsNow = false
      access.enabled = false
      await open()
      expect(text("live-map-share-off")).toBe(OFF)
      expect(byTestId("live-map-share-shows-nothing-now")).toBeNull()
    })

    it("takes the line away with the next read that says a point is shown", async () => {
      showsNow = false
      await open()
      expect(byTestId("live-map-share-shows-nothing-now")).not.toBeNull()
      showsNow = true
      await open({ refreshKey: "k2" })
      expect(byTestId("live-map-share-shows-nothing-now")).toBeNull()
    })
  })

  describe("a link that ends with the organization's day", () => {
    it("is said in words, not as «до 00:00» — also when it was «На 4 часа», pressed late and cut at midnight", async () => {
      await open()
      vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
        requests.push({ method: "POST", path: LIST, body: JSON.parse(String(init?.body)) })
        const link = keep({ expiresAt: END_OF_DAY, createdByName: "Менеджер Второй" })
        return Response.json({ success: true, data: { link: sent(link), url: urlOf("7".repeat(64)) } }, { status: 201 })
      })
      await press(byTestId("live-map-share-create-4h"))
      expect(asked("POST")).toEqual([{ method: "POST", path: LIST, body: { agentId: "a1", duration: "4h" } }])
      expect(working()).toEqual([["Действует до конца дня", "Менеджер Второй · Ещё не открывали"]])
      // …and its «Отозвать» is named by the same words.
      expect(byTestId("live-map-share-revoke-link-1")?.getAttribute("aria-label")).toBe("Отозвать: Действует до конца дня")
    })

    it("is a clock one minute either side of that moment", async () => {
      keep({ expiresAt: iso(599) })
      keep({ expiresAt: iso(601) })
      keep({ expiresAt: END_OF_DAY })
      await open()
      expect(working().map((row) => row[0])).toEqual(["Действует до 19:59", "Действует до 20:01", "Действует до конца дня"])
    })

    it("is judged by the organization's zone: the same moment is a clock where the day ends at another hour, and where the zone is not known", async () => {
      keep({ expiresAt: END_OF_DAY })
      await open({ timeZone: "Europe/Warsaw" })
      expect(working()[0][0]).toBe("Действует до 20:00")
      await open({ timeZone: undefined })
      expect(working()[0][0]).toBe("Действует до 20:00")
      await open({ timeZone: ZONE })
      expect(working()[0][0]).toBe("Действует до конца дня")
    })

    // «Ссылка не живёт дольше конца дня» stood under the buttons until 2026-10-12. The owner asked for
    // a lighter block; a link cut at midnight says so in its own row («Действует до конца дня», above).
    it("leaves that to the link's own row: nothing is explained under the three buttons", async () => {
      await open()
      expect(byTestId("live-map-share-day-limit")).toBeNull()
      expect(durationButtons()[2].parentElement?.nextElementSibling).toBeNull()
    })
  })

  describe("a link whose time has run out since the list was read", () => {
    it("leaves the working ones by the page's clock — address and «Скопировать» with it — and the list is read again, once", async () => {
      const longer = keep({ expiresAt: iso(240) })
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(field()).not.toBeNull()
      expect(working()).toHaveLength(2)
      expect(asked("GET")).toHaveLength(1)
      // One minute short of its hour: nothing changes, and nothing is asked.
      await open({ nowMs: NOW + 59 * 60_000 })
      expect(working()).toHaveLength(2)
      expect(asked("GET")).toHaveLength(1)

      // The hour is up — on the page and on the server.
      serverNow = NOW + 60 * 60_000
      await open({ nowMs: NOW + 60 * 60_000 })
      expect(working()).toEqual([["Действует до 14:00", "Старший Первый · Ещё не открывали"]])
      expect(byTestId(`live-map-share-link-${longer.id}`)).not.toBeNull()
      expect(field()).toBeNull()
      expect(container.querySelector('[data-testid^="live-map-share-copy-"]')).toBeNull()
      expect(past()).toEqual(["Срок истёк: 12.10 11:00 · Не открывали"])
      expect(asked("GET")).toHaveLength(2)
      // The map goes on refreshing: the same link is not a reason to ask again.
      await open({ nowMs: NOW + 61 * 60_000 })
      await open({ nowMs: NOW + 62 * 60_000 })
      expect(asked("GET")).toHaveLength(2)
    })

    it("does not wait for the server to agree, and does not ask it in a loop when it does not", async () => {
      keep({ expiresAt: iso(30) })
      await open()
      // The page's clock is past the moment; the server (its clock unmoved) still calls the link working.
      await open({ nowMs: NOW + 31 * 60_000 })
      expect(working()).toEqual([])
      expect(past()).toEqual(["Срок истёк: 12.10 10:30 · Не открывали"])
      expect(container.querySelector('[data-testid^="live-map-share-revoke-"]')).toBeNull()
      expect(asked("GET")).toHaveLength(2)
      for (let minute = 32; minute < 40; minute += 1) await open({ nowMs: NOW + minute * 60_000 })
      expect(asked("GET")).toHaveLength(2)
    })

    it("no longer counts toward the limit: the three buttons are back the moment the fifth runs out", async () => {
      for (let count = 0; count < 4; count += 1) keep({ expiresAt: iso(240) })
      keep({ expiresAt: iso(10) })
      await open()
      expect(byTestId("live-map-share-limit")).not.toBeNull()
      serverNow = NOW + 10 * 60_000
      await open({ nowMs: NOW + 10 * 60_000 })
      expect(byTestId("live-map-share-limit")).toBeNull()
      expect(durationButtons()).toHaveLength(3)
      expect(working()).toHaveLength(4)
    })

    it("reads a link as working up to the moment itself, and a clock that is no clock takes nothing away", async () => {
      keep({ expiresAt: iso(30) })
      await open({ nowMs: NOW + 30 * 60_000 - 1 })
      expect(working()).toHaveLength(1)
      await open({ nowMs: Number.NaN })
      expect(working()).toHaveLength(1)
      expect(asked("GET")).toHaveLength(1)
    })
  })

  describe("the keyboard and a screen reader", () => {
    it("after a link is made the keyboard is in its field, the link selected — and the box that holds it announces itself", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(document.activeElement).toBe(field())
      expect([field()?.selectionStart, field()?.selectionEnd]).toEqual([0, field()?.value.length])
      expect(byTestId("live-map-share-fresh-link-1")?.getAttribute("role")).toBe("status")
    })

    it("when the fifth link is made and the three buttons give way to the limit, the keyboard is in the new link's field, not on the page", async () => {
      for (let count = 0; count < 4; count += 1) keep()
      await open()
      const pressed = byTestId("live-map-share-create-1h")
      pressed?.focus()
      await press(pressed)
      expect(byTestId("live-map-share-create")).toBeNull()
      expect(text("live-map-share-limit")).not.toBeNull()
      expect(document.activeElement).toBe(field())
    })

    it("does not pull the keyboard back when the person has gone elsewhere while the server was answering", async () => {
      const elsewhere = document.createElement("input")
      document.body.appendChild(elsewhere)
      try {
        let answer: (response: Response) => void = () => {}
        await open()
        vi.mocked(fetch).mockImplementationOnce((_input, init) => {
          requests.push({ method: "POST", path: LIST, body: JSON.parse(String(init?.body)) })
          return new Promise<Response>((resolve) => { answer = resolve })
        })
        await press(byTestId("live-map-share-create-1h"))
        elsewhere.focus()
        const link = keep()
        await act(async () => { answer(Response.json({ success: true, data: { link: sent(link), url: urlOf("9".repeat(64)) } }, { status: 201 })) })
        await settle()
        expect(field()).not.toBeNull()
        expect(document.activeElement).toBe(elsewhere)
      } finally {
        elsewhere.remove()
      }
    })

    it("names the group of three buttons by the words on screen — once, not by a second copy of them", async () => {
      await open()
      const group = byTestId("live-map-share-create")
      expect(group?.getAttribute("role")).toBe("group")
      expect(group?.hasAttribute("aria-label")).toBe(false)
      const label = document.getElementById(group?.getAttribute("aria-labelledby") ?? "")
      expect(label?.textContent).toBe("Создать ссылку:")
      expect(group?.contains(label)).toBe(true)
      // The label is a line of its own: it is not one of the things the three buttons wrap among.
      expect(label?.parentElement).toBe(group)
      expect(new Set(durationButtons().map((button) => button.parentElement)).size).toBe(1)
      expect(durationButtons()[0].parentElement).not.toBe(group)
      expect(durationButtons()[0].parentElement?.contains(label)).toBe(false)
    })

    it("switches no button off the way that drops the keyboard: busy is said with aria-disabled, and the press is ignored", async () => {
      const link = keep()
      await open()
      let answer: (response: Response) => void = () => {}
      vi.mocked(fetch).mockImplementationOnce((_input, init) => {
        requests.push({ method: "POST", path: LIST, body: JSON.parse(String(init?.body)) })
        return new Promise<Response>((resolve) => { answer = resolve })
      })
      await press(byTestId("live-map-share-create-1h"))
      const all = [...container.querySelectorAll("button")]
      expect(all.length).toBeGreaterThan(3)
      expect(all.filter((button) => button.disabled)).toEqual([])
      expect(byTestId(`live-map-share-revoke-${link.id}`)?.getAttribute("aria-disabled")).toBe("true")
      // «Отозвать» of another link takes no press while a link is being made.
      await press(byTestId(`live-map-share-revoke-${link.id}`))
      expect(byTestId(`live-map-share-revoke-step-${link.id}`)).toBeNull()
      await act(async () => { answer(Response.json({ error: "Failed", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 })) })
      await settle()
      expect(byTestId(`live-map-share-revoke-${link.id}`)?.getAttribute("aria-disabled")).toBe("false")
    })
  })

  describe("which link was sent", () => {
    it("marks the link that was copied here, for good: after «Скопировано» has gone, after the block was folded — and in the name of its «Отозвать»", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(byTestId("live-map-share-copied-here-link-1")).toBeNull()
      expect(byTestId("live-map-share-revoke-link-1")?.getAttribute("aria-label")).toBe("Отозвать: Действует до 11:00")
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      await act(async () => { byTestId("live-map-share-copy-link-1")?.click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(text("live-map-share-copy-link-1")).toBe("Скопировать")
      expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
      vi.useRealTimers()
      expect(byTestId("live-map-share-revoke-link-1")?.getAttribute("aria-label")).toBe("Отозвать: Действует до 11:00 · Эту ссылку вы уже отправили или скопировали")

      takeAway()
      await open()
      expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
      // A reload forgets the address, and the mark with it.
      takeAway()
      resetLiveMapShareLinkCacheForTests()
      await open()
      expect(byTestId("live-map-share-copied-here-link-1")).toBeNull()
    })

    it("of two links made one after another marks only the one that was copied", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      await settle(1_050)
      await press(byTestId("live-map-share-create-1h"))
      expect(working()).toEqual([
        ["Действует до 11:00", "Менеджер Второй · Ещё не открывали"],
        ["Действует до 11:00", "Менеджер Второй · Ещё не открывали"],
      ])
      await press(byTestId("live-map-share-copy-link-1"))
      expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
      expect(byTestId("live-map-share-copied-here-link-2")).toBeNull()
      expect(byTestId("live-map-share-revoke-link-2")?.getAttribute("aria-label")).toBe("Отозвать: Действует до 11:00")
    })

    // The owner, 2026-10-12: «его отправку и описание облегчи». Copying a link, opening WhatsApp and
    // pasting it there was three steps for what a taxi app does in one.
    describe("sending it", () => {
      const MADE = `https://app.example.test/share/location/${"1".padStart(64, "0")}?lang=ru`
      const MESSAGE = `Смотрите на карте, где сейчас Нигяр Примерова: ${MADE}`
      const share = vi.fn<(data: { text?: string }) => Promise<void>>()
      const withShareSheet = () => Object.defineProperty(navigator, "share", { configurable: true, value: share })

      beforeEach(() => {
        share.mockReset()
        share.mockResolvedValue(undefined)
      })
      afterEach(() => {
        Reflect.deleteProperty(navigator, "share")
      })

      it("«Отправить в WhatsApp» opens WhatsApp with the message already written — the employee's name and the link — in a tab of its own", async () => {
        await open()
        await press(byTestId("live-map-share-create-1h"))
        const whatsapp = byTestId("live-map-share-whatsapp-link-1") as HTMLAnchorElement | null
        expect(whatsapp?.tagName).toBe("A")
        expect(whatsapp?.textContent).toBe("Отправить в WhatsApp")
        const target = new URL(whatsapp?.getAttribute("href") ?? "")
        expect(target.origin + target.pathname).toBe("https://wa.me/")
        // Whom it goes to is chosen in WhatsApp: the card names no number.
        expect([...target.searchParams.keys()]).toEqual(["text"])
        expect(target.searchParams.get("text")).toBe(MESSAGE)
        expect(whatsapp?.getAttribute("target")).toBe("_blank")
        // The tab WhatsApp opens in is given neither this page nor its address.
        expect(whatsapp?.getAttribute("rel")).toBe("noopener noreferrer")
        // It stands first of the ways to send, under the link itself.
        expect(comesBefore(field(), whatsapp)).toBe(true)
        expect(comesBefore(whatsapp, byTestId("live-map-share-copy-link-1"))).toBe(true)
      })

      it("a press on it marks the link as sent, for good, and puts nothing in the clipboard", async () => {
        await open()
        await press(byTestId("live-map-share-create-1h"))
        const whatsapp = byTestId("live-map-share-whatsapp-link-1")
        // jsdom does not follow a link; the press is all that is asked of it here.
        whatsapp?.addEventListener("click", (event) => event.preventDefault())
        await press(whatsapp)
        expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
        expect(writeText).not.toHaveBeenCalled()
        expect(execCommand).not.toHaveBeenCalled()
        takeAway()
        await open()
        expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
      })

      it("offers «Поделиться…» only where the device has a sheet of its own", async () => {
        await open()
        await press(byTestId("live-map-share-create-1h"))
        expect(byTestId("live-map-share-share-link-1")).toBeNull()
        expect(buttons()).not.toContain("Поделиться…")
        takeAway()
        withShareSheet()
        await open()
        expect(text("live-map-share-share-link-1")).toBe("Поделиться…")
        expect(comesBefore(byTestId("live-map-share-share-link-1"), byTestId("live-map-share-copy-link-1"))).toBe(true)
      })

      it("«Поделиться…» hands the device the same message, and marks the link once it went", async () => {
        withShareSheet()
        await open()
        await press(byTestId("live-map-share-create-1h"))
        expect(share).not.toHaveBeenCalled()
        await press(byTestId("live-map-share-share-link-1"))
        expect(share.mock.calls).toEqual([[{ text: MESSAGE }]])
        expect(text("live-map-share-copied-here-link-1")).toBe("Эту ссылку вы уже отправили или скопировали")
        expect(byTestId("live-map-share-copy-failed")).toBeNull()
      })

      it("a sheet closed without choosing is not a failure and not a sending", async () => {
        withShareSheet()
        share.mockRejectedValue(new DOMException("Share canceled", "AbortError"))
        await open()
        await press(byTestId("live-map-share-create-1h"))
        await press(byTestId("live-map-share-share-link-1"))
        expect(byTestId("live-map-share-copied-here-link-1")).toBeNull()
        expect(byTestId("live-map-share-copy-failed")).toBeNull()
      })

      it("a sheet the device refused to open says so and leaves the link selected, to be copied by hand", async () => {
        withShareSheet()
        share.mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"))
        await open()
        await press(byTestId("live-map-share-create-1h"))
        await press(byTestId("live-map-share-share-link-1"))
        expect(text("live-map-share-copy-failed")).toBe("Не удалось скопировать. Выделите ссылку и скопируйте вручную.")
        expect(byTestId("live-map-share-copied-here-link-1")).toBeNull()
        expect(field()?.selectionStart).toBe(0)
        expect(field()?.selectionEnd).toBe(MADE.length)
      })

      it("a supervisor, who is shown no link, is shown no way to send one", async () => {
        withShareSheet()
        keep()
        access.canWrite = false
        await open({ canWrite: false })
        expect(working()).toHaveLength(1)
        expect(container.querySelector('[data-testid^="live-map-share-whatsapp-"]')).toBeNull()
        expect(container.querySelector('[data-testid^="live-map-share-share-"]')).toBeNull()
      })
    })

    it("does not mark a link that could not be copied", async () => {
      writeText.mockRejectedValue(new Error("NotAllowedError"))
      execCommand.mockReturnValue(false)
      await open()
      await press(byTestId("live-map-share-create-1h"))
      await press(byTestId("live-map-share-copy-link-1"))
      expect(text("live-map-share-copy-failed")).not.toBeNull()
      expect(byTestId("live-map-share-copied-here-link-1")).toBeNull()
    })

    it("a second press within a second of a link being made is the same press twice: it makes no second link — a press after that does", async () => {
      await open()
      await press(byTestId("live-map-share-create-1h"))
      expect(asked("POST")).toHaveLength(1)
      // The second half of a double click, and one more for good measure.
      await press(byTestId("live-map-share-create-1h"))
      await press(byTestId("live-map-share-create-day"))
      expect(asked("POST")).toHaveLength(1)
      expect(working()).toHaveLength(1)
      await settle(1_050)
      await press(byTestId("live-map-share-create-4h"))
      expect(asked("POST")).toHaveLength(2)
      expect(working()).toHaveLength(2)
    })

    it("a creation the server refused holds nothing back: the next press is taken at once", async () => {
      await open()
      refuse.create = () => Response.json({ error: "Failed", code: "MTM_LOCATION_SHARE_LINK_FAILED" }, { status: 500 })
      await press(byTestId("live-map-share-create-1h"))
      refuse.create = undefined
      await press(byTestId("live-map-share-create-1h"))
      expect(asked("POST")).toHaveLength(2)
      expect(working()).toHaveLength(1)
    })
  })
})

describe("the words of «Ссылка на местоположение» in the card", () => {
  type Messages = { [key: string]: string | Messages }
  const LOCALES = ["ru", "en", "az"] as const
  const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages]))
  const paths = (node: Messages, prefix = ""): Array<[string, string]> => Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : paths(value, `${prefix}${key}.`))
  const said = (locale: string) => paths((catalogs[locale].mtmMap as Messages).share as Messages)
  /** What a sentence asks to be filled in — `{time}`, and the `count` of `{count, plural, …}`. */
  const placeholders = (sentence: string) => [...new Set([...sentence.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]))].sort()

  it("are all there in the three languages, each with the same things to fill in", () => {
    const expected = said("ru")
    expect(expected.length).toBeGreaterThan(35)
    for (const locale of ["en", "az"]) {
      expect(said(locale).map(([path]) => path), locale).toEqual(expected.map(([path]) => path))
      expect(said(locale).map(([path, sentence]) => [path, placeholders(sentence)]), locale).toEqual(expected.map(([path, sentence]) => [path, placeholders(sentence)]))
    }
  })

  it("are the sentences the block and the page really ask for — none missing in any language, none left over", () => {
    // The block's own keys, and the block's heading, which the page reads through `tMap`
    // (the catalog gate in lib-i18n-keys.test.ts does not follow a translator of that name).
    const block = readFileSync("src/components/mtm/live-map-agent-share.tsx", "utf8")
    const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")
    const literal = [...block.matchAll(/\bt\(\s*"share\.([\w.]+)"/g), ...page.matchAll(/\btMap\(\s*"share\.([\w.]+)"/g)].map((match) => match[1])
    const families = [...block.matchAll(/\bt\(\s*`share\.([\w.]+)\.\$\{/g)].map((match) => match[1])
    expect(literal).toContain("title")
    expect(families.sort()).toEqual(["durations", "errors", "errors"])
    for (const locale of LOCALES) {
      const have = said(locale).map(([path]) => path)
      for (const key of literal) expect(have, `${locale}: share.${key}`).toContain(key)
      const used = new Set(literal)
      const unused = have.filter((path) => !used.has(path) && !families.some((family) => path.startsWith(`${family}.`)))
      expect(unused, locale).toEqual([])
    }
    // The families are closed sets in the code: every member has its sentence.
    const durations = Object.keys(((catalogs.ru.mtmMap as Messages).share as Messages).durations as Messages)
    expect(durations).toEqual(["1h", "4h", "day"])
    const errors = Object.keys(((catalogs.ru.mtmMap as Messages).share as Messages).errors as Messages).sort()
    expect(errors).toEqual(["agentGone", "busy", "failed", "limit", "linkGone", "network", "off", "readOnly", "session"])
  })

  it("count the openings as each language does", async () => {
    const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl")
    const opened = (locale: string) => {
      const t = createTranslator({ locale, messages: catalogs[locale] as never, namespace: "mtmMap" as never }) as unknown as (key: string, values: Record<string, number>) => string
      return (count: number) => t("share.opened", { count })
    }
    expect([0, 1, 2, 4, 5, 11, 12, 21, 22, 25, 101].map(opened("ru"))).toEqual([
      "Открыта 0 раз", "Открыта 1 раз", "Открыта 2 раза", "Открыта 4 раза", "Открыта 5 раз", "Открыта 11 раз",
      "Открыта 12 раз", "Открыта 21 раз", "Открыта 22 раза", "Открыта 25 раз", "Открыта 101 раз",
    ])
    expect([0, 1, 2, 21].map(opened("en"))).toEqual(["Opened 0 times", "Opened 1 time", "Opened 2 times", "Opened 21 times"])
    expect([0, 1, 2, 21].map(opened("az"))).toEqual(["0 dəfə açılıb", "1 dəfə açılıb", "2 dəfə açılıb", "21 dəfə açılıb"])
  })

  it("say the same three things on the buttons as the server understands", () => {
    const durations = (locale: string) => ((catalogs[locale].mtmMap as Messages).share as Messages).durations as Messages
    expect(durations("ru")).toEqual({ "1h": "На 1 час", "4h": "На 4 часа", day: "До конца дня" })
    expect(((catalogs.ru.mtmMap as Messages).share as Messages).title).toBe("Ссылка на местоположение")
    expect(((catalogs.ru.mtmMap as Messages).share as Messages).shownOnce).toBe("Отправьте сейчас: потом ссылку здесь не увидеть.")
  })

  it("say where the links are switched on by the names the settings page itself carries for that tab and that card", () => {
    // Where the switch really is: the card and the tab named in the page's own table of settings.
    const settings = readFileSync("src/app/(dashboard)/mtm/settings/page.tsx", "utf8")
    const before = settings.slice(0, settings.indexOf('key: "locationShareLinksEnabled"'))
    expect(before.length).toBeGreaterThan(0)
    const card = before.slice(before.lastIndexOf("titleKey:"))
    expect(card).toMatch(/^titleKey: "groupLiveMap",\s+tab: "alerts",/)
    expect(settings).toContain('alerts: "tabAlerts"')
    for (const locale of LOCALES) {
      const page = catalogs[locale].mtmSettingsPage as Messages
      const off = (((catalogs[locale].mtmMap as Messages).share as Messages).errors as Messages).off as string
      expect(typeof page.tabAlerts === "string" && page.tabAlerts.length > 3, locale).toBe(true)
      expect(typeof page.groupLiveMap === "string" && page.groupLiveMap.length > 3, locale).toBe(true)
      // Renamed there, the sentence would send a person to a tab that does not exist.
      expect(off, locale).toContain(page.tabAlerts as string)
      expect(off, locale).toContain(page.groupLiveMap as string)
      expect(off, locale).toContain("MTM")
    }
    const errors = ((catalogs.ru.mtmMap as Messages).share as Messages).errors as Messages
    expect(errors.off).toBe(OFF)
  })

  it("say the new things as decided", () => {
    const share = (catalogs.ru.mtmMap as Messages).share as Messages
    expect(share.revokeConfirm).toBe("Отозвать ссылку? По ней сразу перестанет открываться карта.")
    expect(share.revokeCancel).toBe("Не отзывать")
    expect(share.validUntilEndOfDay).toBe("Действует до конца дня")
    // Under the buttons until 2026-10-12; the row of a link cut at midnight says it now.
    expect(share.dayLimit).toBeUndefined()
    expect(share.none).toBeUndefined()
    expect(share.ready).toBe("Ссылка готова — отправьте её")
    expect(share.sendWhatsApp).toBe("Отправить в WhatsApp")
    expect(share.shareOther).toBe("Поделиться…")
    expect(share.message).toBe("Смотрите на карте, где сейчас {name}: {url}")
    expect(share.copiedHere).toBe("Эту ссылку вы уже отправили или скопировали")
    expect(share.neverOpened).toBe("Не открывали")
    expect(((catalogs.az.mtmMap as Messages).share as Messages).shownOnce).toBe("İndi göndərin: sonra linki burada görmək olmayacaq.")
    // «Открыть» is what the outsider does with a link; of the manager's own view the block says «увидеть».
    expect(share.shownOnce).not.toMatch(/откр/i)
  })

  it("never glue an Azerbaijani case ending onto a name, a time or a number", () => {
    for (const [path, sentence] of said("az")) {
      expect(sentence, path).not.toMatch(/\}['’\-]?\p{L}/u)
    }
  })
})
