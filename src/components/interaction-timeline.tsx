"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Phone, Mail, MessageSquare, LifeBuoy, FileText, Loader2, ArrowDownLeft, ArrowUpRight, CheckSquare, ClipboardList } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  CALL_DISPOSITION_I18N_KEYS,
  isCallDisposition,
} from "@/lib/calls/disposition"

interface TimelineEntry {
  id: string
  kind: "activity" | "call" | "email" | "message" | "ticket" | "task" | "form"
  channel?: string
  direction?: string
  title: string | null
  subtitle?: string
  date: string
  meta?: Record<string, unknown>
}

const KIND_ICON: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  message: MessageSquare,
  ticket: LifeBuoy,
  activity: FileText,
  task: CheckSquare,
  form: ClipboardList,
}

/** Proper-cased display names for omni-channel message channels (stored lowercase). */
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  sms: "SMS",
  facebook: "Facebook",
  instagram: "Instagram",
  vkontakte: "VKontakte",
  email: "Email",
}

/**
 * Unified interaction timeline (Slice 1). Reads the query-time UNION endpoint
 * `/api/v1/contacts/[id]/timeline` and renders one reverse-chronological feed.
 * The API returns no human chrome (kind/channel/direction + raw content); all
 * labels are localized here so the same response works in every locale.
 */
export function InteractionTimeline({ entity, id, orgId }: { entity: "contact" | "lead"; id: string; orgId?: string }) {
  const t = useTranslations("common")
  const tv = useTranslations("voip")
  const [items, setItems] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {}
    fetch(`/api/v1/${entity}s/${id}/timeline`, { headers })
      .then((r) => r.json())
      .then((j) => { if (j.success) setItems(j.data.timeline || []); else setError(true) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [entity, id, orgId])

  const titleFor = (e: TimelineEntry): string => {
    if (e.kind === "call") return e.direction === "inbound" ? t("timelineCallInbound") : t("timelineCallOutbound")
    if (e.title) return e.title
    if (e.kind === "email") return t("timelineNoSubject")
    if (e.kind === "form") return t("timelineForm")
    if (e.kind === "task") return t("timelineTask")
    if (e.kind === "message") {
      const c = e.channel
      if (!c || c === "message") return t("timelineMessage")
      return CHANNEL_LABEL[c] || c.charAt(0).toUpperCase() + c.slice(1)
    }
    if (e.kind === "activity") {
      const at = String(e.meta?.activityType || "")
      const map: Record<string, string> = {
        note: t("timelineNote"), meeting: t("timelineMeeting"), task: t("timelineTask"), call: t("timelineCall"),
      }
      return map[at] || t("timelineActivity")
    }
    return t("timelineActivity")
  }

  const subtitleFor = (e: TimelineEntry): string | undefined => {
    if (
      e.kind === "call"
      && e.subtitle === e.meta?.disposition
      && isCallDisposition(e.meta?.disposition)
    ) {
      return tv(CALL_DISPOSITION_I18N_KEYS[e.meta.disposition])
    }
    return e.subtitle
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("timelineLoading")}
      </div>
    )
  }
  if (error) {
    return <p className="text-sm text-destructive text-center py-8">{t("timelineError")}</p>
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">{t("timelineEmpty")}</p>
  }

  return (
    <div className="relative space-y-4 pl-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border">
      {items.map((e) => {
        const Icon = KIND_ICON[e.kind] || FileText
        const DirIcon = e.direction === "inbound" ? ArrowDownLeft : e.direction === "outbound" ? ArrowUpRight : null
        const subtitle = subtitleFor(e)
        return (
          <div key={e.id} className="relative">
            <div className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-zinc-200 dark:border-zinc-700">
              <Icon className="h-3 w-3 text-muted-foreground" />
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium flex items-center gap-1.5 min-w-0">
                  {DirIcon && <DirIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                  <span className="truncate">{titleFor(e)}</span>
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {new Date(e.date).toLocaleDateString()}
                </span>
              </div>
              {subtitle && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{subtitle}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
