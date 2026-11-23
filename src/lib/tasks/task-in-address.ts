"use client"

import { useEffect, useRef } from "react"

/**
 * The open task card stands in the address, so the address can be sent to a
 * colleague.
 *
 * Zeytun, 2026-11-23: «göndərdiyin linklərin heç biri məndə açılmır, ümumi bura
 * atır». The card opens over the board and the address stayed the board's
 * (`/boards/<id>?mine=1`): whoever copied it from the browser sent the board,
 * with their own «only mine» filter on it.
 *
 * While a card is open the address is `<page>?task=<id>` and nothing else — a
 * person's filters are theirs, not part of the link. Closing the card puts the
 * address back as it was. Opening such an address opens the card.
 */
export const TASK_PARAM = "task"

export function taskLink(origin: string, pathname: string, taskId: string): string {
  return `${origin}${pathname}?${TASK_PARAM}=${encodeURIComponent(taskId)}`
}

/** `enabled`: false while the page does not yet know it is the one to show the card. */
export function useTaskInAddress(openTaskId: string | null, openTask: (id: string) => void, enabled = true): void {
  const arrived = useRef(false)
  // The card the address asked for, until the page has it open: the effect runs
  // twice on mounting in development, and must not read «no card» as «closed».
  const opening = useRef<string | null>(null)
  const beforeCard = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const url = new URL(window.location.href)
    const named = url.searchParams.get(TASK_PARAM)
    if (!arrived.current) {
      arrived.current = true
      if (named && !openTaskId) {
        opening.current = named
        openTask(named)
        return
      }
    }
    if (opening.current) {
      if (openTaskId !== opening.current) return
      opening.current = null
    }
    if (openTaskId === named) return
    if (openTaskId) {
      if (!named) beforeCard.current = url.search
      window.history.replaceState(null, "", `${url.pathname}?${TASK_PARAM}=${encodeURIComponent(openTaskId)}`)
      return
    }
    url.searchParams.delete(TASK_PARAM)
    const back = beforeCard.current ?? url.search
    beforeCard.current = null
    window.history.replaceState(null, "", `${url.pathname}${back}`)
  }, [enabled, openTaskId, openTask])
}
