"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useStageLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { KanbanBoard } from "@/components/deals/kanban-board"
import { Handshake, Plus, BarChart3, Columns3, List, Sparkles, X, Loader2, Search, Pencil, Trash2, Calendar, CheckSquare, Square, MinusSquare, FileText } from "lucide-react"
import { EntityBulkBar } from "@/components/entity-bulk-bar"
import { UserPicker } from "@/components/user-picker"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"
import { DealForm } from "@/components/deal-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DealsAnalytics } from "@/components/deals/deals-analytics"
import { cn } from "@/lib/utils"
import { STAGE_COLORS } from "@/lib/constants"
import { useLocale } from "next-intl"
import { DidYouKnow } from "@/components/did-you-know"
import { InlineTitleCell, InlineTextCell, InlineDateCell } from "@/components/tasks/inline-tasks-table"
import { MeddpiccChips } from "@/components/deals/meddpicc-chips"
import { parseMeddpicc, summarizeMeddpicc } from "@/lib/meddpicc"
import { toast } from "sonner"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import { InfoHint } from "@/components/info-hint"
import { bucketByCurrency, leadBucket, formatBucket, formatExtras, weightedForCurrency, currencyOf } from "@/lib/deal-money"

interface Deal {
  id: string
  name: string
  meddpicc?: unknown
  valueAmount: number
  currency: string
  stage: string
  pipelineId: string | null
  assignedTo: string | null
  probability: number
  notes: string | null
  expectedClose: string | null
  createdAt: string
  stageChangedAt: string | null
  company: { id: string; name: string } | null
  nextTask?: { id: string; title: string; dueDate: string | null; status: string } | null
  _count?: { offers: number }
}

