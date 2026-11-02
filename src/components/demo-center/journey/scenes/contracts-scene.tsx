"use client"

import { useMemo, useState, type MouseEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ArrowLeft, Building2, CheckSquare, Clock, DollarSign, Download, ExternalLink, FileText, Hash, Layers, MoreHorizontal, PenLine, Plus, RefreshCw, Send, Sparkles, ThumbsDown, ThumbsUp, TrendingUp, UserCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ColorStatCard } from "@/components/color-stat-card"
import { DataTable } from "@/components/data-table"
import { PageHeader } from "@/components/page-header"
import { formatDate } from "@/lib/format-date"
import { daysUntilContractEnd } from "@/lib/contract-lifecycle/list-stats"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoLabel, demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import { mtmDemoToday } from "./mtm-demo-data"
import {
  CONTRACTS_DEMO_BODY,
  CONTRACTS_DEMO_DRAFT_ID,
  CONTRACTS_DEMO_QUOTE,
  CONTRACTS_DEMO_SIGNER,
  CONTRACTS_DEMO_STAGES,
  contractsDemoBell,
  contractsDemoDraft,
  contractsDemoLifecycle,
  contractsDemoList,
  contractsDemoNow,
  contractsDemoStats,
  type ContractsDemoRow,
} from "./contracts-demo-data"

/**
 * Contracts: the contract module, a module of its own beside the lead story
 * (owner, 2026-10-13: Omni Channel → Service Desk → Call Center → Route &
 * Field → Contracts).
 *
 * The product pages fetch their data and a page file cannot export its
 * parts, so their frames are redrawn here line for line with the product's
 * parts (`ColorStatCard`, `DataTable`, `PageHeader`) and words: the list
 * (contracts/page.tsx), the contract card's header, figures, approval chain
 * and e-signature (contracts/[id]/page.tsx), the signer's page
 * (sign/[token]/page.tsx) and «Müqavilə həyat dövrü»
 * (contracts/lifecycle/page.tsx). The figures are the product's own
 * arithmetic (`contracts-demo-data.ts`).
 *
 * What the screens say is what the product does: accepting a quote writes
 * the draft, the chain asks one level after another, the signature is the
 * product's own (a link by e-mail, typed or drawn), the first completed
 * signature makes the contract active, and the renewal reminders go to the
 * managers 90/60/30/14/7 days before the end. Renewing is the team's
 * decision: no status moves there by itself.
 */

type ContractsScreen = "list" | "detail" | "customer" | "lifecycle"
const SECTIONS = ["ctr-list", "ctr-approve", "ctr-sign", "ctr-control"] as const

/** The «Müqavilə nəzarəti» group's own menu (nav-items), and the screens each lights up. */
const NAV: ReadonlyArray<{ key: string; screens: readonly ContractsScreen[] }> = [
  { key: "contracts", screens: ["list", "detail", "customer"] },
  { key: "contractLifecycle", screens: ["lifecycle"] },
  { key: "contractTemplatesNav", screens: [] },
  { key: "intakeFormsNav", screens: [] },
  { key: "contractRequestsNav", screens: [] },
  { key: "approvalRulesNav", screens: [] },
  { key: "approvalDelegatesNav", screens: [] },
  { key: "contractMilestonesNav", screens: [] },
  { key: "contractAnalyticsNav", screens: [] },
]

// The list page's own colours (contracts/page.tsx), so a status reads the same here.
const STATUS_PILL: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
}
const STATUS_KEYS: Record<string, string> = { draft: "statusDraft", pending_approval: "statusPendingApproval", approved: "statusApproved", active: "statusActive" }
const TYPE_KEYS: Record<string, string> = { service_agreement: "typeService", nda: "typeNda", maintenance: "typeMaintenance", license: "typeLicense", sla: "typeSla", other: "typeOther" }
const ROLE_KEYS: Record<string, string> = { admin: "approvalRoleAdmin", manager: "approvalRoleManager" }

