"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import {
  ChannelReplyMatrixView,
  type ChannelReplyRow,
  type Mode,
  type UiMode,
} from "@/components/settings/channel-reply-matrix-view"

/**
 * Per-channel "who replies" matrix for the signed-in tenant: reads and writes
 * the reply policy via /api/v1/settings/channel-reply. What it looks like, and
 * which channels honour the setting today, is `ChannelReplyMatrixView`
 * (./channel-reply-matrix-view.tsx).
 */
export function ChannelReplyMatrix() {
  const { data: session, status } = useSession()
  const orgId = session?.user?.organizationId
  const [rows, setRows] = useState<ChannelReplyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const authHeaders = (): Record<string, string> =>
    orgId ? { "x-organization-id": String(orgId) } : {}

  useEffect(() => {
    if (status === "loading") return
    fetch("/api/v1/settings/channel-reply", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { data: { channels: [] } }))
      .then((j) => setRows(j.data?.channels ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Shared optimistic PATCH: apply `optimistic` locally, send `patch`, revert on failure,
  // reconcile with the server's echoed reply on success (race-safe per row).
  const patchRow = async (
    row: ChannelReplyRow,
    optimistic: Partial<ChannelReplyRow["reply"]>,
    patch: Record<string, unknown>,
  ) => {
    const prevReply = row.reply
    const revert = () =>
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, reply: prevReply } : r)))
    setSavingId(row.id)
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, reply: { ...r.reply, ...optimistic } } : r)))
    try {
      const res = await fetch("/api/v1/settings/channel-reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ configId: row.id, ...patch }),
      })
      if (!res.ok) {
        revert()
        return
      }
      const json = await res.json().catch(() => null)
      const reply = json?.data?.reply
      if (reply?.mode) {
        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, reply: { ...r.reply, ...reply } } : r)))
      }
    } catch {
      revert()
    } finally {
      setSavingId(null)
    }
  }

  const setUiMode = (row: ChannelReplyRow, ui: UiMode) => {
    const mode: Mode = ui === "agent" ? "agent" : "ai"
    const draftMode = ui === "ai_draft"
    return patchRow(
      row,
      { mode, draftMode, modeDefaulted: false, modeSource: "explicit" },
      { mode, draftMode },
    )
  }

  const setThreshold = (row: ChannelReplyRow, raw: string) => {
    const aiThreshold = raw === "" ? null : Number(raw)
    return patchRow(row, { aiThreshold }, { aiThreshold })
  }

  const setRollout = (row: ChannelReplyRow, raw: string) => {
    const aiRolloutPercent = raw === "" ? null : Number(raw)
    return patchRow(row, { aiRolloutPercent }, { aiRolloutPercent })
  }

  return (
    <ChannelReplyMatrixView
      rows={rows}
      loading={loading}
      savingId={savingId}
      onUiModeChange={setUiMode}
      onRolloutChange={setRollout}
      onThresholdChange={setThreshold}
    />
  )
}
