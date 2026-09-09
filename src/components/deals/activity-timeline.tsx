"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Loader2, Phone, Mail, Users, FileText, CheckSquare, MessageSquare,
  Filter, Plus, X, Send,
} from "lucide-react"

interface TimelineItem {
  id: string
  type: string
  subject: string
  description?: string
  date: string
  author?: string
  contactName?: string
}

const TYPE_CONFIG: Record<string, { icon: any; bg: string; text: string; labelKey: string }> = {
  call: { icon: Phone, bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-600 dark:text-green-400", labelKey: "actTypeCall" },
  email: { icon: Mail, bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-600 dark:text-blue-400", labelKey: "actTypeEmail" },
  meeting: { icon: Users, bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-600 dark:text-violet-400", labelKey: "actTypeMeeting" },
  note: { icon: FileText, bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-600 dark:text-amber-400", labelKey: "actTypeNote" },
  task: { icon: CheckSquare, bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-600 dark:text-orange-400", labelKey: "actTypeTask" },
  comment: { icon: MessageSquare, bg: "bg-muted", text: "text-muted-foreground", labelKey: "actTypeComment" },
}

const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "task"] as const

export function ActivityTimeline({ dealId, orgId }: { dealId: string; orgId?: string }) {
  const tc = useTranslations("common")
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<string>("call")
  const [formSubject, setFormSubject] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const headers: any = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>

  const fetchActivities = () => {
    setLoading(true)
    fetch(`/api/v1/activities?relatedType=deal&relatedId=${dealId}&limit=50`, { headers })
      .then(r => r.json())
      .then(actRes => {
        const timeline: TimelineItem[] = []
        const acts = actRes?.data?.activities || actRes?.data || []
        acts.forEach((a: any) => {
          timeline.push({
            id: a.id,
            type: a.type || "note",
            subject: a.subject || "Activity",
            description: a.description,
            date: a.scheduledAt || a.createdAt,
            author: a.createdByName,
            contactName: a.contact?.fullName,
          })
        })
        timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        setItems(timeline)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchActivities() }, [dealId, orgId])

  const handleSubmit = async () => {
    if (!formSubject.trim()) return
    setSubmitting(true)
    try {
      await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          type: formType,
          subject: formSubject.trim(),
          description: formDescription.trim() || undefined,
          relatedType: "deal",
          relatedId: dealId,
        }),
      })
      setFormSubject("")
      setFormDescription("")
      setShowForm(false)
      fetchActivities()
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const filters = ["all", "call", "email", "meeting", "note", "task"]
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter)

  return (
    <div className="space-y-4">
      {/* Header with filters and add button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {filters.map(f => {
            const count = f === "all" ? items.length : items.filter(i => i.type === f).length
            if (f !== "all" && count === 0 && filter !== f) return null
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs rounded-full border border-zinc-200 dark:border-zinc-700 transition-colors ${
                  filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                }`}
              >
                {f === "all" ? tc("actTypeAll") : tc((TYPE_CONFIG[f]?.labelKey || "actTypeNote") as any)} ({count})
              </button>
            )
          })}
        </div>
        <Button
          size="sm"
          variant={showForm ? "outline" : "default"}
          onClick={() => setShowForm(!showForm)}
          className="gap-1 shrink-0"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? tc("cancel") : tc("add")}
        </Button>
      </div>

      {/* Add activity form */}
      {showForm && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-3">
          {/* Type selector */}
          <div className="flex gap-1.5">
            {ACTIVITY_TYPES.map(t => {
              const config = TYPE_CONFIG[t]
              const Icon = config.icon
              return (
                <button
                  key={t}
                  onClick={() => setFormType(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    formType === t
                      ? `${config.bg} ${config.text} ring-1 ring-current/20`
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tc((config.labelKey) as any)}
                </button>
              )
            })}
          </div>
          <Input
            placeholder={tc("actSubjectPlaceholder")}
            value={formSubject}
            onChange={e => setFormSubject(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSubmit()}
          />
          <Textarea
            placeholder={tc("actDescPlaceholder")}
            value={formDescription}
            onChange={e => setFormDescription(e.target.value)}
            rows={2}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmit} disabled={submitting || !formSubject.trim()} className="gap-1.5">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {tc("save")}
            </Button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div className="text-center py-10">
          <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{tc("noActivities")}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{tc("activitiesHint")}</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-1">
            {filtered.map((item, i) => {
              const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.note
              const Icon = config.icon
              const isFirst = i === 0

              return (
                <div key={item.id} className="flex gap-3 relative group">
                  {/* Icon */}
                  <div className={`relative z-10 h-10 w-10 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0 ${isFirst ? "ring-2 ring-primary/20" : ""}`}>
                    <Icon className={`h-4 w-4 ${config.text}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-4 min-w-0">
                    <div className="bg-card rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm group-hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{tc((config.labelKey || "actTypeNote") as any)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.date).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {item.author && <span className="text-xs text-muted-foreground ml-auto">{item.author}</span>}
                      </div>
                      {item.type === "email" && item.contactName && (
                        <p className="text-xs text-muted-foreground mb-1">
                          → {item.contactName}
                        </p>
                      )}
                      <p className="text-sm font-medium">{item.subject}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-line">{item.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
