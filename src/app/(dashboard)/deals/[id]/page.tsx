"use client"

/**
 * The deal page (owner, 2026-11-21: «раздел сделки перегружен, его раздели
 * так, чтоб при желании детали раскрывались… но и чтоб не теряло свою
 * значимость»; the clickable prototype was approved with «Давай»).
 *
 * One column, read top to bottom: what the deal is and where it stands
 * (header, stages), its four numbers, what to do about it now, and the
 * details — four sections that stay closed until asked for. One fact lives in
 * one place: the tiles carry numbers, «What to do now» carries what is wrong,
 * the sections say what is inside. Da Vinci is a panel on the right, opened by
 * its button, not a third column.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MotionPage } from "@/components/ui/motion"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  ArrowLeft, Pencil, Trash2, AlertCircle, Tag, X, Loader2, Layers3, Banknote, Wallet, UserRound, CalendarClock,
  Building2, Megaphone, Phone, Plus, Sparkles, Package, History, Check, Contact,
} from "lucide-react"
import { DealCustomerDetails } from "@/components/deals/deal-customer-details"
import { DealForm } from "@/components/deal-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { QuickActionBar, type DealContact } from "@/components/deals/quick-action-bar"
import { ActivityTimeline } from "@/components/deals/activity-timeline"
import { DealContracts } from "@/components/deals/deal-contracts"
import { DealMeddpicc } from "@/components/deals/deal-meddpicc"
import { AiSuggestions } from "@/components/deals/ai-suggestions"
import { NextBestOffers } from "@/components/deals/next-best-offers"
import { AiFeedbackWidget } from "@/components/adaptive-ai/ai-feedback-widget"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { Hint } from "@/components/hint"
import { DealLineItems } from "@/components/deals/deal-line-items"
import { DealProcurementTab } from "@/components/deals/deal-procurement-tab"
import { DealFiles } from "@/components/deals/deal-files"
import { DealChangeApprovals } from "@/components/deals/deal-change-approvals"
import { OffersTab } from "@/components/deals/offers-tab"
import { InvoicesTab } from "@/components/deals/invoices-tab"
import { DealCompetitorsSection, DealContactRolesSection, DealTeamSection, type DealCompetitor } from "@/components/deals/deal-people"
import { DealStageTrack, type TrackStage } from "@/components/deals/overview/deal-stage-track"
import { DealKpiTile, TileAction, TileBar } from "@/components/deals/overview/deal-kpi-tile"
import { DealNextSteps, dayMonth, money, type PlannedTask } from "@/components/deals/overview/deal-next-steps"
import { DealSections, type DealSection } from "@/components/deals/overview/deal-sections"
import { DealStageHistory } from "@/components/deals/overview/deal-stage-history"
import { DealFacts } from "@/components/deals/overview/deal-facts"
import { LostReasonForm, ReachPanel, StageGuardNotice, type ReachContact } from "@/components/deals/overview/deal-inline-panels"
import { checkPermission, type Role } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"
import { STAGE_COLORS } from "@/lib/constants"
import { formatDate } from "@/lib/format-date"
import {
  billedInvoices, buildNextSteps, daysUntil, nextStage, paymentSummary, splitStages, stageKind, unmetRules,
  type InvoiceLike, type StageRule,
} from "@/lib/deals/deal-overview"
import { VOICE_RECORD_CHANGED_EVENT, type VoiceRecordChangedDetail } from "@/lib/ai/voice/voice-confirmation"

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
  /** The owner's name, when the API could resolve `assignedTo` to a person of the organization. */
  assignedToName?: string | null
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
        className="h-5 w-20 border border-input rounded-full px-2 text-[11px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
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
      <div className="rounded-xl border border-border bg-card p-4">
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
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
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

// ── Main page ──
interface PipelineStageRow { id?: string; name: string; displayName: string; color: string; isWon?: boolean | null; isLost?: boolean | null }

type InlinePanel =
  | { kind: "guard"; stage: string; messages: string[] }
  | { kind: "lost"; stage: string }
  | { kind: "won"; stage: string }
  | { kind: "reach" }

