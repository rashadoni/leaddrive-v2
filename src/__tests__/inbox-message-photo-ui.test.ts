// @vitest-environment jsdom
/**
 * A photo a customer sends through a social channel opens on the whole window (2026-11-19).
 *
 * Client report: «в омниканале фотография, которую присылают по соцсетям, не увеличивается при
 * нажатии». The bubble held a bare `<img>` cut to 192 px with `object-cover` and no handler, so a
 * click did nothing. Rendered on real React in jsdom: the click opens a window with the whole photo,
 * the original is linked, Escape and «Закрыть» close it — and the conversation uses this thumbnail.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const translate = (namespace: string) => actual.createTranslator({
    locale: "ru", messages: ru as never, namespace: (namespace || undefined) as never, onError: () => {},
  })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)!
    },
    useLocale: () => "ru",
  }
})

import { MessagePhoto } from "@/components/inbox/message-photo"

const SRC = "/api/v1/inbox/media/abc123.jpg"
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

function render() {
  act(() => root.render(createElement(MessagePhoto, { src: SRC })))
}

const full = () => document.querySelector<HTMLImageElement>('[data-testid="inbox-photo-full"]')
const thumb = () => document.querySelector<HTMLButtonElement>('[data-testid="inbox-photo-thumb"]')!

describe("a photo in an inbox conversation", () => {
  it("is a button, and nothing is open before the click", () => {
    render()
    expect(thumb().tagName).toBe("BUTTON")
    expect(thumb().getAttribute("aria-label")).toBe("Открыть фото")
    expect(thumb().querySelector("img")?.getAttribute("src")).toBe(SRC)
    expect(full()).toBeNull()
  })

  it("opens the whole photo, uncropped, with a link to the original", () => {
    render()
    act(() => thumb().click())
    const img = full()
    expect(img).not.toBeNull()
    expect(img!.getAttribute("src")).toBe(SRC)
    expect(img!.className).toContain("object-contain")
    expect(img!.className).not.toContain("object-cover")
    const original = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Открыть оригинал"))
    expect(original?.getAttribute("href")).toBe(SRC)
    expect(original?.getAttribute("target")).toBe("_blank")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Фото")
  })

  it("closes with «Закрыть» and with Escape", () => {
    render()
    act(() => thumb().click())
    const close = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Закрыть")!
    act(() => close.click())
    expect(full()).toBeNull()

    act(() => thumb().click())
    expect(full()).not.toBeNull()
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect(full()).toBeNull()
  })

  it("is what the conversation draws for an image message", () => {
    const page = readFileSync("src/app/(dashboard)/inbox/page.tsx", "utf8")
    const branch = page.slice(page.indexOf("isImagePreview(m.messageType, m.mediaUrl) ?"))
    expect(branch.slice(0, 300)).toContain("<MessagePhoto src={m.mediaUrl} />")
  })
})
