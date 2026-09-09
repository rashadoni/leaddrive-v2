"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Globe, Loader2, RefreshCw, Send, Users } from "lucide-react"
import { Button } from "@/components/ui/button"

const SENTIMENT_COLORS = {
  positive: "#22c55e",
  neutral: "#6b7280",
  negative: "#ef4444",
} as const

// Брендовые бейджи платформ (SVG — те же, что в CONNECT_CHANNELS на странице
// мониторинга): иконка + цифра читаются в одну строку, без текстовых чипов.
const PLATFORM_BRAND: Record<string, { label: string; bg: string; icon: ReactNode }> = {
  facebook: { label: "Facebook", bg: "#1877f2",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M14 9h3l.4-3H14V4.3c0-.9.3-1.5 1.6-1.5H17V.1C16.7.1 15.7 0 14.5 0 12 0 10.3 1.5 10.3 4.2V6H7.5v3h2.8v9H14z"/></svg> },
  instagram: { label: "Instagram", bg: "radial-gradient(120% 120% at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 70%, #285AEB 100%)",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-3 w-3"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg> },
  tiktok: { label: "TikTok", bg: "#10131a",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M16 3c.3 2 1.5 3.4 3.5 3.7V9c-1.3 0-2.5-.4-3.5-1v5.8c0 3-2.2 5.2-5 5.2S6 16.8 6 13.9s2.4-5 5.2-4.7v2.4c-1.4-.3-2.7.6-2.7 2.1 0 1.3 1 2.3 2.3 2.3 1.4 0 2.4-1 2.4-2.6V3z"/></svg> },
  youtube: { label: "YouTube", bg: "#ff0033",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M23 12s0-3.2-.4-4.7c-.2-.8-.9-1.5-1.7-1.7C19.4 5.2 12 5.2 12 5.2s-7.4 0-8.9.4c-.8.2-1.5.9-1.7 1.7C1 8.8 1 12 1 12s0 3.2.4 4.7c.2.8.9 1.5 1.7 1.7 1.5.4 8.9.4 8.9.4s7.4 0 8.9-.4c.8-.2 1.5-.9 1.7-1.7C23 15.2 23 12 23 12zM9.8 15.3V8.7l5.7 3.3z"/></svg> },
  twitter: { label: "X", bg: "#0f0f14",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M17.5 3h3l-6.6 7.5L21.7 21h-5.9l-4.2-5.5L6.5 21H3.4l7-8L2.6 3h6l3.8 5zM16.4 19.2h1.6L7.6 4.7H5.9z"/></svg> },
  telegram: { label: "Telegram", bg: "#0088cc", icon: <Send className="h-3 w-3" aria-hidden="true" /> },
  vkontakte: { label: "VK", bg: "#0077ff", icon: <span className="text-[8px] font-bold leading-none">VK</span> },
  web: { label: "Web", bg: "#0ea5e9", icon: <Globe className="h-3 w-3" aria-hidden="true" /> },
}

export type MonitoringClientOverviewProfile = {
  id: string
  subjectId: string | null
  name: string
  logoUrl: string | null
  status: string
  findings: {
    total: number
    new: number
    positive: number
    neutral: number
    negative: number
    needsReview: number
  }
  findingsByPlatform: Record<string, number>
  lastCollectedAt: string | null
}

type MonitoringClientOverviewProps = {
  onOpenProfile: (profile: MonitoringClientOverviewProfile) => void
}

function ClientLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      // Runtime brand logos are authenticated, same-origin uploads.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-lg border bg-background object-contain"
        onError={() => setFailedUrl(logoUrl)}
      />
    )
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">
      {name.trim().slice(0, 2).toUpperCase()}
    </span>
  )
}

/**
 * Сводка «по каждому клиенту» для дашборда: тональность и платформы на
 * строку клиента. Клик по строке открывает находки клиента.
 */
export function MonitoringClientOverview({ onOpenProfile }: MonitoringClientOverviewProps) {
  const t = useTranslations("socialMonitoring")
  const locale = useLocale()
  const [profiles, setProfiles] = useState<MonitoringClientOverviewProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    setLoading(true)
    try {
      const response = await fetch("/api/v1/social/monitoring-profiles")
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error ?? "load_failed")
      setProfiles((body.data.profiles ?? []) as MonitoringClientOverviewProfile[])
    } catch {
      setError(true)
      setProfiles(current => current ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = (profiles ?? [])
    .filter(profile => profile.status !== "archived")
    .sort((a, b) =>
      b.findings.new - a.findings.new
      || b.findings.negative - a.findings.negative
      || b.findings.total - a.findings.total
      || a.name.localeCompare(b.name),
    )

  return (
    <div className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
      <div className="flex flex-col gap-1 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("clientOverview.title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("clientOverview.hint")}</p>
        </div>
        {error && (
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("clientOverview.retry")}
          </Button>
        )}
      </div>

      {loading && visible.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("clientOverview.loading")}
        </div>
      ) : error && visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("clientOverview.error")}</p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("clientOverview.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t("clientOverview.clientColumn")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("clientOverview.totalColumn")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("clientOverview.newColumn")}</th>
                <th className="px-4 py-2 font-medium">{t("clientOverview.sentimentColumn")}</th>
                <th className="px-4 py-2 font-medium">{t("clientOverview.platformsColumn")}</th>
                <th className="px-4 py-2 font-medium">{t("clientOverview.lastCollectedColumn")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {visible.map(profile => {
                const { positive, neutral, negative } = profile.findings
                const sentimentTotal = positive + neutral + negative
                const platforms = Object.entries(profile.findingsByPlatform)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                return (
                  <tr
                    key={profile.id}
                    data-testid={`social-client-overview-row-${profile.id}`}
                    // Строка кликабельна только как удобство для мыши; доступной
                    // точкой входа служит настоящая кнопка с именем клиента —
                    // role="button" на <tr> ломал бы таблицу для скринридеров.
                    onClick={() => onOpenProfile(profile)}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          onOpenProfile(profile)
                        }}
                        aria-label={t("clientOverview.openAria", { name: profile.name })}
                        className="flex min-w-0 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ClientLogo name={profile.name} logoUrl={profile.logoUrl} />
                        <span className="truncate font-medium underline-offset-2 hover:underline">{profile.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{profile.findings.total}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`tabular-nums ${profile.findings.new > 0 ? "font-semibold text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                        {profile.findings.new}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-[220px] space-y-1.5">
                        {/* Подписи обязательны: одни цветные точки клиенту непонятны. */}
                        <span className="flex items-center gap-3 whitespace-nowrap text-xs">
                          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SENTIMENT_COLORS.positive }} />{t("positive")} <b className="tabular-nums">{positive}</b></span>
                          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SENTIMENT_COLORS.neutral }} />{t("neutral")} <b className="tabular-nums">{neutral}</b></span>
                          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SENTIMENT_COLORS.negative }} />{t("negative")} <b className="tabular-nums">{negative}</b></span>
                        </span>
                        {sentimentTotal > 0 && (
                          <span className="flex h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-muted" role="img" aria-label={t("clientOverview.sentimentColumn")}>
                            <span style={{ width: `${(positive / sentimentTotal) * 100}%`, background: SENTIMENT_COLORS.positive }} />
                            <span style={{ width: `${(neutral / sentimentTotal) * 100}%`, background: SENTIMENT_COLORS.neutral }} />
                            <span style={{ width: `${(negative / sentimentTotal) * 100}%`, background: SENTIMENT_COLORS.negative }} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {platforms.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="flex items-center gap-3 whitespace-nowrap">
                          {platforms.map(([platform, count]) => {
                            const brand = PLATFORM_BRAND[platform]
                            return (
                              <span key={platform} className="inline-flex items-center gap-1" title={brand?.label ?? platform}>
                                <span
                                  aria-label={brand?.label ?? platform}
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white ring-1 ring-black/5 dark:ring-white/10"
                                  style={{ background: brand?.bg ?? "#6b7280" }}
                                >
                                  {brand?.icon ?? <span className="text-[8px] font-bold uppercase leading-none">{platform.slice(0, 2)}</span>}
                                </span>
                                <b className="text-xs tabular-nums">{count}</b>
                              </span>
                            )
                          })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {profile.lastCollectedAt
                        ? new Date(profile.lastCollectedAt).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : t("clientOverview.never")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
