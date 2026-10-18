"use client"

import { useMemo, type MouseEvent, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ArrowLeft, BookOpen, Bot, CheckCircle2, CircleDot, Clock, FileText, Keyboard, Lock, MessageSquareWarning, Paperclip, Send, ShieldAlert, Star, Timer, UserCheck, UserX, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatBubble } from "@/components/tickets/chat-history-view"
import { TicketClosureRequestView } from "@/components/tickets/ticket-closure-request-view"
import { closureRequestWhatsAppText, ticketStatusWhatsAppText } from "@/lib/ticketing/customer-ticket-text"
import { compareAgentQueueRows } from "@/lib/ticketing/agent-desktop"
import { SLA_POLICY_PRIORITIES, splitSlaDuration, summarizeSlaPolicyCoverage } from "@/lib/ticketing/sla-policy"
import { createDateFormatter } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoLabel, demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import { addDays, mtmDemoAt, mtmDemoToday } from "./mtm-demo-data"
import {
  SUPPORT_DEMO_AGENT,
  SUPPORT_DEMO_ARTICLE,
  SUPPORT_DEMO_CLOCK,
  SUPPORT_DEMO_CLOSURE_LINK,
  SUPPORT_DEMO_CUSTOMER_MESSAGES,
  SUPPORT_DEMO_CUSTOMER_CONFIRMS,
  SUPPORT_DEMO_DRAFT,
  SUPPORT_DEMO_ESCALATION_RULES,
  SUPPORT_DEMO_INTERNAL_NOTE,
  SUPPORT_DEMO_POLICIES,
  SUPPORT_DEMO_TICKET_ID,
  SUPPORT_DEMO_TIMES,
  SUPPORT_DEMO_TIMEZONE,
  supportDemoAgentMetrics,
  supportDemoEscalationTimes,
  supportDemoNextTicket,
  supportDemoTickets,
  type SupportDemoTicket,
} from "./support-demo-data"

/**
 * Service Desk: the support module, a module of its own beside the lead story
 * (owner, 2026-10-13: Omni Channel → Service Desk → Call Center → Route &
 * Field → Contracts).
 *
 * The morning queue is an invented equipment-service company's; every SLA
 * date comes from the product's working-hours clock (`support-demo-data.ts`),
 * the queue's «next» from the list page's own rule, the escalation times
 * from `triggerTimeFromDeadline`
 * and the agent's figures from `calculateAgentDesktopMetrics`. The live
 * screens fetch their data, so their frames are redrawn here with the
 * product's parts (`ChatBubble`) and words.
 *
 * What the screens say is what the product does: a reply goes to the
 * customer's WhatsApp and the portal, never by e-mail; Da Vinci drafts and the
 * agent sends; resolving sends the customer two WhatsApp messages — the
 * status and the closure link (`customer-ticket-text.ts`, the product's own
 * words) — and closes by itself after seven days without an answer; an
 * internal note never reaches the customer.
 *
 * The customer's side of resolving is the product's own closure page
 * (`TicketClosureRequestView`, what the link opens); the two messages are
 * plain bubbles from «Dəstək xidməti» — not the AI's, whose marker a status
 * message never carries.
 */

type SupportScreen = "queue" | "ticket" | "resolve" | "rules" | "results"

const SCREEN_OF: Record<string, SupportScreen> = {
  "sd-queue": "queue",
  "sd-ticket": "ticket",
  "sd-resolve": "resolve",
  "sd-rules": "rules",
  "sd-results": "results",
}

/** The Support group's own menu (nav-items «Support»), and the screen each lights up. */
const NAV: ReadonlyArray<{ key: "tickets" | "agentDesktop" | "knowledgeBase" | "slaPoliciesNav" | "escalationRules" | "macros"; screens: readonly SupportScreen[] }> = [
  { key: "tickets", screens: ["queue", "ticket", "resolve"] },
  { key: "agentDesktop", screens: ["results"] },
  { key: "knowledgeBase", screens: [] },
  { key: "slaPoliciesNav", screens: ["rules"] },
  { key: "escalationRules", screens: ["rules"] },
  { key: "macros", screens: [] },
]

// The list page's own colours (tickets/page.tsx), so a pill reads the same here.
const PRIORITY_PILL: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
}
const PRIORITY_DOT: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-green-500" }
const STATUS_PILL: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  open: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  waiting: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400",
}
const STATUS_DOT: Record<string, string> = { new: "bg-blue-500", open: "bg-sky-500", in_progress: "bg-amber-500", waiting: "bg-zinc-400", resolved: "bg-green-500", closed: "bg-zinc-400" }
const STATUS_PIPELINE = ["new", "open", "in_progress", "waiting", "resolved", "closed"] as const
const STATUS_PIPELINE_COLORS: Record<string, string> = {
  new: "bg-orange-700 text-white",
  open: "bg-blue-600 text-white",
  in_progress: "bg-amber-500 text-white",
  waiting: "bg-zinc-600 text-white",
  resolved: "bg-emerald-600 text-white",
  closed: "bg-zinc-700 text-white",
}
const ESCALATION_PILL: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  3: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
}

