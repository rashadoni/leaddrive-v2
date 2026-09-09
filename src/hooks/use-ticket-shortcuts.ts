"use client"

import { useEffect, useCallback } from "react"

interface ShortcutActions {
  onReply?: () => void
  onInternalNote?: () => void
  onAssignToMe?: () => void
  onEscalate?: () => void
  onClose?: () => void
  onNextTicket?: () => void
  onPrevTicket?: () => void
  onCopyNumber?: () => void
  onToggleShortcuts?: () => void
  macros?: Array<{ execute: () => void }>
}

export interface ShortcutDef {
  keys: string
  description: string
}

export const TICKET_SHORTCUTS: ShortcutDef[] = [
  { keys: "R", description: "Reply" },
  { keys: "N", description: "Internal Note" },
  { keys: "A", description: "Assign to Me" },
  { keys: "E", description: "Escalate" },
  { keys: "X", description: "Close Ticket" },
  { keys: "J / →", description: "Next Ticket" },
  { keys: "K / ←", description: "Previous Ticket" },
  { keys: "C", description: "Copy Ticket #" },
  { keys: "Ctrl+1-9", description: "Apply Macro" },
  { keys: "?", description: "Toggle Shortcuts" },
]

export function useTicketShortcuts(actions: ShortcutActions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture when typing in inputs
    const target = e.target as HTMLElement
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable) {
      if (e.key === "Escape") {
        target.blur()
        e.preventDefault()
      }
      return
    }

    // "?" — toggle shortcuts help (works without modifiers)
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      actions.onToggleShortcuts?.()
      return
    }

    // Ctrl+1 through Ctrl+9 — apply macro
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key) - 1
      if (actions.macros?.[idx]) {
        e.preventDefault()
        actions.macros[idx].execute()
      }
      return
    }

    // Bare key shortcuts (no Ctrl, no Alt, no Meta)
    if (e.ctrlKey || e.altKey || e.metaKey) return

    switch (e.key.toLowerCase()) {
      case "r":
        e.preventDefault()
        actions.onReply?.()
        break
      case "n":
        e.preventDefault()
        actions.onInternalNote?.()
        break
      case "a":
        e.preventDefault()
        actions.onAssignToMe?.()
        break
      case "e":
        e.preventDefault()
        actions.onEscalate?.()
        break
      case "x":
        e.preventDefault()
        actions.onClose?.()
        break
      case "j":
      case "arrowright":
        e.preventDefault()
        actions.onNextTicket?.()
        break
      case "k":
      case "arrowleft":
        e.preventDefault()
        actions.onPrevTicket?.()
        break
      case "c":
        e.preventDefault()
        actions.onCopyNumber?.()
        break
    }
  }, [actions])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])
}
