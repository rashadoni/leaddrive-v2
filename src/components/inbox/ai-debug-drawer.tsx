"use client"

import { useEffect, useState } from "react"
import { useLocale } from "next-intl"
import { Sparkles, X } from "lucide-react"

/**
 * A5 — "how was this reply formed" debug drawer (admin/manager). Opens from the AI badge
 * on a thread message; fetches the reply's AiInteractionLog by metadata.aiLogId and shows
 * the judge scores, KB sources, tools, model/token/cost/latency and the raw exchange.
 */

type LogRow = {
  id: string
  userMessage: string
  aiResponse: string
  latencyMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  model: string | null
  toolsCalled: string[]
  kbArticlesUsed: string[]
  qualityScore: number | null
  createdAt: string
}

type Quality = {
  grounded?: number
  complete?: number
  accurate?: number
  total?: number
  isClarifyingQuestion?: boolean
  scoringFailed?: boolean
  error?: string
}

type Loc = "en" | "ru" | "az"
const COPY: Record<Loc, Record<string, string>> = {
  en: {
    title: "How this reply was formed",
    scores: "Quality scores (LLM judge)",
    grounded: "Grounded", complete: "Complete", accurate: "Accurate", total: "Total",
    clarifying: "Clarifying question", scoringFailed: "Scoring failed",
    kb: "Knowledge base sources", kbNone: "No KB articles used",
    tools: "Tools called", toolsNone: "No tools called",
    runtime: "Model & runtime",
    exchange: "Exchange",
    customer: "Customer", assistant: "Assistant",
    reason: "Delivery",
    reason_draft_mode: "Draft (drafts-only mode)",
    reason_below_threshold: "Draft (below confidence threshold)",
    reason_clarifying_question: "Draft (clarifying question)",
    reason_scoring_failed: "Draft (scoring failed)",
    reason_commitment_guard: "Draft (unsupported promise blocked)",
    reason_auto: "Auto-sent",
    loadError: "Could not load the interaction log",
    tokens: "tokens",
  },
  ru: {
    title: "Как сформирован ответ",
    scores: "Оценки качества (LLM-судья)",
    grounded: "Обоснованность", complete: "Полнота", accurate: "Точность", total: "Итог",
    clarifying: "Уточняющий вопрос", scoringFailed: "Скоринг не сработал",
    kb: "Источники базы знаний", kbNone: "Статьи БЗ не использовались",
    tools: "Вызванные инструменты", toolsNone: "Инструменты не вызывались",
    runtime: "Модель и рантайм",
    exchange: "Обмен",
    customer: "Клиент", assistant: "Ассистент",
    reason: "Доставка",
    reason_draft_mode: "Черновик (режим «только черновики»)",
    reason_below_threshold: "Черновик (ниже порога уверенности)",
    reason_clarifying_question: "Черновик (уточняющий вопрос)",
    reason_scoring_failed: "Черновик (скоринг не сработал)",
    reason_commitment_guard: "Черновик (неподтверждённое обещание заблокировано)",
    reason_auto: "Автоотправка",
    loadError: "Не удалось загрузить лог взаимодействия",
    tokens: "токенов",
  },
  az: {
    title: "Cavab necə formalaşıb",
    scores: "Keyfiyyət balları (LLM-hakim)",
    grounded: "Əsaslılıq", complete: "Tamlıq", accurate: "Dəqiqlik", total: "Yekun",
    clarifying: "Dəqiqləşdirici sual", scoringFailed: "Bal alınmadı",
    kb: "Bilik bazası mənbələri", kbNone: "BB məqalələri istifadə olunmayıb",
    tools: "Çağırılan alətlər", toolsNone: "Alət çağırılmayıb",
    runtime: "Model və icra",
    exchange: "Mübadilə",
    customer: "Müştəri", assistant: "Assistent",
    reason: "Çatdırılma",
    reason_draft_mode: "Qaralama («yalnız qaralama» rejimi)",
    reason_below_threshold: "Qaralama (inam həddindən aşağı)",
    reason_clarifying_question: "Qaralama (dəqiqləşdirici sual)",
    reason_scoring_failed: "Qaralama (bal alınmadı)",
    reason_commitment_guard: "Qaralama (təsdiqlənməmiş vəd bloklandı)",
    reason_auto: "Avto-göndərilib",
    loadError: "Qarşılıqlı əlaqə loqu yüklənmədi",
    tokens: "token",
  },
}