function screenOf(props: DemoSceneProps): ContractsScreen {
  const { section, step, snapshot } = props
  if (section.id === "ctr-list") return "list"
  if (section.id === "ctr-control") return "lifecycle"
  if (section.id === "ctr-sign" && step?.id === "ctr-sign-customer" && snapshot.ui["ctr.signed"] !== true) return "customer"
  return "detail"
}

function useContractsDemo(props: DemoSceneProps) {
  const { snapshot, section, step, reviewMode, dispatch, hint } = props
  const today = mtmDemoToday(snapshot.startedAt)
  const reached = (id: (typeof SECTIONS)[number]) => SECTIONS.indexOf(section.id as (typeof SECTIONS)[number]) > SECTIONS.indexOf(id)
  const flag = (path: string) => snapshot.ui[path] === true
  // A section opened straight from the menu starts where the one before it ends.
  const state = {
    submitted: reached("ctr-approve") || flag("ctr.submitted"),
    legal: reached("ctr-approve") || flag("ctr.legal"),
    finance: reached("ctr-approve") || flag("ctr.finance"),
    sent: reached("ctr-sign") || flag("ctr.sent"),
    signed: reached("ctr-sign") || flag("ctr.signed"),
  }
  const status = state.signed ? "active" : state.finance ? "approved" : state.submitted ? "pending_approval" : "draft"
  /** The step's own control, or a word on where to look instead. */
  const press = (stepId: string, path: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return false
    }
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return false
    }
    dispatch({ type: "ui", path, value: true })
    return true
  }
  return { today, state, status, press, hint }
}

export function ContractsScene(props: DemoSceneProps) {
  const { hint } = props
  const tNav = useTranslations("nav")
  const screen = screenOf(props)

  const keepInDemo = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element | null)?.closest?.("a[href]")
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }

  return (
    <div data-testid="demo-scene-contracts" className="space-y-4" onClickCapture={keepInDemo}>
      {screen !== "customer" && (
        <nav aria-label={tNav("groups.Contracts Control")} className="flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-card p-1 dark:border-zinc-700">
          {NAV.map((item) => {
            const active = item.screens.includes(screen)
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => (active ? undefined : hint(S.contractsTabHint))}
                className={cn("rounded-xl px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {tNav(item.key)}
              </button>
            )
          })}
        </nav>
      )}
      {screen === "list" && <ListScreen {...props} />}
      {screen === "detail" && <DetailScreen {...props} />}
      {screen === "customer" && <CustomerScreen {...props} />}
      {screen === "lifecycle" && <LifecycleScreen {...props} />}
    </div>
  )
}

/* ── Müqavilələr ──────────────────────────────────────────────────────── */

