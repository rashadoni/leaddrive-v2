"use client"

/**
 * C3 (Creatio 10X roadmap) — «Активность на сайте» on the contact card.
 *
 * Lazy tab: fetches the contact's stitched web sessions (C2) on first mount
 * and renders them newest-first — visit header (date, duration, pageviews,
 * first-touch UTM) + the pages/events of the visit. Pricing/product pages
 * get a highlight badge: that is the buying signal the card exists to show.
 */
import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Globe, Loader2, Tag } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format-date"
// The ONE buying-signal classifier — same list the account-engagement pixel
// scores with, so the card's highlight always agrees with the intent score.
import { classifyPageUrl } from "@/lib/account-engagement/track-pixel"

interface WebAction {
  id: string
  type: string
  name: string | null
  url: string | null
  createdAt: string
}

interface WebSessionRow {
  id: string
  startedAt: string
  lastSeenAt: string
  durationMinutes: number
  pageViews: number
  entryUrl: string | null
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  actions: WebAction[]
}

interface Payload {
  totalSessions: number
  totalPageViews: number
  truncated: boolean
  sessions: WebSessionRow[]
}

function pathOf(url: string | null): string {
  if (!url) return "—"
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

export function ContactWebActivity({ contactId, orgId }: { contactId: string; orgId?: string | number }) {
  const t = useTranslations("contactWebActivity")
  const locale = useLocale()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/contacts/${contactId}/web-activity`, {
          headers: orgId ? { "x-organization-id": String(orgId) } : undefined,
        })
        const json = res.ok ? await res.json() : null
        if (!cancelled) {
          if (json?.success) setPayload(json.data)
          else setFailed(true) // a broken endpoint must not read as "no activity"
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [contactId, orgId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
        {t("loadError")}
      </div>
    )
  }

  if (!payload || payload.sessions.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
        {t("empty")}
        <div className="mt-1 text-xs">{t("emptyHint")}</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {t("summary", { sessions: payload.totalSessions, views: payload.totalPageViews })}
        {payload.truncated && <> · {t("showingLatest", { n: payload.sessions.length })}</>}
      </div>

      {payload.sessions.map((s) => (
        <div key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-b border-zinc-100 dark:border-zinc-800">
            <span className="font-medium text-sm">
              {formatDateTime(s.startedAt, locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-muted-foreground">{t("durationMin", { n: s.durationMinutes })}</span>
            <span className="text-muted-foreground">{t("pageViewsN", { n: s.pageViews })}</span>
            {(s.utmSource || s.utmCampaign) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 px-2 py-0.5">
                <Tag className="h-3 w-3" />
                {[s.utmSource, s.utmCampaign].filter(Boolean).join(" / ")}
              </span>
            )}
            {s.referrer && (
              <span className="text-muted-foreground truncate max-w-[240px]" title={s.referrer}>
                ← {s.referrer.replace(/^https?:\/\//, "")}
              </span>
            )}
          </div>
          <div className="px-3 py-2 space-y-1">
            {s.actions.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t("noActions")}</div>
            ) : (
              s.actions.map((a) => {
                const hot = classifyPageUrl(a.url) === "page_view_high_intent"
                return (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground tabular-nums shrink-0 w-10">
                      {formatDateTime(a.createdAt, locale, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {a.type === "event" ? (
                      <span className="rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-1.5 py-0.5">
                        ⚡ {a.name || t("customEvent")}
                      </span>
                    ) : (
                      <span className={cn("truncate", hot && "font-medium")} title={a.url ?? undefined}>
                        {pathOf(a.url)}
                      </span>
                    )}
                    {hot && a.type !== "event" && (
                      <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5">
                        {t("hotPage")}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