export function SupportScene(props: DemoSceneProps) {
  const { section, hint } = props
  const tNav = useTranslations("nav")
  const screen = SCREEN_OF[section.id] ?? "queue"

  const keepInDemo = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element | null)?.closest?.("a[href]")
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }

  return (
    <div data-testid="demo-scene-support" className="@container space-y-4" onClickCapture={keepInDemo}>
      <nav aria-label={tNav("groups.Support")} className="flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-card p-1 dark:border-zinc-700">
        {NAV.map((item) => {
          const active = item.screens.includes(screen)
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? undefined : hint(S.supportTabHint))}
              className={cn("rounded-xl px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {tNav(item.key)}
            </button>
          )
        })}
      </nav>
      {screen === "queue" && <QueueScreen {...props} />}
      {(screen === "ticket" || screen === "resolve") && <TicketScreen {...props} resolveStage={screen === "resolve"} />}
      {screen === "rules" && <RulesScreen {...props} />}
      {screen === "results" && <ResultsScreen {...props} />}
    </div>
  )
}

/* ── Shared ──────────────────────────────────────────────────────────── */

function useDemoClock(startedAt: string) {
  const today = mtmDemoToday(startedAt)
  return { today, now: Date.parse(mtmDemoAt(today, SUPPORT_DEMO_CLOCK)) }
}