export default function DealsPage() {
  const t = useTranslations("deals")
  const tc = useTranslations("common")
  const stageLabel = useStageLabel()
  const locale = useLocale()
  const { data: session } = useSession()
  const router = useRouter()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  useAutoTour("deals")
  const [formOpen, setFormOpen] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal | undefined>()
  const [sortBy, setSortBy] = useState("newest")
  const [tab, setTab] = useState<"analytics" | "kanban" | "list">("kanban")
  const [search, setSearch] = useState("")
  const [stageFilter, setStageFilter] = useState("all")
  const [offerFilter, setOfferFilter] = useState<"all" | "with" | "without">("all")
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [pipelines, setPipelines] = useState<any[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("")
  const [pipelineSummary, setPipelineSummary] = useState<{
    total: number
    weighted: number
    byStage: any[]
    byCurrency?: { currency: string; count: number; value: number; weighted: number }[]
  } | null>(null)
  // Roadmap #20 — saved-view integration. Declared AFTER selectedPipelineId
  // (architect P0 fix — the useState below was in the TDZ when this
  // useMemo factory referenced it; first render would crash with
  // "Cannot access 'selectedPipelineId' before initialization").
  const currentFiltersSnapshot = useMemo(
    () => ({ sortBy, search, stageFilter, offerFilter, tab, selectedPipelineId }),
    [sortBy, search, stageFilter, offerFilter, tab, selectedPipelineId],
  )
  const applySavedView = useCallback((view: SavedView) => {
    const f = view.filters as Record<string, unknown>
    if (typeof f.sortBy === "string") setSortBy(f.sortBy)
    if (typeof f.search === "string") setSearch(f.search)
    if (typeof f.stageFilter === "string") setStageFilter(f.stageFilter)
    if (f.offerFilter === "all" || f.offerFilter === "with" || f.offerFilter === "without") setOfferFilter(f.offerFilter)
    if (f.tab === "analytics" || f.tab === "kanban" || f.tab === "list") setTab(f.tab)
    if (typeof f.selectedPipelineId === "string") setSelectedPipelineId(f.selectedPipelineId)
  }, [])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  // Bulk selection (Roadmap #19 Phase B). List-view only; kanban/analytics
  // don't expose row-level multi-select. Cleared whenever pipeline switches
  // or the user navigates away from list view.
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set())
  const [bulkConfirmAction, setBulkConfirmAction] = useState<null | "delete">(null)
  // Forces the "Move to stage" <select> to remount with cleared value after
  // each action — controlled-React way to make it behave as a one-shot
  // trigger without mutating event.target.value (architect P1 fix).
  const [stageMenuKey, setStageMenuKey] = useState(0)
  const orgId = session?.user?.organizationId

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)
  const STAGES = (selectedPipeline?.stages || []).map((s: any) => ({
    key: s.name,
    name: s.name,
    label: stageLabel(s.name, s.displayName),
    displayName: stageLabel(s.name, s.displayName),
    color: s.color,
    hint: "",
  }))

  const fetchPipelines = async () => {
    try {
      const res = await fetch("/api/v1/pipelines")
      const json = await res.json()
      if (json.success && json.data.length > 0) {
        setPipelines(json.data)
        const def = json.data.find((p: any) => p.isDefault) || json.data[0]
        setSelectedPipelineId(def.id)
      }
    } catch {}
  }

  const fetchDeals = async (pipelineId?: string) => {
    try {
      const pid = pipelineId || selectedPipelineId
      const url = pid ? `/api/v1/deals?limit=200&pipelineId=${pid}` : "/api/v1/deals?limit=200"
      const res = await fetch(url, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setDeals(json.data.deals)
        if (json.data.pipelineSummary) setPipelineSummary(json.data.pipelineSummary)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchPipelines() }, [session])
  useEffect(() => { if (selectedPipelineId) fetchDeals(selectedPipelineId) }, [selectedPipelineId])
  // Drop selection whenever the data underneath changes (pipeline switch /
  // tab switch) — selected ids could point at deals no longer in view.
  useEffect(() => { setSelectedDealIds(new Set()) }, [selectedPipelineId, tab])

  // Bulk-action dispatcher. Mirrors tasks/page.tsx handleBulkAction shape.
  const handleBulkAction = async (action: string, value?: string) => {
    if (selectedDealIds.size === 0) return
    try {
      const res = await fetch("/api/v1/deals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedDealIds), action, value }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || "Bulk action failed"
        throw new Error(err)
      }
      const labelKey = action === "delete" ? "bulkDeletedToast" : action === "update_stage" ? "bulkStageToast" : "bulkReassignToast"
      toast.success(t(labelKey, { count: selectedDealIds.size }))
      setSelectedDealIds(new Set())
      if (selectedPipelineId) fetchDeals(selectedPipelineId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed")
    }
  }

  const toggleDealSelect = (id: string) => {
    setSelectedDealIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Inline-edit helper — PATCH /api/v1/deals/[id] then refetch.
  // toast.error on server/network failure; re-throws so cell state can revert.
  // Uses a `handled` sentinel on thrown errors to avoid double-toasting when
  // the server returned an explicit error (was both server-toast + network-toast).
  const inlineUpdate = async (dealId: string, patch: Record<string, unknown>): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error || `Update failed (${res.status})`
        toast.error(msg)
        throw Object.assign(new Error(msg), { handled: true })
      }
      fetchDeals()
    } catch (err: any) {
      if (!err?.handled) toast.error("Network error — change not saved")
      throw err
    }
  }

  // Validate-and-save helper for numeric cells. Returns a thenable; throws a
  // {handled:true} error on validation failure so the cell reverts cleanly.
  const inlineUpdateNumber = async (
    dealId: string,
    field: string,
    raw: string,
    opts?: { min?: number; max?: number; allowZero?: boolean },
  ): Promise<void> => {
    const trimmed = raw.trim()
    if (trimmed === "") {
      toast.error(`${field} cannot be empty`)
      throw Object.assign(new Error("empty"), { handled: true })
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) {
      toast.error(`${field} must be a number`)
      throw Object.assign(new Error("nan"), { handled: true })
    }
    if (!opts?.allowZero && n === 0 && field === "valueAmount") {
      // valueAmount=0 is technically valid but almost always a typo — soft warn
      toast.warning("Value set to 0")
    }
    const min = opts?.min ?? 0
    const max = opts?.max ?? Number.MAX_SAFE_INTEGER
    const clamped = Math.min(max, Math.max(min, n))
    return inlineUpdate(dealId, { [field]: clamped })
  }

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)
    setAiOpen(true)
    // Client-side backstop: guarantee the panel never hangs on "Загрузка..." even
    // if the server stops responding. Slightly above the route's ~90s worst case so
    // the server's own clean 503 normally wins the race on a slow upstream.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 100_000)
    try {
      const res = await fetch("/api/v1/deals/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ lang: locale }),
        signal: controller.signal,
      })
      const json = await res.json()
      if (json.success) {
        setAiResult(json.data.analysis)
      } else {
        setAiError(json.error || "Analysis failed")
      }
    } catch {
      setAiError(tc("errorNetwork"))
    } finally {
      clearTimeout(timer)
      setAiLoading(false)
    }
  }

  // Filtered + sorted deals
  // D2 sort support: totalScore per deal, computed once per data change —
  // the comparator must not re-parse JSON O(n log n) times.
  const meddpiccScores = useMemo(
    () => new Map(deals.map(d => [d.id, summarizeMeddpicc(parseMeddpicc(d.meddpicc)).totalScore])),
    [deals],
  )

  const filteredDeals = useMemo(() => {
    let result = [...deals]

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.company?.name || "").toLowerCase().includes(q) ||
        (d.notes || "").toLowerCase().includes(q)
      )
    }

    if (stageFilter !== "all") {
      result = result.filter(d => d.stage === stageFilter)
    }
    if (offerFilter !== "all") {
      result = result.filter(d => offerFilter === "with"
        ? (d._count?.offers ?? 0) > 0
        : (d._count?.offers ?? 0) === 0)
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "newest": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case "oldest": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        case "value_desc": return b.valueAmount - a.valueAmount
        case "value_asc": return a.valueAmount - b.valueAmount
        case "name": return a.name.localeCompare(b.name)
        case "probability": return b.probability - a.probability
        case "meddpicc": return (meddpiccScores.get(b.id) ?? 0) - (meddpiccScores.get(a.id) ?? 0)
        case "close_date": return (a.expectedClose || "9999").localeCompare(b.expectedClose || "9999")
        default: return 0
      }
    })

    return result
  }, [deals, search, stageFilter, offerFilter, sortBy, meddpiccScores])

  const kanbanDeals = filteredDeals.map(d => ({
    id: d.id,
    name: d.name,
    company: d.company?.name || "",
    valueAmount: d.valueAmount,
    currency: d.currency,
    stage: d.stage,
    assignedTo: d.assignedTo || "",
    probability: d.probability,
    stageChangedAt: d.stageChangedAt,
    nextTask: d.nextTask || null,
    meddpicc: d.meddpicc,
  }))

  const [moveError, setMoveError] = useState<string | null>(null)

  const handleDealMove = useCallback(async (dealId: string, newStage: string) => {
    setMoveError(null)
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d))
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ stage: newStage }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.validationErrors?.length) {
          setMoveError(data.validationErrors.map((e: any) => e.message).join(". "))
        } else {
          setMoveError(data?.error || "Failed to move deal")
        }
        fetchDeals()
      }
    } catch {
      setMoveError(tc("errorNetwork"))
      fetchDeals()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/deals/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchDeals()
  }

  // Карточки «Выиграно»/«Проиграно» над канбаном: по смыслу стадии, иначе
  // самая крупная сделка организации (CLOSED_WON) в сумму не попадает, а
  // конверсия во вкладке «Аналитика» считается от заниженного знаменателя.
  const wonDeals = deals.filter(d => canonicalDealStage(d.stage) === "WON")
  const lostCount = deals.filter(d => canonicalDealStage(d.stage) === "LOST").length

  // Деньги на этом экране группируются по валюте и НИКОГДА не складываются
  // между валютами: доска с 12 000 USD и 8 000 AZN складывала их в одно
  // число под знаком маната — числа, которого нет ни в одной валюте.
  // Почему группируем, а не переводим по курсу — `src/lib/deal-money.ts`.
  const openDeals = useMemo(
    () => deals.filter(d => {
      const canonical = canonicalDealStage(d.stage)
      return canonical !== "WON" && canonical !== "LOST"
    }),
    [deals],
  )
  // Сервер считает сводку по ВСЕЙ воронке, а `deals` — это страница на 200
  // записей. Поэтому ведущая цифра берётся из сводки, а клиентский расчёт
  // остаётся запасным путём для ответа без `byCurrency` (старый кэш SW).
  const pipelineBuckets = useMemo(
    () => (pipelineSummary?.byCurrency?.length
      ? pipelineSummary.byCurrency.map(b => ({ currency: b.currency, value: b.value, count: b.count }))
      : bucketByCurrency(openDeals)),
    [pipelineSummary, openDeals],
  )
  const { primary: pipelinePrimary, extras: pipelineExtras } = leadBucket(pipelineBuckets)
  const pipelineExtrasLabel = formatExtras(pipelineExtras)
  const singleCurrency = pipelineBuckets.length <= 1
  const weightedValue = pipelineSummary?.byCurrency?.length
    ? pipelineSummary.byCurrency.find(b => b.currency === pipelinePrimary.currency)?.weighted ?? 0
    : weightedForCurrency(openDeals, pipelinePrimary.currency)
  const { primary: wonPrimary, extras: wonExtras } = leadBucket(bucketByCurrency(wonDeals), pipelinePrimary.currency)
  const wonExtrasLabel = formatExtras(wonExtras)
  const openCount = pipelineBuckets.reduce((n, b) => n + b.count, 0)

  // Вкладка «Аналитика» строит все свои графики из одного массива сделок.
  // Отдать ей смесь валют — значит снова показать сумму, которой нет; поэтому
  // она видит только главную валюту, а под KPI пишется, сколько сделок из-за
  // этого не попало в расчёт.
  const analyticsDeals = useMemo(
    () => deals.filter(d => currencyOf(d) === pipelinePrimary.currency),
    [deals, pipelinePrimary.currency],
  )
  const analyticsExcluded = deals.length - analyticsDeals.length
  const analyticsLostCount = analyticsDeals.filter(d => canonicalDealStage(d.stage) === "LOST").length

  const stageNames = useMemo(() => {
    const names = [...new Set(deals.map(d => d.stage))]
    return STAGES.length > 0
      ? STAGES.map((s: any) => s.key).filter((k: string) => names.includes(k))
      : names
  }, [deals, STAGES])

  // Стадии перечислялись на экране трижды: чипы фильтра, полоса и подпись под
  // ней. Осталось одно место — легенда под полосой, она же и фильтр. Открытые
  // стадии берут сумму из серверной сводки (она считает всю воронку, а не
  // страницу на 200 записей); закрытые — из загруженных сделок, ровно как
  // считались карточки «Выиграно» и «Проиграно» до этой правки.
  const legendStages = useMemo(() => {
    const fromServer = new Map<string, { value: number; count: number }>(
      (pipelineSummary?.byStage || []).map((s: any) => [s.name, { value: s.value, count: s.count }]),
    )
    return stageNames.map((name: string) => {
      const server = fromServer.get(name)
      const stageDeals = deals.filter(d => d.stage === name)
      if (server) {
        // Открытая стадия: сумма серверная, то есть по всей воронке — но она
        // сложена по всем валютам, поэтому показываем её только когда валюта
        // на доске одна.
        return { name, count: server.count, value: server.value, currency: pipelinePrimary.currency, showMoney: singleCurrency }
      }
      // Закрытая стадия: сервер её не считает. Берём загруженные сделки и —
      // это важно — её СОБСТВЕННУЮ валюту: выигранная сделка в долларах,
      // подписанная манатом главной воронки, это ровно тот дефект, который
      // здесь чинится.
      const stageBuckets = bucketByCurrency(stageDeals)
      const { primary } = leadBucket(stageBuckets, pipelinePrimary.currency)
      return {
        name,
        count: stageDeals.length,
        value: primary.value,
        currency: primary.currency,
        showMoney: stageBuckets.length <= 1,
      }
    })
  }, [stageNames, deals, pipelineSummary, pipelinePrimary.currency, singleCurrency])
  const legendTotalCount = legendStages.reduce((n, stage) => n + stage.count, 0)

  const getStageLabel = (stage: string) => {
    const s = STAGES.find((st: any) => st.key === stage)
    return s?.label || stage
  }

  const getStageColor = (stage: string) => {
    const s = STAGES.find((st: any) => st.key === stage)
    return s?.color || STAGE_COLORS.LEAD
  }

  if (loading) {
    return (
      <div className={"space-y-6"}>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse"><div className="h-96 bg-muted rounded-lg" /></div>
      </div>
    )
  }

  const tabs = [
    { mode: "analytics" as const, Icon: BarChart3, label: tc("analytics"), tourId: undefined },
    { mode: "kanban"    as const, Icon: Columns3,  label: tc("kanban"),    tourId: "deals-kanban" },
    { mode: "list"      as const, Icon: List,      label: tc("list"),      tourId: undefined },
  ]

  return (
    <div className={"space-y-5"}>

      {/* ── Заголовок, режим просмотра и действия — одной строкой ──
           Раньше это были две полосы поверх ещё пяти: до первой сделки экран
           показывал только органы управления. Заголовок держит строку слева,
           переключатель режима идёт следом, действия прижаты вправо. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {t("title")}
            <TourReplayButton tourId="deals" />
            <HelpButton slug="deals" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("totalDeals", { count: deals.length })}
          </p>
        </div>

        {/* Segmented tab control */}
        <div className="flex border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 bg-muted/30 w-fit">
          {tabs.map(({ mode, Icon, label, tourId }) => (
            <button
              key={mode}
              data-tour-id={tourId}
              onClick={() => setTab(mode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all",
                tab === mode
                  ? "bg-background shadow-sm font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 ml-auto">
          {pipelines.length > 1 && (
            <select
              data-tour-id="deals-pipeline-select"
              value={selectedPipelineId}
              onChange={e => setSelectedPipelineId(e.target.value)}
              className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 px-3 text-sm bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {pipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " ★" : ""}</option>
              ))}
            </select>
          )}
          {(tab === "kanban" || tab === "list") && (
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 px-3 text-sm bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="newest">{t("sortNewest")}</option>
              <option value="oldest">{t("sortOldest")}</option>
              <option value="value_desc">{t("sortAmountDesc")}</option>
              <option value="value_asc">{t("sortAmountAsc")}</option>
              <option value="name">{t("sortNameAsc")}</option>
              <option value="meddpicc">MEDDPICC</option>
              <option value="probability">{t("winProbability")} ↓</option>
              <option value="close_date">{t("expectedClose")} ↑</option>
            </select>
          )}
          <button
            data-tour-id="deals-new"
            onClick={() => { setEditDeal(undefined); setFormOpen(true) }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#FF4D00] text-white hover:bg-[#e04400] transition-colors rounded-lg"
          >
            <Plus className="h-4 w-4" />
            {t("newDeal")}
          </button>
        </div>
      </div>

      <DidYouKnow page="deals" className="mb-1" />

      {/* ── Сводка воронки и строка поиска ──
          До первой сделки экран показывал семь горизонтальных полос: заголовок,
          вкладки, поиск, чипы стадий, кнопку ИИ, четыре карточки метрик, полосу
          воронки и подпись под ней. Осталось две — карточка сводки (одна
          главная цифра, три вспомогательных, полоса и легенда, она же фильтр по
          стадиям) и строка поиска. Блок общий для доски и списка: фильтр по
          стадиям нужен обоим режимам. */}
      {(tab === "kanban" || tab === "list") && (
        <>
          <div data-tour-id="deals-summary" className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("statPipelineValue")}
                  <InfoHint text={t("hintPipelineValue")} size={12} />
                </p>
                <p className="mt-1 text-3xl sm:text-4xl font-semibold leading-none tracking-tight tabular-nums">
                  {formatBucket(pipelinePrimary)}
                </p>
                {pipelineExtrasLabel && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    {pipelineExtrasLabel}
                    <InfoHint text={t("mixedCurrencyHint")} size={12} />
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-x-7 gap-y-3 sm:ml-auto">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("weightedBar")}</p>
                  <p className="mt-0.5 text-lg font-semibold leading-tight tabular-nums">
                    {formatBucket({ currency: pipelinePrimary.currency, value: weightedValue, count: pipelinePrimary.count })}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("statWon")}
                    <InfoHint text={t("hintWonValue")} size={12} />
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-lg font-semibold leading-tight tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatBucket(wonPrimary)}
                    {wonExtrasLabel && (
                      <span className="text-xs font-normal text-muted-foreground" title={wonExtrasLabel}>
                        {wonExtrasLabel}
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("statLost")}
                    <InfoHint text={t("hintLostCount")} size={12} />
                  </p>
                  <p className="mt-0.5 text-lg font-semibold leading-tight tabular-nums text-red-600 dark:text-red-400">
                    {lostCount}
                  </p>
                </div>
              </div>
            </div>

            {pipelineSummary && pipelineSummary.byStage.length > 0 && (
              <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                  {pipelineSummary.byStage.map((s: any) => {
                    // На доске с одной валютой полоса показывает доли по
                    // деньгам. Если валют несколько, складывать их нельзя —
                    // тогда доли считаются по числу сделок, и легенда рядом
                    // перестаёт называть суммы.
                    const pct = singleCurrency
                      ? (pipelineSummary.total > 0 ? (s.value / pipelineSummary.total) * 100 : 0)
                      : (openCount > 0 ? (s.count / openCount) * 100 : 0)
                    const stageInfo = STAGES.find((st: any) => st.key === s.name)
                    const money = formatBucket({ currency: pipelinePrimary.currency, value: s.value, count: s.count })
                    const weighted = formatBucket({ currency: pipelinePrimary.currency, value: s.weighted, count: s.count })
                    return (
                      <div
                        key={s.name}
                        className="h-full rounded-sm transition-all"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          backgroundColor: stageInfo?.color || STAGE_COLORS.LEAD,
                        }}
                        title={singleCurrency
                          ? `${stageInfo?.label || s.name}: ${money} (${t("weightedTooltip")} ${weighted})`
                          : `${stageInfo?.label || s.name}: ${s.count}`}
                      />
                    )
                })}
              </div>
            )}

            {/* Легенда полосы — она же единственный фильтр по стадиям.
                Рисуется отдельно от полосы: полоса живёт из серверной сводки
                по ОТКРЫТЫМ сделкам, и когда открытых нет (всё закрыто, либо
                так отработало правило видимости), фильтр вместе с полосой
                исчезал с экрана — а сброс фильтра, восстановленного из
                сохранённого представления, нажать было бы нечем. */}
            {legendStages.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => setStageFilter("all")}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition-colors",
                    stageFilter === "all"
                      ? "bg-foreground text-background font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tc("all")} <span className="tabular-nums">{legendTotalCount}</span>
                </button>
                {legendStages.map((stage) => {
                  const stageInfo = STAGES.find((st: any) => st.key === stage.name)
                  const active = stageFilter === stage.name
                  return (
                    <button
                      key={stage.name}
                      type="button"
                      onClick={() => setStageFilter(active ? "all" : stage.name)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageInfo?.color || STAGE_COLORS.LEAD }} />
                      <span className="truncate">{stageInfo?.label || stage.name}</span>
                      {stage.showMoney && stage.value > 0 && (
                        <span className="font-semibold text-foreground tabular-nums">
                          {formatBucket({ currency: stage.currency, value: stage.value, count: stage.count })}
                        </span>
                      )}
                      <span className="tabular-nums">· {stage.count}</span>
                    </button>
                  )
              })}
            </div>
            )}
          </div>

          {/* Поиск, фильтр по предложениям и счётчик — одна строка. Полоса
              чипов стадий, которая стояла под ней, уехала в легенду сводки. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[260px] max-w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 pl-9 pr-3 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
              />
            </div>
            <select
              value={offerFilter}
              onChange={(event) => setOfferFilter(event.target.value as "all" | "with" | "without")}
              className="h-9 rounded-lg border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"
              aria-label={t("offerFilter")}
            >
              <option value="all">{t("offerFilterAll")}</option>
              <option value="with">{t("offerFilterWith")}</option>
              <option value="without">{t("offerFilterWithout")}</option>
            </select>
            {(search || stageFilter !== "all" || offerFilter !== "all") && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {filteredDeals.length} / {deals.length}
              </span>
            )}
          </div>
        </>
      )}

      {/* ── Da Vinci AI button ──
           Только на вкладке «Аналитика»: на канбане фиолетовая кнопка была
           третьим конкурирующим акцентом рядом с оранжевой «Новая сделка» и
           цветной полосой стадий, а звала она именно в аналитику. */}
      {tab === "analytics" && (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={runAiAnalysis}
          disabled={aiLoading || deals.length === 0}
          className="relative overflow-hidden bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] hover:opacity-90 text-white border-0 shadow-md shadow-[hsl(var(--ai-from))]/25 hover:shadow-lg hover:shadow-[hsl(var(--ai-from))]/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
        >
          {aiLoading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <span className="relative mr-1.5 flex h-4 w-4 items-center justify-center">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </span>
          )}
          Da Vinci {tc("analytics").toLowerCase()}
        </Button>
      </div>
      )}

      {/* ── Da Vinci AI result card ── */}
      {aiOpen && tab === "analytics" && (
        <div className="rounded-xl border border-[hsl(var(--ai-from))]/20 bg-card p-5">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))]">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-sm font-semibold">Da Vinci — {t("title")}</h3>
            </div>
            <button onClick={() => { setAiOpen(false); setAiResult(null) }} className="p-1 rounded-md hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}...
            </div>
          )}
          {aiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
              {aiError}
            </div>
          )}
          {aiResult && (
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{aiResult}</div>
          )}
        </div>
      )}

      {/* ── Content ── */}
      {tab === "analytics" ? (
        <DealsAnalytics
          deals={analyticsDeals.map(d => ({
            id: d.id,
            title: d.name,
            value: d.valueAmount,
            stage: d.stage,
            probability: d.probability,
            company: d.company ? { name: d.company.name } : undefined,
            expectedCloseDate: d.expectedClose || undefined,
            createdAt: d.createdAt,
          }))}
          pipelineValue={pipelinePrimary.value}
          wonValue={wonPrimary.value}
          lostCount={analyticsLostCount}
          wonCount={wonPrimary.count}
          currency={pipelinePrimary.currency}
          excludedNote={analyticsExcluded > 0 ? t("mixedCurrencyHint") : null}
        />
      ) : tab === "list" ? (
        /* ── LIST VIEW ── */
        <>
        {/* Bulk-actions bar — Roadmap #19 Phase B. List view only.
            Stage selector + reassign use the same `handleBulkAction` dispatcher
            wired to `/api/v1/deals/bulk`. */}
        <EntityBulkBar
          selectedCount={selectedDealIds.size}
          onClearSelection={() => setSelectedDealIds(new Set())}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{t("bulkSetStage")}</span>
            <select
              key={stageMenuKey}
              defaultValue=""
              onChange={(e) => {
                const stage = e.target.value
                if (!stage) return
                handleBulkAction("update_stage", stage)
                // Force remount so the select returns to the "Move to..."
                // placeholder. Controlled approach without mutating
                // event.target.value (architect P1 fix on `ccc60f91`).
                setStageMenuKey(k => k + 1)
              }}
              className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
              aria-label={t("bulkSetStage")}
            >
              <option value="" disabled>{t("bulkSetStage")}</option>
              {STAGES.map((s: { key: string; label: string }) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          {/* Phase F: reassign popover. Endpoint already supported it; UI was the gap. */}
          <UserPicker
            orgId={orgId ? String(orgId) : undefined}
            onSelect={(userId) => handleBulkAction("reassign", userId ?? "")}
          />
          <Button
            variant="destructive"
            size="sm"
            className="gap-1 ml-auto"
            onClick={() => setBulkConfirmAction("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" /> {tc("delete")}
          </Button>
        </EntityBulkBar>

        {/* Roadmap #20 — saved-view chips */}
        <SavedViewBar
          entityType="deals"
          currentFilters={currentFiltersSnapshot}
          onApply={applySavedView}
          onDefaultLoad={applySavedView}
        />

        {/* Mobile stacked-card view (#18) — shown below md:. Tap → /deals/[id]. */}
        <div className="md:hidden space-y-2">
          {filteredDeals.length === 0 ? (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
              <Handshake className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {t("noDeals")}
            </div>
          ) : (
            filteredDeals.map((deal) => {
              const probColor = deal.probability >= 70
                ? "text-emerald-600 dark:text-emerald-400"
                : deal.probability >= 40
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
              const stageColor = getStageColor(deal.stage)
              const isSelected = selectedDealIds.has(deal.id)
              return (
                <div
                  key={deal.id}
                  className={cn(
                    "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
                    isSelected && "ring-1 ring-primary/40 bg-primary/[0.04]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* Bulk select — 44px touch target via padding */}
                    <button
                      type="button"
                      onClick={() => toggleDealSelect(deal.id)}
                      aria-label={tc("selectRow")}
                      className="flex h-11 w-6 items-center justify-center -ml-1 shrink-0"
                    >
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push(`/deals/${deal.id}`)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-medium leading-snug break-words flex-1">{deal.name}</h3>
                        <div className="text-right shrink-0">
                          <div className="text-base font-semibold tabular-nums whitespace-nowrap">
                            {deal.valueAmount.toLocaleString()} <span className="text-xs text-muted-foreground">{deal.currency}</span>
                          </div>
                          <div className={cn("text-xs font-medium tabular-nums", probColor)}>
                            {deal.probability}%
                          </div>
                        </div>
                      </div>
                      {deal.company?.name && (
                        <div className="text-xs text-muted-foreground mt-0.5">{deal.company.name}</div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stageColor }} />
                          <span className="font-medium">{getStageLabel(deal.stage)}</span>
                        </span>
                        {deal.expectedClose && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(deal.expectedClose).toLocaleDateString(locale)}
                          </span>
                        )}
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                          (deal._count?.offers ?? 0) > 0
                            ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                            : "bg-muted text-muted-foreground",
                        )}>
                          <FileText className="h-3 w-3" />
                          {(deal._count?.offers ?? 0) > 0
                            ? t("offerCount", { count: deal._count?.offers ?? 0 })
                            : t("offerNone")}
                        </span>
                      </div>
                    </button>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setEditDeal(deal); setFormOpen(true) }}
                        aria-label={t("editDeal")}
                        className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeleteId(deal.id); setDeleteName(deal.name) }}
                        aria-label={t("deleteDealBtn")}
                        className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Desktop table — hidden below md: */}
        <div className="hidden md:block rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="bg-muted border-b border-zinc-200 dark:border-zinc-700">
                  {/* Bulk-select header — Roadmap #19 Phase B. Tri-state:
                      empty / partial / all-page selected. `every`/`some`
                      computed once and reused (architect P2). */}
                  {(() => {
                    const allOnPageSelected = filteredDeals.length > 0 && filteredDeals.every(d => selectedDealIds.has(d.id))
                    const someOnPageSelected = !allOnPageSelected && filteredDeals.some(d => selectedDealIds.has(d.id))
                    return (
                      <th className="px-3 py-3 w-10">
                        <button
                          type="button"
                          onClick={() => {
                            if (allOnPageSelected) setSelectedDealIds(new Set())
                            else setSelectedDealIds(new Set(filteredDeals.map(d => d.id)))
                          }}
                          aria-label={tc("selectAllRows")}
                          className="p-0.5 rounded hover:bg-muted"
                        >
                          {allOnPageSelected
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : someOnPageSelected
                            ? <MinusSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </th>
                    )
                  })()}
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[220px]">{tc("name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[150px]">{t("company")}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground min-w-[130px]">{t("dealValue")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[120px]">{tc("status")}</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground w-[130px]">{t("winProbability")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[170px]">MEDDPICC</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[130px]">{t("offers")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground min-w-[130px]">{t("expectedClose")}</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                      <Handshake className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      {t("noDeals")}
                    </td>
                  </tr>
                ) : (
                  filteredDeals.map(deal => (
                    <tr
                      key={deal.id}
                      className={cn(
                        "border-b border-zinc-200 dark:border-zinc-700 last:border-0 transition-colors hover:bg-muted/50 group",
                        selectedDealIds.has(deal.id) && "bg-primary/[0.04]",
                      )}
                    >
                      {/* Bulk-select cell */}
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => toggleDealSelect(deal.id)}
                          aria-label={tc("selectRow")}
                          className="p-0.5 rounded hover:bg-muted"
                        >
                          {selectedDealIds.has(deal.id)
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      </td>
                      {/* Name (click → /deals/[id], double-click → rename inline) */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          <InlineTitleCell
                            value={deal.name}
                            onSave={(v) => inlineUpdate(deal.id, { name: v })}
                            onOpen={() => router.push(`/deals/${deal.id}`)}
                          />
                        </div>
                      </td>
                      {/* Company — read-only (Phase B will add picker) */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {deal.company?.name || "—"}
                      </td>
                      {/* Value Amount (inline editable number — validates NaN/empty) */}
                      <td className="px-4 py-3 text-right tabular-nums text-foreground whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <InlineTextCell
                            value={String(deal.valueAmount)}
                            inputType="number"
                            placeholder="0"
                            onSave={(v) => inlineUpdateNumber(deal.id, "valueAmount", v, { min: 0, max: 999999999 })}
                          />
                          <span className="text-xs text-muted-foreground">{deal.currency}</span>
                        </div>
                      </td>
                      {/* Stage (custom inline cell — preserves dot+colored-text look) */}
                      <td className="px-4 py-3">
                        <InlineStageCell
                          value={deal.stage}
                          stages={STAGES}
                          getColor={getStageColor}
                          getLabel={getStageLabel}
                          onSave={(v) => inlineUpdate(deal.id, { stage: v })}
                        />
                      </td>
                      {/* Probability (inline editable 0-100 — validates + clamps) */}
                      <td className="px-4 py-3 text-center">
                        <div className={cn(
                          "inline-flex items-center text-sm font-medium tabular-nums",
                          deal.probability >= 70 ? "text-emerald-600 dark:text-emerald-400" :
                          deal.probability >= 40 ? "text-amber-600 dark:text-amber-400" :
                          "text-muted-foreground"
                        )}>
                          <InlineTextCell
                            value={String(deal.probability)}
                            inputType="number"
                            placeholder="0"
                            onSave={(v) => inlineUpdateNumber(deal.id, "probability", v, { min: 0, max: 100, allowZero: true })}
                          />
                          <span>%</span>
                        </div>
                      </td>
                      {/* D2 — MEDDPICC letter chips */}
                      <td className="px-4 py-3">
                        <MeddpiccChips meddpicc={deal.meddpicc} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                          (deal._count?.offers ?? 0) > 0
                            ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                            : "bg-muted text-muted-foreground",
                        )}>
                          <FileText className="h-3 w-3" />
                          {(deal._count?.offers ?? 0) > 0
                            ? t("offerCount", { count: deal._count?.offers ?? 0 })
                            : t("offerNone")}
                        </span>
                      </td>
                      {/* Expected close (inline editable date) */}
                      <td className="px-4 py-3 text-muted-foreground text-sm">
                        <InlineDateCell
                          value={deal.expectedClose}
                          status=""
                          onSave={(v) => inlineUpdate(deal.id, { expectedClose: v })}
                        />
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-0.5 justify-end opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditDeal(deal); setFormOpen(true) }}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors"
                            title={t("editDeal")}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(deal.id); setDeleteName(deal.name) }}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors"
                            title={t("deleteDealBtn")}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[#FF4D00]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredDeals.length > 0 && (
            <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-muted/30 text-xs text-muted-foreground">
              {filteredDeals.length}{filteredDeals.length !== deals.length ? ` / ${deals.length}` : ""} {t("totalDeals", { count: filteredDeals.length }).replace(/\d+\s*/, "")}
            </div>
          )}
        </div>
        </>
      ) : (
        /* ── KANBAN VIEW ── */
        <>
          {moveError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
              <span className="flex-1">{moveError}</span>
              <button onClick={() => setMoveError(null)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          )}

          <div data-tour-id="deals-card">
            <KanbanBoard
              stages={STAGES}
              deals={kanbanDeals}
              onDealClick={(deal) => router.push(`/deals/${deal.id}`)}
              onDealMove={handleDealMove}
              onQuickAddTask={async (dealId, title) => {
                await fetch(`/api/v1/deals/${dealId}/next-steps`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                  body: JSON.stringify({ title }),
                })
                fetchDeals()
              }}
            />
          </div>
        </>
      )}

      <DealForm
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditDeal(undefined) }}
        onSaved={() => fetchDeals()}
        orgId={orgId}
        pipelineId={selectedPipelineId}
        initialData={editDeal}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteDeal")}
        itemName={deleteName}
      />

      {/* Bulk-delete confirmation — Roadmap #19 Phase B. itemName uses an
          ICU-plural key so RU agrees ("1 сделка" vs "5 сделок") and EN
          stays grammatical ("1 deal" vs "5 deals"). Architect P1 fix. */}
      <DeleteConfirmDialog
        open={bulkConfirmAction === "delete"}
        onOpenChange={(open) => { if (!open) setBulkConfirmAction(null) }}
        onConfirm={async () => {
          await handleBulkAction("delete")
          setBulkConfirmAction(null)
        }}
        title={t("deleteDeal")}
        itemName={t("bulkDeleteItemName", { count: selectedDealIds.size })}
      />
    </div>
  )
}

