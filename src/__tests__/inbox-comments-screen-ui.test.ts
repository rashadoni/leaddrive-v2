// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommentsScreen } from "@/components/inbox-comments/comments-screen"
import type { BoardComment, BoardPost } from "@/lib/inbox/comments-board"

/**
 * The «Комментарии» screen (owner 2026-11-22): what a person sees, what a reply button sends and
 * what the keyword dialog saves. Real React in jsdom with the real Russian messages; the network is
 * a recorder.
 */
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
let container: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string; body: unknown }>

const comment = (id: string, text: string, extra: Partial<BoardComment> = {}): BoardComment => ({
  id, platform: "instagram", conversationId: `conv-${id}`, author: `@${id}`, text, createdAt: "2026-11-22T10:00:00.000Z",
  isThreadReply: false, answered: false, privateReplyAvailable: true, keyword: null, replies: [], ...extra,
})
const post = (key: string, caption: string, comments: BoardComment[]): BoardPost => ({
  key, platform: "instagram", channelConfigId: "ig-1", channelName: "@leaddrive.az", caption, permalink: `https://www.instagram.com/reel/${key}/`,
  imageUrl: null, isReel: true, lastCommentAt: comments[0].createdAt, total: comments.length,
  unanswered: comments.filter((c) => !c.answered).length, comments,
})

const BOARD = {
  posts: [
    post("reel-gece", "GECƏ yazın", [
      comment("aysel", "Qiymət nə qədərdir?"),
      comment("elvin", "GECƏ", {
        answered: true, keyword: "GECƏ", privateReplyAvailable: false,
        replies: [{ id: "r1", text: "Salam!", mode: "private", createdAt: "2026-11-22T10:00:05.000Z", authorName: null, keyword: "GECƏ", fromApp: false }],
      }),
    ]),
    post("reel-say", "SAY yazın", [comment("nigar", "Bu nədir?")]),
  ],
  channels: [{ id: "ig-1", name: "@leaddrive.az" }],
  truncated: false,
  rules: [{ id: "rule-1", keyword: "GECƏ", message: "Salam!", channelConfigId: null, enabled: true }],
  canManageRules: true,
}

function answer(board: unknown, replies: Record<string, { status?: number; body: unknown }> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || "GET"
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const reply = replies[`${method} ${url}`]
    if (reply) return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
    return new Response(JSON.stringify({ success: true, data: board }), { status: 200 })
  }))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  calls = []
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) })
async function render() {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru }, createElement(CommentsScreen))))
  await flush()
}
const all = (testId: string) => Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
const button = (text: string, within: ParentNode = container) =>
  Array.from(within.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text))