function useFormat() {
  const locale = useLocale()
  return useMemo(() => {
    const time = createDateFormatter(locale, { timeZone: SUPPORT_DEMO_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    const dayTime = createDateFormatter(locale, { timeZone: SUPPORT_DEMO_TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    const long = createDateFormatter(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    return {
      time: (iso: string) => time.format(new Date(iso)),
      dayTime: (iso: string) => dayTime.format(new Date(iso)),
      long: (date: string) => long.format(new Date(`${date}T12:00:00.000Z`)),
    }
  }, [locale])
}

function useLabels() {
  const t = useTranslations("tickets")
  const tc = useTranslations("common")
  return useMemo(() => ({
    status: (value: string) => ({ new: t("statusNew"), open: t("statusOpen"), in_progress: t("statusInProgress"), waiting: t("statusWaiting"), resolved: t("statusResolved"), closed: t("statusClosed") } as Record<string, string>)[value] ?? value,
    priority: (value: string) => ({ critical: tc("priorityCritical"), high: tc("priorityHigh"), medium: tc("priorityMedium"), low: tc("priorityLow") } as Record<string, string>)[value] ?? value,
    category: (value: string) => ({ general: t("categoryGeneral"), technical: t("categoryTechnical"), billing: t("categoryBilling"), feature_request: t("categoryFeatureRequest") } as Record<string, string>)[value] ?? value,
    channel: (value: string) => ({ whatsapp: t("channelWhatsapp"), email: t("channelEmail"), portal: t("channelPortal") } as Record<string, string>)[value] ?? value,
  }), [t, tc])
}

/** The list page's SLA reading (`getSlaStatus` + `formatTimeLeft`), on the demo's clock. */
function slaReading(ticket: Pick<SupportDemoTicket, "slaDueAt" | "status">, now: number, hr: string, min: string) {
  if (ticket.status === "resolved" || ticket.status === "closed") return { state: "done" as const, text: "" }
  const diff = Date.parse(ticket.slaDueAt) - now
  if (diff <= 0) return { state: "breached" as const, text: "" }
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  return { state: diff < 2 * 3600000 ? "warning" as const : "ok" as const, text: hours > 0 ? `${hours}${hr} ${minutes}${min}` : `${minutes}${min}` }
}

function Pill({ className, dot, children }: { className: string; dot: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {children}
    </span>
  )
}

function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return <section {...rest} className={cn("rounded-xl border border-zinc-200 bg-card text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-zinc-700", className)}>{children}</section>
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase()
}

/* ── Dəstək Mərkəzi: the queue ───────────────────────────────────────── */

function QueueScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("tickets")
  const labels = useLabels()
  const format = useFormat()
  const { today, now } = useDemoClock(snapshot.startedAt)
  const me = snapshot.identity.name
  const taken = snapshot.ui["sd.taken"] === true
  const tickets = useMemo(() => supportDemoTickets(today).map((ticket) => (taken && ticket.id === SUPPORT_DEMO_TICKET_ID ? { ...ticket, assigneeName: me } : ticket)), [today, taken, me])
  const active = tickets.filter((ticket) => ticket.status !== "resolved" && ticket.status !== "closed")
  const next = supportDemoNextTicket(supportDemoTickets(today))
  const counters = [
    { key: "new", label: t("newQueue"), value: active.filter((ticket) => ticket.status === "new").length, meta: t("openQueue", { count: active.length }), icon: CircleDot },
    { key: "unassigned", label: t("statUnassigned"), value: active.filter((ticket) => !ticket.assigneeName).length, meta: t("needsOwner"), icon: UserX },
    { key: "sla", label: t("slaAtRisk"), value: active.filter((ticket) => Date.parse(ticket.slaDueAt) <= now).length, meta: t("needsAttention"), icon: AlertTriangle },
  ]

  const take = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "sd-queue-take") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path: "sd.taken", value: true })
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">{format.long(today)} · {S.mtmAsOf(SUPPORT_DEMO_CLOCK)}</p>
        </div>
        <Button onClick={() => hint(S.demoButtonHint)}>+ {t("newTicket")}</Button>
      </header>

      <Panel data-tour-id="sd-queue-kpis" className="p-2">
        <div className="grid grid-cols-3 gap-1">
          {counters.map(({ key, label, value, meta, icon: Icon }) => (
            <div key={key} className="flex min-h-14 flex-col items-stretch gap-0.5 rounded-lg px-1 py-2 text-center @2xl:flex-row @2xl:items-center @2xl:gap-3 @2xl:px-3 @2xl:text-left">
              <span className={cn("hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground @2xl:flex", key === "sla" && value > 0 && "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400")}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-col items-center @2xl:flex-row @2xl:items-baseline @2xl:gap-1.5"><strong data-testid={`sd-queue-${key}`} className="text-lg tabular-nums">{value}</strong><span className="line-clamp-2 text-xs font-medium leading-tight @2xl:truncate @2xl:text-sm">{label}</span></span>
                <span className="hidden truncate text-xs text-muted-foreground @2xl:block">{meta}</span>
              </span>
            </div>
          ))}
        </div>
        {next ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t px-2 pt-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t("priorityHook")}: <span className="font-medium text-foreground">{next.ticketNumber} · {next.subject}</span>
            </p>
            {taken ? (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{t("takeNextSuccess", { number: next.ticketNumber })}</span>
            ) : (
              <Button size="sm" className="h-9 shrink-0" onClick={take} {...demoTarget("sd-queue-take")}>
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />{t("takeNext")}
              </Button>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel data-tour-id="sd-queue-list" className="overflow-hidden">
        {/* Wide: the list's own columns, the less telling ones only where they fit. */}
        <table className="hidden w-full table-fixed text-sm @3xl:table">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-[72px] px-3 py-2 font-medium">{t("colNumber")}</th>
              <th className="px-3 py-2 font-medium">{t("colSubject")}</th>
              <th className="w-[84px] px-2 py-2 font-medium">{t("colPriority")}</th>
              <th className="w-[92px] px-2 py-2 font-medium">{t("colStatus")}</th>
              <th className="w-[96px] px-2 py-2 font-medium">{t("colSla")}</th>
              <th className="w-[84px] px-2 py-2 font-medium">{t("colEscalation")}</th>
              <th className="hidden w-[76px] px-2 py-2 font-medium @6xl:table-cell">{t("colResponse")}</th>
              <th className="w-[150px] px-2 py-2 font-medium">{t("colAssigned")}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id} className={cn("border-t border-zinc-100 align-top dark:border-zinc-800", ticket.id === next?.id && "bg-orange-50/60 dark:bg-orange-950/20")}>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</td>
                <td className="px-3 py-2">
                  <span className="block truncate font-medium" title={ticket.subject}>{ticket.subject}</span>
                  <span className="block truncate text-xs text-muted-foreground">{ticket.companyName} · {labels.channel(ticket.channel)}</span>
                </td>
                <td className="px-2 py-2"><Pill className={PRIORITY_PILL[ticket.priority]} dot={PRIORITY_DOT[ticket.priority]}>{labels.priority(ticket.priority)}</Pill></td>
                <td className="px-2 py-2"><Pill className={STATUS_PILL[ticket.status]} dot={STATUS_DOT[ticket.status]}>{labels.status(ticket.status)}</Pill></td>
                <td className="px-2 py-2"><SlaCell ticket={ticket} now={now} /></td>
                <td className="px-2 py-2"><EscalationCell level={ticket.escalationLevel} /></td>
                <td className="hidden px-2 py-2 @6xl:table-cell"><ResponseCell ticket={ticket} /></td>
                <td className="px-2 py-2"><Assignee name={ticket.assigneeName} me={me} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Narrow: one card per ticket, as the product shows a phone. */}
        <ul className="divide-y @3xl:hidden">
          {tickets.map((ticket) => (
            <li key={ticket.id} className={cn("space-y-1.5 px-3 py-2.5", ticket.id === next?.id && "bg-orange-50/60 dark:bg-orange-950/20")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{ticket.subject}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{ticket.companyName} · {labels.channel(ticket.channel)}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill className={PRIORITY_PILL[ticket.priority]} dot={PRIORITY_DOT[ticket.priority]}>{labels.priority(ticket.priority)}</Pill>
                <Pill className={STATUS_PILL[ticket.status]} dot={STATUS_DOT[ticket.status]}>{labels.status(ticket.status)}</Pill>
                <SlaCell ticket={ticket} now={now} />
                <EscalationCell level={ticket.escalationLevel} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

function SlaCell({ ticket, now }: { ticket: SupportDemoTicket; now: number }) {
  const t = useTranslations("tickets")
  const reading = slaReading(ticket, now, t("hrAbbr"), t("minAbbr"))
  const tone = { breached: "text-red-700 dark:text-red-300", warning: "text-amber-700 dark:text-amber-300", ok: "text-green-700 dark:text-green-300", done: "text-muted-foreground" }[reading.state]
  const dot = { breached: "bg-red-500", warning: "bg-amber-500", ok: "bg-green-500", done: "bg-muted-foreground" }[reading.state]
  return (
    <span data-sla-state={reading.state} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", tone)}>
      <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dot)} />
      {reading.state === "breached" ? <>{t("slaBreached")} <AlertTriangle className="inline h-3 w-3" aria-hidden="true" /></> : reading.state === "done" ? t("slaResolved") : reading.text}
    </span>
  )
}

function EscalationCell({ level }: { level: number }) {
  if (!level) return <span className="text-xs text-muted-foreground @3xl:inline hidden">—</span>
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold", ESCALATION_PILL[level] ?? ESCALATION_PILL[3])}><ShieldAlert className="h-3 w-3" aria-hidden="true" />L{level}</span>
}

function ResponseCell({ ticket }: { ticket: SupportDemoTicket }) {
  const tc = useTranslations("common")
  if (!ticket.firstResponseAt) return <span className="text-xs text-muted-foreground">—</span>
  const minutes = Math.floor((Date.parse(ticket.firstResponseAt) - Date.parse(ticket.createdAt)) / 60000)
  const hours = Math.floor(minutes / 60)
  const label = hours > 0 ? `${hours}${tc("hours")} ${minutes % 60}${tc("min")}` : `${minutes}${tc("min")}`
  return <span className={cn("font-mono text-xs", hours > 4 ? "text-red-700 dark:text-red-300" : hours > 1 ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300")}>{label}</span>
}

function Assignee({ name, me }: { name: string | null; me: string }) {
  if (!name) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(name)}</span>
      <span className="truncate text-sm" title={name}>{name === me ? S.supportYou(name) : name}</span>
    </span>
  )
}

/* ── The ticket ──────────────────────────────────────────────────────── */

function TicketScreen({ snapshot, step, reviewMode, dispatch, hint, resolveStage }: DemoSceneProps & { resolveStage: boolean }) {
  const t = useTranslations("tickets")
  const tc = useTranslations("common")
  const labels = useLabels()
  const format = useFormat()
  const { today, now } = useDemoClock(snapshot.startedAt)
  const me = snapshot.identity.name
  const base = useMemo(() => supportDemoTickets(today).find((ticket) => ticket.id === SUPPORT_DEMO_TICKET_ID)!, [today])
  // The reply is the ticket chapter's work; the resolve chapter starts from it.
  const drafted = resolveStage || snapshot.ui["sd.drafted"] === true
  const replied = resolveStage || snapshot.ui["sd.replied"] === true
  const resolved = resolveStage && snapshot.ui["sd.resolved"] === true
  const confirmed = resolved && snapshot.ui["sd.confirmed"] === true
  const at = (hhmm: string) => mtmDemoAt(today, hhmm)
  const ticket: SupportDemoTicket = {
    ...base,
    assigneeName: me,
    firstResponseAt: replied ? at(SUPPORT_DEMO_TIMES.reply) : null,
    status: confirmed ? "closed" : resolved ? "resolved" : base.status,
    resolvedAt: resolved ? at(SUPPORT_DEMO_TIMES.resolved) : null,
  }
  const sla = slaReading(ticket, now, t("hrAbbr"), t("minAbbr"))

  const press = (stepId: string, path: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path, value: true })
  }
  const pressStatus = (status: string) => {
    if (status === "resolved" && resolveStage && !resolved) press("sd-resolve-close", "sd.resolved")
    else hint(S.demoButtonHint)
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t("comments")} onClick={() => hint(S.supportTabHint)}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{ticket.ticketNumber}</span>
              <span className="flex items-center gap-1"><Timer className="h-3 w-3" aria-hidden="true" />{t("handleTimerMinutesSeconds", { minutes: 2, seconds: "10" })}</span>
              <span className="rounded-md border px-1.5 py-0.5">{labels.category(ticket.category)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!resolved ? <Button size="sm" variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-300" onClick={() => hint(S.demoButtonHint)}><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t("escalate")}</Button> : null}
          <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300" onClick={() => hint(S.demoButtonHint)}><MessageSquareWarning className="h-3.5 w-3.5" aria-hidden="true" />{t("complaintsMove")}</Button>
          <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}><Zap className="h-3.5 w-3.5" aria-hidden="true" />{tc("macros")}</Button>
          <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}><UserCheck className="h-3.5 w-3.5" aria-hidden="true" />{t("customerContextAction")}</Button>
          <Button size="icon" variant="ghost" className="hidden h-9 w-9 @2xl:inline-flex" aria-label="Keyboard" onClick={() => hint(S.demoButtonHint)}><Keyboard className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </header>

      <div data-tour-id="sd-ticket-status" className="space-y-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-200 bg-card p-1 @3xl:grid-cols-6 dark:border-zinc-700" role="group" aria-label={t("statusProgress")}>
          {STATUS_PIPELINE.map((status, index) => {
            const current = ticket.status === status
            const past = index < STATUS_PIPELINE.indexOf(ticket.status as (typeof STATUS_PIPELINE)[number])
            const isTarget = status === "resolved" && resolveStage && !resolved
            return (
              <button
                key={status}
                type="button"
                aria-pressed={current}
                onClick={() => pressStatus(status)}
                {...(isTarget ? { ...demoTarget("sd-resolve-close"), ...demoLabel(`«${t("statusResolved")}» basın`) } : {})}
                className={cn("min-h-10 rounded-md px-2 py-2 text-center text-xs font-medium transition-colors", current ? `${STATUS_PIPELINE_COLORS[status]} shadow-sm` : past ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60")}
              >
                {labels.status(status)}
              </button>
            )
          })}
        </div>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-sm @2xl:grid-cols-3 @5xl:grid-cols-6">
          {[
            { label: t("customerLabel"), value: `${ticket.requesterName} · ${ticket.companyName}` },
            { label: t("channelLabel"), value: labels.channel(ticket.channel) },
            { label: t("assignedLabel"), value: S.supportYou(me) },
            { label: t("statusLabel"), value: labels.status(ticket.status) },
            { label: t("priorityLabel"), value: labels.priority(ticket.priority) },
            { label: t("slaResolution"), value: sla.state === "done" ? t("statusResolved") : sla.state === "breached" ? t("slaBreached") : sla.text },
          ].map((fact) => (
            <div key={fact.label} className="min-w-0 border-b border-r p-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
              <dd className="mt-1 truncate text-xs font-semibold" title={fact.value}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid min-w-0 gap-4 @3xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 @3xl:col-span-2">
          <Panel data-tour-id="sd-ticket-thread" className="p-4">
            <h2 className="mb-3 text-base font-semibold">{t("comments")} ({SUPPORT_DEMO_CUSTOMER_MESSAGES.length + 1 + (replied ? 1 : 0) + (resolveStage ? 1 : 0)})</h2>
            <div className="space-y-3">
              {/* The customer's WhatsApp messages, as the product files them: «[Клиент (WhatsApp)] …» comments drawn as bubbles. */}
              {SUPPORT_DEMO_CUSTOMER_MESSAGES.map((message) => (
                <ChatBubble key={message.at} sender="customer" label={t("chatHistoryCustomer")} channel="WhatsApp" text={message.text} footer={<span className="text-xs text-muted-foreground">{format.time(at(message.at))}</span>} />
              ))}
              <div className="flex gap-3 rounded-lg bg-amber-50/70 px-3 py-2 dark:bg-amber-950/20">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">{initials(SUPPORT_DEMO_INTERNAL_NOTE.author)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-amber-700 dark:text-amber-400">{SUPPORT_DEMO_INTERNAL_NOTE.author}</span>
                    <span className="text-xs text-muted-foreground">{format.time(at(SUPPORT_DEMO_INTERNAL_NOTE.at))}</span>
                    <span className="inline-flex items-center gap-0.5 rounded border border-amber-400 px-1 text-[11px] text-amber-600"><Lock className="h-2.5 w-2.5" aria-hidden="true" />{t("internalBadge")}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{SUPPORT_DEMO_INTERNAL_NOTE.text}</p>
                </div>
              </div>
              {replied ? (
                <div data-testid="sd-ticket-reply" className="flex gap-3 rounded-lg px-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">{initials(me)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{me}</span><span className="text-xs text-muted-foreground">{format.time(at(SUPPORT_DEMO_TIMES.reply))}</span></p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{SUPPORT_DEMO_DRAFT}</p>
                  </div>
                </div>
              ) : null}
              {resolveStage ? (
                <ChatBubble sender="customer" label={t("chatHistoryCustomer")} channel="WhatsApp" text={SUPPORT_DEMO_CUSTOMER_CONFIRMS} footer={<span className="text-xs text-muted-foreground">{format.time(at(SUPPORT_DEMO_TIMES.customer))}</span>} />
              ) : null}
            </div>
            {!resolveStage ? <Composer drafted={drafted} replied={replied} press={press} hint={hint} /> : null}
          </Panel>
          {resolved ? (
            <CustomerSide
              ticket={ticket}
              resolvedAt={at(SUPPORT_DEMO_TIMES.resolved)}
              confirmed={confirmed}
              onConfirm={() => press("sd-resolve-wait", "sd.confirmed")}
              onReject={() => hint(S.supportRejectHint)}
            />
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {resolved ? <ClosureCard ticket={ticket} resolvedAt={at(SUPPORT_DEMO_TIMES.resolved)} confirmed={confirmed} /> : null}
          <Panel data-tour-id="sd-ticket-sla" className="p-4 text-sm">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t("slaCard")}</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("slaDeadline")}</dt><dd>{format.dayTime(ticket.slaDueAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("slaTimeRemaining")}</dt><dd className={cn("font-mono font-medium", sla.state === "breached" ? "text-red-600" : "text-green-600")}>{sla.state === "done" ? t("statusResolved") : sla.text}</dd></div>
              {ticket.firstResponseAt ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("slaFirstResponse")}</dt><dd className="text-green-600">{format.time(ticket.firstResponseAt)}</dd></div> : null}
              {ticket.resolvedAt ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("slaResolved")}</dt><dd>{format.time(ticket.resolvedAt)}</dd></div> : null}
            </dl>
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-3.5 w-3.5" aria-hidden="true" />{t("kbArticles")}</h2>
            <button type="button" className="w-full rounded-md p-2 text-left hover:bg-muted" onClick={() => hint(S.demoButtonHint)}>
              <span className="block text-sm font-medium">{SUPPORT_DEMO_ARTICLE.title}</span>
              <span className="block text-xs text-muted-foreground">{SUPPORT_DEMO_ARTICLE.category}</span>
            </button>
          </Panel>
          {/* The ticket page shows the rating card at every stage. */}
          <Panel className="p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Star className="h-3.5 w-3.5" aria-hidden="true" />{t("csatCard")}</h2>
            <p className="text-sm text-muted-foreground">{t("notRated")}</p>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function Composer({ drafted, replied, press, hint }: { drafted: boolean; replied: boolean; press: (stepId: string, path: string) => void; hint: (message: string) => void }) {
  const t = useTranslations("tickets")
  return (
    <div data-tour-id="sd-ticket-composer" className="mt-4 space-y-3 border-t pt-4">
      <div className="flex w-fit rounded-full border bg-card p-0.5" role="group" aria-label={t("messageVisibility")}>
        <span className="rounded-full bg-foreground px-3 py-2 text-xs font-medium text-background"><Send className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />{t("replyBtn")}</span>
        <button type="button" className="rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted" onClick={() => hint(S.demoButtonHint)}><Lock className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />{t("internalNote")}</button>
      </div>
      <textarea
        data-testid="sd-ticket-composer"
        aria-label={t("replyPlaceholder")}
        readOnly
        rows={drafted && !replied ? 6 : 3}
        value={drafted && !replied ? SUPPORT_DEMO_DRAFT : ""}
        placeholder={t("replyPlaceholder")}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{t("attachFile")}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!drafted || replied} onClick={() => press("sd-ticket-send", "sd.replied")} {...(drafted && !replied ? demoTarget("sd-ticket-send") : {})}>
          <Send className="h-3.5 w-3.5" aria-hidden="true" />{t("replyBtn")}
        </Button>
        <span className="mx-1 h-6 border-l" aria-hidden="true" />
        <span className="rounded-md border px-2 py-1.5 text-xs">{t("languageAzerbaijani")}</span>
        <Button size="sm" variant="outline" disabled={replied} onClick={() => (drafted ? hint(S.demoButtonHint) : press("sd-ticket-draft", "sd.drafted"))} {...(!drafted ? demoTarget("sd-ticket-draft") : {})}>
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />{t("aiReply")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t("aiSummary")}</Button>
        <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}><Zap className="h-3.5 w-3.5" aria-hidden="true" />{t("aiSteps")}</Button>
      </div>
      <p data-testid="sd-ticket-audience" className="text-xs text-muted-foreground">{t("replyAudienceWhatsapp")}</p>
    </div>
  )
}

function ClosureCard({ ticket, resolvedAt, confirmed }: { ticket: SupportDemoTicket; resolvedAt: string; confirmed: boolean }) {
  const t = useTranslations("tickets")
  const format = useFormat()
  // closure-requests.ts: the customer has seven days to answer.
  const dueAt = new Date(Date.parse(resolvedAt) + 7 * 24 * 60 * 60 * 1000).toISOString()
  return (
    <Panel data-tour-id="sd-resolve-closure" className="border-blue-200 bg-blue-50/40 p-4 text-sm dark:border-blue-900/60 dark:bg-blue-950/10">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-blue-600" aria-hidden="true" />{t("closureRequestCard")}</h2>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{confirmed ? t("closureRequestConfirmed") : t("closureRequestPending")}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("closureRequestSentDesc")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-background/70 p-2"><span className="block text-muted-foreground">{t("closureRequestChannel")}</span><span className="font-medium">whatsapp</span></div>
        <div className="rounded-md bg-background/70 p-2"><span className="block text-muted-foreground">{t("closureRequestRecipient")}</span><span className="block truncate font-medium">{ticket.requesterDetail}</span></div>
      </div>
      <p className="mt-2 rounded-md border border-blue-200/70 bg-background/70 p-2 text-xs text-muted-foreground dark:border-blue-900/60">{t("closureRequestAutoClose")}: <span className="font-medium text-foreground">{format.dayTime(dueAt)}</span></p>
    </Panel>
  )
}

/**
 * What the customer gets when the ticket is resolved: the product's two
 * WhatsApp messages, and the closure page the link opens — the prospect
 * answers as the customer.
 */
function CustomerSide({ ticket, resolvedAt, confirmed, onConfirm, onReject }: {
  ticket: SupportDemoTicket
  resolvedAt: string
  confirmed: boolean
  onConfirm: () => void
  onReject: () => void
}) {
  const tp = useTranslations("portal")
  const format = useFormat()
  const messages = [
    ticketStatusWhatsAppText("az", "resolved", ticket.ticketNumber) ?? "",
    closureRequestWhatsAppText("az", { ticketNumber: ticket.ticketNumber, confirmationUrl: SUPPORT_DEMO_CLOSURE_LINK }),
  ]
  // closure-requests.ts: the customer has seven days to answer.
  const dueAt = new Date(Date.parse(resolvedAt) + 7 * 24 * 60 * 60 * 1000).toISOString()
  return (
    <Panel data-tour-id="sd-resolve-customer" className="p-4">
      <h2 className="mb-3 text-base font-semibold">{S.supportCustomerSide}</h2>
      {/* One column: the closure page is laid out for a whole screen, and beside
          the messages its two buttons ran out of the card. */}
      <div className="space-y-4">
        <ol className="space-y-2">
          {messages.map((text) => (
            <li key={text} className="rounded-lg rounded-tl-sm border bg-background px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">{S.supportCustomerSideFrom} · {format.time(resolvedAt)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-lg border bg-background p-4">
          <TicketClosureRequestView
            request={{
              id: "demo-closure",
              status: confirmed ? "confirmed" : "pending",
              dueAt,
              ticket: { ticketNumber: ticket.ticketNumber, subject: ticket.subject, status: ticket.status },
            }}
            submitting={null}
            message={confirmed ? tp("closureConfirmedMessage") : ""}
            error=""
            onSubmit={(action) => (action === "confirm" ? onConfirm() : onReject())}
            confirmButtonProps={demoTarget("sd-resolve-wait")}
          />
        </div>
      </div>
    </Panel>
  )
}

/* ── SLA and escalation rules ────────────────────────────────────────── */

function RulesScreen({ snapshot }: DemoSceneProps) {
  const ts = useTranslations("slaPolicyUi")
  const te = useTranslations("escalationRules")
  const t = useTranslations("tickets")
  const labels = useLabels()
  const format = useFormat()
  const { today, now } = useDemoClock(snapshot.startedAt)
  const coverage = summarizeSlaPolicyCoverage(SUPPORT_DEMO_POLICIES)
  const duration = (hours: number) => {
    const { hours: h, minutes } = splitSlaDuration(hours)
    return h && minutes ? ts("durationHoursMinutes", { hours: h, minutes }) : h ? ts("durationHours", { hours: h }) : ts("durationMinutes", { minutes })
  }
  // The open ticket the rules are working on this morning.
  const late = useMemo(() => supportDemoTickets(today).find((ticket) => ticket.escalationLevel > 0)!, [today])
  const times = supportDemoEscalationTimes(late)
  const sentence = (rule: (typeof SUPPORT_DEMO_ESCALATION_RULES)[number]) => {
    const offset = rule.triggerMinutes % 60 === 0 ? te("duration.hours", { count: rule.triggerMinutes / 60 }) : te("duration.minutes", { count: rule.triggerMinutes })
    const trigger = rule.triggerType === "resolution_warning" ? te("sentenceBefore", { duration: offset }) : rule.triggerType === "first_response_breach" ? te("sentenceAfterFirstResponse", { duration: offset }) : te("sentenceAfterResolution", { duration: offset })
    const action = rule.actions[0]
    const what = action.type === "notify" ? te("sentenceNotify", { target: te(`targets.${action.target ?? "manager"}`) }) : te(`sentenceActions.${action.type}`)
    return te("sentence", { trigger, action: what, level: rule.level })
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{ts("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{ts("description")}</p>
      </header>
      <div data-tour-id="sd-rules-sla" className="space-y-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y py-2 text-xs text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{SUPPORT_DEMO_POLICIES.length}</strong> {ts("totalPolicies")}</span>
          <span><strong className="font-semibold text-foreground">{coverage.active}</strong> {ts("activePolicies")}</span>
          <span><strong className="font-semibold text-foreground">{coverage.covered.length}/4</strong> {ts("prioritiesCovered")}</span>
        </p>
        <Panel className="overflow-hidden">
          <table className="hidden w-full table-fixed text-sm @3xl:table">
            <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[96px] px-3 py-2 font-medium">{ts("priorityLabel")}</th>
                <th className="px-3 py-2 font-medium">{ts("policyLabel")}</th>
                <th className="w-[96px] px-3 py-2 font-medium">{ts("firstResponseLabel")}</th>
                <th className="w-[96px] px-3 py-2 font-medium">{ts("resolutionLabel")}</th>
                <th className="w-[170px] px-3 py-2 font-medium">{ts("scheduleLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {SLA_POLICY_PRIORITIES.map((priority) => SUPPORT_DEMO_POLICIES.filter((policy) => policy.priority === priority).map((policy) => (
                <tr key={policy.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2"><Pill className={PRIORITY_PILL[priority]} dot={PRIORITY_DOT[priority]}>{labels.priority(priority)}</Pill></td>
                  <td className="px-3 py-2"><span className="block truncate font-medium">{policy.name}</span><span className="block text-xs text-muted-foreground">{ts("assignmentCounts", { companies: policy.companies, entitlements: policy.entitlements })}</span></td>
                  <td className="px-3 py-2 tabular-nums">{duration(policy.firstResponseHours)}</td>
                  <td className="px-3 py-2 tabular-nums">{duration(policy.resolutionHours)}</td>
                  <td className="px-3 py-2 text-xs">{ts("workingSchedule", { timezone: SUPPORT_DEMO_TIMEZONE })}</td>
                </tr>
              )))}
            </tbody>
          </table>
          <ul className="divide-y @3xl:hidden">
            {SUPPORT_DEMO_POLICIES.map((policy) => (
              <li key={policy.id} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2"><Pill className={PRIORITY_PILL[policy.priority]} dot={PRIORITY_DOT[policy.priority]}>{labels.priority(policy.priority)}</Pill><span className="truncate font-medium">{policy.name}</span></div>
                <p className="text-xs text-muted-foreground">{ts("firstResponseLabel")}: {duration(policy.firstResponseHours)} · {ts("resolutionLabel")}: {duration(policy.resolutionHours)}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <p className="text-xs text-muted-foreground">{ts("workingCalendarHint")}</p>
      </div>

      <div data-tour-id="sd-rules-escalation" className="space-y-3">
        <h2 className="text-lg font-semibold">{te("title")}</h2>
        <Panel className="divide-y">
          {SUPPORT_DEMO_ESCALATION_RULES.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 px-4 py-3">
              <EscalationCell level={rule.level} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{rule.name}</p>
                <p className="text-sm text-muted-foreground first-letter:uppercase">{sentence(rule)}</p>
              </div>
            </div>
          ))}
        </Panel>
        <Panel className="p-4">
          <h3 className="text-sm font-semibold">{S.supportEscalationOn(`${late.ticketNumber} · ${late.companyName}`)}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("slaDeadline")}: {format.dayTime(late.slaDueAt)}</p>
          <ol className="mt-3 space-y-2">
            {times.map(({ rule, at }) => {
              const fired = Date.parse(at) <= now && rule.level <= late.escalationLevel
              return (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <EscalationCell level={rule.level} />
                  <span className="tabular-nums">{format.time(at)}</span>
                  <span className={cn("text-xs", fired ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{fired ? S.supportEscalationFired : S.supportEscalationNext}</span>
                </li>
              )
            })}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{te("orderBehavior")}</p>
        </Panel>
      </div>
    </div>
  )
}

/* ── The agent's desk ────────────────────────────────────────────────── */

function ResultsScreen({ snapshot }: DemoSceneProps) {
  const t = useTranslations("agentDesktop")
  const labels = useLabels()
  const format = useFormat()
  const { today, now } = useDemoClock(snapshot.startedAt)
  const metrics = useMemo(() => supportDemoAgentMetrics(today), [today])
  // Her open tickets, in the desk's own order: earliest actionable SLA first.
  const queue = useMemo(() => supportDemoTickets(today)
    .filter((ticket) => ticket.assigneeName === SUPPORT_DEMO_AGENT && ticket.status !== "resolved" && ticket.status !== "closed")
    .sort((a, b) => compareAgentQueueRows(
      { ...a, createdAt: new Date(a.createdAt), slaFirstResponseDueAt: new Date(a.slaFirstResponseDueAt), slaDueAt: new Date(a.slaDueAt), firstResponseAt: a.firstResponseAt ? new Date(a.firstResponseAt) : null },
      { ...b, createdAt: new Date(b.createdAt), slaFirstResponseDueAt: new Date(b.slaFirstResponseDueAt), slaDueAt: new Date(b.slaDueAt), firstResponseAt: b.firstResponseAt ? new Date(b.firstResponseAt) : null },
    )), [today])
  const duration = (seconds: number | null) => {
    if (seconds == null) return t("unavailableMetric")
    if (seconds < 60) return t("durationSeconds", { count: seconds })
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return t("durationMinutes", { count: minutes })
    return t("durationHoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }
  const percent = (value: number | null) => (value == null ? t("unavailableMetric") : `${value}%`)
  const tiles = [
    { key: "response", label: t("avgResponse"), value: duration(metrics.averageFirstResponseSeconds), sample: metrics.firstResponseSample },
    { key: "resolution", label: t("avgResolution"), value: duration(metrics.averageResolutionSeconds), sample: metrics.resolutionSample },
    { key: "rate", label: t("resolutionRate"), value: percent(metrics.resolutionRatePct), sample: metrics.resolutionRateSample },
    { key: "sla", label: t("slaCompliance"), value: percent(metrics.slaCompliancePct), sample: metrics.slaObligationSample },
    { key: "csat", label: t("csat"), value: metrics.csatAverage == null ? t("unavailableMetric") : t("csatValue", { value: metrics.csatAverage }), sample: metrics.csatSample },
  ]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { name: SUPPORT_DEMO_AGENT })}</p>
      </header>
      <Panel className="overflow-hidden">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("personalQueue")}</h2>
        <ul className="divide-y">
          {queue.map((ticket) => (
            <li key={ticket.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{ticket.subject}</span>
              <Pill className={PRIORITY_PILL[ticket.priority]} dot={PRIORITY_DOT[ticket.priority]}>{labels.priority(ticket.priority)}</Pill>
              {(() => {
                const due = ticket.firstResponseAt ? ticket.slaDueAt : ticket.slaFirstResponseDueAt
                // The desk's own reading: the actionable deadline, in red once it has passed.
                return <span className={cn("text-xs", Date.parse(due) <= now ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>{t("due", { date: format.dayTime(due) })}</span>
              })()}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel data-tour-id="sd-results-metrics" className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t("myPerformance")}</h2>
          <p className="text-xs text-muted-foreground">{t("rollingPeriod", { days: 30 })} · {format.long(addDays(today, -30))} – {format.long(today)}</p>
        </div>
        <dl className="grid grid-cols-2 @3xl:grid-cols-5">
          {tiles.map((tile) => (
            <div key={tile.key} className="border-b border-r px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{tile.label}</dt>
              <dd className="mt-1">
                <span data-testid={`sd-metric-${tile.key}`} className="block text-lg font-semibold tabular-nums">{tile.value}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("sampleSize", { count: tile.sample })}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  )
}
