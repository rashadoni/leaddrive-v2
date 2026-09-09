"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Target, Phone, Mail, CheckSquare, ArrowUpRight, Loader2, Play } from "lucide-react"
import Link from "next/link"

interface NextAction {
  type: string
  title: string
  reason: string
  priority: "high" | "medium" | "low"
  entityType: string
  entityId: string
  entityName: string
}

const TYPE_ICONS: Record<string, any> = {
  call: Phone,
  email: Mail,
  task: CheckSquare,
  meeting: Target,
  update_stage: ArrowUpRight,
  send_offer: Mail,
}

const PRIORITY_STYLES: Record<string, { dot: string; text: string }> = {
  high: { dot: "bg-red-500", text: "text-red-600" },
  medium: { dot: "bg-amber-500", text: "text-amber-600" },
  low: { dot: "bg-blue-500", text: "text-blue-600" },
}

function getEntityLink(type: string, id: string): string {
  switch (type) {
    case "deal": return `/deals/${id}`
    case "lead": return `/leads`
    case "contact": return `/contacts/${id}`
    case "company": return `/companies/${id}`
    default: return "#"
  }
}

export function RecommendedActions() {
  const t = useTranslations("dashboard")
  const [actions, setActions] = useState<NextAction[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/v1/ai/next-actions?limit=5")
      .then(r => r.json())
      .then(j => { if (j.success) setActions(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleQuickAction = async (action: NextAction, idx: number) => {
    setExecuting(idx)
    try {
      if (action.type === "call" || action.type === "email") {
        // Log activity
        await fetch("/api/v1/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: action.type === "call" ? "call" : "email",
            subject: action.title,
            description: action.reason,
            relatedType: action.entityType,
            relatedId: action.entityId,
          }),
        })
      } else if (action.type === "task") {
        // Create task
        await fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: action.title,
            description: action.reason,
            priority: action.priority,
            relatedType: action.entityType,
            relatedId: action.entityId,
            dueDate: new Date(Date.now() + 86400000).toISOString(),
          }),
        })
      }
      // Remove executed action from list
      setActions(prev => prev.filter((_, i) => i !== idx))
    } catch {}
    setExecuting(null)
  }

  return (
    <div className="dashboard-bento-card rounded-lg bg-card border border-zinc-200 dark:border-zinc-700 shadow-sm p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Target className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t("recommendedActions")}</span>
      </div>

      {loading ? (
        <div className="h-[140px] flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : actions.length === 0 ? (
        <div className="h-[140px] flex items-center justify-center text-xs text-muted-foreground">
          {t("noRecommendations")}
        </div>
      ) : (
        <div className="space-y-1.5">
          {actions.map((action, idx) => {
            const Icon = TYPE_ICONS[action.type] || Target
            const style = PRIORITY_STYLES[action.priority]
            const link = getEntityLink(action.entityType, action.entityId)

            return (
              <Link
                key={idx}
                href={link}
                className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                      {action.title}
                    </p>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{action.reason}</p>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleQuickAction(action, idx) }}
                  className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  title={action.type === "call" ? t("logCall") : action.type === "email" ? t("logEmail") : t("createTask")}
                >
                  {executing === idx ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </button>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