function ListScreen(props: DemoSceneProps) {
  const t = useTranslations("contracts")
  const locale = useLocale()
  const { today, press, hint } = useContractsDemo(props)
  const rows = useMemo(() => contractsDemoList(today), [today])
  const stats = useMemo(() => contractsDemoStats(today, rows), [today, rows])
  const now = Date.parse(contractsDemoNow(today))

  // The page's columns, but its type column and the row's quick-action icons,
  // and the table's tighter padding: at the demo's width the page's table
  // would scroll sideways inside its card. The type shows on the contract card.
  const columns = [
    { key: "contractNumber", label: t("number"), sortable: true, hint: t("hintColNumber"), render: (item: ContractsDemoRow) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{item.contractNumber}</span> },
    {
      key: "title", label: t("name"), sortable: true,
      render: (item: ContractsDemoRow) => item.id === CONTRACTS_DEMO_DRAFT_ID
        ? <button type="button" onClick={(event) => { event.stopPropagation(); press("ctr-list-open", "ctr.opened") }} className="line-clamp-2 max-w-[280px] text-left font-medium text-foreground underline-offset-4 hover:underline" title={item.title} {...demoTarget("ctr-list-open")}>{item.title}</button>
        : <span className="line-clamp-2 max-w-[280px] font-medium text-foreground" title={item.title}>{item.title}</span>,
    },
    {
      key: "company", label: t("company"), sortable: true,
      render: (item: ContractsDemoRow) => (
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-1 text-sm">{item.company.name}</span>
        </div>
      ),
    },
    {
      key: "valueAmount", label: t("amount"), sortable: true, hint: t("hintColAmount"),
      render: (item: ContractsDemoRow) => <span className="whitespace-nowrap font-medium tabular-nums">{item.valueAmount ? `${item.valueAmount.toLocaleString()} ${item.currency}` : <span className="text-muted-foreground/40">—</span>}</span>,
    },
    {
      key: "status", label: t("status"), sortable: true, hint: t("hintColStatus"),
      render: (item: ContractsDemoRow) => <span className={cn("inline-block whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium", STATUS_PILL[item.status] || "bg-muted")}>{t(STATUS_KEYS[item.status])}</span>,
    },
    {
      key: "endDate", label: t("endDate"), sortable: true, hint: t("hintColDates"),
      render: (item: ContractsDemoRow) => {
        const days = daysUntilContractEnd(item.endDate, now)
        const isExpiring = days !== null && days > 0 && days <= 90
        return (
          <div className={cn("flex items-center gap-1 text-sm", isExpiring && "font-medium text-orange-500")}>
            {isExpiring && <AlertTriangle className="h-3 w-3" />}
            {formatDate(item.endDate, locale)}
            {isExpiring && <span className="text-[10px]">({days}d)</span>}
          </div>
        )
      },
    },
  ]

  const total = rows.length
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={<p className="text-sm text-muted-foreground">{t("subtitle")}</p>}
        actions={
          <>
            <button type="button" onClick={() => hint(S.demoButtonHint)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground" title={t("exportXlsx")}>
              <Download className="h-4 w-4" />
              {t("exportXlsx")}
            </button>
            <Button variant="outline" onClick={() => hint(S.demoButtonHint)}><Layers className="mr-1 h-4 w-4" /> {t("newFromTemplate")}</Button>
            <Button onClick={() => hint(S.demoButtonHint)}><Plus className="mr-1 h-4 w-4" /> {t("newContract")}</Button>
          </>
        }
      />
      <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>

      {/* The page's six-across row needs its full width; in the demo's narrower frame they sit three to a row. */}
      <div data-tour-id="ctr-list-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <ColorStatCard label={t("statTotal")} value={total} icon={<FileText className="h-4 w-4" />} hint={t("hintTotalContracts")} />
        <ColorStatCard label={t("statActive")} value={stats.activeCount} icon={<FileText className="h-4 w-4" />} hint={t("hintActiveContracts")} />
        <ColorStatCard label={t("statTotalAmount")} value={`${stats.totalValue.toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} hint={t("hintContractValue")} />
        <ColorStatCard label={t("statMrr")} value={`${Math.round(stats.mrr).toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} />
        <ColorStatCard label={t("statAvgValue")} value={`${stats.avgValue.toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} />
        <ColorStatCard label={t("statExpiringSoon")} value={stats.expiringSoon} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintExpiringSoon")} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm" onClick={() => hint(S.demoButtonHint)}>{t("filterAll")} ({total})</Button>
        {(["draft", "pending_approval", "approved", "active"] as const).map((key) => (
          stats.statusCounts[key] ? (
            <Button key={key} variant="outline" size="sm" onClick={() => hint(S.demoButtonHint)}>{t(STATUS_KEYS[key])} ({stats.statusCounts[key]})</Button>
          ) : null
        ))}
        <Button variant="outline" size="sm" onClick={() => hint(S.demoButtonHint)} className={cn(stats.expiringSoon > 0 && "border-orange-300 text-orange-600")}>
          <AlertTriangle className="mr-1 h-3 w-3" /> {t("filterExpiring90d")} ({stats.expiringSoon})
        </Button>
      </div>

      <div data-tour-id="ctr-list-table">
        <DataTable
          columns={columns as never}
          data={rows as never}
          searchPlaceholder={t("searchLabelExtended")}
          searchKey="title"
          dense
          onRowClick={(row: Record<string, unknown>) => (row.id === CONTRACTS_DEMO_DRAFT_ID ? press("ctr-list-open", "ctr.opened") : hint(S.contractsOpenDraftHint))}
        />
      </div>
    </div>
  )
}

/* ── The contract card ────────────────────────────────────────────────── */

function DetailScreen(props: DemoSceneProps) {
  const { step } = props
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const { today, state, status, press, hint } = useContractsDemo(props)
  const contract = useMemo(() => contractsDemoDraft(today), [today])
  const now = Date.parse(contractsDemoNow(today))
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [esignOpen, setEsignOpen] = useState(false)

  const daysActive = Math.floor((now - new Date(contract.startDate).getTime()) / 86400000)
  const daysLeft = contract.endDate ? Math.floor((new Date(contract.endDate).getTime() - now) / 86400000) : null
  const variant = status === "active" ? "default" : status === "draft" ? "secondary" : undefined
  const canSubmit = status === "draft"
  const currentLevel = !state.submitted ? null : !state.legal ? 1 : !state.finance ? 2 : null
  const stageStatus = (order: number) => (!state.submitted ? null : order === 1 ? (state.legal ? "approved" : "pending") : (state.finance ? "approved" : "pending"))
  const decidedAt = formatDate(contractsDemoNow(today), "az")

  const openApproval = () => {
    if (step?.id !== "ctr-approve-submit") {
      press("ctr-approve-submit", "ctr.submitted")
      return
    }
    setApprovalOpen(true)
  }
  const submit = () => {
    if (press("ctr-approve-submit", "ctr.submitted")) setApprovalOpen(false)
  }
  const decide = (order: number) => {
    if (order === 1) press("ctr-approve-decide", "ctr.legal")
    else press("ctr-approve-decide", "ctr.finance")
  }
  const openEsign = () => {
    if (step?.id !== "ctr-sign-send") {
      press("ctr-sign-send", "ctr.sent")
      return
    }
    setEsignOpen(true)
  }
  const send = () => {
    if (press("ctr-sign-send", "ctr.sent")) setEsignOpen(false)
  }

  return (
    <div className="space-y-6">
      <div data-tour-id="ctr-detail-header" className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => hint(S.demoButtonHint)} aria-label={tc("back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-tight" title={contract.title}>{contract.title}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{contract.contractNumber}</span>
                <Badge variant={variant ?? "secondary"} data-testid="ctr-status">{t(STATUS_KEYS[status])}</Badge>
              </div>
              <a href={`/quotes/${CONTRACTS_DEMO_QUOTE.id}`} className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-emerald-200/70 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400" title={t("spawnedFromQuoteHint")}>
                <Sparkles className="h-3 w-3" />
                {t("spawnedFromQuote")}
              </a>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canSubmit && (
            <Button variant="default" onClick={openApproval} {...(approvalOpen ? {} : demoTarget("ctr-approve-submit"))}>
              <CheckSquare className="mr-1.5 h-4 w-4" /> {t("submitForApproval")}
            </Button>
          )}
          <Button variant="outline" onClick={() => hint(S.demoButtonHint)}><PenLine className="mr-1.5 h-4 w-4" /> {t("openEditor")}</Button>
          <Button variant="outline" onClick={() => hint(S.demoButtonHint)}><FileText className="mr-1.5 h-4 w-4" /> {t("viewDocument")}</Button>
          <Button variant="outline" size="icon" aria-label={t("moreActions")} onClick={() => hint(S.demoButtonHint)}><MoreHorizontal className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ColorStatCard label={tc("daysActive")} value={daysActive} icon={<Clock className="h-4 w-4" />} />
        <ColorStatCard label={tc("value")} value={`${Number(contract.valueAmount).toLocaleString()} ${contract.currency}`} icon={<DollarSign className="h-4 w-4" />} hint={t("hintColAmount")} />
        <ColorStatCard label={tc("type")} value={t(TYPE_KEYS[contract.type])} icon={<Hash className="h-4 w-4" />} hint={t("hintColType")} />
        <ColorStatCard label={tc("daysLeft")} value={daysLeft !== null ? `${daysLeft}` : "—"} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintColDates")} />
      </div>

      {approvalOpen && (
        <Card data-tour-id="ctr-approve-dialog">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CheckSquare className="h-5 w-5" /> {t("submitForApprovalTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("submitForApprovalDesc")}</p>
            {CONTRACTS_DEMO_STAGES.map((stage) => (
              <div key={stage.order} className="space-y-3 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <span className="text-xs text-muted-foreground">{t("approvalStageLabel", { num: stage.order })}</span>
                    <Input value={stage.label} readOnly className="h-8 text-sm" />
                  </div>
                  <div className="w-20 shrink-0 space-y-1">
                    <span className="text-xs text-muted-foreground">{t("approvalStageSlaHours")}</span>
                    <Input value={stage.slaHours} readOnly className="h-8 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("approvalModeLabel")}</span>
                  <div className="h-8 w-fit rounded border border-zinc-200/70 bg-card px-2 py-1.5 text-xs dark:border-zinc-700/70">{t("approvalModeAllOption")}</div>
                </div>
                <div className="space-y-0.5 border-l-2 border-border/30 pl-2">
                  <span className="text-[10px] text-muted-foreground">{t("approvalStageRole")}</span>
                  <Input value={stage.assigneeRole} readOnly className="h-7 text-xs" />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApprovalOpen(false)}>{tc("cancel")}</Button>
              <Button onClick={submit} {...demoTarget("ctr-approve-submit")} {...demoLabel(S.contractsArrowSubmit)}>{t("submitForApprovalTitle")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state.submitted && (
        <Card data-tour-id="ctr-approve-chain">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CheckSquare className="h-4 w-4 text-muted-foreground" /> {t("approvalChainTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {CONTRACTS_DEMO_STAGES.map((stage) => {
              const current = currentLevel === stage.order
              const statusOf = stageStatus(stage.order) ?? "pending"
              const statusKey = statusOf === "approved" ? "approvalStatusApproved" : "approvalStatusPending"
              return (
                <div key={stage.order} className={cn("rounded-md border", current && "border-primary/40 bg-primary/5")} title={statusOf === "pending" && !current ? t("approvalWaitingTurn") : undefined}>
                  <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-sm">
                    <span className="w-5 text-xs font-medium text-muted-foreground">{stage.order}.</span>
                    <span className="flex-1 font-medium">{stage.label}</span>
                    <span className="text-xs text-muted-foreground">{t("approvalModeAll")}</span>
                    <span className="text-xs text-muted-foreground">{t("approvalSlaShort", { hours: stage.slaHours })}</span>
                    <Badge variant={statusOf === "approved" ? "default" : "outline"} className="text-xs capitalize">{t(statusKey)}</Badge>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 pl-8 text-sm">
                    <span className="flex-1 text-xs text-muted-foreground">{t(ROLE_KEYS[stage.assigneeRole])}</span>
                    {statusOf === "approved" && <span className="text-xs text-muted-foreground">{decidedAt}</span>}
                    <Badge variant={statusOf === "approved" ? "default" : "outline"} className="text-xs capitalize">{t(statusKey)}</Badge>
                    {current && (
                      <div className="ml-1 flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 gap-1 border-green-300 px-2 text-xs text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950" onClick={() => decide(stage.order)} title={t("approvalApproveAction")} {...demoTarget("ctr-approve-decide")}>
                          <ThumbsUp className="h-3.5 w-3.5" />
                          {t("approvalApproveAction")}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => hint(S.contractsRejectHint)} title={t("approvalRejectAction")}>
                          <ThumbsDown className="h-3.5 w-3.5" />
                          {t("approvalRejectAction")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {state.finance && (
        <Card data-tour-id="ctr-sign-envelope">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base"><PenLine className="h-4 w-4 text-muted-foreground" /> {t("esignTitle")}</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => hint(S.demoButtonHint)} title={t("esignRefresh")}><RefreshCw className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openEsign} {...(state.sent || esignOpen ? {} : demoTarget("ctr-sign-send"))}>
                  <Send className="mr-1 h-3 w-3" />
                  {t("esignSendForSignature")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {esignOpen && (
              <div className="mb-3 space-y-4 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-base font-semibold"><PenLine className="h-5 w-5" /> {t("esignSendDialogTitle")}</p>
                <div className="space-y-1">
                  <span className="text-xs">{t("esignSubjectLabel")} *</span>
                  <Input value={contract.title} readOnly className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <span className="text-xs">{t("esignMessageLabel")}</span>
                  <textarea readOnly placeholder={t("esignMessagePlaceholder")} rows={3} className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-2">
                  <span className="text-xs">{t("esignSignersLabel")} *</span>
                  <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-1.5">
                    <Input value={CONTRACTS_DEMO_SIGNER.fullName} readOnly placeholder={t("esignSignerFullName")} className="h-8 text-sm" />
                    <Input value={CONTRACTS_DEMO_SIGNER.email} readOnly placeholder={t("esignSignerEmail")} className="h-8 text-sm" />
                    <div className="h-8 rounded border border-zinc-200/70 bg-card px-2 py-1.5 text-xs dark:border-zinc-700/70">{t("esignRoleSigner")}</div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => hint(S.demoButtonHint)}><Plus className="mr-1 h-3 w-3" /> {t("esignAddSigner")}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("esignEmailBestEffort")}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEsignOpen(false)}>{tc("cancel")}</Button>
                  <Button onClick={send} {...demoTarget("ctr-sign-send")} {...demoLabel(S.contractsArrowSend)}>{t("esignSendForSignature")}</Button>
                </div>
              </div>
            )}
            {!state.sent ? (
              <p className="text-sm text-muted-foreground">{t("esignEmpty")}</p>
            ) : (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="default" className="shrink-0 text-xs capitalize" data-testid="ctr-envelope-status">{t(state.signed ? "esignStatusCompleted" : "esignStatusSent")}</Badge>
                  <span className="min-w-0 flex-1 break-words font-medium">{contract.title}</span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>{t("esignSentAt")}: {new Date(contractsDemoNow(today)).toLocaleString()}</span>
                  {state.signed
                    ? <span>{t("esignCompletedAt")}: {new Date(contractsDemoNow(today)).toLocaleString()}</span>
                    : <span>{t("esignExpiresAt")}: {new Date(now + 30 * 86400000).toLocaleDateString()}</span>}
                </div>
                <div className="ml-1 divide-y divide-border/50 border-l-2 border-border/30 pl-1">
                  <div className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                    <Badge variant={state.signed ? "default" : "secondary"} className="shrink-0 text-[10px] capitalize">{t(state.signed ? "esignSignerSigned" : "esignSignerSent")}</Badge>
                    <span className="font-medium">{CONTRACTS_DEMO_SIGNER.fullName}</span>
                    <span className="text-muted-foreground">{CONTRACTS_DEMO_SIGNER.email}</span>
                    {state.signed && <span className="text-muted-foreground">{t("esignSignedAt")}: {new Date(contractsDemoNow(today)).toLocaleString()}</span>}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/* ── The signer's page (sign/[token]) ─────────────────────────────────── */

function CustomerScreen(props: DemoSceneProps) {
  const t = useTranslations("signPortal")
  const { today, press, hint } = useContractsDemo(props)
  const contract = useMemo(() => contractsDemoDraft(today), [today])

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{S.contractsCustomerCaption(CONTRACTS_DEMO_SIGNER.fullName)}</p>
      <div data-tour-id="ctr-sign-customer" className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700">
        <header className="border-b border-zinc-200 bg-white shadow-sm">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-indigo-600" />
              <span className="text-sm font-semibold text-zinc-800">{t("documentTitle")}</span>
            </div>
            <div className="text-sm text-zinc-500"><span className="font-medium text-zinc-700">{t("signedBy")}:</span> {CONTRACTS_DEMO_SIGNER.fullName}</div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
          <div className="space-y-1 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
            <p className="text-base font-semibold text-indigo-900">{contract.title}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-indigo-500">#{contract.contractNumber} — {contract.title}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-3"><h2 className="text-sm font-medium text-zinc-700">{contract.title}</h2></div>
            <div className="px-6 py-6">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{CONTRACTS_DEMO_BODY}</div>
            </div>
          </div>
          <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-zinc-600">{t("scrollToSign")}</p>
            <div className="flex w-fit gap-1 rounded-lg bg-zinc-100 p-1">
              <button type="button" className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-sm">{t("tabTyped")}</button>
              <button type="button" onClick={() => hint(S.demoButtonHint)} className="rounded-md px-4 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-700">{t("tabDrawn")}</button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-zinc-700">{t("typeNameLabel")}</label>
              <input type="text" value={CONTRACTS_DEMO_SIGNER.fullName} readOnly placeholder={t("typeNamePlaceholder")} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-3xl italic text-zinc-800" style={{ fontFamily: "'Dancing Script', cursive" }}>{CONTRACTS_DEMO_SIGNER.fullName}</p>
              </div>
              <p className="text-xs text-zinc-400">{t("typeNameHint")}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => press("ctr-sign-customer", "ctr.signed")} className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700" {...demoTarget("ctr-sign-customer")}>{t("signButton")}</button>
              <button type="button" onClick={() => hint(S.contractsRejectHint)} className="rounded-lg border border-zinc-200 px-5 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50">{t("declineButton")}</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/* ── Müqavilə həyat dövrü ─────────────────────────────────────────────── */

function formatMoney(n: number | null, currency: string): string {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—"
  const fmt = (v: number, suffix: string) => `${currency} ${v.toFixed(v >= 100 ? 0 : 1)}${suffix}`
  if (n >= 1_000_000) return fmt(n / 1_000_000, "M")
  if (n >= 1_000) return fmt(n / 1_000, "K")
  return `${currency} ${Math.round(n)}`
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000)
    return hours <= 1 ? "<1h" : `${hours}h`
  }
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function formatLocalDate(date: Date | null): string {
  if (!date) return "—"
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function LifecycleScreen(props: DemoSceneProps) {
  const t = useTranslations("slice2.contractLifecycle")
  const tc = useTranslations("slice2.common")
  const tn = useTranslations("notifications")
  const { today, hint } = useContractsDemo(props)
  const data = useMemo(() => contractsDemoLifecycle(today), [today])
  const bell = useMemo(() => contractsDemoBell(today), [today])
  const dueIn = (days: number) => (days < 0 ? tc("overdueDays", { days: Math.abs(days) }) : days === 0 ? tc("today") : days === 1 ? tc("tomorrow") : tc("inDays", { days }))
  const typeColors: Record<string, string> = { info: "bg-blue-500", warning: "bg-yellow-500", error: "bg-red-500" }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><FileText className="h-8 w-8 text-primary" /> {t("title")}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div data-tour-id="ctr-control-renewals" className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" /> {t("kpiRenewalAlerts")}</p>
            <p className="mt-0.5 text-2xl font-bold" data-testid="ctr-kpi-renewals">{data.renewals.total}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3" /> {t("kpiOverdueRenewals")}</p>
            <p className={cn("mt-0.5 text-2xl font-bold", data.renewals.overdueCount > 0 && "text-red-600")}>{data.renewals.overdueCount}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><UserCheck className="h-3 w-3" /> {t("kpiPendingApproval")}</p>
            <p className="mt-0.5 text-2xl font-bold">{data.approvals.total}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {t("kpiBottleneckStage")}</p>
            {data.approvals.bottleneckStage ? (
              <div className="mt-0.5">
                <span className="block truncate text-sm font-semibold">{data.approvals.bottleneckStage}</span>
                <span className="text-xs text-muted-foreground">{t("waiting", { count: data.approvals.bottleneckCount })}</span>
              </div>
            ) : <p className="mt-0.5 text-sm font-semibold">—</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><RefreshCw className="h-5 w-5 text-muted-foreground" /> {t("renewalAlerts")}</h2>
            <div className="space-y-2">
              {data.renewals.items.slice(0, 20).map((r) => (
                <div key={r.id} className={cn("rounded-lg border border-zinc-200 p-3 dark:border-zinc-700", r.isOverdue ? "border-red-500 bg-red-500/5" : r.daysUntilDue <= 14 ? "border-amber-500 bg-amber-500/5" : "")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate font-semibold"><Building2 className="h-3 w-3 shrink-0 text-muted-foreground" /> {r.companyName ?? t("noCompany")}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.contractNumber} · {r.contractTitle}</p>
                      <p className="mt-1 font-mono text-xs">{formatMoney(r.valueAmount, r.currency)} · {t("alertDays", { days: r.daysBeforeExpiry })}</p>
                      <a href={`/contracts/${r.contractId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="h-3 w-3" /> {t("openContract")}</a>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-sm font-semibold", r.isOverdue ? "text-red-600" : r.daysUntilDue <= 14 ? "text-amber-600" : "text-muted-foreground")}>{dueIn(r.daysUntilDue)}</p>
                      {r.endDate && <p className="font-mono text-xs text-muted-foreground">{t("ends", { date: formatLocalDate(r.endDate) })}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><UserCheck className="h-5 w-5 text-muted-foreground" /> {t("approvalQueue")}</h2>
            <div className="space-y-3">
              {data.approvals.groups.map((group) => (
                <div key={group.label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">{group.label}</h3>
                    <span className={cn("font-mono text-sm", group.contracts.length >= 3 ? "font-semibold text-amber-600" : "text-muted-foreground")}>{t("waiting", { count: group.contracts.length })}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.contracts.slice(0, 5).map((c) => (
                      <div key={c.currentStageId} className="border-t py-1.5 text-sm first:border-t-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate"><span className="font-mono text-xs text-muted-foreground">{c.contractNumber}</span> · {c.companyName ?? t("noCompany")}</p>
                            <p className="truncate text-xs text-muted-foreground">{c.contractTitle} · {formatMoney(c.valueAmount, c.currency)}</p>
                          </div>
                          <span className={cn("shrink-0 font-mono text-xs", c.ageMs > 7 * 86_400_000 ? "text-red-600" : c.ageMs > 3 * 86_400_000 ? "text-amber-600" : "text-muted-foreground")}>{formatAge(c.ageMs)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button type="button" onClick={() => hint(S.demoButtonHint)} className="flex items-center gap-1 rounded bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-600/20"><ThumbsUp className="h-3 w-3" /> {t("approveStage")}</button>
                          <button type="button" onClick={() => hint(S.demoButtonHint)} className="flex items-center gap-1 rounded bg-red-600/10 px-2 py-0.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-600/20"><ThumbsDown className="h-3 w-3" /> {t("rejectStage")}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("footerRenewals")}</p>
          <p>{t("footerApprovals")}</p>
        </div>
      </div>

      {bell && (
        <div data-tour-id="ctr-control-bell" className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{S.contractsBellCaption}</p>
          <div className="w-full max-w-80 overflow-hidden rounded-lg border border-zinc-200 bg-background shadow-xl dark:border-zinc-700">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h4 className="text-sm font-medium">{tn("title")}</h4>
            </div>
            <div className="border-b bg-muted/30 px-4 py-3 last:border-0">
              <div className="flex items-start gap-2">
                <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${typeColors[bell.type]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" data-testid="ctr-bell-title">{bell.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{bell.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{new Date(bell.deliveredAt).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
