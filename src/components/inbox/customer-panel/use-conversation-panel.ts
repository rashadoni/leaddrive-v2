"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import type { JourneyResult } from "@/lib/inbox/customer-journey"

export type ConversationPanelData = {
  since: string | null
  channels: string[]
  language: string | null
  journey: JourneyResult
  autoReply: {
    off: boolean
    offAt: string | null
    offByName: string | null
    channelAi: boolean
  }
}

/**
 * The answer as the panel can draw it, or null. A partial answer (a release half-way through a
 * deploy, a proxy's error page with a 200) must leave the card without the blocks, not break it.
 */
export function readPanelData(raw: unknown): ConversationPanelData | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const journey = value.journey as Record<string, unknown> | undefined
  const autoReply = value.autoReply as Record<string, unknown> | undefined
  if (!journey || !Array.isArray(journey.steps) || !autoReply || typeof autoReply.off !== "boolean") return null
  return {
    since: typeof value.since === "string" ? value.since : null,
    channels: Array.isArray(value.channels) ? value.channels.filter((item): item is string => typeof item === "string") : [],
    language: typeof value.language === "string" ? value.language : null,
    journey: {
      steps: journey.steps as ConversationPanelData["journey"]["steps"],
      total: typeof journey.total === "number" ? journey.total : journey.steps.length,
      beyondCurrent: journey.beyondCurrent === true,
    },
    autoReply: {
      off: autoReply.off,
      offAt: typeof autoReply.offAt === "string" ? autoReply.offAt : null,
      offByName: typeof autoReply.offByName === "string" ? autoReply.offByName : null,
      channelAi: autoReply.channelAi === true,
    },
  }
}

/**
 * What the inbox panel reads about one conversation (GET …/conversations/[id]/panel) and its
 * «AI rejimi» switch (PUT …/auto-reply). A switch answers on the screen at once and goes back if
 * the server refuses.
 */
export function useConversationPanel(conversationId: string | null | undefined, headers: Record<string, string>) {
  const [data, setData] = useState<ConversationPanelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // The answer for a conversation the person has already left is dropped.
  const current = useRef<string | null>(null)

  const load = useCallback(async () => {
    const id = conversationId ?? null
    current.current = id
    if (!id) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${encodeURIComponent(id)}/panel`, { headers })
      const json = await readJsonSafely<{ data?: unknown }>(res)
      if (current.current === id) setData(res.ok ? readPanelData(json?.data) : null)
    } catch {
      if (current.current === id) setData(null)
    } finally {
      if (current.current === id) setLoading(false)
    }
  }, [conversationId, headers])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])

  const setAutoReply = useCallback(async (on: boolean): Promise<boolean> => {
    const id = conversationId
    if (!id) return false
    const before = data
    setSaving(true)
    setData((prev) => prev ? { ...prev, autoReply: { ...prev.autoReply, off: !on } } : prev)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${encodeURIComponent(id)}/auto-reply`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ on }),
      })
      const json = await readJsonSafely<{ data?: { off: boolean; offAt: string | null } }>(res)
      if (!res.ok || !json?.data) throw new Error(String(res.status))
      if (current.current === id) await load()
      return true
    } catch {
      if (current.current === id) setData(before)
      return false
    } finally {
      setSaving(false)
    }
  }, [conversationId, data, headers, load])

  return { data, loading, saving, reload: load, setAutoReply }
}
