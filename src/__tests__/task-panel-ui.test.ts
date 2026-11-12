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
    if (url === "/api/v1/users/assignable") return json([{ id: "s", name: "Sabina Hasanova" }, { id: "n", name: "Nazrin Shirinova" }, { id: "a", name: "Aytan Mushkurova" }])
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
})