export default function DealDetailPage() {
  const t = useTranslations("deals")
  const td = useTranslations("dealPage")
  const tcw = useTranslations("contractWizard")
  const tl = useTranslations("dealLines")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  useAutoTour("dealDetail")
  const { data: session } = useSession()
  const tp = useTranslations("procurement.dealTab")
  const tf = useTranslations("dealFiles")
  const ta = useTranslations("dealApprovals")
  // The «Purchasing» part exists only for a tenant with the procurement module
  // and a person who may read purchase requests — the gates of its API.
  const sessionUser = session?.user as { id?: string; role?: string; plan?: string; addons?: string[]; modules?: Record<string, boolean> } | undefined
  const role = sessionUser?.role as Role | undefined
  const may = (scope: Parameters<typeof checkPermission>[1], action: Parameters<typeof checkPermission>[2]) => Boolean(role && checkPermission(role, scope, action))
  const showProcurement = Boolean(
    role
    && checkPermission(role, "purchase-requests", "read")
    && hasModule({ plan: sessionUser?.plan || "", addons: sessionUser?.addons, modules: sessionUser?.modules }, "procurement"),
  )
  const canWrite = may("deals", "write")
  const canSeeInvoices = may("invoices", "read")
  const orgId = session?.user?.organizationId ? String(session.user.organizationId) : undefined

  const { isVisible } = useFieldPermissions("deal")
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  // Product lines: a remount key for «Next best offers» adding one, and
  // whether there are any (the edit form then locks amount and currency).
  const [linesKey, setLinesKey] = useState(0)
  const [lineCount, setLineCount] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)
  const [moneyKey, setMoneyKey] = useState(0)
  const [offersCount, setOffersCount] = useState(0)
  const [invoices, setInvoices] = useState<InvoiceLike[]>([])
  const [tasks, setTasks] = useState<PlannedTask[]>([])
  const [completedTasks, setCompletedTasks] = useState(0)
  const [competitors, setCompetitors] = useState<DealCompetitor[]>([])
  const [nextRules, setNextRules] = useState<StageRule[]>([])
  const [stageBusy, setStageBusy] = useState(false)
  const [stageError, setStageError] = useState("")
  const [pipelineStages, setPipelineStages] = useState<PipelineStageRow[]>([])
  const [pipelineName, setPipelineName] = useState("")
  // What is open on the page: one section, the chosen part of each, one form
  // of «What to do now», one panel under the stages, and Da Vinci.
  const [section, setSection] = useState<string | null>(null)
  const [part, setPart] = useState<Record<string, string>>({})
  const [form, setForm] = useState<string | null>(null)
  const [inline, setInline] = useState<InlinePanel | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const todoRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<HTMLDivElement>(null)
  const inlineRef = useRef<HTMLDivElement>(null)
  const now = useMemo(() => new Date(), [])

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
  // The stages as the track reads them: what a stage MEANS comes from the
  // pipeline's flags; without a pipeline the standard names are all there is.
  const trackStages: TrackStage[] = pipelineStages.length > 0
    ? pipelineStages.map(s => ({ name: s.name, label: stageLabels[s.name] || s.name, isWon: s.isWon, isLost: s.isLost }))
    : FALLBACK_STAGE_STYLES.map(s => ({ name: s.key, label: stageLabels[s.key] || s.key }))
  const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>

  const fetchDeal = async () => {
    try {
      const res = await fetch(`/api/v1/deals/${id}`, { headers })
      const json = await res.json()
      if (json.success) setDeal(json.data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // Everything «What to do now» and the tiles are counted from, besides the deal itself.
  const fetchWork = async () => {
    const read = async (url: string) => {
      try { const res = await fetch(url, { headers }); return res.ok ? await res.json() : null } catch { return null }
    }
    const [offersJson, invoicesJson, tasksJson, doneJson, rivalsJson] = await Promise.all([
      read(`/api/v1/deals/${id}/offers`),
      canSeeInvoices ? read(`/api/v1/invoices?dealId=${id}&limit=100`) : null,
      read(`/api/v1/tasks?relatedType=deal&relatedId=${id}&open=1&sort=due&limit=20`),
      read(`/api/v1/tasks?relatedType=deal&relatedId=${id}&status=completed&limit=1`),
      read(`/api/v1/deals/${id}/competitors`),
    ])
    setOffersCount(Array.isArray(offersJson?.data) ? offersJson.data.length : offersJson?.data?.offers?.length || 0)
    setInvoices(invoicesJson?.data?.invoices || [])
    setTasks(tasksJson?.data?.tasks || [])
    setCompletedTasks(doneJson?.data?.total || 0)
    setCompetitors(Array.isArray(rivalsJson?.data) ? rivalsJson.data : [])
  }
  const refresh = () => { void fetchDeal(); void fetchWork(); setMoneyKey(k => k + 1) }

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

  /** The rules of a stage: what the server will check when the deal is moved onto it. */
  const fetchRules = async (stageName: string): Promise<StageRule[]> => {
    try {
      let stageId: string | undefined = pipelineStages.find(s => s.name === stageName)?.id
      if (!stageId) {
        const json = await (await fetch(`/api/v1/pipeline-stages?target=${stageName}`, { headers })).json()
        stageId = ((json.data || []) as PipelineStageRow[]).find(s => s.name === stageName)?.id
      }
      if (!stageId) return []
      const json = await (await fetch(`/api/v1/pipeline-stages/${stageId}/rules`, { headers })).json()
      return ((json.data || []) as Array<StageRule & { isActive?: boolean }>).filter(rule => rule.isActive !== false)
    } catch { return [] }
  }

  useEffect(() => { if (session) { fetchDeal(); fetchWork() } }, [session?.user?.id, session?.user?.organizationId, id])
  // A voice edit to THIS deal was just saved: show the new values, so the
  // user can see on the card whether everything is right.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<VoiceRecordChangedDetail>).detail
      if (detail?.entityType === "deal" && detail.entityId === id) void fetchDeal()
    }
    window.addEventListener(VOICE_RECORD_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(VOICE_RECORD_CHANGED_EVENT, onChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])
  useEffect(() => { if (deal?.pipelineId) fetchPipelineStages(deal.pipelineId) }, [deal?.pipelineId])

  const stageNames = trackStages.map(s => s.name).join("|")
  const following = deal ? nextStage(trackStages, deal.stage) : null
  // What the next stage asks for, read whenever the deal stands somewhere new.
  useEffect(() => {
    let alive = true
    if (!following) { setNextRules([]); return }
    void fetchRules(following.name).then(rules => { if (alive) setNextRules(rules) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following?.name, stageNames, orgId])

  const reveal = (ref: { current: HTMLElement | null }) => {
    requestAnimationFrame(() => ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }))
  }
  const openSection = (next: string, nextPart?: string) => {
    setSection(next)
    if (nextPart) setPart(all => ({ ...all, [next]: nextPart }))
    reveal(sectionsRef)
  }
  const openForm = (next: string | null) => {
    setForm(next)
    if (next) { setInline(null); reveal(todoRef) }
  }
  const openInline = (next: InlinePanel | null) => {
    setStageError("")
    setInline(next)
    if (next) reveal(inlineRef)
  }

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

  /**
   * Moves the deal. The server is the authority on a stage's rules: a refusal
   * comes back as the list of what is not met, and is shown in place.
   */
  const moveStage = async (target: string, extra: Record<string, unknown> = {}, undoable = true) => {
    if (!deal) return
    const previous = deal.stage
    setStageBusy(true)
    setStageError("")
    try {
      const res = await fetch(`/api/v1/deals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ stage: target, ...extra }),
      })
      if (res.ok) {
        setInline(null)
        refresh()
        const label = stageLabels[target] || target
        // A plain step between open stages can be taken back; winning and losing
        // set off what the organization hung on them, so they are asked first instead.
        const plain = undoable && stageKind(trackStages.find(s => s.name === target)) === "open" && stageKind(trackStages.find(s => s.name === previous)) === "open"
        toast.success(td("stageMoved", { stage: label }), plain ? { action: { label: td("undo"), onClick: () => void moveStage(previous, {}, false) } } : undefined)
      } else if (res.status === 422) {
        const json = await res.json().catch(() => ({}))
        const messages: string[] = (json.validationErrors || []).map((e: { message: string }) => e.message)
        openInline({ kind: "guard", stage: stageLabels[target] || target, messages })
      } else {
        setStageError(td("actionFailed"))
        toast.error(td("actionFailed"))
      }
    } catch {
      setStageError(td("actionFailed"))
      toast.error(td("actionFailed"))
    } finally { setStageBusy(false) }
  }

  const pickStage = async (stage: TrackStage) => {
    if (!deal || deal.stage === stage.name || !canWrite) return
    const kind = stageKind(stage)
    if (kind === "lost") { openInline({ kind: "lost", stage: stage.name }); return }
    setStageBusy(true)
    const rules = await fetchRules(stage.name)
    setStageBusy(false)
    const unmet = unmetRules(deal as unknown as Record<string, unknown>, rules, completedTasks)
    if (unmet.length > 0) { openInline({ kind: "guard", stage: stage.label, messages: unmet.map(rule => rule.errorMessage) }); return }
    if (kind === "won") { openInline({ kind: "won", stage: stage.name }); return }
    await moveStage(stage.name)
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
      <div className="mx-auto max-w-[1280px] space-y-4 animate-pulse">
        <div className="h-9 w-72 rounded bg-muted" />
        <div className="h-11 rounded-xl bg-muted" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl bg-muted" />)}
        </div>
        <div className="h-56 rounded-xl bg-muted" />
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
  const kind = stageKind(trackStages.find(s => s.name === deal.stage), deal.stage)
  const summary = paymentSummary(invoices, now)
  const steps = buildNextSteps({
    deal: deal as unknown as Record<string, unknown> & { assignedTo?: string | null; contactId?: string | null },
    kind, invoices, nextStageRules: nextRules, completedTasks, now,
  })
  const firstDebt = billedInvoices(invoices).find(invoice => invoice.balanceDue > 0)
  const nextTask = tasks.find(task => task.dueDate) ?? tasks[0]
  const lastOpenStage = [...splitStages(trackStages).track].reverse().find(s => stageKind(s) === "open")

  // Whom the deal can be reached through: its contact first, then the contacts given a role.
  const reachContacts: ReachContact[] = (() => {
    const map = new Map<string, ReachContact>()
    if (deal.contact) map.set(deal.contact.id, { id: deal.contact.id, fullName: deal.contact.fullName, position: deal.contact.position, phone: deal.contact.phone, email: deal.contact.email })
    deal.contactRoles?.forEach(cr => {
      if (cr.contact && !map.has(cr.contactId)) map.set(cr.contactId, { id: cr.contactId, fullName: cr.contact.fullName, position: cr.contact.position, phone: cr.contact.phone, email: cr.contact.email })
    })
    return Array.from(map.values())
  })()

  const payment = summary.byCurrency.length === 1 ? summary.byCurrency[0] : null
  const dueLabel = (iso: string) => {
    const days = daysUntil(iso, now)
    return days === 0 ? td("today") : days === 1 ? td("tomorrow") : dayMonth(iso, locale, now)
  }

  const sections: DealSection[] = [
    {
      id: "client",
      label: td("secClient"),
      icon: <Building2 />,
      summary: td("secClientSummary", { contact: deal.contact?.fullName || td("noContactShort"), team: deal.teamMembers?.length || 0 }),
      hint: td("secClientHint"),
      parts: [
        { id: "company", label: td("partCompany"), render: () => (
          <div className="space-y-4">
            {(deal.contact || deal.company) && <DealCustomerDetails contact={deal.contact} company={deal.company} orgId={orgId} bare />}
            <DealFacts
              empty={td("notSet")}
              facts={[
                { label: t("company"), value: deal.company?.name },
                { label: td("contact"), value: deal.contact?.fullName },
                { label: t("assignedTo"), value: deal.assignedToName ?? deal.assignedTo },
                { label: t("campaign"), value: deal.campaign?.name },
                { label: tc("created"), value: formatDate(deal.createdAt, locale) },
                { label: t("salesChannel"), value: deal.salesChannel },
              ].filter(fact => fact.label !== t("salesChannel") || isVisible("salesChannel"))}
              footer={canWrite && !deal.contact ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openForm("contact:set")}><Plus className="h-4 w-4" />{td("addContact")}</Button> : undefined}
            />
          </div>
        ) },
        { id: "team", label: td("partTeam"), count: (deal.teamMembers?.length || 0) + (deal.contactRoles?.length || 0), render: () => (
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("team")}</h3>
              <DealTeamSection dealId={id} orgId={orgId} members={deal.teamMembers || []} canWrite={canWrite} emptyHint={td("teamEmpty")} onChanged={fetchDeal} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t("contactRoles")}</h3>
              <DealContactRolesSection dealId={id} orgId={orgId} companyId={deal.company?.id} roles={deal.contactRoles || []} canWrite={canWrite} emptyHint={td("rolesEmpty")} onChanged={fetchDeal} />
            </div>
          </div>
        ) },
        { id: "rivals", label: t("competitors"), count: competitors.length, render: () => (
          <DealCompetitorsSection dealId={id} orgId={orgId} competitors={competitors} canWrite={canWrite} emptyHint={td("rivalsEmpty")} onChanged={() => void fetchWork()} />
        ) },
      ],
    },
    {
      id: "sale",
      label: td("secSale"),
      icon: <Package />,
      summary: td("secSaleSummary", { items: lineCount, offers: offersCount }),
      hint: td("secSaleHint"),
      parts: [
        // Product lines — the deal's amount is their sum (src/lib/deals/line-items.ts).
        // Kept mounted: the page reads how many there are from it.
        { id: "items", label: tl("title"), count: lineCount, keepMounted: true, render: () => (
          <DealLineItems key={linesKey} dealId={id} orgId={orgId} onSaved={fetchDeal} onCountChange={setLineCount} />
        ) },
        { id: "offers", label: t("offers"), count: offersCount, render: () => (
          <OffersTab dealId={id} orgId={orgId} companyId={deal.company?.id} contactId={deal.contactId} contactEmail={deal.contact?.email} currency={deal.currency} valueAmount={deal.valueAmount} />
        ) },
        ...(may("contracts", "read") ? [{ id: "contracts", label: tcw("dealPart"), render: () => (
          <DealContracts dealId={id} canCreate={may("contracts", "write")} />
        ) }] : []),
        { id: "terms", label: td("partTerms"), render: () => (
          <DealFacts
            empty={td("notSet")}
            facts={[
              ...(isVisible("probability") ? [{ label: t("winProbability"), value: `${deal.probability}%` }] : []),
              { label: t("confidenceLevel"), value: `${deal.confidenceLevel ?? 50}%` },
              ...(isVisible("expectedClose") ? [{ label: t("expectedClose"), value: deal.expectedClose ? formatDate(deal.expectedClose, locale) : null }] : []),
              ...(isVisible("customerNeed") ? [{ label: t("customerNeed"), value: deal.customerNeed }] : []),
              ...(deal.lostReason ? [{ label: tc("lostReason"), value: deal.lostReason, wide: true }] : []),
              ...(isVisible("notes") ? [{ label: t("notes"), value: deal.notes, wide: true }] : []),
            ]}
            footer={canWrite ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />{t("editDeal")}</Button> : undefined}
          />
        ) },
        { id: "meddpicc", label: "MEDDPICC", render: () => (
          <DealMeddpicc dealId={id} orgId={orgId} initial={deal.meddpicc} onSaved={fetchDeal} />
        ) },
      ],
    },
    {
      id: "money",
      label: showProcurement ? td("secMoneyBuying") : td("secMoney"),
      icon: <Wallet />,
      summary: showProcurement ? td("secMoneyBuyingSummary", { invoices: summary.count }) : td("secMoneySummary", { invoices: summary.count }),
      hint: td("secMoneyHint"),
      parts: [
        ...(canSeeInvoices && orgId ? [{ id: "invoices", label: tc("invoicesTitle"), count: summary.count, render: () => <InvoicesTab key={moneyKey} dealId={id} orgId={orgId} /> }] : []),
        // Purchasing (docs/sales-procurement/README.md) — only with the module, mounted on open.
        ...(showProcurement ? [{ id: "procurement", label: tp("tab"), render: () => <DealProcurementTab dealId={id} dealName={deal.name} /> }] : []),
        // Customer approvals — the journal of agreed changes (task 5.2).
        { id: "approvals", label: ta("tab"), render: () => <DealChangeApprovals dealId={id} canWrite={canWrite} /> },
      ],
    },
    {
      id: "history",
      label: td("secHistory"),
      icon: <History />,
      summary: td("secHistorySummary"),
      hint: td("secHistoryHint"),
      parts: [
        { id: "feed" as const, label: t("toolbarFeed") },
        { id: "stages" as const, label: td("partStages") },
        { id: "files" as const, label: tf("tab") },
      ].map(tab => ({
        ...tab,
        render: () => tab.id === "feed" ? (
          <div className="space-y-4">
            {/* The composer sends a letter to a contact; the timeline under it logs a note, a call, a meeting. */}
            <QuickActionBar
              dealId={id}
              orgId={orgId}
              contacts={(() => {
                const map = new Map<string, DealContact>()
                deal.contactRoles?.forEach(cr => {
                  if (cr.contact) map.set(cr.contactId, { id: cr.contactId, fullName: cr.contact.fullName, email: cr.contact.email, isPrimary: cr.isPrimary })
                })
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
            <div data-tour-id="deal-timeline">
              <ActivityTimeline key={timelineKey} dealId={id} orgId={orgId} />
            </div>
          </div>
        ) : tab.id === "stages" ? (
          <DealStageHistory dealId={id} orgId={orgId} createdAt={deal.createdAt} currentStage={deal.stage} stageLabels={stageLabels} />
        ) : (
          // Layout, PDF, photo of the customer order (docs/sales-procurement/README.md, task 4.1).
          <DealFiles dealId={id} canWrite={canWrite} />
        ),
      })),
    },
  ]

  return (
    <MotionPage className="mx-auto max-w-[1280px] space-y-4 pb-12">
      {/* ── Header: what the deal is, and what can be done with it ── */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <Hint text={t("backToDeals")}>
          <Button variant="outline" size="icon" onClick={() => router.push("/deals")} className="h-9 w-9 shrink-0" aria-label={t("backToDeals")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Hint>
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-bold tracking-tight">{deal.name}</h1>
            <Badge data-crm-color-role="status" className="text-white text-[11px]" style={{ backgroundColor: stageInfo?.color }}>
              {stageInfo?.label ?? deal.stage}
            </Badge>
            {pipelineName && (
              <Hint text={t("pipelineCategory")}>
                <Badge variant="outline" className="gap-1 text-[11px]" tabIndex={0}>
                  <Layers3 className="h-3 w-3" />
                  {pipelineName}
                </Badge>
              </Hint>
            )}
            <TourReplayButton tourId="dealDetail" /><HelpButton slug="deal-detail" variant="label" className="shrink-0" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            {deal.company && <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{deal.company.name}</span>}
            {deal.contact && <span className="inline-flex items-center gap-1.5"><Contact className="h-3.5 w-3.5" />{deal.contact.fullName}</span>}
            {deal.campaign && <span className="hidden items-center gap-1.5 sm:inline-flex"><Megaphone className="h-3.5 w-3.5" />{deal.campaign.name}</span>}
            <span className="inline-flex items-center gap-1.5">
              <Tag className="h-3 w-3 shrink-0" />
              <TagsInput tags={deal.tags || []} onChange={saveTags} addTagLabel={t("addTag")} />
            </span>
          </div>
        </div>
        <div data-tour-id="deal-quick-actions" className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <Hint text={td("reachHint")}>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 max-sm:flex-1" onClick={() => openInline(inline?.kind === "reach" ? null : { kind: "reach" })}>
              <Phone className="h-4 w-4" /> {td("reach")}
            </Button>
          </Hint>
          <Hint text={td("addRecordHint")}>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label={td("addRecord")} onClick={() => openSection("history", "feed")}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{td("addRecord")}</span>
            </Button>
          </Hint>
          <Hint text={td("aiHint")}>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label="Da Vinci" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4 text-[hsl(var(--ai-from))]" /> <span className="hidden sm:inline">Da Vinci</span>
            </Button>
          </Hint>
          {canWrite && (
            <Hint text={td("editHint")}>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="h-9 gap-1.5" aria-label={t("editDeal")}>
                <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">{t("editDeal")}</span>
              </Button>
            </Hint>
          )}
          {may("deals", "delete") && (
            <Hint text={t("deleteDeal")}>
              <Button
                variant="outline" size="icon"
                className="h-9 w-9 text-red-600 hover:border-red-300 hover:text-red-700"
                aria-label={t("deleteDeal")}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Hint>
          )}
        </div>
      </div>

      {/* ── Stages: one thin track, «lost» apart ── */}
      <div data-tour-id="deal-stage-progress">
        <DealStageTrack
          stages={trackStages}
          current={deal.stage}
          busy={stageBusy || !canWrite}
          ariaLabel={td("stagesLabel")}
          hint={(stage, isCurrent) => isCurrent ? td("stageHintCurrent") : stageKind(stage) === "lost" ? td("stageHintLost") : td("stageHintMove", { stage: stage.label })}
          onPick={stage => void pickStage(stage)}
        />
      </div>

      {/* ── In place of a modal: why not yet, why lost, how to reach the customer ── */}
      <div ref={inlineRef} className={inline ? "scroll-mt-4" : "hidden"}>
        {inline?.kind === "guard" && <StageGuardNotice stage={inline.stage} messages={inline.messages} onClose={() => openInline(null)} />}
        {inline?.kind === "lost" && (
          <LostReasonForm
            competitors={competitors.map(c => c.name)}
            busy={stageBusy}
            error={stageError}
            onSubmit={reason => void moveStage(inline.stage, { lostReason: reason })}
            onCancel={() => openInline(null)}
          />
        )}
        {inline?.kind === "won" && (
          <div data-testid="deal-won-confirm" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] sm:px-[18px]">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"><Check className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1 basis-[240px]">
              <p className="text-sm font-semibold">{td("wonAsk", { stage: stageLabels[inline.stage] || inline.stage })}</p>
              <p className="text-[13px] text-muted-foreground">{td("wonAskHint")}</p>
            </div>
            <Button size="sm" className="h-9" disabled={stageBusy} onClick={() => void moveStage(inline.stage)}>{stageBusy && <Loader2 className="h-4 w-4 animate-spin" />}{td("wonConfirm")}</Button>
            <Button size="sm" variant="ghost" className="h-9" disabled={stageBusy} onClick={() => openInline(null)}>{tc("cancel")}</Button>
          </div>
        )}
        {inline?.kind === "reach" && (
          <ReachPanel
            dealId={id}
            companyId={deal.company?.id}
            contacts={reachContacts}
            debt={firstDebt ? { number: firstDebt.invoiceNumber, amount: money(firstDebt.balanceDue, firstDebt.currency) } : null}
            canWrite={canWrite}
            onAddContact={() => openForm("contact:set")}
            onWriteEmail={() => { openInline(null); openSection("history", "feed") }}
            onClose={() => openInline(null)}
          />
        )}
      </div>

      {/* ── Four numbers; each leads to where it is worked on ── */}
      <div data-tour-id="deal-kpi-chips" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <DealKpiTile
          testId="deal-tile-amount"
          label={td("tileAmount")}
          icon={<Banknote />}
          value={isVisible("valueAmount") ? money(deal.valueAmount, deal.currency) : "—"}
          sub={isVisible("probability") ? td("tileAmountSub", { probability: deal.probability }) : td("tileAmountLines", { count: lineCount })}
          hint={td("tileAmountHint")}
          onClick={() => openSection("sale", "items")}
        />
        <DealKpiTile
          testId="deal-tile-payment"
          label={td("tilePayment")}
          icon={<Wallet />}
          muted={!canSeeInvoices || summary.count === 0}
          value={!canSeeInvoices ? "—" : summary.count === 0 ? td("noInvoices") : payment ? td("paidOf", { paid: payment.paid.toLocaleString("en-US", { maximumFractionDigits: 2 }), total: money(payment.total, payment.currency) }) : td("invoicesCount", { count: summary.count })}
          extra={payment ? <TileBar percent={payment.total > 0 ? (payment.paid / payment.total) * 100 : 0} /> : undefined}
          sub={!canSeeInvoices ? td("tileNoAccess")
            : summary.count === 0 ? <TileAction>{td("issueInvoice")}</TileAction>
              : !payment ? td("mixedCurrencies")
                : payment.due > 0 ? <span className="font-medium text-red-700 dark:text-red-400">{td("debt", { amount: money(payment.due, payment.currency) })}</span>
                  : <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{td("paidInFull")}</span>}
          hint={td("tilePaymentHint")}
          onClick={() => openSection("money", canSeeInvoices ? "invoices" : "approvals")}
        />
        <DealKpiTile
          testId="deal-tile-owner"
          label={t("assignedTo")}
          icon={<UserRound />}
          muted={!deal.assignedTo}
          value={deal.assignedTo ? (deal.assignedToName ?? deal.assignedTo) : td("notAssigned")}
          sub={deal.assignedTo ? td("ownerLeads") : canWrite ? <TileAction>{td("assign")}</TileAction> : ""}
          hint={td("tileOwnerHint")}
          onClick={() => { if (canWrite) openForm("owner:set") }}
        />
        <DealKpiTile
          testId="deal-tile-next"
          label={td("tileNext")}
          icon={<CalendarClock />}
          muted={!nextTask}
          value={nextTask ? (nextTask.dueDate ? dueLabel(nextTask.dueDate) : td("planNoDate")) : td("notPlanned")}
          sub={nextTask
            ? <span className={`truncate ${nextTask.dueDate && daysUntil(nextTask.dueDate, now) < 0 ? "font-medium text-red-700 dark:text-red-400" : ""}`}>{nextTask.title}</span>
            : may("tasks", "write") ? <TileAction>{td("plan")}</TileAction> : ""}
          hint={td("tileNextHint")}
          onClick={() => openForm("plan")}
        />
      </div>

      {/* ── What to do now ── */}
      <div ref={todoRef} className="scroll-mt-4">
        <DealNextSteps
          dealId={id}
          orgId={orgId}
          currentUserId={sessionUser?.id}
          deal={{ assignedTo: deal.assignedTo, assignedToName: deal.assignedToName, contactId: deal.contactId, contact: deal.contact, companyId: deal.company?.id, expectedClose: deal.expectedClose }}
          kind={kind}
          stageLabel={stageLabels[deal.stage] || deal.stage}
          nextStageLabel={following?.label ?? null}
          lostReason={deal.lostReason}
          result={steps}
          tasks={tasks}
          canWrite={canWrite}
          canInvoice={may("invoices", "write")}
          canTask={may("tasks", "write")}
          form={form}
          onForm={openForm}
          onChanged={refresh}
          onMoveNext={() => { if (following) void pickStage(following) }}
          onReopen={() => { if (lastOpenStage) void moveStage(lastOpenStage.name) }}
          onOpenSection={openSection}
          onEditDeal={() => setEditOpen(true)}
        />
      </div>

      {/* ── The details: closed until asked for ── */}
      <div ref={sectionsRef} data-tour-id="deal-sidebar" className="scroll-mt-4">
        <DealSections
          sections={sections}
          open={section}
          part={part}
          ariaLabel={td("sectionsLabel")}
          collapseLabel={td("collapse")}
          onOpen={setSection}
          onPart={(sectionId, partId) => setPart(all => ({ ...all, [sectionId]: partId }))}
        />
      </div>

      {/* ── Da Vinci: a panel, not a column ── */}
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent side="right" closeLabel={tc("close")} className="w-full overflow-y-auto sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-[hsl(var(--ai-from))]" />Da Vinci</SheetTitle>
            <SheetDescription>{td("aiPanelHint")}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <AdvisorRecordWidget entityType="deal" entityId={id} orgId={orgId} />
            <div data-tour-id="deal-ai-prediction">
              <AiPredictionCard dealId={id} orgId={orgId} />
            </div>
            <div data-tour-id="deal-ai-suggestions">
              <AiSuggestions dealId={id} />
            </div>
            <NextBestOffers dealId={id} orgId={orgId} onAdded={() => { setLinesKey(k => k + 1); fetchDeal() }} />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Modals ── */}
      <DealForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={refresh}
        amountFromLines={lineCount > 0}
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
    </MotionPage>
  )
}
