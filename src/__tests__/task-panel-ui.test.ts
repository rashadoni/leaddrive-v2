// @vitest-environment jsdom
/**
 * The Bordio-style task card (owner, 2026-11-07), rendered with the real
 * Russian copy against a fake API: the fields and the board path show, the
 * title is renamed in place, a subtask is added on Enter, a message with an
 * @-mention sends the mentioned id, following and the timer call their
 * endpoints, and the time line reads in words.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => "ru",
  }
})

import { TaskPanel } from "@/components/tasks/task-panel/task-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TASK = {
  id: "t1", divisionId: "b1", title: "Vebsayt reklamları", description: "", status: "in_progress", priority: "critical", type: "digital_marketing",
  taskKey: "DPHARMA-53", dueDate: "2026-12-04T19:59:59.000Z", startDate: null, assignedTo: "s", assignee: { id: "s", name: "Sabina Hasanova" },
  collaborators: [], reporterId: "n", reporter: { id: "n", name: "Nazrin Shirinova" }, creator: { id: "s", name: "Sabina Hasanova" },
  tags: ["meta"], estimatedHours: null, recurrenceRule: null, customFields: { brand: "Pharmastore" },
  checklist: [{ id: "c1", title: "pixel quraşdırılması", completed: true, sortOrder: 0, assignedTo: "s", assignee: { id: "s", name: "Sabina Hasanova" }, dueDate: null }],
  attachments: [], createdAt: "2025-12-02T10:33:15.785Z",
}
const FEED = {
  items: [
    { kind: "event", id: "e1", at: "2026-03-05T11:18:00.000Z", user: { id: "s", name: "Sabina Hasanova" }, action: "due_date_changed", oldValue: null, newValue: "2026-03-12T19:59:59.000Z", text: null },
    { kind: "message", id: "m1", at: "2026-03-19T11:17:00.000Z", user: { id: "s", name: "Sabina Hasanova" }, text: "birbaşa reklamları aktivləşdirdim", mentions: [], system: false },
    { kind: "event", id: "e2", at: "2026-11-03T11:04:00.000Z", user: null, action: "external_event", oldValue: null, newValue: null, text: "Sabina Hasanova completed the subtask: pixel quraşdırılması" },
  ],
  followers: [{ id: "a", name: "Aytan" }, { id: "s", name: "Sabina Hasanova" }],
  following: false,
}

let container: HTMLDivElement
let root: Root
const calls: string[] = []
const timer: { running: { startedAt: string } | null } = { running: null }
beforeEach(() => {
  calls.length = 0
  timer.running = null
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? init.body : ""
    calls.push(`${method} ${url} ${body}`.trim())
    const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
    if (url === "/api/v1/tasks/t1" && method === "GET") return json(TASK)
    if (url === "/api/v1/tasks/t1/time") {
      if (method === "POST" && body.includes('"start"')) timer.running = { startedAt: new Date().toISOString() }
      return json({ entries: [], totalMinutes: 90, running: timer.running })
    }
    if (url === "/api/v1/tasks/t1/feed") return json(FEED)
    if (url === "/api/v1/divisions") return json({ divisions: [
      { id: "dig", name: "Digital Marketing", isDepartment: true },
      { id: "b1", name: "Pharmastore", parentDivisionId: "dig", boardColumns: [] },
      { id: "b2", name: "Zeytun", parentDivisionId: "dig", boardColumns: [] },
    ] })
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "s", name: "Sabina Hasanova" }, { id: "n", name: "Nazrin Shirinova" }, { id: "a", name: "Aytan Mushkurova" }])
    if (url.startsWith("/api/v1/custom-fields")) return json([{ fieldName: "brand", isActive: true, options: ["Zeytun", "Pharmastore"] }])
    if (url.startsWith("/api/v1/task-types")) return json([{ id: "1", name: "digital_marketing", displayName: "DIGITAL MARKETING", color: "#000", sortOrder: 0, isActive: true }])
    return json({})
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!
  await act(async () => {
    setter.call(el, value)
    el.setSelectionRange?.(value.length, value.length)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const press = (el: Element, key: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })) })
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })) })
const byText = (selector: string, text: string) => [...container.querySelectorAll(selector)].find((el) => el.textContent?.includes(text))

async function open() {
  await act(async () => {
    root.render(createElement(TaskPanel, {
      taskId: "t1", path: "Digital Marketing / Pharmastore", canEdit: true, onClose: () => {}, onMutated: () => {},
      columns: [{ key: "todo", label: "New task", columnKey: "c_todo" }, { key: "in_progress", label: "In progress", columnKey: "c_ip" }, { key: "done", label: "Completed", columnKey: "c_done" }],
    }))
  })
  await flush()
}

describe("task card panel", () => {
  it("shows a CRM status the board has no column for as the column the board puts it in", async () => {
    // The quick-add row writes «pending»; the card printed the raw word (2026-11-09).
    const was = TASK.status
    TASK.status = "pending"
    try {
      await open()
      const status = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.text === "Completed"))!
      expect(status.value).toBe("todo")
      expect([...status.options].map((o) => o.text)).toEqual(["New task", "In progress", "Completed"])
      expect(calls.some((c) => c.startsWith("PATCH"))).toBe(false)
    } finally {
      TASK.status = was
    }
  })

  it("shows the fields, the board path, subtasks with their people, and a time line in words", async () => {
    await open()
    const text = container.textContent ?? ""
    expect(text).toContain("Digital Marketing / Pharmastore / DPHARMA-53")
    expect(text).toContain("Поставил")
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Vebsayt reklamları")
    const status = [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.text === "Completed"))!
    expect(status.value).toBe("in_progress")
    expect(text).toContain("#meta")
    expect(text).toContain("потрачено 1:30")
    expect(text).toContain("pixel quraşdırılması")
    expect(text).toContain("Sabina Hasanova поставил(а) срок 12 мар. 2026 г.")
    expect(text).toContain("Sabina Hasanova completed the subtask: pixel quraşdırılması")
    expect(text).toContain("2 подписчика")
  })

  it("renames in place, adds a subtask on Enter, follows, and starts the timer", async () => {
    await open()
    const title = container.querySelector("textarea") as HTMLTextAreaElement
    await type(title, "Vebsayt reklamları — GA4")
    await act(async () => { title.dispatchEvent(new FocusEvent("blur")); title.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) })
    await flush()
    expect(calls).toContain('PATCH /api/v1/tasks/t1 {"title":"Vebsayt reklamları — GA4"}')

    const add = container.querySelector('[data-testid="task-panel-subtask-input"]') as HTMLInputElement
    await type(add, "ga4 quraşdırılması")
    await press(add, "Enter")
    await flush()
    expect(calls).toContain('POST /api/v1/tasks/t1/checklist {"title":"ga4 quraşdırılması"}')

    await click(byText("button", "Следить"))
    await flush()
    expect(calls).toContain("POST /api/v1/tasks/t1/followers {}")

    await click(byText("button", "Таймер"))
    await flush()
    expect(calls).toContain('POST /api/v1/tasks/t1/time {"action":"start"}')
    expect(byText("button", "Стоп")).toBeTruthy()
  })

  it("sends a message with the @-mentioned person's id", async () => {
    await open()
    const box = container.querySelector('textarea[placeholder="Сообщение… @ — упомянуть"]') as HTMLTextAreaElement
    await type(box, "bax @naz")
    const option = byText("[role=listbox] button", "Nazrin Shirinova")!
    await act(async () => { option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })) })
    expect(box.value).toBe("bax @Nazrin Shirinova ")
    await click(byText("button", "Отправить"))
    await flush()
    expect(calls).toContain('POST /api/v1/tasks/t1/comments {"content":"bax @Nazrin Shirinova","mentions":["n"]}')
  })
})

// Zeytun's first day in the CRM (2026-11-12): «Burda elave etdiyim sekilleri gore bilmirem»,
// «fayl elave etmek … mumkun deyil», «əlavə olunanları da silmək olmur».
describe("files in the card, as in Bordio", () => {
  const PICS = [
    { id: "f1", fileName: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", originalName: "11.11.26 Stories-1.jpg", mimeType: "image/jpeg" },
    { id: "f2", fileName: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf", originalName: "plan.pdf", mimeType: "application/pdf" },
  ]
  const withFiles = async (items: unknown[]) => {
    const task = TASK as unknown as { attachments: unknown[] }
    const feed = FEED as unknown as { items: unknown[] }
    const was = { attachments: task.attachments, items: feed.items }
    task.attachments = PICS
    feed.items = items
    return () => { task.attachments = was.attachments; feed.items = was.items }
  }

  it("a message that names files shows them — the picture as a picture — and a name the task has no file for as a name", async () => {
    const restore = await withFiles([
      { kind: "message", id: "m9", at: "2026-11-11T08:46:00.000Z", user: { id: "x", name: "Khayala" }, text: "Baxın\n📎 11.11.26 Stories-1.jpg, plan.pdf, köhnə.png", mentions: [], system: false },
    ])
    try {
      await open()
      const img = container.querySelector('[data-testid="feed-message-pictures"] img') as HTMLImageElement
      expect(img.getAttribute("src")).toBe("/uploads/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg?w=480")
      // The picture is saved from the card under its own name, without opening a tab.
      const save = container.querySelector('[data-testid="feed-picture-download"]') as HTMLAnchorElement
      expect([save.getAttribute("href"), save.getAttribute("download")]).toEqual(["/uploads/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg?download=1", "11.11.26 Stories-1.jpg"])
      const links = [...container.querySelectorAll('[data-testid="feed-message-files"] a')].map((a) => a.getAttribute("href"))
      expect(links).toEqual(["/uploads/tasks/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf"])
      expect(container.querySelector('[data-testid="feed-message-files"]')?.textContent).toContain("köhnə.png")
      expect(container.textContent).not.toContain("📎")
    } finally { restore() }
  })

  it("the paperclip in the message box sends the file to the task, then the message naming it", async () => {
    const restore = await withFiles([])
    try {
      await open()
      const input = container.querySelector('[data-testid="feed-file-input"]') as HTMLInputElement
      const file = new File(["x"], "afişa.png", { type: "image/png" })
      Object.defineProperty(input, "files", { configurable: true, value: [file] })
      await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
      expect(container.querySelector('[data-testid="feed-pending-files"]')?.textContent).toContain("afişa.png")
      await type(container.querySelector('textarea[placeholder="Сообщение… @ — упомянуть"]') as HTMLTextAreaElement, "Yeni variant")
      await click(byText("button", "Отправить"))
      await flush()
      const posted = calls.filter((c) => c.startsWith("POST /api/v1/tasks/t1/"))
      expect(posted[0]).toMatch(/^POST \/api\/v1\/tasks\/t1\/files/)
      expect(posted[1]).toContain('"content":"Yeni variant\\n📎 afişa.png"')
    } finally { restore() }
  })

  it("a file is removed in two clicks", async () => {
    const restore = await withFiles([])
    try {
      await open()
      await click(container.querySelector('[data-testid="task-file-remove"]'))
      await click(container.querySelector('[data-testid="task-file-remove-confirm"]'))
      await flush()
      expect(calls).toContain("DELETE /api/v1/tasks/t1/files?fileId=f1")
    } finally { restore() }
  })
})

describe("a picture the file gate refused", () => {
  it("asks again after a pause instead of staying broken", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const task = TASK as unknown as { attachments: unknown[] }
    const feed = FEED as unknown as { items: unknown[] }
    const was = { attachments: task.attachments, items: feed.items }
    task.attachments = [{ id: "f1", fileName: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", originalName: "a.jpg", mimeType: "image/jpeg" }]
    feed.items = [{ kind: "message", id: "m1", at: "2026-11-11T08:46:00.000Z", user: { id: "x", name: "X" }, text: "📎 a.jpg", mentions: [], system: false }]
    try {
      await open()
      const img = () => container.querySelector('[data-testid="feed-message-pictures"] img') as HTMLImageElement
      expect(img().getAttribute("src")).toBe("/uploads/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg?w=480")
      await act(async () => { img().dispatchEvent(new Event("error")) })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(img().getAttribute("src")).toBe("/uploads/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg?w=480&try=1")
    } finally {
      task.attachments = was.attachments
      feed.items = was.items
      vi.useRealTimers()
    }
  })

  // Elvira, 2026-11-12: «45 ədəd vinil» comes as a numbered list — one press makes the subtasks.
  it("turns the numbered list of the description into subtasks, and a pasted list too", async () => {
    const was = TASK.description
    TASK.description = "Ölçülər:\n1. 167 (eni) x 88 Ferveks\n2. 122 (eni) x 88 Hedelix\n3. pixel quraşdırılması"
    try {
      await open()
      const split = container.querySelector('[data-testid="task-panel-split-list"]') as HTMLButtonElement
      // «pixel quraşdırılması» is a subtask already: two lines are offered.
      expect(split.textContent).toContain("(2)")
      await click(split)
      await flush()
      expect(calls).toContain('POST /api/v1/tasks/t1/checklist {"titles":["167 (eni) x 88 Ferveks","122 (eni) x 88 Hedelix"]}')

      const add = container.querySelector('[data-testid="task-panel-subtask-input"]') as HTMLInputElement
      const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
      paste.clipboardData = { getData: () => "Story 1\nStory 2\n\nStory 3" }
      await act(async () => { add.dispatchEvent(paste) })
      await flush()
      expect(paste.defaultPrevented).toBe(true)
      expect(calls).toContain('POST /api/v1/tasks/t1/checklist {"titles":["Story 1","Story 2","Story 3"]}')
    } finally {
      TASK.description = was
    }
  })

  // Xayala, 2026-11-12: «qrup halında silmək imkanı olsun»; Ulviyya: «komentdə yazılan mətn redaktə olmur».
  it("removes picked files at once, and its author edits a message", async () => {
    const was = { attachments: TASK.attachments, feed: { ...FEED } }
    TASK.attachments = [
      { id: "f1", fileName: "a.jpg", originalName: "Nivea 1.jpg" },
      { id: "f2", fileName: "b.jpg", originalName: "Nivea 2.jpg" },
      { id: "f3", fileName: "c.xlsx", originalName: "Korega.xlsx" },
    ] as never
    Object.assign(FEED, { me: { id: "s", admin: false } })
    try {
      await open()
      const picks = [...container.querySelectorAll('[data-testid="task-file-pick"]')] as HTMLInputElement[]
      await click(picks[0])
      await click(picks[2])
      await click(container.querySelector('[data-testid="task-files-bulk-remove"]'))
      await click(container.querySelector('[data-testid="task-files-bulk-yes"]'))
      await flush()
      expect(calls).toContain("DELETE /api/v1/tasks/t1/files?fileId=f1&fileId=f3")

      // Sabina's own message («birbaşa reklamları aktivləşdirdim») has «Изменить»; the save sends the new text.
      await click(container.querySelector('[data-message-id="m1"] [data-testid="task-feed-message-edit"]'))
      const editor = container.querySelector('[data-testid="task-feed-message-editor"]') as HTMLTextAreaElement
      await type(editor, "birbaşa reklamları dayandırdım")
      await click(container.querySelector('[data-testid="task-feed-message-save"]'))
      await flush()
      expect(calls).toContain('PATCH /api/v1/tasks/t1/comments/m1 {"content":"birbaşa reklamları dayandırdım"}')
    } finally {
      TASK.attachments = was.attachments
      delete (FEED as { me?: unknown }).me
    }
  })

  // Güllü, 2026-11-13: «при нажатии для скачивания визуала кидает на другую страницу и сохраняет не с
  // наименованием, которое задавал дизайнер» — nine visuals of a post were nine tabs and nine hashes.
  it("saves a file under its author's name, and all of a task's files at one press", async () => {
    const was = TASK.attachments
    TASK.attachments = [
      { id: "f1", fileName: "aaaa.png", originalName: "13.11.2026-Qan-şəkəri-1.png" },
      { id: "f2", fileName: "bbbb.png", originalName: "13.11.2026-Qan-şəkəri-2.png" },
      { id: "f3", fileName: "cccc.mp4", originalName: "reels final.mp4" },
    ] as never
    const saved: string[] = []
    const inFlight = { now: 0, most: 0 }
    const stubbed = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.startsWith("/uploads/tasks/")) return stubbed(url, init)
      calls.push(`GET ${url}`)
      inFlight.now += 1
      inFlight.most = Math.max(inFlight.most, inFlight.now)
      await Promise.resolve()
      inFlight.now -= 1
      return url.includes("cccc") ? new Response("gate", { status: 500 }) : new Response("bytes")
    }))
    const createObjectURL = vi.fn(() => "blob:saved")
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download) })
    try {
      await open()
      // Each file: one link that saves it, named as its author named it — no new tab.
      const links = [...container.querySelectorAll('[data-testid="task-file-download"]')] as HTMLAnchorElement[]
      expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("download"), a.getAttribute("target")])).toEqual([
        ["/uploads/tasks/aaaa.png?download=1", "13.11.2026-Qan-şəkəri-1.png", null],
        ["/uploads/tasks/bbbb.png?download=1", "13.11.2026-Qan-şəkəri-2.png", null],
        ["/uploads/tasks/cccc.mp4?download=1", "reels final.mp4", null],
      ])

      // All of them at one press: one after another, each under its own name; what failed is named.
      const all = container.querySelector('[data-testid="task-files-download-all"]') as HTMLButtonElement
      expect(all.textContent).toBe("Скачать все")
      await click(all)
      for (let i = 0; i < 6; i += 1) await flush()
      expect(calls.filter((c) => c.startsWith("GET /uploads/tasks/"))).toEqual([
        "GET /uploads/tasks/aaaa.png?download=1", "GET /uploads/tasks/bbbb.png?download=1", "GET /uploads/tasks/cccc.mp4?download=1",
      ])
      expect(inFlight.most).toBe(1)
      expect(saved).toEqual(["13.11.2026-Qan-şəkəri-1.png", "13.11.2026-Qan-şəkəri-2.png"])
      expect(container.querySelector('[data-testid="task-files-save-note"]')?.textContent).toBe("Не удалось скачать (1): reels final.mp4")
      expect(all.disabled).toBe(false)

      // With files ticked, the same button saves only those.
      saved.length = 0
      await click(container.querySelectorAll('[data-testid="task-file-pick"]')[1])
      expect(all.textContent).toBe("Скачать выбранные (1)")
      await click(all)
      for (let i = 0; i < 6; i += 1) await flush()
      expect(saved).toEqual(["13.11.2026-Qan-şəkəri-2.png"])
      expect(container.querySelector('[data-testid="task-files-save-note"]')).toBeNull()
    } finally {
      clicked.mockRestore()
      TASK.attachments = was
    }
  })

  // Zeytun, 2026-11-13, an employee on Pharmastore choosing her manager as the reporter: «digər departamentlərdən
  // adamların adlarını görməli deyiləm… bir sürü ad çıxır». The card asked for the whole company.
  it("offers the board's own people for assignee, reporter and co-assignee, and keeps a name already on the task", async () => {
    const task = TASK as unknown as Record<string, unknown>
    const was = { assignedTo: task.assignedTo, assignee: task.assignee }
    // The task is already given to someone who is not on this board.
    Object.assign(task, { assignedTo: "dinara", assignee: { id: "dinara", name: "Dinara Mehdiyeva" } })
    try {
      await open()
      // The people are asked for the task's own board, once it is known which board that is.
      expect(calls.filter((c) => c.includes("/api/v1/users/assignable"))).toEqual(["GET /api/v1/users/assignable?divisionId=b1"])
      const selects = [...container.querySelectorAll("select")] as HTMLSelectElement[]
      const names = (select: HTMLSelectElement) => [...select.options].slice(1).map((o) => o.text)
      const assignee = selects.find((s) => s.value === "dinara")!
      // Her name stays in its field, among the board's three.
      expect(names(assignee)).toEqual(["Aytan Mushkurova", "Dinara Mehdiyeva", "Nazrin Shirinova", "Sabina Hasanova"])
      // «Add a person» offers the board's people only: she is the assignee already, the rest are the board's.
      const add = selects.find((s) => s.options[0]?.text.startsWith("+"))!
      expect(names(add).every((name) => ["Aytan Mushkurova", "Nazrin Shirinova", "Sabina Hasanova"].includes(name))).toBe(true)
      expect(names(add)).not.toContain("Dinara Mehdiyeva")
    } finally {
      Object.assign(task, was)
    }
  })

  // 2026-11-13: the card showed the raw key «taskPanel.board» — the label was never added to the messages.
  it("names the board field in words and never shows a message key", async () => {
    await open()
    const field = container.querySelector('[data-testid="task-panel-board"]') as HTMLSelectElement
    expect(field).not.toBeNull()
    expect([...field.options].map((o) => o.text)).toEqual(["Digital Marketing · Pharmastore", "Digital Marketing · Zeytun"])
    expect(container.textContent).toContain("Доска")
    expect(container.textContent).not.toMatch(/taskPanel\.[a-zA-Z]/u)
  })
})

// Ulviyya (Zeytun), 2026-11-13: «в тасках включите функцию жирный шрифт как в бордио».
describe("the description's formatting", () => {
  // jsdom lays nothing out; the editor asks where the cursor is to scroll it into view.
  beforeEach(() => {
    const none = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
    const box = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
    Object.assign(Range.prototype, { getClientRects: none, getBoundingClientRect: box })
    Object.assign(Element.prototype, { getClientRects: none, scrollIntoView: () => {} })
    Object.assign(document, { elementFromPoint: () => null })
  })

  type Live = { commands: { focus: () => boolean; selectAll: () => boolean; setContent: (html: string) => boolean; setTextSelection: (at: { from: number; to: number }) => boolean; insertContent: (text: string) => boolean }; getHTML: () => string }
  const field = () => container.querySelector('[data-testid="task-description"]') as HTMLElement & { editor: Live }
  const settle = async () => { for (let i = 0; i < 4; i += 1) { await flush(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) } }
  const openCard = async () => { await open(); await settle() }
  const into = async () => { await act(async () => { field().editor.commands.focus(); field().dispatchEvent(new FocusEvent("focusin", { bubbles: true })) }) }
  const leave = async () => {
    await act(async () => { field().dispatchEvent(new FocusEvent("blur")); field().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body })) })
    await settle()
  }
  const patches = () => calls.filter((c) => c.startsWith("PATCH /api/v1/tasks/t1 ")).map((c) => JSON.parse(c.slice("PATCH /api/v1/tasks/t1 ".length)) as Record<string, unknown>)
  const withTask = async (fields: Record<string, unknown>, run: () => Promise<void>) => {
    const task = TASK as unknown as Record<string, unknown>
    const was = Object.fromEntries(Object.keys(fields).map((key) => [key, task[key]]))
    Object.assign(task, fields)
    try { await run() } finally { Object.assign(task, was) }
  }

  it("a stored description shows its bold, italic, underline and lists; the buttons appear only while it is edited", async () => {
    await withTask({ description: "Son tarix — 27 noyabr. yalnız az\n1. Vizual\n2. Sayt", descriptionHtml: "<p><strong>Son tarix — 27 noyabr.</strong> <em>yalnız az</em> <u>Nazrin</u></p><ol><li><p>Vizual</p></li><li><p>Sayt</p></li></ol>" }, async () => {
      await openCard()
      expect(field().querySelector("strong")?.textContent).toBe("Son tarix — 27 noyabr.")
      expect(field().querySelector("em")?.textContent).toBe("yalnız az")
      expect(field().querySelector("u")?.textContent).toBe("Nazrin")
      expect([...field().querySelectorAll("ol li")].map((li) => li.textContent)).toEqual(["Vizual", "Sayt"])
      // Nothing on the title's line until the text is being edited.
      expect(container.querySelector('[data-testid="task-description-toolbar"]')).toBeNull()
      await into()
      const names = [...container.querySelectorAll('[data-testid="task-description-toolbar"] button')].map((b) => b.getAttribute("title"))
      expect(names).toEqual(["Жирный (Ctrl+B)", "Курсив (Ctrl+I)", "Подчёркнутый (Ctrl+U)", "Нумерованный список", "Маркированный список"])
      // Looked at and left: nothing is saved.
      await leave()
      expect(patches()).toEqual([])
      expect(container.querySelector('[data-testid="task-description-toolbar"]')).toBeNull()
    })
  })

  it("selected text made bold is saved as formatting, with the same words as plain text", async () => {
    await withTask({ description: "Banner 1080 x 1920", descriptionHtml: null }, async () => {
      await openCard()
      // A plain description opens as the same text.
      expect(field().textContent).toBe("Banner 1080 x 1920")
      await into()
      await act(async () => { field().editor.commands.setTextSelection({ from: 8, to: 19 }) })
      const bold = container.querySelector('[data-testid="task-description-bold"]') as HTMLButtonElement
      expect(bold.getAttribute("aria-pressed")).toBe("false")
      // The press does not take the cursor out of the text.
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      await act(async () => { bold.dispatchEvent(down) })
      expect(down.defaultPrevented).toBe(true)
      await click(bold)
      expect(field().querySelector("strong")?.textContent).toBe("1080 x 1920")
      expect((container.querySelector('[data-testid="task-description-bold"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true")
      // Nothing is sent while the text is still being edited…
      expect(patches()).toEqual([])
      // …and one save when the field is left.
      await leave()
      expect(patches()).toEqual([{ descriptionHtml: "<p>Banner <strong>1080 x 1920</strong></p>", description: "Banner 1080 x 1920" }])
    })
  })

  it("a list made with the button offers «split into subtasks» at once", async () => {
    await withTask({ description: "", descriptionHtml: null }, async () => {
      await openCard()
      expect(container.querySelector('[data-testid="task-description-placeholder"]')?.textContent).toBe("Добавьте описание…")
      await into()
      await act(async () => { field().editor.commands.setContent("<ol><li><p>167 x 88 Ferveks</p></li><li><p>122 x 88 Hedelix</p></li></ol>") })
      // setContent is the test's way to type; the panel hears it as typing.
      await act(async () => { field().editor.commands.insertContent(" ") })
      await settle()
      expect(container.querySelector('[data-testid="task-description-placeholder"]')).toBeNull()
      expect(container.querySelector('[data-testid="task-panel-split-list"]')?.textContent).toContain("2")
    })
  })

  it("someone who may not change the task reads the formatting and gets no buttons", async () => {
    await withTask({ description: "Vacib", descriptionHtml: "<p><strong>Vacib</strong></p>", you: { mayManage: false, mayDelete: false } }, async () => {
      await openCard()
      expect(field().querySelector("strong")?.textContent).toBe("Vacib")
      expect(field().getAttribute("contenteditable")).toBe("false")
      await act(async () => { field().dispatchEvent(new FocusEvent("focusin", { bubbles: true })) })
      expect(container.querySelector('[data-testid="task-description-toolbar"]')).toBeNull()
    })
  })
})
