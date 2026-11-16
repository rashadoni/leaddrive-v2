// @vitest-environment jsdom
/**
 * Instagram comments on the inbox screen (owner, 2026-11-16, from a mock-up: a comment lands in the
 * conversation with its author, as a card with the post; the answer goes to Direct by default, or
 * publicly under the post).
 *
 * The real inbox page on real React, in Azerbaijani, with the network stubbed: what the operator sees
 * (the card, its «Postu aç» link, the «Şərh» mark in the list, the «Şərhlər» view) and what the
 * composer sends (which comment, and where the answer goes).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages

const stable = vi.hoisted(() => ({
  session: { data: { user: { id: "u-me", role: "admin" } }, status: "authenticated" },
  router: { push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} },
}))
vi.mock("next-auth/react", () => ({ useSession: () => stable.session }))
vi.mock("next/navigation", () => ({
  useRouter: () => stable.router,
  usePathname: () => "/inbox",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const translate = (namespace: string) => actual.createTranslator({
    locale: "az", messages: az as never, namespace: (namespace || undefined) as never, onError: () => {},
  })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)!
    },
    useLocale: () => "az",
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import InboxV2Page from "@/app/(dashboard)/inbox/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const COMMENT_TEXT = "Qiyməti neçədir? Bakıda haradan almaq olar?"

function commentConversation(commentAt: string, extra: Record<string, unknown>[] = []) {
  return {
    socialConversationId: "sc-ayten",
    contactId: null,
    contactName: "Aytən Məmmədova",
    channels: ["instagram"],
    lastChannel: "instagram",
    lastMessage: COMMENT_TEXT,
    lastMessageAt: commentAt,
    lastDirection: "inbound",
    lastIsComment: true,
    hasComment: true,
    messageCount: 1 + extra.length,
    unreadCount: 1,
    status: "open",
    participants: [],
    messages: [
      {
        id: "m-comment", direction: "inbound", channelType: "instagram", from: "4621", to: "1784",
        body: COMMENT_TEXT, status: "delivered", createdAt: commentAt, conversationId: "sc-ayten",
        metadata: {
          senderId: "4621",
          igComment: {
            commentId: "17900000000000001", mediaId: "18047", username: "ayten.m",
            caption: "Noreva Xerodiane AP+ — quru dəri üçün krem", permalink: "https://www.instagram.com/p/Cx1/",
            imageUrl: "/uploads/inbox/org/post.jpg",
          },
        },
      },
      ...extra,
    ],
  }
}
const DIRECT_ONLY = {
  socialConversationId: "sc-nigar", contactId: null, contactName: "Nigar Həsənova", channels: ["instagram"],
  lastChannel: "instagram", lastMessage: "Salam", lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
  messageCount: 1, unreadCount: 0, status: "open", participants: [],
  messages: [{ id: "m-n1", direction: "inbound", channelType: "instagram", from: "77", to: "1784", body: "Salam", status: "delivered", createdAt: new Date(Date.now() - 3_600_000).toISOString(), conversationId: "sc-nigar" }],
}

let conversations: unknown[] = []
let container: HTMLDivElement
let root: Root
let posts: Record<string, unknown>[]

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  window.history.replaceState(null, "", "/inbox?conversation=sc-ayten")
  posts = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST" && url === "/api/v1/inbox") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return json({ id: "sent-1" })
    }
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({ conversations, channels: [], stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 } })
    }
    if (url.endsWith("/convert-to-lead")) return json({ candidates: [], recommendedAssigneeId: null, draft: null })
    return json([])
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}
async function renderInbox() {
  await act(async () => { root.render(createElement(InboxV2Page)) })
  await flush()
}
const q = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
async function click(el: HTMLElement) {
  await act(async () => { el.click() })
  await flush()
}
async function typeAndSend(text: string) {
  const box = q("inbox-reply-box") as HTMLTextAreaElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(box, text)
    box.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) })
  await flush()
}

describe("an Instagram comment in the inbox", () => {
  it("shows as a card with the post and a link to it, and the list marks the conversation", async () => {
    conversations = [commentConversation(new Date().toISOString()), DIRECT_ONLY]
    await renderInbox()

    const card = q("inbox-instagram-comment")!
    expect(card.textContent).toContain("Postun altında şərh")
    expect(card.textContent).toContain("Noreva Xerodiane AP+")
    expect(card.textContent).toContain(COMMENT_TEXT)
    expect(card.querySelector("img")?.getAttribute("src")).toBe("/uploads/inbox/org/post.jpg")
    const link = q("inbox-comment-open-post") as HTMLAnchorElement
    expect(link.textContent).toContain("Postu aç")
    expect(link.getAttribute("href")).toBe("https://www.instagram.com/p/Cx1/")
    expect(link.getAttribute("target")).toBe("_blank")

    // In the list: the «Şərh» mark on this conversation only, and the preview says it is a comment.
    expect(container.querySelectorAll('[data-testid="conversation-comment-chip"]')).toHaveLength(1)
    const previews = [...container.querySelectorAll('[data-testid="inbox-conversation-preview"]')].map((p) => p.textContent)
    expect(previews).toContain(`Şərh: ${COMMENT_TEXT}`)
    // The «Şərhlər» view is there, because a comment is.
    expect(container.querySelector('[data-view="comments"]')?.textContent).toContain("Şərhlər")
  })

  it("answers in Direct by default, naming the comment", async () => {
    conversations = [commentConversation(new Date().toISOString())]
    await renderInbox()

    expect(q("inbox-comment-mode-direct")?.getAttribute("aria-pressed")).toBe("true")
    expect(q("inbox-comment-mode-public")?.getAttribute("aria-pressed")).toBe("false")
    expect(q("inbox-comment-reply-target")?.textContent).toContain(`Cavab verilən şərh: «${COMMENT_TEXT}»`)

    await typeAndSend("Aptek ünvanlarını göndərirəm")

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      channel: "instagram", conversationId: "sc-ayten", body: "Aptek ünvanlarını göndərirəm",
      commentReply: { messageId: "m-comment", mode: "direct" },
    })
  })

  it("answers under the post when the operator picks «Şərhə cavab»", async () => {
    conversations = [commentConversation(new Date().toISOString())]
    await renderInbox()

    await click(q("inbox-comment-mode-public")!)
    expect(q("inbox-comment-mode-public")?.getAttribute("aria-pressed")).toBe("true")
    await typeAndSend("Qiyməti 24 AZN")

    expect(posts[0]).toMatchObject({ commentReply: { messageId: "m-comment", mode: "public" } })
  })

  it("locks Direct, with the reason in words, when Meta would refuse it — and answers under the post", async () => {
    // Eight days old: past the one private reply Meta allows, and the person never wrote in Direct.
    conversations = [commentConversation(new Date(Date.now() - 8 * 24 * 3_600_000).toISOString())]
    await renderInbox()

    expect(q("inbox-comment-mode-direct")).toBeNull()
    expect(q("inbox-comment-mode-direct-locked")?.textContent).toContain("Direct-ə yaz")
    expect(q("inbox-comment-reply-target")?.textContent).toContain("Direct bağlıdır")
    expect(q("inbox-comment-mode-public")?.getAttribute("aria-pressed")).toBe("true")

    await typeAndSend("Qiyməti 24 AZN")
    expect(posts[0]).toMatchObject({ commentReply: { mode: "public" } })
  })

  it("keeps Direct open when the person wrote in Direct after an old comment's private reply was spent", async () => {
    const old = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString()
    const dm = new Date(Date.now() - 3_600_000).toISOString()
    // Their newest message is a Direct one: the reply answers it, no comment choice at all.
    conversations = [{
      ...commentConversation(old, [{
        id: "m-dm", direction: "inbound", channelType: "instagram", from: "4621", to: "1784",
        body: "Salam, ünvanı yazın", status: "delivered", createdAt: dm, conversationId: "sc-ayten", metadata: {},
      }]),
      lastMessageAt: dm, lastIsComment: false,
    }]
    await renderInbox()

    expect(q("inbox-comment-reply")).toBeNull()
    await typeAndSend("Nərimanov filialı")
    expect(posts[0]).not.toHaveProperty("commentReply")
  })

  it("a conversation without comments shows no comment choice and no «Şərhlər» view", async () => {
    conversations = [DIRECT_ONLY]
    window.history.replaceState(null, "", "/inbox?conversation=sc-nigar")
    await renderInbox()

    expect(q("inbox-comment-reply")).toBeNull()
    expect(container.querySelector('[data-view="comments"]')).toBeNull()
  })
})
