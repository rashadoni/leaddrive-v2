"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

export const VOICE_STATUS_LAYER_ID = "dashboard-voice-status-layer"

/**
 * The status line under an in-flow microphone (header or AI bar).
 *
 * Presentation only — it shows whatever text the voice control hands it.
 *
 * It cannot hang off the button with `absolute top-full`: the header has a
 * backdrop filter, which makes it a stacking context, and <main> is painted
 * after it, so the line ended up underneath the page. Raising the whole header
 * (`relative z-30`) fixed that but also lifted it over dialogs that render in
 * place (ui/dialog.tsx, `fixed z-[60]`) inside a positioned page wrapper.
 *
 * So the line is portalled into an empty layer that the dashboard shell keeps
 * inside its own stacking context, and placed under its anchor with
 * `fixed z-50`: above page content, below the in-place dialogs that share
 * that context. Not <body>: the shell root is `z-[2]`, so anything at body
 * level would sit above every in-place dialog. Body is only the fallback for
 * a page without the shell.
 */
export function VoiceInlineStatus({ className, children }: { className: string; children: ReactNode }) {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [placement, setPlacement] = useState<{ layer: HTMLElement; top: number; right: number } | null>(null)

  useEffect(() => {
    const anchor = markerRef.current?.parentElement
    if (!anchor) return
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      setPlacement({
        layer: document.getElementById(VOICE_STATUS_LAYER_ID) ?? document.body,
        top: Math.round(rect.bottom + 8),
        right: Math.max(8, Math.round(window.innerWidth - rect.right)),
      })
    }
    const frame = window.requestAnimationFrame(place)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [])

  return (
    <>
      <span ref={markerRef} hidden />
      {placement
        ? createPortal(
          <span
            data-testid="voice-inline-status"
            aria-live="polite"
            className={`fixed z-50 ${className}`}
            style={{ top: placement.top, right: placement.right }}
          >
            {children}
          </span>,
          placement.layer,
        )
        : null}
    </>
  )
}
