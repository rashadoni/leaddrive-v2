"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft, BarChart3, Brain, Columns3, Hourglass, List, Mail, PhoneOutgoing, Plus, Search, Sparkles, Timer,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CollapsibleSection } from "@/components/crm/collapsible-section"
import { CustomerDetailsCards } from "@/components/crm/customer-details-cards"
import { StageProgress } from "@/components/deals/stage-progress"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { DEMO_DEAL_STAGES, demoMoney, type DemoActivityRecord } from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import { LeadCardView } from "./lead-scene"
import type { DemoSceneProps } from "../scene-props"
import { demoLabel, demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Sales → Deals: the board and the deal card.
 *
 * The section opens on the lead card, because that is where the prospect
 * presses «Convert» in the real product; after the conversion it shows the
 * board and then the card. Stage labels come from the product's own `deals`
 * namespace, and the chevron bar is the product's own StageProgress.
 *
 * As on `deals/page.tsx`: a card opens the deal's page (there is no
 * quick-view sheet — the demo used to draw one), a stage changes on the page's
 * stage bar or by dragging, and the summary is the board's four figures.
 */
export function DealScene(props: DemoSceneProps) {
  const { snapshot, step, reviewMode } = props
  const lead = snapshot.records.lead
  const onConvertStep = step?.id === "deal-convert"
  if (onConvertStep && !reviewMode && lead) return <LeadCardView {...props} lead={lead} />
  return <DealWorkspace {...props} />
}

