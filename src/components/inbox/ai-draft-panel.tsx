"use client"

import { useEffect, useState } from "react"
import { useLocale } from "next-intl"
import { Sparkles, X } from "lucide-react"

/**
 * A2 — operator review of a pending AI reply draft (SocialConversation.metadata.aiDraft).
 * Self-contained: fetches the conversation detail itself (the inbox list payload doesn't
 * carry metadata), so the page only mounts it with a socialConversationId. Renders nothing
 * when there is no pending draft.
 */

type PanelDraft = {
  text: string
  reason: string
  quality?: { total?: number }
  channel: string
  createdAt: string
  inboundPreview?: string
}

type Loc = "en" | "ru" | "az"
const COPY: Record<Loc, Record<string, string>> = {
  en: {
    title: "AI draft — needs review",
    send: "Send",
    discard: "Discard",
    sending: "Sending…",
    quality: "quality",
    draft_mode: "drafts-only mode",
    below_threshold: "below the confidence threshold",
    clarifying_question: "clarifying question",
    scoring_failed: "quality scoring failed",
    commitment_guard: "unsupported promise blocked",
  },
  ru: {
    title: "Черновик AI — нужна проверка",
    send: "Отправить",
    discard: "Отклонить",
    sending: "Отправка…",
    quality: "качество",
    draft_mode: "режим «только черновики»",
    below_threshold: "ниже порога уверенности",
    clarifying_question: "уточняющий вопрос",
    scoring_failed: "скоринг качества не сработал",
    commitment_guard: "неподтверждённое обещание заблокировано",
  },
  az: {
    title: "AI qaralaması — yoxlama lazımdır",
    send: "Göndər",
    discard: "Rədd et",
    sending: "Göndərilir…",
    quality: "keyfiyyət",
    draft_mode: "«yalnız qaralama» rejimi",
    below_threshold: "inam həddindən aşağı",
    clarifying_question: "dəqiqləşdirici sual",
    scoring_failed: "keyfiyyət balı alınmadı",
    commitment_guard: "təsdiqlənməmiş vəd bloklandı",
  },
}

export function AiDraftPanel({
  scid,
  headers,
  refreshKey,
  onResolved,
}: {
  scid: string | null
  headers: Record<string, string>
  /** Bump to refetch (e.g. the thread's message count — a new inbound may have drafted). */
  refreshKey?: unknown
  onResolved?: () => void
}) {
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const [draft, setDraft] = useState<PanelDraft | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDraft(null)
    setError(null)
    if (!scid) return
    fetch(`/api/v1/inbox/conversations/${scid}`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const d = j?.data?.metadata?.aiDraft as PanelDraft | undefined
        if (d && typeof d.text === "string" && d.text.trim()) {
          setDraft(d)
          setText(d.text)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scid, refreshKey])

  if (!scid || !draft) return null

  const act = async (action: "send" | "discard") => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}/ai-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(action === "send" ? { action, text } : { action }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setError((j?.error as string) || `HTTP ${res.status}`)
        // The server has consumed/blocked this exact draft after an ambiguous
        // external delivery. Hide it locally too; leaving Send enabled would
        // invite an operator to issue the second POST we explicitly prohibit.
        if (j?.deliveryUnknown === true) {
          setDraft(null)
          onResolved?.()
        }
        return
      }
      setDraft(null)
      onResolved?.()
    } finally {
      setBusy(false)
    }
  }

  const total = typeof draft.quality?.total === "number" ? draft.quality.total : null
  const reasonLabel = c[draft.reason] ?? draft.reason

  return (
    <div className="mx-3 mb-2 rounded-lg border border-violet-300 bg-violet-50/70 p-3 dark:border-violet-800 dark:bg-violet-950/30">
      <div className="flex items-center gap-2 text-xs font-medium text-violet-800 dark:text-violet-300">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">
          {c.title} · {reasonLabel}
          {total !== null && <span className="ml-1 opacity-70">({c.quality} {total.toFixed(2)})</span>}
        </span>
        <button
          type="button"
          onClick={() => act("discard")}
          disabled={busy}
          className="shrink-0 rounded p-0.5 hover:bg-violet-200/60 dark:hover:bg-violet-900/50"
          title={c.discard}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(6, Math.max(2, text.split("\n").length))}
        className="mt-2 w-full resize-y rounded-md border border-violet-200 bg-background px-2 py-1.5 text-sm dark:border-violet-800"
        disabled={busy}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => act("send")}
          disabled={busy || !text.trim()}
          className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? c.sending : c.send}
        </button>
        <button
          type="button"
          onClick={() => act("discard")}
          disabled={busy}
          className="rounded-md border border-violet-300 px-3 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/40"
        >
          {c.discard}
        </button>
      </div>
    </div>
  )
}
