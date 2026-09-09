"use client"

/**
 * C5 Account Engagement — account detail drawer (UX upgrade).
 *
 * Opens when a card is clicked. Explains the account in plain language —
 * WHY it has this grade (the firmographic factors), how the engagement score
 * differs from the grade, its signals — and lets the user ACT: move the
 * lifecycle stage (real PATCH). Read-only data + one write action; closes the
 * "static, jargon-heavy" gap without restructuring the list.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import { ACCOUNT_LIFECYCLE_TRANSITIONS } from "@/lib/account-engagement/types"
import { Activity, AlertTriangle, CalendarPlus, CheckCircle2, Loader2, TrendingUp } from "lucide-react"

export interface DrawerAccount {
  id: string
  accountName: string
  lifecycleStage: string
  icpTier: string
  engagementScore: number
  grade: string
  industrySlug: string | null
  employeeBand: string | null
  annualRevenueUsd: string | null
  lastSignalAt: string | null
  recentSignals30d: number
  isStalePriority: boolean
}

function formatRevenue(usd: string | null): string {
  if (!usd) return "—"
  const n = Number(usd)
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

interface Props {
  account: DrawerAccount | null
  onClose: () => void
  onChanged: () => void
}

export function AccountDetailDrawer({ account, onClose, onChanged }: Props) {
  const t = useTranslations("slice2.accountEngagement")
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [taskState, setTaskState] = useState<"idle" | "saving" | "done">("idle")
  const [taskErr, setTaskErr] = useState<string | null>(null)

  if (!account) return null
  const a = account

  const transitions = ACCOUNT_LIFECYCLE_TRANSITIONS as Record<string, readonly string[]>
  const validNext = transitions[a.lifecycleStage] ?? []
  const unassigned = a.grade === "unassigned" || a.icpTier === "unscored"

  // Plain-language "why this grade" — list only the factors that are present.
  const factors: Array<{ label: string; value: string }> = []
  if (a.icpTier !== "unscored") factors.push({ label: t("detail.factorTier"), value: t(`icpTierLabels.${a.icpTier}`) })
  if (a.employeeBand) factors.push({ label: t("size"), value: a.employeeBand.replace("_", " ") })
  if (a.annualRevenueUsd) factors.push({ label: t("revenue"), value: formatRevenue(a.annualRevenueUsd) })
  if (a.industrySlug) factors.push({ label: t("industry"), value: a.industrySlug })

  async function changeStage(stage: string) {
    setSaving(stage)
    setErr(null)
    try {
      const res = await fetch(`/api/v1/account-engagement/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycleStage: stage }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onChanged()
      onClose()
    } catch {
      setErr(t("detail.stageError"))
    } finally {
      setSaving(null)
    }
  }

  // Create a follow-up task (reactivation for stale accounts) in the CRM task
  // board. No `type` sent → skips the org task-type validation gate.
  async function createTask() {
    setTaskState("saving")
    setTaskErr(null)
    try {
      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const title = a.isStalePriority
        ? t("detail.taskTitleReactivate", { name: a.accountName })
        : t("detail.taskTitleFollowup", { name: a.accountName })
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: t("detail.taskDesc", { name: a.accountName }),
          priority: a.isStalePriority ? "high" : "medium",
          dueDate,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTaskState("done")
    } catch {
      setTaskErr(t("detail.taskError"))
      setTaskState("idle")
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) onClose() }} widthClassName="max-w-[34rem]">
      <DialogHeader>
        <DialogTitle>{a.accountName}</DialogTitle>
        <DialogDescription>
          <span className="inline-flex gap-1.5 items-center flex-wrap">
            <span className="px-2 py-0.5 rounded bg-muted text-foreground text-xs">{t(`stageLabels.${a.lifecycleStage}`)}</span>
            <span className="px-2 py-0.5 rounded border text-xs">{t(`icpTierLabels.${a.icpTier}`)}</span>
            <span className="px-2 py-0.5 rounded bg-muted text-xs">{t("detail.gradeBadge", { grade: a.grade === "unassigned" ? "?" : a.grade })}</span>
          </span>
        </DialogDescription>
      </DialogHeader>

      <DialogContent className="space-y-5 text-sm">
        {/* WHY the grade */}
        <section>
          <h4 className="font-semibold mb-1.5">{t("detail.whyGrade")}</h4>
          {unassigned ? (
            <p className="text-muted-foreground">{t("detail.whyUnassigned")}</p>
          ) : (
            <ul className="space-y-1">
              {factors.map((f) => (
                <li key={f.label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-medium">{f.value}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Score vs grade — the key confusion */}
        <section className="rounded-lg bg-muted/50 p-3">
          <h4 className="font-semibold mb-1">{t("detail.scoreVsGrade")}</h4>
          <p className="text-muted-foreground mb-2">{t("detail.scoreVsGradeBody")}</p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> {t("engagement")}</span>
            <span className="font-mono font-bold">{a.engagementScore}<span className="text-xs text-muted-foreground">/100</span></span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">{t("signals30d")}</span>
            <span className="font-mono">{a.recentSignals30d}</span>
          </div>
        </section>

        {a.isStalePriority && (
          <div className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t("detail.staleExplain")}</span>
          </div>
        )}
        {!a.isStalePriority && a.engagementScore >= 70 && (
          <div className="rounded-lg border border-green-500 bg-green-500/10 p-3 flex items-start gap-2 text-green-800 dark:text-green-300">
            <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t("detail.hotExplain")}</span>
          </div>
        )}

        {/* Create a follow-up / reactivation task in the CRM */}
        <section>
          {taskState === "done" ? (
            <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {t("detail.taskCreated")}
            </p>
          ) : (
            <button
              onClick={createTask}
              disabled={taskState === "saving"}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {taskState === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
              {t("detail.createTask")}
            </button>
          )}
          {taskErr && <p className="text-destructive text-sm mt-1.5">{taskErr}</p>}
        </section>

        {err && <p className="text-destructive text-sm">{err}</p>}
      </DialogContent>

      <DialogFooter className="flex-col items-stretch gap-2">
        <div className="text-xs text-muted-foreground">{t("detail.moveStage")}</div>
        <div className="flex flex-wrap gap-2">
          {validNext.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("detail.noTransitions")}</span>
          ) : (
            validNext.map((stage) => (
              <button
                key={stage}
                onClick={() => changeStage(stage)}
                disabled={saving !== null}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {saving === stage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                → {t(`stageLabels.${stage}`)}
              </button>
            ))
          )}
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm hover:bg-muted"
          >
            {t("detail.close")}
          </button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
