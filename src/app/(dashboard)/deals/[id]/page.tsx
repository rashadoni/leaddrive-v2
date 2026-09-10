"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MotionPage } from "@/components/ui/motion"
import {
  ArrowLeft, Pencil, Trash2, AlertCircle, Tag, X,
  Loader2, Hourglass, Timer, Mail, PhoneOutgoing,
  Layers3,
} from "lucide-react"
import { GradientKpiChip } from "@/components/crm/gradient-kpi-chip"
import { DealCustomerDetails } from "@/components/deals/deal-customer-details"
import { CollapsibleSection } from "@/components/crm/collapsible-section"
import { cn } from "@/lib/utils"
import { DealForm } from "@/components/deal-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { StageProgress } from "@/components/deals/stage-progress"
import { QuickActionBar, type DealContact } from "@/components/deals/quick-action-bar"
import { DealSidebar } from "@/components/deals/deal-sidebar"
import { ActivityTimeline } from "@/components/deals/activity-timeline"
import { DealMeddpicc } from "@/components/deals/deal-meddpicc"
import { AiSuggestions } from "@/components/deals/ai-suggestions"
import { NextBestOffers } from "@/components/deals/next-best-offers"
import { AiFeedbackWidget } from "@/components/adaptive-ai/ai-feedback-widget"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { StageValidationDialog } from "@/components/deals/stage-validation-dialog"
import { StageChecklistDialog } from "@/components/deals/stage-checklist-dialog"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { STAGE_COLORS } from "@/lib/constants"

const FALLBACK_STAGE_STYLES = [
  { key: "LEAD",        color: STAGE_COLORS.LEAD,        bg: "bg-indigo-500" },
  { key: "QUALIFIED",   color: STAGE_COLORS.QUALIFIED,   bg: "bg-blue-500" },
  { key: "PROPOSAL",    color: STAGE_COLORS.PROPOSAL,    bg: "bg-amber-500" },
  { key: "NEGOTIATION", color: STAGE_COLORS.NEGOTIATION, bg: "bg-orange-500" },
  { key: "WON",         color: STAGE_COLORS.WON,         bg: "bg-green-500" },
  { key: "LOST",        color: STAGE_COLORS.LOST,        bg: "bg-red-500" },
]

interface Deal {
  id: string
  name: string
  stage: string
  pipelineId: string | null
  meddpicc?: unknown
  valueAmount: number
  currency: string
  probability: number
  confidenceLevel: number
  assignedTo: string | null
  notes: string | null
  expectedClose: string | null
  stageChangedAt: string | null
  createdAt: string
  updatedAt: string
  lostReason: string | null
  tags: string[]
  contactId: string | null
  customerNeed: string | null
  salesChannel: string | null
  company: { id: string; name: string } | null
  campaign: { id: string; name: string } | null
  contact: { id: string; fullName: string; position: string | null; email: string | null; phone: string | null; avatar: string | null } | null
  teamMembers: Array<{
    id: string; userId: string; role: string
    user: { id: string; name: string | null; email: string; avatar: string | null; role: string | null }
  }>
  contactRoles: Array<{
    id: string; contactId: string; role: string; influence: string; decisionFactor: string; loyalty: string
    isPrimary: boolean; cashbackType: string | null; cashbackValue: number | null
    contact: { id: string; fullName: string; position: string | null; email: string | null; phone: string | null }
  }>
}

