"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Clock3, Copy, Loader2, Mail, Newspaper, Rss } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type GoogleAlertsSettings = {
  intakeAddress: string
  activeScenarioCount: number
  terms: string[]
  autoSyncAvailable: boolean
  automaticScenarioSyncAvailable: boolean
  // Прежний канал прямого обхода азербайджанских изданий выведен из
  // эксплуатации: веб покрывается только лентами Google Alerts. Поле ещё
  // приходит от API ради совместимости, но картой не показывается.
  automaticCollection?: unknown
  // Необязательное: у клиента может быть закэширован service worker'ом ответ
  // старой версии API, и разыменование без защиты уронило бы всю страницу.
  rssFeeds?: {
    connectedCount: number
    activeCount: number
    failingCount: number
    allEmpty: boolean
    lastCheckedAt: string | null
    lastSuccessfulAt: string | null
    foundOnLastRuns: number
    createdOnLastRuns: number
    hasRuns: boolean
  }
}

export function GoogleAlertsNewsSettingsCard() {
  const t = useTranslations("socialMonitoring")
  const [settings, setSettings] = useState<GoogleAlertsSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/social/google-alerts", { signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok || !body.success) throw new Error("load_failed")
        setSettings(body.data)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setFailed(true)
      })
    return () => controller.abort()
  }, [])

  const copyAddress = async () => {
    if (!settings) return
    await navigator.clipboard.writeText(settings.intakeAddress)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const formatTimestamp = (value: string | null) => {
    if (!value) return t("googleAlerts.neverChecked")
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return t("googleAlerts.neverChecked")
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
              <Newspaper className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold">{t("googleAlerts.title")}</h2>
            <Badge variant="success" className="text-[10px]">{t("googleAlerts.free")}</Badge>
            <Badge variant="outline" className="text-[10px]">{t("googleAlerts.newsOnly")}</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
            {t("googleAlerts.description")}
          </p>
        </div>
        {settings && (
          <Badge variant={settings.activeScenarioCount > 0 ? "success" : "warning"} className="shrink-0 text-[10px]">
            {t("googleAlerts.scenarioCount", { count: settings.activeScenarioCount })}
          </Badge>
        )}
      </div>

      {failed ? (
        <p className="mt-4 text-xs text-red-600 dark:text-red-400">{t("googleAlerts.loadFailed")}</p>
      ) : !settings ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("googleAlerts.loading")}
        </div>
      ) : (
        <div className="mt-4">
          {/* Подключённые RSS-ленты Google Alerts: раньше карточка их не видела
              (считала только бесплатный новостной канал), и владелец не мог
              подтвердить, что лента вообще привязана и опрашивается. */}
          {settings.rssFeeds && (
            <div className="border-b border-zinc-200 py-3 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <Rss className="h-3.5 w-3.5 text-orange-600 dark:text-orange-300" />
                <div className="text-xs font-semibold">{t("googleAlerts.rssTitle")}</div>
                <Badge
                  variant={settings.rssFeeds.failingCount > 0 ? "warning" : settings.rssFeeds.activeCount > 0 ? "success" : "outline"}
                  className="text-[10px]"
                >
                  {settings.rssFeeds.connectedCount > 0
                    ? t("googleAlerts.rssConnectedCount", { count: settings.rssFeeds.connectedCount })
                    : t("googleAlerts.rssNone")}
                </Badge>
                {/* Подключена, но не опрашивается (сценарий на паузе) — иначе
                    зелёный бейдж обещал бы сбор, которого нет. */}
                {settings.rssFeeds.connectedCount > settings.rssFeeds.activeCount && (
                  <Badge variant="outline" className="text-[10px]">
                    {t("googleAlerts.rssPaused", { count: settings.rssFeeds.connectedCount - settings.rssFeeds.activeCount })}
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-5 text-muted-foreground">
                {settings.rssFeeds.connectedCount > 0
                  ? t("googleAlerts.rssDescription")
                  : t("googleAlerts.rssEmptyHint")}
              </p>
              {settings.rssFeeds.connectedCount > 0 && (
                <div className="mt-2 grid max-w-md gap-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      {t("googleAlerts.lastChecked")}
                    </span>
                    <span className="text-right font-medium text-foreground">
                      {formatTimestamp(settings.rssFeeds.lastCheckedAt)}
                    </span>
                  </div>
                  {settings.rssFeeds.hasRuns && (
                    <div className="flex items-center justify-between gap-3">
                      <span>{t("googleAlerts.rssLastRuns")}</span>
                      <span className="text-right font-medium text-foreground">
                        {t("googleAlerts.latestRunCounts", {
                          found: settings.rssFeeds.foundOnLastRuns,
                          created: settings.rssFeeds.createdOnLastRuns,
                        })}
                      </span>
                    </div>
                  )}
                  {settings.rssFeeds.failingCount > 0 ? (
                    <p className="leading-4 text-amber-700 dark:text-amber-300">
                      {t("googleAlerts.rssFailing", { count: settings.rssFeeds.failingCount })}
                    </p>
                  ) : settings.rssFeeds.allEmpty ? (
                    <p className="leading-4 text-amber-700 dark:text-amber-300">{t("googleAlerts.rssFeedEmpty")}</p>
                  ) : null}
                </div>
              )}
            </div>
          )}

          <div className="py-3">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="text-xs font-semibold">{t("googleAlerts.optionalAlertsTitle")}</div>
              <Badge variant="outline" className="text-[10px]">{t("googleAlerts.optional")}</Badge>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t("googleAlerts.setupHint")}</p>
            <div className="text-[11px] font-medium text-muted-foreground">{t("googleAlerts.intakeAddress")}</div>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all text-xs text-foreground">{settings.intakeAddress}</code>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={copyAddress}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("googleAlerts.copied") : t("googleAlerts.copy")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {settings.terms.slice(0, 12).map(term => (
              <span key={term} className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {term}
              </span>
            ))}
            {settings.terms.length > 12 && (
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                +{settings.terms.length - 12}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            {t("googleAlerts.scenarioSyncAutomatic")}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {t("googleAlerts.autoSyncUnavailable")}
          </p>
        </div>
      )}
    </section>
  )
}