function ScoreBar({ label, value }: { label: string; value: number | undefined }) {
  if (typeof value !== "number") return null
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div
          className={
            "h-1.5 rounded-full " + (value >= 0.7 ? "bg-emerald-500" : value >= 0.5 ? "bg-amber-500" : "bg-red-500")
          }
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono">{value.toFixed(2)}</span>
    </div>
  )
}

export function AiDebugDrawer({
  logId,
  quality,
  draftReason,
  headers,
  onClose,
}: {
  logId: string
  /** metadata.aiQuality off the message (axes; the log row only stores the total). */
  quality?: Quality | null
  /** metadata.aiDraftReason when the message came through operator review. */
  draftReason?: string | null
  headers: Record<string, string>
  onClose: () => void
}) {
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const [log, setLog] = useState<LogRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLog(null)
    setError(null)
    fetch(`/api/v1/ai-interaction-logs/${logId}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!cancelled) setLog(j?.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setError(c.loadError)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId])

  const deliveryKey = draftReason ? `reason_${draftReason}` : "reason_auto"

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <h2 className="flex-1 truncate text-sm font-semibold">{c.title}</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.scores}</h3>
          {quality?.scoringFailed ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">{c.scoringFailed}{quality.error ? ` · ${quality.error}` : ""}</p>
          ) : (
            <>
              <ScoreBar label={c.grounded} value={quality?.grounded} />
              <ScoreBar label={c.complete} value={quality?.complete} />
              <ScoreBar label={c.accurate} value={quality?.accurate} />
              <ScoreBar label={c.total} value={quality?.total ?? log?.qualityScore ?? undefined} />
              {quality?.isClarifyingQuestion && (
                <p className="text-xs text-violet-700 dark:text-violet-300">{c.clarifying}</p>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground">{c.reason}: {c[deliveryKey] ?? draftReason}</p>
        </section>

        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.kb}</h3>
          {log && log.kbArticlesUsed.length > 0 ? (
            <ul className="list-inside list-disc text-xs">
              {log.kbArticlesUsed.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{log ? c.kbNone : "…"}</p>
          )}
        </section>

        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.tools}</h3>
          {log && log.toolsCalled.length > 0 ? (
            <ul className="list-inside list-disc text-xs font-mono">
              {log.toolsCalled.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{log ? c.toolsNone : "…"}</p>
          )}
        </section>

        {log && (
          <section className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.runtime}</h3>
            <p className="font-mono text-xs text-muted-foreground">
              {log.model ?? "—"} · {(log.promptTokens ?? 0) + (log.completionTokens ?? 0)} {c.tokens} ·{" "}
              {typeof log.costUsd === "number" ? `$${log.costUsd.toFixed(4)}` : "—"} ·{" "}
              {typeof log.latencyMs === "number" ? `${Math.round(log.latencyMs)}ms` : "—"}
            </p>
          </section>
        )}

        {log && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.exchange}</h3>
            <div className="rounded-md border border-border/60 bg-card p-2 text-xs">
              <div className="mb-1 font-medium text-muted-foreground">{c.customer}</div>
              <p className="whitespace-pre-wrap break-words">{log.userMessage}</p>
            </div>
            <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2 text-xs dark:border-violet-800 dark:bg-violet-950/30">
              <div className="mb-1 font-medium text-violet-700 dark:text-violet-300">{c.assistant}</div>
              <p className="whitespace-pre-wrap break-words">{log.aiResponse}</p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
