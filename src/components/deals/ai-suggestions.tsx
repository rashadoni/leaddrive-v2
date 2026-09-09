"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Sparkles, Phone, Mail, Calendar, ListTodo, ArrowUpRight,
  Loader2, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react"

interface Suggestion {
  action: string
  reason: string
  priority: "high" | "medium" | "low"
  type: "call" | "email" | "meeting" | "task" | "update_stage"
}

const TYPE_ICONS: Record<string, any> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  task: ListTodo,
  update_stage: ArrowUpRight,
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-amber-500",
  low: "border-l-slate-400",
}

export function AiSuggestions({ dealId }: { dealId: string }) {
  const t = useTranslations("aiSettings")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState<number | null>(null)
  const [applied, setApplied] = useState<Set<number>>(new Set())

  const applyAction = async (s: Suggestion, idx: number) => {
    setApplying(idx)
    try {
      // Create a task based on the suggestion
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + (s.priority === "high" ? 1 : 3))
      await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: s.action,
          description: `AI suggestion: ${s.reason}`,
          priority: s.priority,
          dueDate: dueDate.toISOString(),
          relatedType: "deal",
          relatedId: dealId,
        }),
      })
      setApplied(prev => new Set(prev).add(idx))
    } catch {}
    setApplying(null)
  }

  const fetchSuggestions = () => {
    setLoading(true)
    setError(false)
    setDismissed(new Set())
    fetch(`/api/v1/deals/ai-suggestions?dealId=${dealId}`)
      .then(r => r.json())
      .then(res => {
        if (res.data?.suggestions) {
          setSuggestions(res.data.suggestions)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSuggestions()
  }, [dealId])

  const visibleSuggestions = suggestions.filter((_, i) => !dismissed.has(i))

  if (!loading && !error && visibleSuggestions.length === 0 && suggestions.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-medium">{t("aiSuggestions")}</span>
          {visibleSuggestions.length > 0 && (
            <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-1.5 py-0.5 rounded-full">
              {visibleSuggestions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); fetchSuggestions() }}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("analyzingDeal")}
            </div>
          )}

          {error && (
            <p className="text-xs text-muted-foreground py-2">{t("loadFailed")}</p>
          )}

          {!loading && visibleSuggestions.map((s, idx) => {
            const originalIdx = suggestions.indexOf(s)
            const Icon = TYPE_ICONS[s.type] || ListTodo
            return (
              <div
                key={originalIdx}
                className={`border-l-2 ${PRIORITY_STYLES[s.priority] || PRIORITY_STYLES.low} rounded-r-lg bg-accent/30 p-3 space-y-1`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <p className="text-sm font-medium leading-tight">{s.action}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pl-5.5 leading-relaxed">{s.reason}</p>
                <div className="flex gap-2 pl-5.5 pt-1">
                  {applied.has(originalIdx) ? (
                    <span className="text-[10px] text-green-600">{t("taskCreated")}</span>
                  ) : (
                    <button
                      onClick={() => applyAction(s, originalIdx)}
                      disabled={applying === originalIdx}
                      className="text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      {applying === originalIdx ? t("creating") : t("createTask")}
                    </button>
                  )}
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <button
                    onClick={() => setDismissed(prev => new Set(prev).add(originalIdx))}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("dismiss")}
                  </button>
                </div>
              </div>
            )
          })}

          {!loading && visibleSuggestions.length === 0 && suggestions.length > 0 && (
            <p className="text-xs text-muted-foreground py-2">{t("allDismissed")}</p>
          )}
        </div>
      )}
    </div>
  )
}
