"use client"

import { useEffect } from "react"
import {
  flushPharmacyPromotionOutbox,
  sendPharmacyPromotionOutboxRequests,
} from "@/lib/mtm/pharmacy-promotion-outbox"

function syncContext(payload: unknown): { scopeKey: string; canFieldExecute: boolean } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const candidate = data as { scopeKey?: unknown; canFieldExecute?: unknown }
  if (
    typeof candidate.scopeKey !== "string"
    || candidate.scopeKey.length < 16
    || candidate.scopeKey.length > 128
    || typeof candidate.canFieldExecute !== "boolean"
  ) return null
  return { scopeKey: candidate.scopeKey, canFieldExecute: candidate.canFieldExecute }
}

/**
 * Dashboard-level drain: queued field operations keep syncing after the user
 * leaves the execution detail page. The server-derived scope partitions the
 * IndexedDB queue across tenant/principal changes.
 */
export function PharmacyPromotionOutboxSync({ sessionKey }: { sessionKey: string }) {
  useEffect(() => {
    if (!sessionKey) return
    const controller = new AbortController()
    let context: { scopeKey: string; canFieldExecute: boolean } | null = null
    let contextRefreshAfter = 0
    let activeContextRequest: Promise<void> | null = null

    const refreshContext = () => {
      if (activeContextRequest) return activeContextRequest
      activeContextRequest = fetch("/api/v1/mtm/pharmacy-promotion-executions/sync-context", {
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok || controller.signal.aborted) {
          context = null
          contextRefreshAfter = 0
          return
        }
        context = syncContext(await response.json().catch(() => null))
        contextRefreshAfter = Date.now() + 5 * 60_000
      }).catch(() => {
        context = null
        contextRefreshAfter = 0
      }).finally(() => {
        activeContextRequest = null
      })
      return activeContextRequest
    }

    const wake = async () => {
      if (!navigator.onLine || controller.signal.aborted) return
      if (!context || Date.now() >= contextRefreshAfter) await refreshContext()
      if (!context?.canFieldExecute || controller.signal.aborted) return
      await flushPharmacyPromotionOutbox({
        scopeKey: context.scopeKey,
        send: (requests) => sendPharmacyPromotionOutboxRequests(
          requests,
          globalThis.fetch.bind(globalThis),
          { signal: controller.signal },
        ),
      })
    }
    const wakeWithoutOverlap = () => { void wake() }
    const wakeWhenVisible = () => {
      if (document.visibilityState === "visible") wakeWithoutOverlap()
    }

    window.addEventListener("online", wakeWithoutOverlap)
    document.addEventListener("visibilitychange", wakeWhenVisible)
    const interval = window.setInterval(wakeWithoutOverlap, 30_000)
    wakeWithoutOverlap()

    return () => {
      controller.abort()
      window.removeEventListener("online", wakeWithoutOverlap)
      document.removeEventListener("visibilitychange", wakeWhenVisible)
      window.clearInterval(interval)
    }
  }, [sessionKey])

  return null
}