function DealWorkspace({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("deals")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { deal, lead } = snapshot.records
  const [view, setView] = useState<"kanban" | "list">("kanban")
  const [cardOpen, setCardOpen] = useState(snapshot.state !== "DEAL_CREATED")
  // «Sövdələşmə kartı» talks about the card, so it opens with the step: the
  // kanban's advance does not remount the scene, and the card used to stay
  // shut behind two clicks the step never asked for.
  // (State adjusted while rendering, once per arrival on the step, so the
  // prospect can still close the card again.)
  const onCardStep = step?.id === "deal-card"
  const [openedForCardStep, setOpenedForCardStep] = useState(false)
  if (onCardStep && !openedForCardStep) {
    setOpenedForCardStep(true)
    setCardOpen(true)
  }

  if (!deal) {
    return <p className="text-sm text-muted-foreground">{t("noDealsInStage")}</p>
  }

  const stageLabel = (index: number) => t(DEMO_DEAL_STAGES[index].labelKey)
  // Shape required by the product's own StageProgress: { key, label, color }.
  const stages = DEMO_DEAL_STAGES.map((stage, index) => ({
    key: stage.key,
    label: stageLabel(index),
    color: stage.key === "won" ? "#22c55e" : "#FF4D00",
  }))

  // `stageKey` names the stage clicked on the deal page's stage bar.
  const advance = (stageKey: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id === "deal-advance") {
      const next = DEMO_DEAL_STAGES[deal.stageIndex + 1]?.key
      if (stageKey !== next) {
        hint(S.hintFollow(step.title))
        return
      }
      dispatch({ type: "transition", stepId: step.id, to: "DEAL_ADVANCED" })
      return
    }
    if (step?.id === "closed-won-move") {
      // The step says «pick the won stage» on the bar; nothing else is a win.
      if (stageKey !== "won") {
        hint(S.hintFollow(step.title))
        return
      }
      dispatch({ type: "transition", stepId: step.id, to: "CLOSED_WON" })
      return
    }
    hint(S.hintFollow(step?.title ?? ""))
  }

  // A card on the board opens the deal's page, as in the product.
  const openCard = () => setCardOpen(true)
  const nextStageKey = DEMO_DEAL_STAGES[deal.stageIndex + 1]?.key
  const won = deal.wonAt !== null
  const openAmount = won ? 0 : deal.amount
  const weighted = Math.round((openAmount * deal.probability) / 100)

  const activityCount = (type: DemoActivityRecord["type"]) => (lead?.activities ?? []).filter((entry) => entry.type === type).length
  const daysInFunnel = Math.max(0, Math.round((Date.parse(snapshot.updatedAt) - Date.parse(deal.createdAt)) / 86_400_000))

  if (!cardOpen) {
    return (
      <div data-testid="demo-scene-deals-board" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("totalDeals", { count: 1 })}</p>
          </div>
          {/* The pipeline picker appears in the product only with a second pipeline. */}
          <div className="flex flex-wrap items-center gap-2">
            <div data-tour-id="deals-view-tabs" className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-muted/30 p-1 dark:border-zinc-700">
              {([
                { key: "analytics" as const, Icon: BarChart3, label: tc("analytics") },
                { key: "kanban" as const, Icon: Columns3, label: tc("kanban") },
                { key: "list" as const, Icon: List, label: tc("list") },
              ]).map(({ key, Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => (key === "analytics" ? hint(S.hintDisabled) : setView(key))}
                  aria-current={view === key ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                    view === key ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            <Button data-tour-id="deals-new" onClick={() => hint(S.demoButtonHint)}>
              <Plus className="mr-1 h-4 w-4" /> {t("newDeal")}
            </Button>
          </div>
        </div>

        <div data-tour-id="deals-summary" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("statPipelineValue")}</p>
              <p className="mt-1 text-3xl font-semibold leading-none tracking-tight tabular-nums">{demoMoney(openAmount)}</p>
            </div>
            <div className="flex flex-wrap items-end gap-x-7 gap-y-3 sm:ml-auto">
              <SummaryFigure label={t("weightedBar")} value={demoMoney(weighted)} />
              <SummaryFigure label={t("statWon")} value={demoMoney(won ? deal.amount : 0)} tone="text-emerald-600 dark:text-emerald-400" />
              <SummaryFigure label={t("statLost")} value="0" tone="text-red-600 dark:text-red-400" />
            </div>
          </div>
          <div className="mt-3 flex gap-1">
            {DEMO_DEAL_STAGES.map((stage, index) => (
              <div key={stage.key} className="min-w-0 flex-1">
                <div className={cn("h-1.5 rounded-full", index <= deal.stageIndex ? "bg-primary" : "bg-muted")} />
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{stageLabel(index)}</p>
              </div>
            ))}
          </div>
          <div className="relative mt-3 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              readOnly
              placeholder={t("searchPlaceholder")}
              onClick={() => hint(S.demoButtonHint)}
              className="w-full rounded-lg border border-zinc-200 bg-background py-1.5 pl-9 pr-3 text-xs dark:border-zinc-700"
            />
          </div>
        </div>

        {view === "kanban" ? (
          <div data-tour-id="deals-kanban" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {DEMO_DEAL_STAGES.map((stage, index) => {
              const cards = index === deal.stageIndex ? [deal] : []
              return (
                <div key={stage.key} className="min-w-0">
                  <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-700">
                    <span className="truncate text-xs font-semibold">{stageLabel(index)}</span>
                    <span className="text-xs text-muted-foreground">{cards.length}</span>
                  </div>
                  <div className="min-h-[180px] space-y-2">
                    {cards.map((card) => (
                      <div key={card.id} data-tour-id="deals-card" className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                        <button type="button" onClick={openCard} className="block w-full text-left" {...demoTarget("deal-advance")} {...demoLabel(S.arrowOpenDeal)}>
                          <span className="block truncate text-xs font-medium">{card.title}</span>
                          <span className="mt-1 block truncate text-[11px] text-muted-foreground">{lead?.companyName}</span>
                          <span className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{demoMoney(card.amount)}</span>
                            <span>{card.probability}%</span>
                          </span>
                        </button>
                      </div>
                    ))}
                    {cards.length === 0 && (
                      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-muted-foreground/40 dark:border-zinc-700">—</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div data-tour-id="deals-list" className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("title")}</th>
                  <th className="px-4 py-2 font-medium">{t("company")}</th>
                  <th className="px-4 py-2 font-medium">{t("hintColStage")}</th>
                  <th className="px-4 py-2 text-right font-medium">{S.dealAmount}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="px-4 py-2"><button type="button" onClick={openCard} className="hover:underline">{deal.title}</button></td>
                  <td className="px-4 py-2 text-muted-foreground">{lead?.companyName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{stageLabel(deal.stageIndex)}</td>
                  <td className="px-4 py-2 text-right font-medium">{demoMoney(deal.amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

      </div>
    )
  }

  return (
    <div data-testid="demo-scene-deal-card" className="space-y-4">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setCardOpen(false)} aria-label={t("title")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{deal.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {S.dealOwner}: {lead?.assignedToName} · {S.dealExpectedClose}: {formatDate(deal.expectedCloseAt, locale)}
          </p>
        </div>
      </div>

      <div data-tour-id="deal-stage-progress">
        <StageProgress
          stages={stages}
          currentStage={DEMO_DEAL_STAGES[deal.stageIndex].key}
          onStageClick={(stageKey) => advance(stageKey)}
          stageButtonProps={(stageKey) => (stageKey === "won" ? demoTarget("closed-won-move") : stageKey === nextStageKey ? demoTarget("deal-advance") : undefined)}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div data-tour-id="deal-sidebar" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
            <div className="space-y-3 p-4 text-sm">
              <Field label={S.dealAmount} value={demoMoney(deal.amount)} />
              <Field label={S.dealProbability} value={`${deal.probability}%`} />
              <Field label={S.dealExpectedClose} value={formatDate(deal.expectedCloseAt, locale)} />
              <Field label={tc("assignee")} value={lead?.assignedToName ?? "—"} />
              <Field label={t("hintColStage")} value={stageLabel(deal.stageIndex)} />
              <Field label={S.dealCampaign} value={snapshot.records.campaign.name} />
            </div>
          </div>
          <div data-tour-id="deal-next-best-offers" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{S.nextBestOffers}</p>
            <p className="mt-2 text-sm">{S.nextBestOffersBody}</p>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <CollapsibleSection title={t("dealDetailsSection")}>
            <div data-tour-id="deal-kpi-chips" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Chip label={t("kpiDaysInFunnel")} value={String(daysInFunnel)} Icon={Hourglass} />
              <Chip label={t("kpiDaysAtStage")} value={String(daysInFunnel)} Icon={Timer} />
              {/* Counted from the record, never fixed: «Gedən zənglər: 0» used
                  to sit above a feed that logged an answered AI call. */}
              <Chip label={t("kpiEmailsSent")} value={String(activityCount("email"))} Icon={Mail} />
              <Chip label={t("kpiOutgoingCalls")} value={String(activityCount("call"))} Icon={PhoneOutgoing} />
            </div>
          </CollapsibleSection>

          <div data-tour-id="deal-customer-details">
            <CollapsibleSection title={t("customerDetails")}>
              <CustomerDetailsCards
                person={lead ? { name: lead.contactName, subtitle: lead.jobTitle, email: lead.email, phone: lead.phone } : null}
                company={lead ? { name: lead.companyName } : null}
              />
            </CollapsibleSection>
          </div>

          <div data-tour-id="deal-quick-actions" className="flex flex-wrap gap-2">
            {[tc("send"), t("kpiOutgoingCalls"), tc("timelineTab")].map((label) => (
              <Button key={label} size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)}>{label}</Button>
            ))}
          </div>

          <Card data-tour-id="deal-timeline">
            <CardHeader><CardTitle className="text-base">{t("toolbarFeed")}</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {(lead?.timeline ?? []).slice(-4).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{entry.title}</span>
                      {entry.subtitle && <span className="block text-xs text-muted-foreground">{entry.subtitle}</span>}
                    </span>
                    <time dateTime={entry.date} className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.date, locale)}</time>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card data-tour-id="deal-ai-prediction">
              <CardContent className="space-y-2 pt-6">
                <p className="flex items-center gap-1.5 text-sm font-medium"><Brain className="h-4 w-4 text-purple-500" /> {S.aiPrediction}</p>
                <p className="text-2xl font-bold text-primary">{deal.probability}%</p>
                <p className="text-xs text-muted-foreground">{S.aiPredictionBody}</p>
              </CardContent>
            </Card>
            <Card data-tour-id="deal-ai-suggestions">
              <CardContent className="space-y-2 pt-6">
                <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-[hsl(var(--ai-from))]" /> {S.aiSuggestion}</p>
                <p className="text-sm leading-relaxed">{S.aiSuggestionBody}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  )
}

function SummaryFigure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold leading-tight tabular-nums", tone)}>{value}</p>
    </div>
  )
}

function Chip({ label, value, Icon }: { label: string; value: string; Icon: typeof Hourglass }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="h-3 w-3" /> {label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  )
}