// ─── Inline Stage Cell ──────────────────────────────────────────
// Custom click-to-edit cell for the deal stage — preserves the
// dot+colored-text trigger and shows stage options with matching dot
// colors in the popover. Stages come from the active pipeline so the
// shared InlineSelectCell (which uses Tailwind class maps) wouldn't fit
// arbitrary HEX colors from pipeline config.
function InlineStageCell({
  value, stages, getColor, getLabel, onSave,
}: {
  value: string
  stages: { name: string; label: string; color?: string }[]
  getColor: (s: string) => string
  getLabel: (s: string) => string
  onSave: (v: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const pick = async (next: string) => {
    setOpen(false)
    if (next === value) return
    setSaving(true)
    try { await onSave(next) } finally { setSaving(false) }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        title="Click to change stage"
        className="inline-flex items-center gap-1.5 px-1 -mx-1 py-0.5 rounded hover:bg-muted transition"
      >
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: getColor(value) }} />
        <span className="text-sm" style={{ color: getColor(value) }}>{getLabel(value)}</span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1">
          {stages.map(s => (
            <button
              key={s.name}
              type="button"
              onClick={(e) => { e.stopPropagation(); pick(s.name) }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2",
                s.name === value && "bg-muted/60 font-medium",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color || getColor(s.name) }} />
              <span style={{ color: s.color || getColor(s.name) }}>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
