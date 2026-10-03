// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collectRenderedTextContrast } from "../../scripts/workforce-calendar-contrast-dom.mjs"
import { evaluateTextContrast } from "../../scripts/workforce-calendar-contrast-colors.mjs"

// jsdom geometry/animations/text are supplied; computed CSS is real. Neutral
// content:none supplies its missing pseudo-style fallback. No native Canvas,
// rendering or focus acceptance is established here.
const saved: [object, string, PropertyDescriptor | undefined][] = []
let target: HTMLButtonElement
let sheet: HTMLStyleElement
let oldClass: string
function define(object: object, key: string, value: unknown) {
  saved.push([object, key, Object.getOwnPropertyDescriptor(object, key)])
  Object.defineProperty(object, key, { configurable: true, value })
}
beforeEach(() => {
  oldClass = document.documentElement.className
  document.documentElement.className = "light"
  sheet = document.createElement("style")
  sheet.textContent = `html{color-scheme:light} html,body,main,button,span{
    background-color:rgb(255,255,255);color:rgb(0,0,0);opacity:1;
    visibility:visible;mix-blend-mode:normal;font:400 14px Arial;
    content:none;box-shadow:none;text-shadow:none}`
  document.head.append(sheet)
  document.body.innerHTML = "<main><button><span>Reverse</span> pair</button></main>"
  target = document.querySelector("button")!
  Object.defineProperty(target, "innerText", { get: () => target.textContent })
  define(document, "fonts", { status: "loaded" })
  define(Range.prototype, "getClientRects", () => [new DOMRect(0, 0, 40, 16)])
  define(Element.prototype, "getAnimations", () => [])
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  vi.stubGlobal("devicePixelRatio", 1)
})
afterEach(() => {
  for (const [object, key, descriptor] of saved.splice(0).reverse()) {
    if (descriptor) Object.defineProperty(object, key, descriptor)
    else Reflect.deleteProperty(object, key)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sheet.remove()
  document.body.replaceChildren()
  document.documentElement.className = oldClass
})
const collect = () => collectRenderedTextContrast(target, { expectedTexts: ["Reverse", "pair"] })
function expectJsdomShadowOnly(failures: string[]) {
  // jsdom serializes computed text-shadow:none as a transparent color. This
  // uncertainty remains NOT_PROVEN; it must not invent an inset-shadow failure.
  expect(failures.length).toBeGreaterThan(0)
  expect(failures.every(failure => failure.startsWith("unsupported-textShadow:"))).toBe(true)
}

describe("DOM contrast shadow guards", () => {
  it("reads owners and all ancestors without invented inset shadows", async () => {
    const value = await collect()
    expect(value.textNodes).toBe(2)
    expect(value.renderedFragments).toBe(2)
    expect(value.runs[0].backgroundLayers.map(layer => layer.tag)).toEqual(["SPAN", "BUTTON", "MAIN", "BODY", "HTML"])
    expectJsdomShadowOnly(value.runs.flatMap(run => run.failures))
    expect(evaluateTextContrast(value).status).toBe("NOT_PROVEN")
  })
  it("retains an outset ring without calling it inset", async () => {
    target.style.boxShadow = "0 0 0 3px rgb(0, 0, 255)"
    const value = await collect()
    expect(value.runs[1].backgroundLayers[0].boxShadow).toBe(getComputedStyle(target).boxShadow)
    expectJsdomShadowOnly(value.runs.flatMap(run => run.failures))
    expect(evaluateTextContrast(value).status).toBe("NOT_PROVEN")
  })
  it.each(["span", "main"])("rejects inset on %s", async selector => {
    document.querySelector<HTMLElement>(selector)!.style.boxShadow = "inset 0 0 4px rgb(0,0,0)"
    const value = await collect()
    expect(value.runs[0].failures.some(failure => failure.startsWith("unsupported-inset-shadow:"))).toBe(true)
    expect(evaluateTextContrast(value).status).toBe("NOT_PROVEN")
  })
  it.each(["opacity:0.5", "filter:blur(1px)"])("rejects %s", async css => {
    target.querySelector("span")!.setAttribute("style", css)
    expect(evaluateTextContrast(await collect()).status).toBe("NOT_PROVEN")
  })
  it("rejects unloaded fonts and wrong theme", async () => {
    define(document, "fonts", { status: "loading" })
    expect(evaluateTextContrast(await collect()).status).toBe("NOT_PROVEN")
    define(document, "fonts", { status: "loaded" })
    document.documentElement.className = "dark"
    expect(evaluateTextContrast(await collect()).status).toBe("NOT_PROVEN")
  })
  it("preserves styles, DOM and focus", async () => {
    const before = document.body.outerHTML
    const focus = document.activeElement
    await collect()
    expect(document.body.outerHTML).toBe(before)
    expect(document.activeElement).toBe(focus)
  })
})
