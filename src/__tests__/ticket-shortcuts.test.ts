// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTicketShortcuts } from "@/hooks/use-ticket-shortcuts"

type Actions = Parameters<typeof useTicketShortcuts>[0]
function Probe({ actions }: { actions: Actions }) {
  useTicketShortcuts(actions)
  return null
}

describe("ticket macro keyboard shortcuts", () => {
  let root: Root | null
  let host: HTMLDivElement
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    if (root) act(() => root?.unmount())
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })
  function render(actions: Actions) {
    act(() => root?.render(createElement(Probe, { actions })))
  }
  function press(options: KeyboardEventInit, target: HTMLElement = document.body) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options })
    act(() => { target.dispatchEvent(event) })
    return event
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("uses saved Alt+%i binding independently of ordinal", (digit) => {
    const other = vi.fn()
    const bound = vi.fn()
    render({ macros: [{ execute: other }, { shortcutKey: "Alt+" + digit, execute: bound }] })
    const event = press({ key: String(digit), code: "Digit" + digit, altKey: true })
    expect(bound).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it("retains saved binding after reordering and preserves legacy Ctrl ordinal", () => {
    const bound = vi.fn()
    const other = vi.fn()
    const saved = { shortcutKey: "Alt+1", execute: bound }
    render({ macros: [{ execute: other }, saved] })
    press({ key: "2", ctrlKey: true })
    expect(bound).toHaveBeenCalledTimes(1)
    render({ macros: [saved, { execute: other }] })
    press({ key: "1", altKey: true })
    press({ key: "2", ctrlKey: true })
    expect(bound).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it("recognizes the physical digit with a macOS Option-generated symbol", () => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+1", execute }] })
    expect(press({ key: "¡", code: "Digit1", altKey: true }).defaultPrevented).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("does not fall back to ordinal for an unbound Alt number", () => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+2", execute }] })
    expect(press({ key: "1", code: "Digit1", altKey: true }).defaultPrevented).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(["input", "textarea", "select", "div"])("does not capture while editing %s", (tag) => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+1", execute }] })
    const target = document.createElement(tag)
    if (tag === "div") Object.defineProperty(target, "isContentEditable", { value: true })
    document.body.append(target)
    expect(press({ key: "1", altKey: true }, target).defaultPrevented).toBe(false)
    expect(press({ key: "1", ctrlKey: true }, target).defaultPrevented).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it("honors the disabled guard while preview or confirmation is active", () => {
    const execute = vi.fn()
    render({ enabled: false, macros: [{ shortcutKey: "Alt+1", execute }] })
    expect(press({ key: "1", altKey: true }).defaultPrevented).toBe(false)
    expect(press({ key: "1", ctrlKey: true }).defaultPrevented).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])("ignores Alt combined with another modifier: %j", (modifier) => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+1", execute }] })
    expect(press({ key: "1", altKey: true, ...modifier }).defaultPrevented).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it("does not capture AltGraph character entry", () => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+1", execute }] })
    const event = new KeyboardEvent("keydown", { key: "1", altKey: true, bubbles: true, cancelable: true })
    vi.spyOn(event, "getModifierState").mockImplementation((modifier) => modifier === "AltGraph")
    act(() => { document.body.dispatchEvent(event) })
    expect(execute).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("removes its listener when the ticket unmounts", () => {
    const execute = vi.fn()
    render({ macros: [{ shortcutKey: "Alt+1", execute }] })
    act(() => root?.unmount())
    root = null
    press({ key: "1", altKey: true })
    expect(execute).not.toHaveBeenCalled()
  })
})
