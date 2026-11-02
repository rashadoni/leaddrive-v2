import { act } from "react"

/**
 * Opens the hint of `trigger` the way a keyboard does — focus — and returns its
 * sentence, or null when the element has no hint. The bubble is portalled into
 * <body>, so it is looked for there; it is closed again before returning.
 *
 * Radix measures the bubble through ResizeObserver, which jsdom has not got,
 * and the hint stays closed without one (src/components/hint.tsx). A stand-in
 * is put up for the reading and taken down after it, so the rest of a test
 * file runs as it did, with every hint closed.
 */
export async function readHint(trigger: Element | null | undefined): Promise<string | null> {
  if (!trigger) return null
  const scope = globalThis as { ResizeObserver?: unknown }
  const installed = !scope.ResizeObserver
  if (installed) {
    scope.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  try {
    const element = trigger as HTMLElement
    await act(async () => { element.focus() })
    const bubble = document.body.querySelector('[data-testid="hint-bubble"]')
    // Radix repeats the sentence for screen readers in a hidden role="tooltip";
    // that copy is the sentence alone, without the arrow.
    const text = bubble?.querySelector('[role="tooltip"]')?.textContent ?? null
    await act(async () => { element.blur() })
    return text
  } finally {
    if (installed) delete scope.ResizeObserver
  }
}
