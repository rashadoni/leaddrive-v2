"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Loader2, Clock, ArrowRight, DollarSign, User, Tag, FileText, Trash2 } from "lucide-react"

interface HistoryEntry {
  id: string
  action: string
  entityType: string
  entityName?: string
  oldValue?: any
  newValue?: any
  createdAt: string
  userId?: string
  userName?: string
}

const STAGE_COLORS: Record<string, string> = {
  LEAD: "bg-muted text-foreground/70",
  QUALIFIED: "bg-blue-100 text-blue-700",
  PROPOSAL: "bg-violet-100 text-violet-700",
  NEGOTIATION: "bg-amber-100 text-amber-700",
  WON: "bg-green-100 text-green-700",
  LOST: "bg-red-100 text-red-700",
}

export function DealHistory({ dealId, orgId, deal }: { dealId: string; orgId?: string; deal: any }) {
  const tc = useTranslations("common")
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers: any = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    fetch(`/api/v1/audit-log?entityType=deal&entityId=${dealId}&limit=100`, { headers })
      .then(r => r.json())
      .then(j => { if (j.success) setEntries(j.data?.logs || j.data || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dealId, orgId])

  if (loading) {
    return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  function stageLabel(s: string) {
    const map: Record<string, string> = { LEAD: "Lid", QUALIFIED: "Kvalif.", PROPOSAL: "Təklif", NEGOTIATION: "Danışıqlar", WON: "Qazanıldı", LOST: "İtirildi" }
    return map[s] || s
  }

  interface TimelineItem {
    id: string
    date: string
    icon: any
    bg: string
    iconText: string
    title: string
    detail: string
    richDetail?: React.ReactNode
    badge?: string
    badgeColor?: string
  }

  const timeline: TimelineItem[] = []

  // Deal creation as first entry
  timeline.push({
    id: "created-meta",
    date: deal.createdAt,
    icon: FileText,
    bg: "bg-indigo-100",
    iconText: "text-indigo-600",
    title: tc("dealCreated"),
    detail: "",
    richDetail: (
      <div className="flex flex-wrap gap-2 mt-1">
        <span className="text-xs font-medium">{deal.name}</span>
        {deal.valueAmount > 0 && <Badge variant="outline" className="text-xs">{deal.valueAmount?.toLocaleString()} {deal.currency}</Badge>}
        <Badge className={`text-xs ${STAGE_COLORS[deal.stage] || ""}`}>{stageLabel(deal.stage)}</Badge>
      </div>
    ),
  })

  // Audit log entries
  entries.forEach(e => {
    const oldVal = e.oldValue || {}
    const newVal = e.newValue || {}
    const action = (e.action || "").toLowerCase()

    // Stage change
    if ((action === "update" || action.includes("stage")) && (newVal.stage || action.includes("move"))) {
      const fromStage = oldVal.stage
      const toStage = newVal.stage || (typeof newVal === "object" && newVal.stage)
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: ArrowRight,
        bg: "bg-blue-100",
        iconText: "text-blue-600",
        title: fromStage ? `${stageLabel(fromStage)} → ${stageLabel(toStage)}` : tc("stageChangedTo", { stage: stageLabel(toStage || "?") }),
        detail: e.userName ? tc("by", { name: e.userName }) : "",
        richDetail: (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {fromStage && <Badge className={`text-xs ${STAGE_COLORS[fromStage] || "bg-muted text-foreground/70"}`}>{stageLabel(fromStage)}</Badge>}
            {fromStage && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            {toStage && <Badge className={`text-xs ${STAGE_COLORS[toStage] || "bg-muted text-foreground/70"}`}>{stageLabel(toStage)}</Badge>}
            {e.userName && <span className="text-xs text-muted-foreground ml-1">{tc("by", { name: e.userName })}</span>}
          </div>
        ),
      })
      return
    }

    // Value change
    if (action === "update" && newVal.valueAmount !== undefined) {
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: DollarSign,
        bg: "bg-green-100",
        iconText: "text-green-600",
        title: "Məbləğ dəyişdi",
        detail: "",
        richDetail: (
          <div className="flex items-center gap-2 mt-1">
            {oldVal.valueAmount !== undefined && <span className="text-xs line-through text-muted-foreground">{Number(oldVal.valueAmount).toLocaleString()}</span>}
            {oldVal.valueAmount !== undefined && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            <span className="text-xs font-medium text-green-700">{Number(newVal.valueAmount).toLocaleString()} {deal.currency}</span>
            {e.userName && <span className="text-xs text-muted-foreground ml-1">{tc("by", { name: e.userName })}</span>}
          </div>
        ),
      })
      return
    }

    // Assigned user change
    if (action === "update" && newVal.assignedTo !== undefined) {
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: User,
        bg: "bg-violet-100",
        iconText: "text-violet-600",
        title: "Məsul dəyişdi",
        detail: "",
        richDetail: (
          <div className="flex items-center gap-1 mt-1 text-xs">
            {oldVal.assignedTo && <span className="text-muted-foreground line-through">{oldVal.assignedTo}</span>}
            {oldVal.assignedTo && <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground" />}
            <span className="font-medium">{newVal.assignedTo || tc("unassigned")}</span>
          </div>
        ),
      })
      return
    }

    // Name change
    if (action === "update" && newVal.name !== undefined) {
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: Tag,
        bg: "bg-amber-100",
        iconText: "text-amber-600",
        title: "Ad dəyişdi",
        detail: oldVal.name ? `"${oldVal.name}" → "${newVal.name}"` : `"${newVal.name}"`,
      })
      return
    }

    // Delete
    if (action === "delete") {
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: Trash2,
        bg: "bg-red-100",
        iconText: "text-red-600",
        title: tc("actionDeleteDeal"),
        detail: e.userName ? tc("by", { name: e.userName }) : "",
      })
      return
    }

    // Generic update fallback
    if (action === "update") {
      const changedFields = Object.keys(newVal).filter(k => k !== "probability")
      if (changedFields.length === 0) return
      timeline.push({
        id: e.id,
        date: e.createdAt,
        icon: Tag,
        bg: "bg-amber-100",
        iconText: "text-amber-600",
        title: tc("actionUpdateDeal"),
        detail: changedFields.map(k => `${k}: ${String(newVal[k] || "—").slice(0, 40)}`).join(", "),
      })
      return
    }

    // Legacy actions from v1 (e.g. "create deal", "move deal stage")
    const legacyLabels: Record<string, string> = {
      "create": tc("actionCreateDeal"), "create deal": tc("actionCreateDeal"),
      "move deal stage": tc("actionMoveDealStage"), "move_deal_stage": tc("actionMoveDealStage"),
    }
    timeline.push({
      id: e.id,
      date: e.createdAt,
      icon: Clock,
      bg: "bg-muted",
      iconText: "text-muted-foreground",
      title: legacyLabels[action] || action.replace(/_/g, " "),
      detail: e.userName ? tc("by", { name: e.userName }) : "",
    })
  })

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="relative">
      <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
      <div className="space-y-1">
        {timeline.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.id} className="flex gap-3 relative">
              <div className={`relative z-10 h-10 w-10 rounded-full ${item.bg} flex items-center justify-center flex-shrink-0 mt-1`}>
                <Icon className={`h-4 w-4 ${item.iconText}`} />
              </div>
              <div className="flex-1 pb-3">
                <div className="bg-card rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(item.date)}</span>
                  </div>
                  {item.richDetail ? item.richDetail : (
                    item.detail ? <p className="text-xs text-muted-foreground mt-1">{item.detail}</p> : null
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