async function press(el: Element | undefined) {
  expect(el).toBeDefined()
  await act(async () => (el as HTMLElement).click())
  await flush()
}
async function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("the «Комментарии» section of Omni-Channel", () => {
  it("opens on what still waits for an answer, grouped by post", async () => {
    answer(BOARD)
    await render()

    expect(calls[0]).toMatchObject({ url: "/api/v1/inbox/comments", method: "GET" })
    expect(all("inbox-comments-post").map((p) => p.textContent)).toEqual([
      expect.stringContaining("1 без ответа из 2"),
      expect.stringContaining("1 без ответа из 1"),
    ])
    // «Без ответа» is the first view: the comment the rule already answered is not in it.
    expect(all("inbox-comments-comment").map((c) => c.textContent)).toEqual([expect.stringContaining("Qiymət nə qədərdir?")])
    expect(container.textContent).toContain("Без ответа · 2")
    expect(container.textContent).toContain("С ключевым словом · 1")
    expect(all("inbox-comments-rule-banner")[0].textContent).toContain("Слово «GECƏ» в комментарии")
  })

  it("shows under an answered comment who answered it and how", async () => {
    answer(BOARD)
    await render()
    await press(button("Все"))

    const answered = all("inbox-comments-comment").find((c) => c.dataset.answered === "yes")!
    expect(answered.textContent).toContain("Отправлено в директ автоматически по слову «GECƏ»")
    expect(button("Ответить ещё", answered)).toBeDefined()
  })

  it("sends a public answer through the inbox's own send, naming the comment and the mode", async () => {
    answer(BOARD, { "POST /api/v1/inbox": { status: 201, body: { success: true } } })
    await render()
    const card = all("inbox-comments-comment")[0]
    await press(button("Ответить под постом", card))
    expect(card.textContent).toContain("Ответ появится под постом, его увидят все.")
    await type(card.querySelector("textarea")!, "Direct-ə yazdıq")
    await press(card.querySelector('[data-testid="inbox-comments-send"]')!)

    const sent = calls.find((c) => c.method === "POST" && c.url === "/api/v1/inbox")!
    expect(sent.body).toEqual({
      to: "@aysel", body: "Direct-ə yazdıq", channel: "instagram",
      conversationId: "conv-aysel", commentReply: { messageId: "aysel", mode: "public" },
    })
    // The section is read again after a send, so the comment leaves «Без ответа» by the server's word.
    expect(calls.filter((c) => c.url === "/api/v1/inbox/comments")).toHaveLength(2)
  })

  it("says why an answer did not go, and keeps the text", async () => {
    answer(BOARD, { "POST /api/v1/inbox": { status: 400, body: { error: "outside the customer's messaging window" } } })
    await render()
    const card = all("inbox-comments-comment")[0]
    await press(button("Написать в директ", card))
    await type(card.querySelector("textarea")!, "Salam")
    await press(card.querySelector('[data-testid="inbox-comments-send"]')!)

    expect(card.querySelector('[role="alert"]')?.textContent).toBe("Ответ не отправлен: outside the customer's messaging window")
    expect(card.querySelector("textarea")!.value).toBe("Salam")
  })

  it("answers a Facebook comment through its own route, in Messenger's words", async () => {
    const fb = comment("farid", "Qiymət?", { platform: "facebook", conversationId: null })
    answer({ ...BOARD, posts: [{ ...post("page_1", "Facebook post", [fb]), platform: "facebook" }] }, {
      "POST /api/v1/inbox/comments/facebook/farid/reply": { status: 201, body: { success: true } },
    })
    await render()
    const card = all("inbox-comments-comment")[0]
    // No thread yet: nothing to open.
    expect(card.textContent).not.toContain("Открыть диалог")
    await press(button("Написать в Messenger", card))
    expect(card.textContent).toContain("Facebook даёт один такой ответ")
    await type(card.querySelector("textarea")!, "Salam")
    await press(card.querySelector('[data-testid="inbox-comments-send"]')!)

    const sent = calls.find((c) => c.method === "POST")!
    expect(sent.url).toBe("/api/v1/inbox/comments/facebook/farid/reply")
    expect(sent.body).toEqual({ mode: "private", body: "Salam" })
  })

  it("does not offer Messenger once the Facebook comment's private reply is spent", async () => {
    const fb = comment("farid", "Qiymət?", { platform: "facebook", conversationId: "conv-1", privateReplyAvailable: false })
    answer({ ...BOARD, posts: [{ ...post("page_1", "Facebook post", [fb]), platform: "facebook" }] })
    await render()
    const card = all("inbox-comments-comment")[0]
    expect(button("Написать в Messenger", card)).toBeUndefined()
    expect(card.textContent).toContain("Открыть диалог")
  })

  it("saves the keyword rules as the administrator left them", async () => {
    answer(BOARD, { "PUT /api/v1/inbox/comments/keyword-rules": { body: { success: true, data: { rules: [] } } } })
    await render()
    await press(button("Ключевые слова"))
    await press(button("Добавить правило"))
    const rules = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="inbox-comments-rule"]'))
    expect(rules).toHaveLength(2)
    await type(rules[1].querySelector<HTMLInputElement>('[data-testid="inbox-comments-rule-keyword"]')!, "SAY")
    await type(rules[1].querySelector<HTMLTextAreaElement>('[data-testid="inbox-comments-rule-message"]')!, "Salam, SAY üçün təşəkkürlər")
    await press(document.querySelector('[data-testid="inbox-comments-rules-save"]')!)

    const saved = calls.find((c) => c.method === "PUT")!
    expect(saved.body).toEqual({
      rules: [
        { id: "rule-1", keyword: "GECƏ", message: "Salam!", channelConfigId: null, enabled: true },
        { id: null, keyword: "SAY", message: "Salam, SAY üçün təşəkkürlər", channelConfigId: null, enabled: true },
      ],
    })
  })

  it("does not offer the rules to somebody who may not change them, and explains an empty section", async () => {
    answer({ ...BOARD, posts: [], rules: [], canManageRules: false })
    await render()

    expect(button("Ключевые слова")).toBeUndefined()
    expect(all("inbox-comments-empty")[0].textContent).toContain("Комментариев пока нет")
  })
})
