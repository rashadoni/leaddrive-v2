"use client"

/**
 * The visits on top of a client's card and an institution's card (owner,
 * 2026-10-16, from a picture): the last visit — when, who, to whom, what was
 * shown — the visit the agent left open now, the next one with «Запланировать»,
 * and the latest visits in a list. The summary comes from the card's own API
 * (`readMtmClientVisitSummary`); a visit left open is the visits page's own
 * notion (`isMtmVisitLeftOpen`), with the same reminder to the agent.
 */
import Link from "next/link"
import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarPlus } from "lucide-react"
import { Hint, HintValue } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { isMtmVisitLeftOpen } from "@/lib/mtm/visit-left-open"
import type { MtmClientVisitLine, MtmClientVisitSummary } from "@/lib/mtm/client-visit-summary"
import { RemindAgentButton, useMinuteClock, useOpenForText } from "@/app/(dashboard)/mtm/visits/visit-left-open"

type Kind = "contact" | "institution"

const OUTCOMES = new Set(["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"])

function useVisitWords(timezone: string) {
  const t = useTranslations("mtmClientVisits")
  const locale = useLocale()
  const when = (value: string) => formatDateTime(value, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }) || "—"
  const day = (value: string) => formatDate(`${value}T12:00:00.000Z`, locale, { day: "numeric", month: "short", timeZone: "UTC" })
  const monthName = (key: string) => formatDate(`${key}-15T12:00:00.000Z`, locale, { month: "long", timeZone: "UTC" })
  /** «к Abbasov Aydın · показал «Forlaks» · 7 стр. · фото 1 · подпись». */
  const detail = (visit: MtmClientVisitLine & { resultNotes?: string | null }, kind: Kind) => [
    kind === "institution" && visit.contact ? t("toWhom", { name: visit.contact.displayName }) : null,
    visit.outcome && OUTCOMES.has(visit.outcome) ? t(`outcomes.${visit.outcome}`) : null,
    kind === "contact" ? visit.customer.name : null,
    ...visit.shown.map((item) => [t("shown", { product: item.product }), item.pages ? t("pages", { count: item.pages }) : null].filter(Boolean).join(" · ")),
    visit.photos > 0 ? t("photos", { count: visit.photos }) : null,
    visit.signed ? t("signed") : null,
    // What the agent wrote after the visit, where the line carries it.
    "resultNotes" in visit && typeof visit.resultNotes === "string" && visit.resultNotes.trim() ? `«${visit.resultNotes.trim()}»` : null,
  ].filter(Boolean).join(" · ")
  return { t, when, day, monthName, detail }
}

function Cell({ label, hint, tone, children, testId }: { label: string; hint: string; tone?: "amber"; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className={cn("grid content-start gap-1 px-5 py-4", tone === "amber" && "")}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><HintValue text={hint}>{label}</HintValue></span>
      {children}
    </div>
  )
}

