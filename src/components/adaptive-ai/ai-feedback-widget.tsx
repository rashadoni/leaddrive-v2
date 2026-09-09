"use client"

/**
 * A9 Adaptive AI Models — slice-2 reusable feedback widget.
 *
 * Three-state rating UI (👎 / 🤷 / 👍) plus optional comment textarea.
 * Drop in next to any AI prediction surface to capture user
 * agreement signal:
 *
 *   <AiFeedbackWidget
 *     predictionType="prediction_deal_win"
 *     predictionTargetId={deal.id}
 *     predictionValue={String(deal.aiWinProbability)}
 *     orgId={orgId}
 *   />
 *
 * Compact mode (default): three small buttons, no comment field.
 * Expanded: shows the comment textarea after a rating is picked.
 *
 * Once a rating is recorded the widget transitions to a thank-you
 * state and disables further edits — preventing repeated re-rating
 * on a single prediction surface from inflating sample size. (Slice-3
 * cron tolerates duplicates anyway, but the UX expectation is
 * "feedback once per prediction view".)
 */
import { useState } from "react"
import { ThumbsDown, ThumbsUp, MinusCircle, Loader2, Check } from "lucide-react"
import type { PredictionType, Rating } from "@/lib/adaptive-ai/types"

interface Props {
  predictionType: PredictionType
  predictionTargetId: string
  predictionValue?: string | null
  /** Kept as opt-in for callsites that already pass orgId, but the
   *  POST route resolves organizationId from the session JWT — the
   *  header is not consulted server-side. Safe to omit. */
  orgId?: string
  /** Compact: three buttons only, no comment textarea. Default false
   *  (shows comment field after rating is picked). */
  compact?: boolean
  /** Optional caption shown above the buttons. Override for surfaces
   *  where "Was this useful?" doesn't fit. */
  caption?: string
  /** Fired after a successful POST — parent can refresh metrics. */
  onSubmitted?: (rating: Rating) => void
}

export function AiFeedbackWidget({
  predictionType,
  predictionTargetId,
  predictionValue,
  compact = false,
  caption,
  onSubmitted,
}: Props) {
  const [picked, setPicked] = useState<Rating | null>(null)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (rating: Rating, withComment: string | null) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/ai-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionType,
          predictionTargetId,
          predictionValue: predictionValue ?? null,
          rating,
          comment: withComment,
        }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setSubmitted(true)
      onSubmitted?.(rating)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit")
      setPicked(null) // allow retry on error
    } finally {
      setSubmitting(false)
    }
  }

  const handlePick = (rating: Rating) => {
    if (submitting || submitted) return
    setPicked(rating)
    // Compact mode submits immediately; expanded mode waits for
    // optional comment before submit.
    if (compact) {
      void submit(rating, null)
    }
  }

  const handleSubmitComment = () => {
    if (picked === null) return
    void submit(picked, comment.trim() || null)
  }

  if (submitted) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" />
        <span>Thanks — feedback recorded.</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Was this prediction useful?</p>
      )}

      <div className="inline-flex gap-1">
        <RatingButton
          icon={<ThumbsDown className="h-3.5 w-3.5" />}
          label="Bad"
          active={picked === -1}
          disabled={submitting}
          onClick={() => handlePick(-1)}
          tone="negative"
        />
        <RatingButton
          icon={<MinusCircle className="h-3.5 w-3.5" />}
          label="Skip"
          active={picked === 0}
          disabled={submitting}
          onClick={() => handlePick(0)}
          tone="neutral"
        />
        <RatingButton
          icon={<ThumbsUp className="h-3.5 w-3.5" />}
          label="Good"
          active={picked === 1}
          disabled={submitting}
          onClick={() => handlePick(1)}
          tone="positive"
        />
      </div>

      {!compact && picked !== null && !submitting && (
        <div className="space-y-1.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional: what would make this prediction more useful?"
            rows={2}
            maxLength={1000}
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleSubmitComment}
            disabled={submitting}
            className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {submitting ? "Submitting…" : "Submit feedback"}
          </button>
        </div>
      )}

      {submitting && (
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Recording…</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function RatingButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  tone,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  disabled: boolean
  onClick: () => void
  tone: "negative" | "neutral" | "positive"
}) {
  const activeClasses: Record<typeof tone, string> = {
    negative: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    neutral: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    positive: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  }
  const tint = active ? activeClasses[tone] : "bg-transparent border-zinc-200 dark:border-zinc-700 hover:bg-muted"

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tint}`}
    >
      {icon}
    </button>
  )
}
