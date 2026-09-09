"use client"

/**
 * D1 (Creatio 10X roadmap) — MEDDPICC qualification tab on the deal card.
 *
 * 8 blocks (Metrics … Competition), each: score 1-5 + «why this score» +
 * «what to do next». The rollup badge (unscored/red/yellow/green + n/40)
 * recomputes as you click — an unscored block caps the status at yellow.
 * Saved as ONE PUT of the whole JSON (a qualification pass is one edit
 * session, not 24 tiny requests).
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Save, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  MEDDPICC_BLOCKS,
  type MeddpiccBlockKey,
  type MeddpiccData,
  parseMeddpicc,
  summarizeMeddpicc,
  scoreBucket,
} from "@/lib/meddpicc"

const STATUS_STYLES: Record<string, string> = {
  unscored: "bg-muted text-muted-foreground",
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  yellow: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
}

const BUCKET_BTN: Record<string, string> = {
  red: "bg-red-500 text-white border-red-500",
  yellow: "bg-amber-500 text-white border-amber-500",
  green: "bg-emerald-500 text-white border-emerald-500",
}

export function DealMeddpicc({
  dealId,
  orgId,
  initial,
  onSaved,
}: {
  dealId: string
  orgId?: string | number
  initial: unknown
  onSaved?: (data: MeddpiccData) => void
}) {
  const t = useTranslations("meddpicc")
  const [data, setData] = useState<MeddpiccData>(() => parseMeddpicc(initial))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // D3 — blocks the advisor just drafted (this session), for the "AI draft" badge.
  const [suggesting, setSuggesting] = useState(false)
  const [aiFilled, setAiFilled] = useState<Set<MeddpiccBlockKey>>(new Set())

  // Resync from the server value while PRISTINE only — an external update
  // (second tab, bulk edit) refreshes the view, but never clobbers edits in
  // progress. Last-write-wins remains the model for concurrent saves.
  useEffect(() => {
    if (!dirty) setData(parseMeddpicc(initial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const summary = useMemo(() => summarizeMeddpicc(data), [data])

  const patch = (key: MeddpiccBlockKey, upd: Partial<MeddpiccData[MeddpiccBlockKey]>) => {
    setData((prev) => ({ ...prev, [key]: { ...prev[key], ...upd } }))
    setDirty(true)
    // Once the manager touches a block, it's no longer an unreviewed AI draft.
    setAiFilled((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  // D3 — ask the advisor to draft blocks from the deal's correspondence, then
  // fill only the still-EMPTY blocks (never clobber the manager's own work).
  const suggest = async () => {
    setSuggesting(true)
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/meddpicc/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`)
      if ((json.data.evidenceCount ?? 0) === 0) {
        toast.info(t("ai.noEvidence"))
        return
      }
      const sugg = parseMeddpicc(json.data.suggestions)
      const isEmpty = (b?: MeddpiccData[MeddpiccBlockKey]) => !b || (b.score === undefined && !b.note && !b.next)
      const fillKeys = MEDDPICC_BLOCKS.filter((key) => sugg[key] && isEmpty(data[key]))
      if (fillKeys.length === 0) {
        toast.info(t("ai.nothingNew"))
        return
      }
      // Functional update re-checks each block against the LATEST state, so an
      // edit the manager made during the in-flight call is never clobbered.
      setData((prev) => {
        const next = { ...prev }
        for (const key of fillKeys) {
          if (!isEmpty(prev[key])) continue
          const s = sugg[key]!
          next[key] = { score: s.score, note: s.note, next: s.next }
        }
        return next
      })
      setAiFilled((prev) => new Set([...prev, ...fillKeys]))
      setDirty(true)
      toast.success(t("ai.filled", { n: fillKeys.length, sources: json.data.evidenceCount }))
    } catch {
      toast.error(t("ai.error"))
    } finally {
      setSuggesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({ meddpicc: data }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`)
      // Field-permissions can silently strip the write for restricted roles
      // (the route still 200s). The route echoes the updated deal — if our
      // field didn't come back, say so instead of faking success.
      if (json.data && json.data.meddpicc === undefined) {
        toast.error(t("savedNoPermission"))
        return
      }
      setDirty(false)
      onSaved?.(data)
      toast.success(t("saved"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* rollup header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLES[summary.status])}>
          {t(`status_${summary.status}`)}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("scoreOf", { n: summary.totalScore, max: summary.maxScore })} · {t("scoredOf", { n: summary.scored })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={suggest}
            disabled={suggesting || saving}
            title={t("ai.suggest")}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/10 disabled:opacity-40"
          >
            {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {suggesting ? t("ai.suggesting") : t("ai.suggest")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t("save")}
          </button>
        </div>
      </div>

      {/* Plain-language primer: what MEDDPICC is + how the 1-5 score works, so a
          first-time user knows what each block is asking and how to rate it. */}
      <div className="rounded-lg border border-zinc-200 bg-muted/40 px-3 py-2 text-xs leading-relaxed dark:border-zinc-700">
        <p className="text-muted-foreground">{t("intro")}</p>
        <p className="mt-1.5 font-medium text-foreground/80">{t("scoreGuide")}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {MEDDPICC_BLOCKS.map((key) => {
          const block = data[key] ?? {}
          const bucket = scoreBucket(block.score)
          return (
            <div key={key} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2.5">
              {/* Title + AI badge — its own line; a long title can wrap without
                  ever colliding with the score buttons. */}
              <div className="flex items-start gap-1.5">
                <span className="flex-1 text-sm font-medium leading-tight">{t(`block_${key}`)}</span>
                {aiFilled.has(key) && (
                  <span
                    title={t("ai.badgeHint")}
                    className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/10 text-primary px-1 py-0.5 text-[10px] font-medium"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {t("ai.badge")}
                  </span>
                )}
              </div>
              {/* Hint on its own line */}
              <p className="text-[11px] leading-snug text-muted-foreground">{t(`hint_${key}`)}</p>
              {/* Score — a full-width segmented row (5 equal buttons), its own line */}
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patch(key, { score: block.score === s ? undefined : s })}
                    title={`${s} — ${t(`score_${s}`)}`}
                    aria-label={`${s} — ${t(`score_${s}`)}`}
                    aria-pressed={block.score === s}
                    className={cn(
                      "h-8 flex-1 rounded-md border text-xs font-semibold transition-colors",
                      block.score === s
                        ? BUCKET_BTN[bucket] ?? "bg-primary text-primary-foreground border-primary"
                        : "border-zinc-300 dark:border-zinc-600 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                value={block.note ?? ""}
                onChange={(e) => patch(key, { note: e.target.value })}
                placeholder={t("whyPlaceholder")}
                maxLength={2000}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 py-1.5 text-xs"
              />
              <input
                value={block.next ?? ""}
                onChange={(e) => patch(key, { next: e.target.value })}
                placeholder={t("nextPlaceholder")}
                maxLength={2000}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 py-1.5 text-xs"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