export function MtmClientVisitStrip({ kind, summary, longOpenMinutes, timezone, orgId, planHref }: {
  kind: Kind
  summary: MtmClientVisitSummary
  longOpenMinutes: number
  timezone: string
  orgId?: string
  /** «Запланировать»: the route planner with this client already on the route. */
  planHref: string | null
}) {
  const { t, when, day, monthName, detail } = useVisitWords(timezone)
  const now = useMinuteClock()
  const openFor = useOpenForText()
  const month = monthName(summary.month)
  const last = summary.lastClosed
  const open = summary.open
  const leftOpen = open ? isMtmVisitLeftOpen(open, now, longOpenMinutes) : false

  const lastCell = (
    <Cell testId="mtm-client-visit-last" label={t("lastVisit")} hint={t("hint.lastVisit")}>
      {last ? (
        <>
          <span className="text-[15px] font-semibold">{when(last.checkInAt)} · {last.agent.name}</span>
          {detail(last, kind) ? <span className="text-sm text-muted-foreground">{detail(last, kind)}</span> : null}
          <Link href={`/mtm/visits?visitId=${encodeURIComponent(last.id)}`} className="text-sm font-semibold text-primary hover:underline">{t("openVisit")} →</Link>
        </>
      ) : (
        <>
          <span className="text-[15px] font-semibold text-orange-600 dark:text-orange-400">{t("noVisitYet")}</span>
          <span className="text-sm text-muted-foreground">{t("monthVisits", { month, count: 0 })}</span>
        </>
      )}
    </Cell>
  )
  const openCell = open ? (
    <Cell testId="mtm-client-visit-open" label={t("now")} hint={t("hint.now")} tone={leftOpen ? "amber" : undefined}>
      {leftOpen ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("leftOpen")}</span>
          <span className="text-sm text-amber-900/80 dark:text-amber-200/80">
            {[kind === "institution" && open.contact ? t("toWhom", { name: open.contact.displayName }) : null, t("openSince", { since: when(open.checkInAt), openFor: openFor(open.checkInAt, now) }), open.agent.name].filter(Boolean).join(" · ")}
          </span>
          <span className="mt-1">
            <RemindAgentButton agentId={open.agent.id} customerName={open.customer.name} checkInAt={open.checkInAt} timezone={timezone} orgId={orgId} testId="mtm-client-visit-remind" />
          </span>
        </>
      ) : (
        <>
          <span className="text-[15px] font-semibold">{t("inProgress")}</span>
          <span className="text-sm text-muted-foreground">{[t("since", { since: when(open.checkInAt) }), open.agent.name].join(" · ")}</span>
        </>
      )}
    </Cell>
  ) : null
  const planButton = planHref ? (
    <span className="mt-1">
      <Hint text={t("hint.plan")}>
        <Button asChild size="sm" className="min-h-9">
          <Link href={planHref} data-testid="mtm-client-visit-plan"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{t("plan")}</Link>
        </Button>
      </Hint>
    </span>
  ) : null
  const nextLine = summary.next ? (
    <Link href={`/mtm/routes?routeId=${encodeURIComponent(summary.next.routeId)}`} className="text-[15px] font-semibold hover:text-primary hover:underline">
      {[summary.next.plannedTime ? when(summary.next.plannedTime) : day(summary.next.date), summary.next.agent?.name].filter(Boolean).join(" · ")}
    </Link>
  ) : <span className="text-[15px] font-semibold text-orange-600 dark:text-orange-400">{t("notPlanned")}</span>
  const nextCell = (
    <Cell testId="mtm-client-visit-next" label={t("next")} hint={t("hint.next")}>
      {nextLine}
      <span className="text-sm text-muted-foreground">{t("monthVisits", { month, count: summary.monthClosed })}</span>
      {summary.next ? null : planButton}
    </Cell>
  )
  const clientsCell = summary.clientsHere ? (
    <Cell testId="mtm-client-visit-clients" label={t("clientsHere")} hint={t("hint.clientsHere", { month })}>
      <span className="text-[15px] font-semibold">
        {t("clientsCount", { count: summary.clientsHere.active })}
        {summary.clientsHere.active > 0 ? (
          <span className={summary.clientsHere.notVisitedThisMonth > 0 ? "text-orange-600 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}>
            {" · "}{summary.clientsHere.notVisitedThisMonth > 0
              ? t("clientsNotVisited", { count: summary.clientsHere.notVisitedThisMonth, month })
              : t("allVisited", { month })}
          </span>
        ) : null}
      </span>
      {open ? (
        <>
          <span className="text-sm text-muted-foreground">{summary.next ? t("nextOn", { next: [summary.next.plannedTime ? when(summary.next.plannedTime) : day(summary.next.date), summary.next.agent?.name].filter(Boolean).join(" · ") }) : t("nextNotPlanned")}</span>
          {summary.next ? null : planButton}
        </>
      ) : null}
    </Cell>
  ) : null

  const cells = kind === "contact"
    ? [lastCell, openCell ?? (
        <Cell key="month" testId="mtm-client-visit-month" label={t("monthLabel", { month })} hint={t("hint.month", { month })}>
          <span className="text-[15px] font-semibold">{t("monthVisits", { month, count: summary.monthClosed })}</span>
          <span className="text-sm text-muted-foreground">{t("totalVisits", { count: summary.total })}</span>
        </Cell>
      ), nextCell]
    : [lastCell, openCell ?? nextCell, clientsCell ?? (openCell ? nextCell : null)]
  return (
    <div data-testid="mtm-client-visit-strip" className="grid divide-y divide-border border-t border-border md:grid-cols-3 md:divide-x md:divide-y-0">
      {cells.filter(Boolean).map((cell, index) => <div key={index} className="contents">{cell}</div>)}
    </div>
  )
}

/** The latest visits, one line each: when, who, to whom, what was shown, and what state it is in. */
export function MtmClientVisitList({ kind, visits, total, longOpenMinutes, timezone, title }: {
  kind: Kind
  visits: Array<MtmClientVisitLine & { resultNotes?: string | null }>
  total: number
  longOpenMinutes: number
  timezone: string
  title?: ReactNode
}) {
  const { t, when, detail } = useVisitWords(timezone)
  const now = useMinuteClock()
  const openFor = useOpenForText()
  return (
    <section data-testid="mtm-client-visit-list" className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title ?? t("listTitle", { count: total })}</h2>
        {total > visits.length ? <span className="text-xs text-muted-foreground">{t("listLatest", { count: visits.length })}</span> : null}
      </div>
      {visits.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-border">
          {visits.map((visit) => {
            const leftOpen = isMtmVisitLeftOpen(visit, now, longOpenMinutes)
            return (
              <li key={visit.id} data-testid={`mtm-client-visit-${visit.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm sm:flex-nowrap">
                <Link href={`/mtm/visits?visitId=${encodeURIComponent(visit.id)}`} className="w-32 shrink-0 font-semibold tabular-nums hover:text-primary hover:underline">{when(visit.checkInAt)}</Link>
                <span className="w-44 shrink-0 truncate">{visit.agent.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={detail(visit, kind)}>{detail(visit, kind) || "—"}</span>
                <span className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  leftOpen ? "text-amber-700 dark:text-amber-300"
                    : visit.status === "CHECKED_IN" ? "text-sky-700 dark:text-sky-300"
                      : "text-emerald-700 dark:text-emerald-300",
                )}>
                  {leftOpen ? t("statusLeftOpen", { openFor: openFor(visit.checkInAt, now) }) : visit.status === "CHECKED_IN" ? t("statusInProgress") : t("statusClosed")}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
