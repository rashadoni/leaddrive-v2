import type { MouseEvent } from "react"

// A click on a control inside the row does that control's job, not "open".
const ROW_CONTROLS = "a,button,input,select,textarea,label,summary,[role=button],[role=menuitem],[role=checkbox],[role=dialog],[data-row-click-ignore]"

/**
 * A table row that opens its card on a click anywhere in it (owner-approved
 * mockup, 2026-11-01: «вся строка открывает карточку»). The name stays a real
 * link for the keyboard and for "open in a new tab"; this only widens the
 * target for the mouse. A click that lands on a control in the row, comes from
 * a portal (menus, hints: React bubbles them through the row, the DOM does
 * not), or ends a text selection leaves the page where it is.
 */
export function openRowOnClick(event: MouseEvent<HTMLElement>, href: string, push: (href: string) => void): void {
  if (event.defaultPrevented || event.button !== 0) return
  const target = event.target as Element | null
  if (!target || !event.currentTarget.contains(target) || target.closest(ROW_CONTROLS)) return
  if (window.getSelection()?.toString()) return
  if (event.metaKey || event.ctrlKey) {
    window.open(href, "_blank", "noopener")
    return
  }
  push(href)
}
