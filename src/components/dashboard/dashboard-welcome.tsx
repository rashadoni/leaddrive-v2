"use client"

import { useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, Bot, Send, Sparkles } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import type { ResolvedQuickAction } from "@/lib/dashboard/quick-actions"

type DashboardWelcomeProps = {
  userName?: string | null
  lastUpdated: Date
  data: {
    pipeline: { deals: number; wonValue: number; conversionRate: number }
    leads: { activeCount: number; total: number; conversionRate: number }
    operations: { openTickets: number; slaBreached: number }
  }
  /** `welcomeGreeting` widget: greeting, Da Vinci field, quick actions. */
  showGreeting?: boolean
  /** `welcomeBrief` widget: the "focus for today" panel on the right. */
  showBrief?: boolean
  /** Configured in /settings/dashboard; already filtered to what this user may open. */
  quickActions?: ResolvedQuickAction[]
}

function getFirstName(name?: string | null): string | null {
  const firstName = name?.trim().split(/\s+/)[0]
  return firstName || null
}

/**
 * The dashboard's opening canvas. Under the live wallpaper (the default for
 * every user) it is deliberately NOT a card: the greeting, the Da Vinci field
 * and the briefing float straight over the video, the way a launcher home
 * screen does. The card treatment in globals.css only applies when the user
 * has switched the wallpaper off and there is nothing behind the hero.
 */
export function DashboardWelcome({
  userName,
  lastUpdated,
  data,
  showGreeting = true,
  showBrief = true,
  quickActions = [],
}: DashboardWelcomeProps) {
  const t = useTranslations("dashboard")
  const tNav = useTranslations("nav")
  const locale = useLocale()
  const [query, setQuery] = useState("")
  const hour = lastUpdated.getHours()
  const greeting = hour < 12
    ? t("greeting.morning")
    : hour < 18
      ? t("greeting.afternoon")
      : t("greeting.evening")
  const firstName = getFirstName(userName)
  const activeLeads = data.leads.activeCount || data.leads.total || 0
  const conversion = data.pipeline.conversionRate || data.leads.conversionRate || 0
  const briefingQuery = t("welcome.briefingQuery")

  function openAssistant(message: string) {
    const normalized = message.trim()
    window.dispatchEvent(new CustomEvent("davinci:open", {
      detail: normalized ? { query: normalized } : undefined,
    }))
  }

  function submitQuery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!query.trim()) return
    openAssistant(query)
    setQuery("")
  }

  const focusItems = [
    data.operations.slaBreached > 0
      ? t("welcome.focusSla", { count: data.operations.slaBreached })
      : t("welcome.focusSlaClear"),
    activeLeads > 0
      ? t("welcome.focusLeads", { count: activeLeads })
      : t("welcome.focusLeadsEmpty"),
    data.pipeline.deals > 0
      ? t("welcome.focusDeals", { count: data.pipeline.deals, conversion })
      : t("welcome.focusDealsEmpty"),
  ]

  // Both halves are registry widgets, so a tenant can switch either off in
  // /settings/dashboard. With neither the hero is gone entirely — no empty
  // canvas holding the first screen hostage.
  if (!showGreeting && !showBrief) return null

  return (
    <section
      className={`dashboard-welcome${showGreeting ? "" : " dashboard-welcome--brief-only"}`}
      aria-labelledby={showGreeting ? "dashboard-welcome-title" : "dashboard-brief-title"}
    >
      {/* Decorative route motif for the no-wallpaper card only; hidden under video. */}
      <div className="dashboard-welcome-route" aria-hidden="true">
        <svg viewBox="0 0 860 320" preserveAspectRatio="none">
          <path className="dashboard-welcome-route-shadow" d="M-70 306 C 120 164, 286 374, 468 194 S 760 84, 940 -30" />
          <path className="dashboard-welcome-route-line" d="M-70 306 C 120 164, 286 374, 468 194 S 760 84, 940 -30" />
        </svg>
      </div>

      <div className="dashboard-welcome-grid">
        {showGreeting ? (
        <div className="dashboard-welcome-main">
          <p className="dashboard-welcome-meta">
            <time dateTime={lastUpdated.toISOString()}>
              {formatDate(lastUpdated, locale, { weekday: "long", day: "numeric", month: "long" })}
              {`, ${lastUpdated.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`}
            </time>
          </p>

          <div className="dashboard-welcome-copy">
            <h1 id="dashboard-welcome-title">
              {greeting}{firstName ? `, ${firstName}` : ""}!
            </h1>
            <p>{t("welcome.subtitle")}</p>
          </div>

          <form className="dashboard-welcome-command" onSubmit={submitQuery}>
            <label htmlFor="dashboard-welcome-ai">{t("welcome.askLabel")}</label>
            <div>
              <Sparkles aria-hidden="true" />
              <input
                id="dashboard-welcome-ai"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("welcome.askPlaceholder")}
                autoComplete="off"
              />
              <button type="submit" aria-label={t("welcome.askSubmit")} disabled={!query.trim()}>
                <Send aria-hidden="true" />
              </button>
            </div>
          </form>

          {quickActions.length > 0 ? (
            <nav className="dashboard-welcome-actions" aria-label={t("welcome.quickActions")}>
              {quickActions.map((action) => {
                const Icon = action.icon
                const label = action.labelNamespace === "nav"
                  ? tNav(action.labelKey)
                  : t(action.labelKey)
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={`dashboard-welcome-action${action.primary ? " dashboard-welcome-action--primary" : ""}`}
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </Link>
                )
              })}
            </nav>
          ) : null}
        </div>
        ) : null}

        {showBrief ? (
        <aside className="dashboard-welcome-brief" aria-labelledby="dashboard-brief-title">
          <div className="dashboard-welcome-brief-heading">
            <span><Bot aria-hidden="true" /></span>
            <div>
              <p>{t("welcome.aiLabel")}</p>
              <h2 id="dashboard-brief-title">{t("welcome.briefTitle")}</h2>
            </div>
          </div>

          <ol>
            {focusItems.map((item, index) => (
              <li key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </li>
            ))}
          </ol>

          <button type="button" className="dashboard-welcome-brief-action" onClick={() => openAssistant(briefingQuery)}>
            <span>{t("welcome.openBriefing")}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </aside>
        ) : null}
      </div>
    </section>
  )
}
