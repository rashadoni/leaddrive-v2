"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft, ArrowRight, Brain, Building2, Calendar, DollarSign, Flame, MessageSquare,
  Pencil, Phone, Search, ShieldCheck, Sparkles, Trash2, Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ColorStatCard } from "@/components/color-stat-card"
import { CollapsibleSection } from "@/components/crm/collapsible-section"
import { CustomerDetailsCards } from "@/components/crm/customer-details-cards"
import { InfoHint } from "@/components/info-hint"
import { LeadEvaluationCard, LeadOverview, LeadStatBoxes } from "@/components/leads/lead-overview"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { getLeadScoreFactorLabel } from "@/lib/leads/score-factor-labels"
import { applyTransitionEffects, DEMO_CHANNEL_LABELS, demoMoney, type DemoActivityRecord, type DemoLeadRecord } from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import type { DemoJourneyVariant, DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Lead list + lead card, built from the product's own presentational
 * components (LeadOverview, LeadStatBoxes, LeadEvaluationCard,
 * CustomerDetailsCards, ColorStatCard, CollapsibleSection) and the product's
 * own `leads` translations. The data comes from the session snapshot; no
 * tenant route is called. Controls that belong to a later part of the story
 * are present but inert, with a hint — hiding them would misrepresent the
 * screen, and wiring them would let the prospect skip the story.
 */

const STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  contacted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  qualified: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  converted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  lost: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
}
const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
}
const statusDot: Record<string, string> = {
  new: "bg-sky-400", contacted: "bg-amber-400", qualified: "bg-violet-500",
  converted: "bg-emerald-500", lost: "bg-gray-300",
}
const gradeStyle: Record<string, string> = {
  A: "bg-foreground text-background", B: "bg-foreground/70 text-background",
  C: "bg-amber-500 text-white", D: "bg-red-500 text-white", F: "bg-[#FF4D00] text-white",
}

function gradeOf(score: number): string {
  if (score >= 80) return "A"
  if (score >= 60) return "B"
  if (score >= 40) return "C"
  if (score >= 20) return "D"
  return "F"
}

type TabId = "details" | "activities" | "timeline" | "sentiment" | "tasks" | "ai"

export function LeadScene(props: DemoSceneProps) {
  const { snapshot, step, reviewMode } = props
  const lead = snapshot.records.lead
  // The list is shown until the prospect opens their own card; afterwards
  // (and in review) the card is the screen the story works on.
  const onListStep = step?.id === "lead-list-stats" || step?.id === "lead-open"
  return !lead || (onListStep && !reviewMode) ? <LeadListView {...props} /> : <LeadCardView {...props} lead={lead} />
}

