// @vitest-environment jsdom
/**
 * A picture on the clipboard goes into the inbox reply as an attachment (owner, 2026-11-27: «сделай
 * функцию чтоб можно было из буфер обмена вставлять фото. сейчас мне приходится сохранять фото а потом
 * выбирать через файл»).
 *
 * The real inbox page on real React with the network stubbed: a pasted screenshot is uploaded through
 * the same route as the paperclip, shows as the attachment chip and leaves with the reply; a paste that
 * carries text (cells of a spreadsheet come with a picture of themselves) stays a text paste and
 * uploads nothing.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages

// The same session, router and translator on every render, as the app hands
// them: a fresh object per render re-fires the page's effects keyed on them.
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

const now = new Date().toISOString()
const conversation = (id: string, name: string, body: string) => ({
  socialConversationId: id,
  contactId: null,
  contactName: name,
  channels: ["instagram"],
  lastChannel: "instagram",
  lastMessageAt: now,
  messageCount: 1,
  unreadCount: 0,
  status: "open",
  participants: [],
  messages: [{ id: `${id}-m1`, direction: "inbound", channelType: "instagram", from: name, to: "fanumsec", body, status: "received", createdAt: now }],
})
const CONVERSATIONS = [
  conversation("sc-mirvari", "@mirvari.decor", "Nişan dekoru neçəyədir?"),
  conversation("sc-parviz", "@parviz.aliyev", "Gerek ele Parviz qoyadim adini"),
]

let container: HTMLDivElement
let root: Root
let posts: { url: string; body: Record<string, unknown> }[]
let uploads: File[]

const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } })

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
  window.history.replaceState(null, "", "/inbox?conversation=sc-mirvari")
  posts = []
  uploads = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST" && url === "/api/v1/inbox/upload") {
      const file = (init.body as FormData).get("file") as File
      uploads.push(file)
      return json({ url: "/uploads/inbox-media/org-1/pasted.png", name: file.name, type: file.type })
    }
    if (init?.method === "POST" && url === "/api/v1/inbox") {
      posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return json({ id: "sent-1" })
    }
    if (url === "/api/v1/inbox" || url.startsWith("/api/v1/inbox?")) {
      return json({ conversations: CONVERSATIONS, channels: [], stats: { totalMessages: 2, inbound: 2, outbound: 0, conversations: 2 } })
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

const box = () => container.querySelector<HTMLTextAreaElement>('[data-testid="inbox-reply-box"]')!

/** The clipboard as Chrome hands it to a paste: its text, and its files as items. */
function clipboard(text: string, files: File[]) {
  return {
    getData: (format: string) => (format === "text/plain" ? text : ""),
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    files,
  }
}

async function paste(text: string, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: clipboard(text, files) })
  await act(async () => { box().dispatchEvent(event) })
  await flush()
  return event
}

const screenshot = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" })

describe("inbox reply — a picture pasted from the clipboard", () => {
  it("is uploaded like a picked file, shows as the attachment and leaves with the reply", async () => {
    await renderInbox()
    const event = await paste("", [screenshot()])

    expect(event.defaultPrevented, "the picture is not pasted into the text").toBe(true)
    expect(uploads.map((f) => [f.name, f.type])).toEqual([["image.png", "image/png"]])
    expect(container.textContent, "the attachment chip").toContain("image.png")
    expect(box().value).toBe("")

    await act(async () => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    await flush()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.attachmentUrl).toBe("/uploads/inbox-media/org-1/pasted.png")
    expect(posts[0].body.conversationId).toBe("sc-mirvari")
  })

  it("stays a text paste when the clipboard carries text with the picture", async () => {
    await renderInbox()
    const event = await paste("Qiymət\t25 AZN", [screenshot()])

    expect(event.defaultPrevented, "the browser pastes the text").toBe(false)
    expect(uploads).toHaveLength(0)
  })
})
