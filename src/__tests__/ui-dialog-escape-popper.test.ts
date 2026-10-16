// @vitest-environment jsdom
/**
 * Escape inside a list, popover or menu opened in a dialog closes that list,
 * not the dialog. The dialog listens in the capture phase, so until 2026-10-16
 * Escape in the specialty list of an agent's «Clients» tab closed the whole
 * agent dialog and took everything typed in it along.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))

import { Dialog, DialogContent } from "@/components/ui/dialog"

let root: Root
let host: HTMLDivElement
let popper: HTMLDivElement
const onOpenChange = vi.fn()

function escape(target: Element) {
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })) })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  onOpenChange.mockReset()
  host = document.createElement("div")
  document.body.appendChild(host)
  // Where Radix puts an open popover: outside the dialog, in <body>.
  popper = document.createElement("div")
  popper.setAttribute("data-radix-popper-content-wrapper", "")
  popper.innerHTML = '<label><input data-testid="option" type="checkbox"></label>'
  document.body.appendChild(popper)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(Dialog, { open: true, onOpenChange }, createElement(DialogContent, null, createElement("input", { "data-testid": "field" }))))
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  popper.remove()
})

describe("Escape in a dialog", () => {
  it("leaves the dialog open when it is pressed in a list opened from it", () => {
    escape(popper.querySelector('[data-testid="option"]')!)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("still closes the dialog everywhere else", () => {
    escape(document.querySelector('[data-testid="field"]')!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