function LeadListView({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("leads")
  const locale = useLocale()
  const { identity, records } = snapshot
  const lead = records.lead

  const statusLabels: Record<string, string> = {
    new: t("statusNew"), contacted: t("statusContacted"), qualified: t("statusQualified"),
    converted: t("statusConverted"), lost: t("statusLost"),
  }

  // Before the card exists the story still shows a board with the prospect's
  // own row in "new": that is what the manager sees the moment the lead lands.
  // It is the very lead opening it creates (the same record effect), so the
  // row the prospect clicks is the card they get. Without it the «Yeni»
  // column was empty on «Öz kartınızı açın» and the story could not go on.
  const pending: DemoLeadRecord | null =
    lead ?? (snapshot.state === "AI_REPLIED" ? applyTransitionEffects(records, "LEAD_CREATED", identity, new Date(snapshot.updatedAt)).lead : null)
  const rows = pending ? [pending] : []
  const score = pending?.score ?? 0

  const openCard = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "lead-open") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "LEAD_CREATED" })
  }

  return (
    <div data-testid="demo-scene-lead-list" className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 data-tour-id="leads-list" className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
            <span className="text-lg font-normal text-muted-foreground">({rows.length})</span>
          </h1>
          <p data-tour-id="leads-score" className="mt-1 text-sm text-muted-foreground">
            {t("avgScore")}: <span className="font-medium text-foreground">{score}</span>/100
            {" · "}{t("hotLeads")}: <span className={cn("font-medium", score >= 70 ? "text-[#FF4D00]" : "text-foreground")}>{score >= 70 ? 1 : 0}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => hint(S.demoButtonHint)}
          className="flex items-center gap-1.5 rounded-lg bg-[#FF4D00] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#e04400]"
        >
          {t("newLead")}
        </button>
      </div>

      <div data-tour-id="leads-stats" className="grid grid-cols-2 gap-0 overflow-hidden rounded-lg border border-zinc-200 sm:grid-cols-4 dark:border-zinc-700">
        {[
          { value: rows.length, label: t("title") },
          { value: 0, label: t("statusConverted") },
          { value: `${score}/100`, label: t("avgScore") },
          { value: score >= 70 ? 1 : 0, label: t("hotLeads"), hot: true },
        ].map((stat, index) => (
          <div key={stat.label} className={cn("px-6 py-4", index > 0 && "border-l border-zinc-200 dark:border-zinc-700")}>
            <div className={cn("text-3xl font-bold tracking-tight", stat.hot && score >= 70 ? "text-[#FF4D00]" : "text-foreground")}>{stat.value}</div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <div data-tour-id="leads-status-filter" className="flex flex-wrap gap-1.5">
        {[{ key: "all", label: `${t("all")} (${rows.length})` },
          ...STATUSES.map((status) => ({ key: status, label: `${statusLabels[status]} (${rows.filter((row) => row.status === status).length})` }))
        ].map((item, index) => (
          <button
            key={item.key}
            type="button"
            onClick={() => hint(S.hintFollow(step?.title ?? ""))}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              index === 0 ? "border-foreground bg-foreground font-medium text-background" : "border-zinc-200 text-muted-foreground hover:border-foreground/40 hover:text-foreground dark:border-zinc-700",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div data-tour-id="leads-toolbar" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            readOnly
            placeholder={t("searchPlaceholder")}
            onClick={() => hint(S.demoButtonHint)}
            className="w-full rounded-lg border border-zinc-200 bg-background py-2 pl-9 pr-3 text-sm dark:border-zinc-700"
          />
        </div>
        <span className="ml-auto shrink-0 text-sm text-muted-foreground">{t("title")}: {rows.length}</span>
      </div>

      <div data-tour-id="leads-kanban" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {STATUSES.map((status) => {
          const columnRows = rows.filter((row) => row.status === status)
          return (
            <div key={status} className="min-w-0">
              <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-700">
                <span className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot[status])} />
                  <span className="text-xs font-semibold text-foreground">{statusLabels[status]}</span>
                </span>
                <span className="text-xs text-muted-foreground">{columnRows.length}</span>
              </div>
              <div className="min-h-[200px] space-y-2">
                {columnRows.map((row) => {
                  const letter = gradeOf(row.score)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={openCard}
                      {...demoTarget("lead-open")}
                      className="w-full rounded-lg border border-zinc-200 bg-card p-3 text-left transition-all hover:border-foreground/30 hover:shadow-sm dark:border-zinc-700"
                    >
                      <span className="mb-1.5 flex items-center gap-2">
                        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold", gradeStyle[letter])}>{letter}</span>
                        <span className="flex-1 truncate text-xs font-medium text-foreground">{row.contactName}</span>
                      </span>
                      <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <Building2 className="h-2.5 w-2.5" /> {row.companyName}
                      </span>
                      <span className="mt-2 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3 shrink-0" /> {formatDate(row.createdAt, locale)}
                      </span>
                      <span className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">{row.score}/100</span>
                        <span className="text-xs font-semibold text-foreground">{demoMoney(row.estimatedValue)}</span>
                      </span>
                    </button>
                  )
                })}
                {columnRows.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-muted-foreground/40 dark:border-zinc-700">—</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function LeadCardView({ snapshot, step, reviewMode, variant, dispatch, hint, lead }: DemoSceneProps & { lead: DemoLeadRecord }) {
  const t = useTranslations("leads")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [tab, setTab] = useState<TabId>(() => (snapshot.ui["lead.activeTab"] as TabId) ?? "details")

  const statusLabels: Record<string, string> = {
    new: t("statusNew"), contacted: t("statusContacted"), qualified: t("statusQualified"),
    converted: t("statusConverted"), lost: t("statusLost"),
  }
  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"),
  }
  const channelLabel = DEMO_CHANNEL_LABELS[lead.source]

  // The real card computes these from the timeline API; here they come from
  // the snapshot, with `loading` false so the components render final values.
  const stats = useMemo(
    () => ({
      loading: false,
      firstDate: lead.timeline[0]?.date ?? null,
      lastDate: lead.timeline[lead.timeline.length - 1]?.date ?? null,
      tasksToDo: snapshot.records.task && snapshot.records.task.status !== "done" ? 1 : 0,
      callsMade: 0,
    }),
    [lead.timeline, snapshot.records.task],
  )

  const selectTab = (next: TabId) => {
    setTab(next)
    if (!reviewMode) dispatch({ type: "ui", path: "lead.activeTab", value: next })
  }

  const advanceStatus = (status: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "lead-status-advance") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    if (status !== "qualified") {
      hint(S.hintFollow(step.title))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "LEAD_QUALIFIED" })
  }

  // «AI ilə zəng et» on the card. In the open demo the call is simulated and
  // the card says so; a granted demo with the live call rings the prospect's
  // own phone from the guide panel instead (owner, 2026-09-22).
  const callFromCard = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "ai-call-from-card") {
      hint(step ? S.hintFollow(step.title) : S.hintDisabled)
      return
    }
    // Through the states a call really goes through: queued, ringing, result.
    dispatch({ type: "outcome", stepId: step.id, to: "CALL_RESULT_RECORDED" })
  }

  const convert = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "deal-convert") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "DEAL_CREATED" })
  }

  const callResult = lead.activities.find((activity) => activity.id === "act-call") ?? null
  const currentIndex = STATUSES.indexOf(lead.status as (typeof STATUSES)[number])
  // "Now" is the snapshot's own clock, not Date.now(): the scene must render
  // the same value on every pass, and the journey already timestamps itself.
  const daysSinceCreated = Math.max(
    0,
    Math.round((Date.parse(snapshot.updatedAt) - Date.parse(lead.createdAt)) / 86_400_000),
  )

  return (
    <div data-testid="demo-scene-lead-card" className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button className="shrink-0" variant="ghost" size="icon" onClick={() => hint(S.hintFollow(step?.title ?? ""))} aria-label={tc("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                {lead.contactName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="flex min-w-0 flex-wrap items-center gap-2 break-words text-2xl font-bold">{lead.contactName}</h1>
                  <Badge className={cn("text-xs", statusColors[lead.status])}>{statusLabels[lead.status]}</Badge>
                  <Badge className={cn("text-xs", priorityColors[lead.priority])}>{priorityLabels[lead.priority]}</Badge>
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> {lead.companyName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{lead.email}</p>
              </div>
            </div>
          </div>
        </div>
        <div data-tour-id="lead-header-actions" className="flex w-full flex-wrap items-center gap-2">
          <Button data-tour-id="lead-ai-call" variant="outline" className="gap-1.5" onClick={callFromCard} {...demoTarget("ai-call-from-card")}>
            <Phone className="h-4 w-4" /> {t("aiCall.action")}
          </Button>
          {lead.status !== "converted" && (
            <Button
              data-tour-id="leads-convert"
              variant="outline"
              className="gap-1.5 text-green-600 hover:border-green-300 hover:text-green-700"
              onClick={convert}
              {...demoTarget("deal-convert")}
            >
              <ArrowRight className="h-4 w-4" /> {t("modalConvertToDeal")}
            </Button>
          )}
          <Button variant="outline" className="gap-1.5" onClick={() => hint(S.demoButtonHint)}>
            <Zap className="h-4 w-4" /> {t("addToSequence")}
          </Button>
          <Button variant="outline" onClick={() => hint(S.demoButtonHint)}><Pencil className="h-4 w-4" /> {tc("edit")}</Button>
          <Button variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => hint(S.demoButtonHint)}>
            <Trash2 className="h-4 w-4" /> {tc("delete")}
          </Button>
        </div>
      </div>

      {/* Status pipeline bar */}
      <Card data-tour-id="lead-status-bar">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-1">
            {STATUSES.map((status, index) => {
              const isCurrent = status === lead.status
              const isActive = index <= currentIndex
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => advanceStatus(status)}
                  {...demoTarget(status === "qualified" && "lead-status-advance")}
                  className={cn(
                    "relative flex-1 rounded-md px-3 py-2.5 text-xs font-medium transition-all hover:opacity-80",
                    isCurrent
                      ? status === "converted" ? "bg-green-500 text-white shadow-sm" : "bg-primary text-primary-foreground shadow-sm"
                      : isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {statusLabels[status]}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div data-tour-id="lead-overview">
            <LeadOverview
              lead={{ score: lead.score, interest: null, brand: null, source: lead.source, priority: lead.priority }}
              stats={stats}
              priorityLabel={priorityLabels[lead.priority]}
              priorityClass={priorityColors[lead.priority]}
              sourceLabel={channelLabel}
            />
          </div>
          <VoicePermissionCard granted={Boolean(callResult)} onAction={() => hint(S.hintDisabled)} />
          {callResult ? <CallResultCard entry={callResult} variant={variant} /> : null}
          <LeadEvaluationCard
            score={lead.score}
            factors={lead.scoreDetails.factors}
            converted={lead.status === "converted"}
            onConvert={convert}
            convertLabel={t("modalConvertToDeal")}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div data-tour-id="lead-kpi" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ColorStatCard wrapLabel label={t("detailScoreGrade")} value={`${gradeOf(lead.score)} · ${lead.score}`} icon={<Flame className="h-4 w-4" />} hint={t("hintColScore")} />
            <ColorStatCard wrapLabel label={t("detailDaysSinceCreated")} value={`${daysSinceCreated} ${t("modalDays")}`} icon={<Calendar className="h-4 w-4" />} />
            <ColorStatCard wrapLabel label={t("modalEstimatedValue")} value={demoMoney(lead.estimatedValue)} icon={<DollarSign className="h-4 w-4" />} />
            <ColorStatCard wrapLabel label={t("modalPriority")} value={priorityLabels[lead.priority]} icon={<Flame className="h-4 w-4" />} hint={t("hintColPriority")} />
          </div>

          <div data-tour-id="lead-tabs" className="flex flex-wrap gap-x-1 border-b">
            {([
              { id: "details" as const, label: t("modalDetails") },
              { id: "activities" as const, label: t("modalActivities") },
              { id: "timeline" as const, label: tc("timelineTab") },
              { id: "sentiment" as const, label: t("modalSentiment") },
              { id: "tasks" as const, label: t("modalTasks") },
              { id: "ai" as const, label: t("modalAiScoring") },
            ]).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectTab(entry.id)}
                {...demoTarget(entry.id === "timeline" && "lead-timeline", entry.id === "ai" && "lead-scoring")}
                aria-current={tab === entry.id ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  tab === entry.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === "details" && (
            <div data-tour-id="lead-details" className="space-y-4">
              <CollapsibleSection title={t("leadDetailsSection")}>
                <LeadStatBoxes stats={stats} createdAt={lead.createdAt} />
              </CollapsibleSection>
              <CollapsibleSection title={t("customerDetails")}>
                <CustomerDetailsCards
                  person={{ name: lead.contactName, subtitle: lead.jobTitle, email: lead.email, phone: lead.phone }}
                  company={{ name: lead.companyName }}
                />
              </CollapsibleSection>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-base">{t("modalLeadInfo")} <InfoHint text={t("hintColContact")} size={14} /></CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    <Field label={t("modalContactName")} value={lead.contactName} />
                    <Field label={t("colCompany")} value={lead.companyName} />
                    <Field label={t("modalSource")} value={`${channelLabel} · ${lead.sourceDetail}`} hint={t("hintColSource")} />
                    <Field label={t("colStatus")} value={statusLabels[lead.status]} />
                    <Field label={tc("assignee")} value={lead.assignedToName} />
                    <Field label={t("modalEstimatedValue")} value={demoMoney(lead.estimatedValue)} />
                  </dl>
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "activities" && (
            <Card data-tour-id="lead-activities">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-1.5 text-base"><MessageSquare className="h-4 w-4" /> {t("activityTimeline")}</CardTitle>
                <Button size="sm" onClick={() => hint(S.demoButtonHint)}>{t("addActivity")}</Button>
              </CardHeader>
              <CardContent>
                <ul className="relative space-y-4 pl-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border">
                  {lead.activities.map((activity) => (
                    <li key={activity.id} className="relative">
                      <span className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-background text-xs dark:border-zinc-700">·</span>
                      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{activity.subject}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(activity.createdAt, locale)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{activity.description}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">— {activity.createdByName}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {tab === "timeline" && (
            <Card data-tour-id="lead-timeline">
              <CardHeader><CardTitle className="text-base">{tc("timelineTab")}</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {lead.timeline.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{entry.title}</span>
                        {entry.subtitle && <span className="block text-xs text-muted-foreground">{entry.subtitle}</span>}
                      </span>
                      <time dateTime={entry.date} className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.date, locale)}</time>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {tab === "sentiment" && (
            <Card data-tour-id="lead-sentiment">
              <CardContent className="space-y-3 pt-6 text-center">
                <Brain className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{t("modalSentimentDesc")}</p>
                <Button variant="outline" onClick={() => hint(S.hintDisabled)}>{t("modalAnalyzeSentiment")}</Button>
              </CardContent>
            </Card>
          )}

          {tab === "tasks" && (
            <Card data-tour-id="lead-tasks">
              <CardContent className="pt-6">
                {snapshot.records.task ? (
                  <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <p className="text-sm font-medium">{snapshot.records.task.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tc("assignee")}: {snapshot.records.task.assigneeName} · {formatDateTime(snapshot.records.task.dueAt, locale)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 text-center">
                    <Sparkles className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">{t("modalTasksDesc")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "ai" && (
            <Card data-tour-id="lead-ai-scoring">
              <CardContent className="space-y-4 pt-6">
                <h4 className="flex items-center gap-1.5 text-sm font-medium"><Brain className="h-4 w-4 text-purple-500" /> {t("modalAiAnalysis")}</h4>
                <div className="ai-accent rounded-lg border border-[hsl(var(--ai-from))]/20 bg-[hsl(var(--ai-from))]/5 p-4">
                  <p className="flex items-start gap-2 text-sm leading-relaxed">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ai-from))]" aria-hidden="true" />
                    {lead.scoreDetails.reasoning}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Metric value={gradeOf(lead.score)} label={t("modalGrade")} />
                  <Metric value={String(lead.score)} label={t("modalScore")} />
                  <Metric value={`${Math.round(lead.score * 0.6)}%`} label={t("modalConversion")} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{t("modalFactors")}</p>
                  {Object.entries(lead.scoreDetails.factors).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{getLeadScoreFactorLabel(key, t)}</span>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
                        </span>
                        <span className="w-8 text-right font-medium">{value}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 truncate font-medium">{value ?? "—"}</dd>
      {hint && <InfoHint text={hint} size={12} />}
    </div>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <div className="text-3xl font-bold text-primary">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

/** What the call left on the card: how long it lasted, how it ended, what the
 *  assistant wrote. The same line goes to the lead's timeline. */
function CallResultCard({ entry, variant }: { entry: DemoActivityRecord; variant: DemoJourneyVariant }) {
  const t = useTranslations("voip")
  return (
    <Card data-tour-id="lead-call-result">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Phone className="h-4 w-4 text-primary" aria-hidden="true" /> {t("callOutcome")}
          {variant !== "granted" ? (
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{S.simulatedSend}</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">{t("duration")}: <span className="font-medium text-foreground">2 dəq 04 san</span></span>
          <span className="text-muted-foreground">{t("callOutcome")}: <span className="font-medium text-foreground">{t("outcomeInterested")}</span></span>
        </div>
        <p className="rounded-lg border border-zinc-200 bg-muted/40 p-2.5 text-xs leading-relaxed dark:border-zinc-700">{entry.description}</p>
        <p className="text-[11px] text-muted-foreground">{S.callResultInTimeline}</p>
      </CardContent>
    </Card>
  )
}

/**
 * The AI-call consent control, shown in its real shape with the product's own
 * strings and the honest state for this demo: no verified phone, so nothing
 * can be allowed here. The real component fetches the permission ledger,
 * which a public session must never reach.
 */
/**
 * The lead card's sales-call permission, as the story leaves it.
 *
 * Before the call it is simply not recorded yet; the product's own
 * «phoneUnavailable» line used to be shown instead, telling the prospect to
 * add a phone number that the same card prints two rows above. After the call
 * the permission exists (the call records it — `recordDemoCallPermission`),
 * so the badge follows.
 */
function VoicePermissionCard({ granted, onAction }: { granted: boolean; onAction: () => void }) {
  const t = useTranslations("leads.voicePermission")
  return (
    <Card data-tour-id="lead-voice-permission">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex min-w-0 items-start gap-2 text-sm leading-snug">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">{t("title")}</span>
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0",
              granted
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
            )}
          >
            {granted ? t("status.allowed") : t("status.unknown")}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {granted ? t("description.allowed") : t("description.unknown")}
        </p>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          disabled
          onClick={onAction}
          className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left leading-snug sm:min-h-9"
        >
          {t("allowAction")}
        </Button>
      </CardContent>
    </Card>
  )
}
