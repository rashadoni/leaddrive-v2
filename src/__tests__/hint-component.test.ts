// @vitest-environment jsdom
/**
 * The hint under the cursor (src/components/hint.tsx).
 *
 * Owner, 2026-10-15, on the live map: «тут нет подсказок при наведении, и
 * вообще подсказок в модуле очень мало». The browser's own `title` was on some
 * buttons — it opens after a second of a still cursor and he never saw one.
 * The hint opens on hover and on keyboard focus, says one sentence, and adds
 * nothing to the page where it has nothing to say.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Hint, HintValue } from "@/components/hint"
import { readHint } from "./helpers/hint"

let root: Root
let container: HTMLDivElement
const draw = async (element: ReturnType<typeof createElement>) => {
  await act(async () => { root.render(element) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("a hint", () => {
  it("says its sentence when the button under it is reached, and only then", async () => {
    await draw(createElement(Hint, { text: "Откроет историю за сегодня.", children: createElement("button", { type: "button" }, "История") }))
    const button = container.querySelector("button")!
    expect(document.body.querySelector('[data-testid="hint-bubble"]')).toBeNull()
    expect(await readHint(button)).toBe("Откроет историю за сегодня.")
    // Closed again once the focus leaves.
    expect(document.body.querySelector('[data-testid="hint-bubble"]')).toBeNull()
    // Not the browser's grey title.
    expect(button.hasAttribute("title")).toBe(false)
  })

  it("adds nothing where it has nothing to say", async () => {
    await draw(createElement(Hint, { text: "", children: createElement("button", { type: "button" }, "История") }))
    expect(container.innerHTML).toBe('<button type="button">История</button>')
    expect(await readHint(container.querySelector("button"))).toBeNull()
  })

  it("explains a disabled button too: the hint is put on a span around it, which a pointer and a keyboard reach", async () => {
    await draw(createElement(Hint, { text: "Не чаще раза в 15 с.", wrap: true, children: createElement("button", { type: "button", disabled: true }, "Обновить") }))
    const span = container.firstElementChild as HTMLElement
    expect(span.tagName).toBe("SPAN")
    expect(span.getAttribute("tabindex")).toBe("0")
    expect(span.querySelector("button")?.disabled).toBe(true)
    expect(await readHint(span)).toBe("Не чаще раза в 15 с.")
  })

  it("stays closed, without an error, where the browser cannot measure it", async () => {
    await draw(createElement(Hint, { text: "Откроет историю за сегодня.", children: createElement("button", { type: "button" }, "История") }))
    expect((globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBeUndefined()
    const button = container.querySelector("button")!
    await act(async () => { button.focus() })
    expect(document.body.querySelector('[data-testid="hint-bubble"]')).toBeNull()
  })
})

describe("a value with a hint", () => {
  it("is marked by a dotted underline before anyone hovers, and is reached by the keyboard in the page's order", async () => {
    await draw(createElement(HintValue, { text: "Точность GPS: до 12 м от точки.", children: "±12 m" }))
    const value = container.querySelector("[data-hint-value]") as HTMLElement
    expect(value.className).toContain("decoration-dotted")
    expect(value.className).toContain("cursor-help")
    expect(value.getAttribute("tabindex")).toBe("0")
    expect(await readHint(value)).toBe("Точность GPS: до 12 м от точки.")
  })

  it("is plain text when there is nothing to explain", async () => {
    await draw(createElement(HintValue, { text: null, className: "font-bold", children: "±12 m" }))
    expect(container.innerHTML).toBe('<span class="font-bold">±12 m</span>')
  })
})