// ── Tags Input ──
function TagsInput({ tags, onChange, addTagLabel }: { tags: string[]; onChange: (tags: string[]) => void; addTagLabel: string }) {
  const [input, setInput] = useState("")
  const TAG_COLORS = ["bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400", "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"]

  const addTag = () => {
    const trimmed = input.trim()
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed])
    setInput("")
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag, i) => (
        <span key={tag} className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${TAG_COLORS[i % TAG_COLORS.length]}`}>
          {tag}
          <button onClick={() => onChange(tags.filter(t => t !== tag))} className="hover:opacity-70">
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        className="h-5 w-20 border border-zinc-200 dark:border-zinc-700 rounded-full px-2 text-[11px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
        placeholder={`+ ${addTagLabel}`}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag() } }}
        onBlur={addTag}
      />
    </div>
  )
}

// ── AI Prediction Card ──
function AiPredictionCard({ dealId, orgId }: { dealId: string; orgId?: string }) {
  const t = useTranslations("deals")
  const tc = useTranslations("common")
  const [pred, setPred] = useState<any>(null)
  const [nextActions, setNextActions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPrediction = () => {
    setLoading(true)
    Promise.all([
      fetch(`/api/v1/analytics/deal-prediction?dealId=${dealId}`).then(r => r.json()),
      fetch(`/api/v1/ai/next-actions?limit=3`).then(r => r.json()),
    ])
      .then(([p, a]) => {
        if (p.success) setPred(p.data)
        if (a.success) {
          // Filter actions related to this deal
          const dealActions = a.data.filter((act: any) => act.entityId === dealId)
          setNextActions(dealActions.length > 0 ? dealActions : a.data.slice(0, 2))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // Translate a prediction factor { key, params } to localized string
  const translateFactor = (f: any): string => {
    if (typeof f === "string") return f // legacy string format
    const factorKeys: Record<string, string> = {
      dealNotFound: t("factorDealNotFound"),
      noActivityDays: t("factorNoActivityDays", { days: f.params?.days ?? 0 }),
      dealOpenDays: t("factorDealOpenDays", { days: f.params?.days ?? 0 }),
      fewInteractions: t("factorFewInteractions"),
      overdueCloseDate: t("factorOverdueCloseDate"),
      interactionsCount: t("factorInteractionsCount", { count: f.params?.count ?? 0 }),
      recentActivity: t("factorRecentActivity"),
      highProbabilityStage: t("factorHighProbabilityStage", { probability: f.params?.probability ?? 0 }),
    }
    return factorKeys[f.key] || f.key
  }

  useEffect(() => { fetchPrediction() }, [dealId])

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("aiPredictionLoading")}
        </div>
      </div>
    )
  }

  if (!pred) return null

  const probColor = pred.winProbability >= 70 ? "text-emerald-600" : pred.winProbability >= 40 ? "text-amber-600" : "text-red-600"
  const probBg = pred.winProbability >= 70 ? "bg-emerald-500" : pred.winProbability >= 40 ? "bg-amber-500" : "bg-red-500"

  const translateAction = (key: string, params: Record<string, string | number> = {}) => {
    try { return t(key, params) } catch { return key }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t("aiPrediction")}</span>
        <button
          onClick={fetchPrediction}
          className="text-sm text-primary hover:underline"
        >
          {tc("refresh")}
        </button>
      </div>

      {/* Probability */}
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-14">
          <svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
            <circle
              cx="18" cy="18" r="16" fill="none" strokeWidth="3"
              className={probBg.replace("bg-", "text-")}
              strokeDasharray={`${pred.winProbability} ${100 - pred.winProbability}`}
              strokeLinecap="round"
            />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${probColor}`}>
            {pred.winProbability}%
          </span>
        </div>
        <div>
          <p className="text-base font-semibold">{t("winProbabilityFull")}</p>
          <p className="text-sm text-muted-foreground">
            {t("confidenceLabel", { value: pred.confidence })}
          </p>
        </div>
      </div>

      {/* Risk factors */}
      {pred.riskFactors?.length > 0 && (
        <div>
          <p className="text-sm font-medium text-red-600 mb-1">{t("risksTitle")}</p>
          {pred.riskFactors.map((f: any, i: number) => (
            <p key={i} className="text-sm text-muted-foreground flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" /> {translateFactor(f)}
            </p>
          ))}
        </div>
      )}

      {/* Positive factors */}
      {pred.positiveFactors?.length > 0 && (
        <div>
          <p className="text-sm font-medium text-emerald-600 mb-1">{t("positiveFactorsTitle")}</p>
          {pred.positiveFactors.map((f: any, i: number) => (
            <p key={i} className="text-sm text-muted-foreground flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" /> {translateFactor(f)}
            </p>
          ))}
        </div>
      )}

      {/* Next best actions */}
      {nextActions.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-sm font-medium text-primary mb-2">{t("recommendationsTitle")}</p>
          {nextActions.map((action: any, i: number) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                action.priority === "high" ? "bg-red-500" : action.priority === "medium" ? "bg-amber-500" : "bg-blue-500"
              }`} />
              <div>
                <p className="text-sm font-medium">{action.titleKey ? translateAction(action.titleKey, action.titleParams) : action.title}</p>
                <p className="text-xs text-muted-foreground">{action.reasonKey ? translateAction(action.reasonKey, action.reasonParams) : action.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* A9 Adaptive AI Models — slice-2 feedback widget.
          predictionValue serialized as decimal in [0,1] per
          PREDICTION_VALUE_FORMAT.prediction_deal_win (slice-3 cron
          parses the same format). pred.winProbability is integer
          percent 0-100, so divide by 100. */}
      <div className="border-t pt-3">
        <AiFeedbackWidget
          predictionType="prediction_deal_win"
          predictionTargetId={dealId}
          predictionValue={(pred.winProbability / 100).toFixed(4)}
          orgId={orgId}
        />
      </div>
    </div>
  )
}

// ── Next Steps widget ──
// ── Main page ──
export default function DealDetailPage() {
  const t = useTranslations("deals")
  const tc = useTranslations("common")
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  useAutoTour("dealDetail")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId ? String(session.user.organizationId) : undefined

  const { isVisible, isEditable } = useFieldPermissions("deal")
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)
  const [offersCount, setOffersCount] = useState(0)
  const [invoicesCount, setInvoicesCount] = useState(0)
  const [validationErrors, setValidationErrors] = useState<Array<{ field: string; message: string }>>([])
  const [validationStage, setValidationStage] = useState<string>("")
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [checklistItems, setChecklistItems] = useState<Array<{ field: string; message: string; passed: boolean }>>([])
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [checklistTarget, setChecklistTarget] = useState<string>("")
  const [stageChanging, setStageChanging] = useState(false)
  const [pipelineStages, setPipelineStages] = useState<any[]>([])
  const [pipelineName, setPipelineName] = useState("")
  const [activityCounts, setActivityCounts] = useState<{ emails: number; calls: number }>({ emails: 0, calls: 0 })
  const [rightTab, setRightTab] = useState<"overview" | "feed" | "meddpicc">("overview")

  // Header toolbar anchors: the feed lives inside a tab, so switch first,
  // then scroll on the next frame when the target is laid out.
  /*
   * Ряд якорей под заголовком («Следующие шаги», «Лента», «Оценка») убран.
   * Каждая его кнопка вела туда, куда и так один клик:
   *   — «Лента» использовала ТОТ ЖЕ ключ перевода, что и вкладка «Лента»,
   *     и делала ровно то же самое — переключала на неё;
   *   — «Следующие шаги» указывали на блок, который теперь стоит в открытой
   *     по умолчанию вкладке «Обзор», прямо под данными клиента;
   *   — «Оценка» вела в карточку ИИ-прогноза, которая на широком экране
   *     всегда видна в правой рейке.
   * Третий способ навигации рядом со вкладками и рейками — не удобство, а
   * ещё одна строка, которую надо прочитать, чтобы понять, что читать её
   * было незачем.
   */

  const stageTranslations: Record<string, string> = {
    LEAD: t("stageLead"),
    QUALIFIED: t("stageQualified"),
    PROPOSAL: t("stageProposal"),
    NEGOTIATION: t("stageNegotiation"),
    WON: t("stageWon"),
    LOST: t("stageLost"),
  }
  const stageLabels: Record<string, string> = pipelineStages.length > 0
    ? Object.fromEntries(pipelineStages.map(s => [s.name, stageTranslations[s.name] || s.displayName]))
    : stageTranslations

  const STAGE_STYLES = pipelineStages.length > 0
    ? pipelineStages.map(s => ({ key: s.name, color: s.color, bg: `bg-[${s.color}]` }))
    : FALLBACK_STAGE_STYLES

  const STAGES = STAGE_STYLES.map(s => ({ ...s, label: stageLabels[s.key] || s.key }))
  const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>

  const fetchDeal = async () => {
    try {
      const res = await fetch(`/api/v1/deals/${id}`, { headers })
      const json = await res.json()
      if (json.success) setDeal(json.data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }


  const fetchCounts = async () => {
    try {
      const [offersRes, invoicesRes] = await Promise.all([
        fetch(`/api/v1/deals/${id}/offers`, { headers }),
        fetch(`/api/v1/invoices?dealId=${id}&limit=1`, { headers }),
      ])
      const offersJson = await offersRes.json()
      const invoicesJson = await invoicesRes.json()
      setOffersCount(Array.isArray(offersJson.data) ? offersJson.data.length : offersJson.data?.offers?.length || 0)
      setInvoicesCount(Array.isArray(invoicesJson.data) ? invoicesJson.data.length : invoicesJson.data?.total || 0)
    } catch { /* ok */ }
  }

  // KPI chips: email/call counts from the same activities endpoint the
  // timeline uses (capped at 50 — counts are best-effort, not audited totals).
  const fetchActivityCounts = async () => {
    try {
      const res = await fetch(`/api/v1/activities?relatedType=deal&relatedId=${id}&limit=50`, { headers })
      const json = await res.json()
      const items: Array<{ type?: string }> = json?.data?.activities || (Array.isArray(json?.data) ? json.data : [])
      setActivityCounts({
        emails: items.filter(a => a.type === "email").length,
        calls: items.filter(a => a.type === "call").length,
      })
    } catch { /* chips fall back to 0 */ }
  }

  const fetchPipelineStages = async (pipelineId?: string) => {
    if (!pipelineId) return
    try {
      const res = await fetch(`/api/v1/pipelines/${pipelineId}`, { headers })
      const json = await res.json()
      if (json.success && json.data.stages) {
        setPipelineStages(json.data.stages)
        setPipelineName(json.data.name || "")
      }
    } catch {}
  }

  useEffect(() => { if (session) { fetchDeal(); fetchCounts() } }, [session, id])
  useEffect(() => { if (session) fetchActivityCounts() }, [session, id, timelineKey])
  useEffect(() => { if (deal?.pipelineId) fetchPipelineStages(deal.pipelineId) }, [deal?.pipelineId])

  const saveTags = async (newTags: string[]) => {
    if (!deal) return
    try {
      await fetch(`/api/v1/deals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ tags: newTags }),
      })
      setDeal({ ...deal, tags: newTags })
    } catch (err) { console.error(err) }
  }

  const handleStageClick = async (newStage: string) => {
    if (!deal || deal.stage === newStage) return
    setChecklistTarget(newStage)
    setChecklistLoading(true)
    setChecklistOpen(true)

    // Fetch validation rules for target stage and check them client-side
    try {
      const res = await fetch(`/api/v1/pipeline-stages?target=${newStage}`, { headers })
      const json = await res.json()
      const stages = json.data || []
      const targetStage = stages.find((s: any) => s.name === newStage)

      if (targetStage?.id) {
        const rulesRes = await fetch(`/api/v1/pipeline-stages/${targetStage.id}/rules`, { headers })
        const rulesJson = await rulesRes.json()
        const rules = rulesJson.data || []

        if (rules.length === 0) {
          setChecklistItems([])
        } else {
          const items = rules.map((rule: any) => {
            const fieldValue = (deal as any)[rule.fieldName]
            let passed = false
            switch (rule.ruleType) {
              case "required": passed = !!fieldValue || fieldValue === 0; break
              case "min_value": passed = typeof fieldValue === "number" && rule.ruleValue ? fieldValue >= parseFloat(rule.ruleValue) : false; break
              default: passed = true
            }
            return { field: rule.fieldName, message: rule.errorMessage, passed }
          })
          setChecklistItems(items)
        }
      } else {
        setChecklistItems([])
      }
    } catch { setChecklistItems([]) }
    finally { setChecklistLoading(false) }
  }

  const confirmStageChange = async () => {
    if (!deal || !checklistTarget) return
    setStageChanging(true)
    try {
      const res = await fetch(`/api/v1/deals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ stage: checklistTarget }),
      })
      if (res.ok) {
        setChecklistOpen(false)
        fetchDeal()
      } else if (res.status === 422) {
        const json = await res.json()
        if (json.validationErrors) {
          setChecklistOpen(false)
          setValidationErrors(json.validationErrors)
          setValidationStage(checklistTarget)
        }
      }
    } catch (err) { console.error(err) }
    finally { setStageChanging(false) }
  }

  const handleDelete = async () => {
    const res = await fetch(`/api/v1/deals/${id}`, {
      method: "DELETE", headers,
    })
    if (res.ok) router.push("/deals")
    else throw new Error(tc("errorDeleteFailed"))
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-10 bg-muted rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-96 bg-muted rounded-xl" />
          <div className="col-span-2 h-96 bg-muted rounded-xl" />
        </div>
      </div>
    )
  }

  if (!deal) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">{t("dealNotFound")}</h2>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/deals")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("backToDeals")}
        </Button>
      </div>
    )
  }

  const stageInfo = STAGES.find(s => s.key === deal.stage)

  return (
    <MotionPage className="space-y-6 pb-12">
      {/* ── Header (Creatio-style record header: name / company, contact) ── */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/deals")} className="h-8 w-8 mt-0.5">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2 min-w-0">
              <span className="truncate">{deal.name}</span>
              {(deal.company || deal.contact) && (
                <span className="font-semibold text-muted-foreground truncate hidden md:inline max-w-[40%] shrink-0">
                  {" / "}
                  {[deal.company?.name, deal.contact?.fullName].filter(Boolean).join(", ")}
                </span>
              )}
              <TourReplayButton tourId="dealDetail" /><HelpButton slug="deal-detail" variant="label" className="shrink-0" />
            </h1>
            <Badge className="text-white text-[11px]" style={{ backgroundColor: stageInfo?.color }}>
              {stageInfo?.label ?? deal.stage}
            </Badge>
            {pipelineName && (
              <Badge variant="outline" className="gap-1 text-[11px]" title={t("pipelineCategory")}>
                <Layers3 className="h-3 w-3" />
                {pipelineName}
              </Badge>
            )}
          </div>
          {/* Tags */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Tag className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <TagsInput tags={deal.tags || []} onChange={saveTags} addTagLabel={t("addTag")} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> {t("editDeal")}
          </Button>
          <Button
            variant="outline" size="sm"
            className="text-red-500 hover:text-red-600 hover:border-red-300"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Stage Progress Bar (chevrons) ── */}
      <div data-tour-id="deal-stage-progress">
      <StageProgress
        stages={STAGES}
        currentStage={deal.stage}
        onStageClick={handleStageClick}
      />
      </div>

      {/* ── LAYOUT: left rail + content; AI rail becomes a 3rd column on xl (Creatio) ── */}
      <div className={cn(
        "grid grid-cols-1 gap-4 items-start",
        "[grid-template-areas:'main'_'left'_'ai']",
        "lg:grid-cols-[320px_minmax(0,1fr)] lg:[grid-template-areas:'left_main'_'ai_main']",
        "xl:grid-cols-[300px_minmax(0,1fr)_340px] xl:[grid-template-areas:'left_main_ai']",
      )}>
        {/* LEFT: Data sidebar */}
        <div className="space-y-4 [grid-area:left] min-w-0">
          <div data-tour-id="deal-sidebar" className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
            <DealSidebar
              deal={deal}
              orgId={orgId}
              offersCount={offersCount}
              invoicesCount={invoicesCount}
              onEdit={() => setEditOpen(true)}
              fetchDeal={fetchDeal}
            />
          </div>

          {/* Next Best Offers — right after record info, as in the Creatio reference */}
          <NextBestOffers dealId={id} orgId={orgId} />
        </div>

        {/* AI RAIL — 3rd column on xl, below the left rail otherwise */}
        <div className="space-y-4 [grid-area:ai] min-w-0">
          <AdvisorRecordWidget entityType="deal" entityId={id} orgId={orgId} />

          {/* AI Prediction */}
          <div data-tour-id="deal-ai-prediction">
            <AiPredictionCard dealId={id} orgId={orgId} />
          </div>

          {/* AI Suggestions (Copilot) */}
          <div data-tour-id="deal-ai-suggestions">
            <AiSuggestions dealId={id} />
          </div>
        </div>

        {/* MAIN: tabs (Обзор | Лента), Creatio-style */}
        <div className="space-y-4 [grid-area:main] min-w-0">
          <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
            {([
              { id: "overview" as const, label: t("tabOverview") },
              { id: "feed" as const, label: t("toolbarFeed") },
              { id: "meddpicc" as const, label: "MEDDPICC" },
            ]).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRightTab(tab.id)}
                className={cn(
                  "px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors",
                  rightTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab: Overview — both tabs stay mounted (tours + timeline state) */}
          <div className={rightTab === "overview" ? "space-y-4" : "hidden"}>
          {/* Deal details — Creatio-style collapsible with gradient KPI chips */}
          <CollapsibleSection title={t("dealDetailsSection")} tourId="deal-kpi-chips">
            {(() => {
              const dayMs = 86_400_000
              const daysInFunnel = Math.max(0, Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / dayMs))
              const daysAtStage = Math.max(0, Math.floor((Date.now() - new Date(deal.stageChangedAt ?? deal.createdAt).getTime()) / dayMs))
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <GradientKpiChip variant="green"   label={t("kpiDaysInFunnel")}  value={daysInFunnel} icon={<Hourglass />} />
                  <GradientKpiChip variant="teal"    label={t("kpiDaysAtStage")}   value={daysAtStage}  icon={<Timer />} />
                  <GradientKpiChip variant="magenta" label={t("kpiEmailsSent")}    value={activityCounts.emails} icon={<Mail />} />
                  <GradientKpiChip variant="indigo"  label={t("kpiOutgoingCalls")} value={activityCounts.calls}  icon={<PhoneOutgoing />} />
                </div>
              )
            })()}
          </CollapsibleSection>

          {/* Customer details — collapsible, inside the content column as in Creatio */}
          {(deal.contact || deal.company) && (
            <CollapsibleSection title={t("customerDetails")}>
              <DealCustomerDetails contact={deal.contact} company={deal.company} orgId={orgId} bare />
            </CollapsibleSection>
          )}

          </div>

          {/* Tab: Feed */}
          <div className={rightTab === "feed" ? "space-y-4" : "hidden"}>
          {/* Quick Action Bar — always visible at top */}
          <div data-tour-id="deal-quick-actions">
          <QuickActionBar
            dealId={id}
            orgId={orgId}
            contacts={(() => {
              const map = new Map<string, DealContact>()
              // Add contact roles
              deal.contactRoles?.forEach(cr => {
                if (cr.contact) map.set(cr.contactId, { id: cr.contactId, fullName: cr.contact.fullName, email: cr.contact.email, isPrimary: cr.isPrimary })
              })
              // Add primary contact if not already in roles
              if (deal.contact && !map.has(deal.contact.id)) {
                map.set(deal.contact.id, { id: deal.contact.id, fullName: deal.contact.fullName, email: deal.contact.email, isPrimary: true })
              }
              return Array.from(map.values())
            })()}
            onActivityAdded={() => setTimelineKey(k => k + 1)}
            labels={{
              email: tc("sendEmailAction"),
              send: tc("send"),
            }}
          />
          </div>

          {/* Unified Timeline */}
          <div data-tour-id="deal-timeline" className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <ActivityTimeline key={timelineKey} dealId={id} orgId={orgId} />
          </div>
          </div>

          {/* Tab: MEDDPICC (D1) — mounted lazily on first open */}
          {rightTab === "meddpicc" && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <DealMeddpicc dealId={id} orgId={orgId} initial={deal.meddpicc} onSaved={fetchDeal} />
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <DealForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchDeal}
        initialData={{
          id: deal.id,
          name: deal.name,
          pipelineId: deal.pipelineId,
          companyId: deal.company?.id,
          stage: deal.stage,
          valueAmount: deal.valueAmount,
          currency: deal.currency,
          probability: deal.probability,
          expectedClose: deal.expectedClose,
          notes: deal.notes,
        }}
        orgId={orgId}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteDeal")}
        itemName={deal.name}
      />
      <StageChecklistDialog
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        onConfirm={confirmStageChange}
        confirming={stageChanging}
        targetStageLabel={stageLabels[checklistTarget] || checklistTarget}
        targetStageColor={STAGES.find(s => s.key === checklistTarget)?.color || "#6366f1"}
        items={checklistItems}
        loading={checklistLoading}
      />
      <StageValidationDialog
        open={validationErrors.length > 0}
        onClose={() => setValidationErrors([])}
        errors={validationErrors}
        targetStage={validationStage}
        stageLabel={stageLabels[validationStage] || validationStage}
        stageColor={STAGES.find(s => s.key === validationStage)?.color || "#6366f1"}
      />
    </MotionPage>
  )
}
