"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { LeadForm } from "@/components/lead-form"
import { LeadConvertDialog } from "@/components/lead-convert-dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  Search, Pencil, Trash2, ArrowRight, Plus,
  Phone, Mail, Building2, Calendar, ArrowUpDown, ArrowUp, ArrowDown,
  LayoutGrid, List, BarChart3, Columns3,
  CheckSquare, Square, MinusSquare, Zap, ListOrdered, PhoneCall,
} from "lucide-react"
import { EnrollInSequenceDialog } from "@/components/sequences/enroll-in-sequence-dialog"
import { cn } from "@/lib/utils"
import { useLocale, useTranslations } from "next-intl"
import { useCategoryLabel } from "@/lib/status-labels"
import { formatDate } from "@/lib/format-date"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { LeadsAnalytics } from "@/components/leads/leads-analytics"
import { LateCallbacksPanel } from "@/components/leads/late-callbacks-panel"
import { LeadBrowserCallAction } from "@/components/leads/lead-browser-call-action"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { InlineTitleCell, InlineTextCell, InlineSelectCell } from "@/components/tasks/inline-tasks-table"
import { Button } from "@/components/ui/button"
import { EntityBulkBar } from "@/components/entity-bulk-bar"
import { UserPicker } from "@/components/user-picker"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"
import { VoiceCallQueuePreview } from "@/components/voice-call-queues/voice-call-queue-preview"
import { toast } from "sonner"
import { compareLeads, DEFAULT_LEAD_SORT } from "@/lib/leads/sort"

interface Lead {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: string | null
  brand: string | null
  category: string | null
  status: string
  priority: string
  score: number
  scoreDetails: any
  estimatedValue: number | null
  notes: string | null
  pipelineId: string | null
  lastScoredAt: string | null
  createdAt: string
  assignedTo: string | null
  assignedToName: string | null
}

// Grade: compact colored squares — functional, not decorative
const gradeStyle: Record<string, string> = {
  A: "bg-foreground text-background",
  B: "bg-foreground/70 text-background",
  C: "bg-amber-500 text-white",
  D: "bg-red-500 text-white",
  F: "bg-[#FF4D00] text-white",
}

// Status: colored dot + text
// Kanban column-header dot — still used by the Kanban view (table rows
// were migrated to InlineSelectCell pills in Roadmap #6).
const statusDot: Record<string, string> = {
  new:       "bg-sky-400",
  contacted: "bg-amber-400",
  qualified: "bg-violet-500",
  converted: "bg-emerald-500",
  lost:      "bg-gray-300",
}

// Module-level constants for inline-editable list cells (Roadmap #6).
// Same shape as the deals/contacts pattern: OPTIONS tuple + per-value
// badgeClasses map. Status uses the same colors as the existing dot+text
// rendering, repackaged as pill-style bg+text classes.
const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"] as const
const STATUS_BADGE_CLASSES: Record<string, string> = {
  new:       "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  contacted: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  qualified: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  converted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  lost:      "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
}
const SOURCE_OPTIONS = ["website", "referral", "cold_call", "linkedin", "email"] as const
const SOURCE_BADGE_CLASSES: Record<string, string> = {
  website:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  referral:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cold_call: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  linkedin:  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  email:     "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
}
// Category includes "regular" — that value pre-existed in old data, the
// filter dropdown, and lead-form.tsx. Omitting it would render those leads
// as placeholder + make "regular" unselectable via inline edit.
const CATEGORY_OPTIONS = ["vip", "partner", "prospect", "regular", "inactive"] as const
const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  vip:      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  partner:  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  prospect: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  regular:  "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  inactive: "bg-muted text-muted-foreground",
}
// Display labels (proper capitalization — old rendering used CSS capitalize).
function getGrade(score: number): string {
  if (score >= 80) return "A"
  if (score >= 60) return "B"
  if (score >= 40) return "C"
  if (score >= 20) return "D"
  return "F"
}

export default function LeadsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const t = useTranslations("leads")
  const tc = useTranslations("common")
  const locale = useLocale()
  const categoryLabel = useCategoryLabel("common", Object.keys(CATEGORY_BADGE_CLASSES))
  const categoryLabels = Object.fromEntries(CATEGORY_OPTIONS.map((v) => [v, categoryLabel(v)] as const))

  const statusLabels: Record<string, string> = {
    new: t("statusNew"), contacted: t("statusContacted"), qualified: t("statusQualified"),
    converted: t("statusConverted"), lost: t("statusLost"),
  }
  const sourceLabels: Record<string, string> = {
    website: t("sourceWebsite"), referral: t("sourceReferral"), cold_call: t("sourceColdCall"),
    linkedin: t("sourceLinkedin"), email: t("sourceEmail"),
  }

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  useAutoTour("leads")
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams?.get("search") || "")
  const [statusFilter, setStatusFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState(searchParams?.get("category") || "")
  const [sourceFilter, setSourceFilter] = useState(searchParams?.get("source") || "")
  const [sortBy, setSortBy] = useState(DEFAULT_LEAD_SORT)
  const [showForm, setShowForm] = useState(searchParams?.get("new") === "1")
  const [editData, setEditData] = useState<Lead | undefined>()
  const [convertLead, setConvertLead] = useState<Lead | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [tab, setTab] = useState<"analytics" | "workspace">("workspace")
  const [viewMode, setViewMode] = useState<"table" | "kanban">("kanban")
  // Roadmap #20 — saved-view integration.
  const currentFiltersSnapshot = useMemo(
    () => ({ sortBy, search, statusFilter, categoryFilter, sourceFilter, viewMode, tab }),
    [sortBy, search, statusFilter, categoryFilter, sourceFilter, viewMode, tab],
  )
  const applySavedView = useCallback((view: SavedView) => {
    const f = view.filters as Record<string, unknown>
    if (typeof f.sortBy === "string") setSortBy(f.sortBy)
    if (typeof f.search === "string") setSearch(f.search)
    if (typeof f.statusFilter === "string") setStatusFilter(f.statusFilter)
    if (typeof f.categoryFilter === "string") setCategoryFilter(f.categoryFilter)
    if (typeof f.sourceFilter === "string") setSourceFilter(f.sourceFilter)
    if (f.viewMode === "table" || f.viewMode === "kanban") setViewMode(f.viewMode)
    if (f.tab === "analytics" || f.tab === "workspace") setTab(f.tab)
  }, [])
  // URL query params win over saved default — see contacts page for the
  // same guard (architect P1 from #20 rollout review).
  const hasUrlFilterParam = !!(searchParams?.get("search") || searchParams?.get("category") || searchParams?.get("source"))
  const onDefaultLoadGuarded = hasUrlFilterParam ? undefined : applySavedView
  // Bulk selection (Roadmap #19 Phase C). Table view only; kanban groups
  // by status, which already affords mass-moves via drag-drop.
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
  const [bulkConfirmAction, setBulkConfirmAction] = useState<null | "delete">(null)
  const [showBulkEnroll, setShowBulkEnroll] = useState(false)
  const [showAiQueuePreview, setShowAiQueuePreview] = useState(false)
  // Force-remount key for the status-picker <select> so it returns to its
  // placeholder after each action without mutating event.target.value
  // (architect-mandated controlled pattern, see deals page).
  const [statusMenuKey, setStatusMenuKey] = useState(0)

  const fetchLeads = async () => {
    try {
      const res = await fetch("/api/v1/leads?limit=500&includeConverted=true", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setLeads(json.data.leads || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchLeads() }, [session])

  // Drop bulk selection whenever the underlying view changes — selected ids
  // could point at rows no longer in the filtered/kanban scope.
  useEffect(() => {
    setSelectedLeadIds(new Set())
    setShowAiQueuePreview(false)
  }, [viewMode, tab, statusFilter, categoryFilter, sourceFilter])

  useEffect(() => {
    if (selectedLeadIds.size === 0) setShowAiQueuePreview(false)
  }, [selectedLeadIds.size])

  const selectedQueueLeads = useMemo(
    () => leads
      .filter((lead) => selectedLeadIds.has(lead.id))
      .map((lead) => ({
        id: lead.id,
        contactName: lead.contactName,
        assignedTo: lead.assignedTo,
      })),
    [leads, selectedLeadIds],
  )

  const selectedQueueOwnerUserId = useMemo(() => {
    const owners = Array.from(new Set(
      selectedQueueLeads
        .map((lead) => lead.assignedTo)
        .filter((value): value is string => Boolean(value)),
    ))
    return owners.length === 1 ? owners[0] : undefined
  }, [selectedQueueLeads])

  // Bulk-action dispatcher. Mirrors deals/page handleBulkAction.
  const handleBulkAction = async (action: string, value?: string) => {
    if (selectedLeadIds.size === 0) return
    try {
      const res = await fetch("/api/v1/leads/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ids: Array.from(selectedLeadIds), action, value }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || t("bulkActionFailed")
        throw new Error(err)
      }
      const labelKey = action === "delete"
        ? "bulkDeletedToast"
        : action === "update_status"
        ? "bulkStatusToast"
        : "bulkReassignToast"
      toast.success(t(labelKey, { count: selectedLeadIds.size }))
      setSelectedLeadIds(new Set())
      fetchLeads()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("bulkActionFailed"))
    }
  }

  const toggleLeadSelect = (id: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Inline-edit helper — PATCH /api/v1/leads/[id] then refetch.
  // Uses {handled:true} sentinel so the network-error toast only fires
  // for actual network failures (not when server already toasted).
  const inlineUpdate = async (leadId: string, patch: Record<string, unknown>): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error || t("updateFailed", { status: res.status })
        toast.error(msg)
        throw Object.assign(new Error(msg), { handled: true })
      }
      fetchLeads()
    } catch (err: any) {
      if (!err?.handled) toast.error(t("networkError"))
      throw err
    }
  }

  // Kanban drag-and-drop — mirrors tasks/page.tsx handleKanbanDrop: move the
  // card optimistically first, revert + toast if the server rejects. No
  // refetch on success (would clobber other in-flight optimistic edits).
  // Dropping onto "converted" does a plain status PATCH — same as the table
  // view's inline status editor; the full convert flow (contact/deal
  // creation) stays on the explicit arrow button.
  const [dragLeadId, setDragLeadId] = useState<string | null>(null)
  const handleKanbanDrop = async (leadId: string, newStatus: string) => {
    setDragLeadId(null)
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === newStatus) return
    const prev = leads
    setLeads(p => p.map(l => l.id === leadId ? { ...l, status: newStatus } : l))
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        setLeads(prev)
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t("updateFailed", { status: res.status }))
      }
    } catch {
      setLeads(prev)
      toast.error(t("networkError"))
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/leads/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchLeads()
  }

  // ── Filter & sort ─────────────────────────────────────────────────────────
  const filtered = leads.filter(l => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false
    if (categoryFilter && l.category !== categoryFilter) return false
    if (sourceFilter === "__none__" && l.source) return false
    if (sourceFilter && sourceFilter !== "__none__" && l.source !== sourceFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        l.contactName.toLowerCase().includes(q) ||
        (l.companyName || "").toLowerCase().includes(q) ||
        (l.email || "").toLowerCase().includes(q) ||
        (l.phone || "").toLowerCase().includes(q) ||
        (l.brand || "").toLowerCase().includes(q)
      )
    }
    return true
  }).sort((a, b) => compareLeads(a, b, sortBy))

  // ── Stats ─────────────────────────────────────────────────────────────────
  const statusCounts: Record<string, number> = {}
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1 })
  const sourceOptions = Array.from(new Set([
    ...SOURCE_OPTIONS,
    ...leads.map(lead => lead.source).filter((source): source is string => Boolean(source)),
  ])).sort((a, b) => (sourceLabels[a] || a).localeCompare(sourceLabels[b] || b))
  const hasLeadsWithoutSource = leads.some(lead => !lead.source)
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0
  const hotLeads = leads.filter(l => l.score >= 80).length

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={"space-y-5"}>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-28 bg-muted animate-pulse rounded" />
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-9 w-28 bg-muted animate-pulse rounded" />
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 bg-muted/40 animate-pulse border-b border-zinc-200 dark:border-zinc-700" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={"space-y-5"}>

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            data-tour-id="leads-list"
            className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2 flex-wrap"
          >
            {t("title")}
            <span className="text-muted-foreground font-normal text-lg">({leads.length})</span>
            <TourReplayButton tourId="leads" />
            <HelpButton slug="leads" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1" data-tour-id="leads-score">
            {t("avgScore")}: <span className="font-medium text-foreground">{avgScore}</span>/100
            {" · "}{t("hotLeads")}: <span className={cn("font-medium", hotLeads > 0 ? "text-[#FF4D00]" : "text-foreground")}>{hotLeads}</span>
          </p>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1">
            {([
              { key: "analytics" as const, Icon: BarChart3, label: tc("analytics") },
              { key: "workspace" as const, Icon: Columns3,  label: tc("list") },
            ]).map(({ key, Icon, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Insights */}
          <button
            onClick={() => router.push("/contacts?entity=leads")}
            className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
          >
            {t("insightsBtn")}
          </button>

          <button
            type="button"
            onClick={() => {
              const ownerUserId = session?.user?.id
              router.push(`/voip/call-queues${ownerUserId ? `?ownerUserId=${encodeURIComponent(ownerUserId)}` : ""}`)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground dark:border-zinc-700"
          >
            <ListOrdered aria-hidden="true" className="h-3.5 w-3.5" />
            {t("aiCallQueues")}
          </button>

          {/* New Lead — only this button gets orange */}
          <button
            onClick={() => { setEditData(undefined); setShowForm(true) }}
            className="flex items-center gap-1.5 text-sm font-semibold bg-[#FF4D00] text-white px-4 py-1.5 rounded-lg hover:bg-[#e04400] transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t("newLead")}
          </button>
        </div>
      </div>

      {/* ── ANALYTICS TAB ────────────────────────────────────────────────── */}
      {tab === "analytics" ? (
        <>
        {/* Promises made to customers on AI calls, settled against whether the
            seller actually called back - and how late. */}
        <section className="mb-6 space-y-3" data-testid="late-callbacks-section">
          <h2 className="text-lg font-semibold">{t("lateCallbacksTitle")}</h2>
          <LateCallbacksPanel days={7} />
        </section>
        <LeadsAnalytics
          leads={leads}
          labels={{
            totalLeads: t("title"), hotLeads: t("hotLeads"), avgScore: t("avgScore"),
            converted: t("statusConverted"), lost: t("statusLost"),
            conversionRate: t("analyticsConversionRate"), avgDaysToConvert: t("analyticsAvgDays"),
            statusDistribution: t("analyticsStatusDist"), scoreDistribution: t("analyticsScoreDist"),
            sourceBreakdown: t("analyticsSourceBreakdown"), priorityBreakdown: t("analyticsPriorityBreakdown"),
            topLeads: t("analyticsTopLeads"), conversionFunnel: t("analyticsConvFunnel"),
            conversionProbability: t("analyticsConvProb"), score: t("colScore"),
            estimatedValue: t("modalEstimatedValue"), noData: t("noLeads"),
            new: t("statusNew"), contacted: t("statusContacted"), qualified: t("statusQualified"),
            high: t("priorityHigh"), medium: t("priorityMedium"), low: t("priorityLow"),
            leadsByMonth: t("analyticsLeadsByMonth"), pipelineValue: t("analyticsPipelineValue"),
          }}
        />
        </>
      ) : (
        <>
          <PageDescription text={t("pageDescription")} />
          <DidYouKnow page="leads" className="mb-2" />

          {/* ── STATS ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-0 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {[
              { value: leads.length,                label: t("title") },
              { value: statusCounts.converted || 0, label: t("statusConverted") },
              { value: `${avgScore}/100`,            label: t("avgScore") },
              { value: hotLeads,                     label: t("hotLeads"), hot: true },
            ].map((stat, i) => (
              <div key={i} className={cn("px-6 py-4", i > 0 && "border-l border-zinc-200 dark:border-zinc-700")}>
                <div className={cn(
                  "text-3xl font-bold tracking-tight",
                  stat.hot && hotLeads > 0 ? "text-[#FF4D00]" : "text-foreground"
                )}>
                  {stat.value}
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-medium">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* ── STATUS FILTER PILLS ──────────────────────────────────── */}
          <div
            data-tour-id="leads-status-filter"
            className="flex flex-wrap gap-1.5"
          >
            {[
              { key: "all", label: `${t("all")} (${leads.length})` },
              ...Object.entries(statusLabels).map(([key, label]) => ({
                key, label: `${label} (${statusCounts[key] || 0})`
              }))
            ].map(item => (
              <button
                key={item.key}
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  "px-3 py-1 text-sm rounded-full border transition-colors",
                  statusFilter === item.key
                    ? "bg-foreground text-background border-foreground font-medium"
                    : "border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* ── TOOLBAR ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 bg-background"
              />
            </div>

            {/* Category */}
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 px-3 text-sm bg-background focus:outline-none cursor-pointer text-muted-foreground hover:border-foreground/40 transition-colors"
            >
              <option value="">{t("allCategories")}</option>
              <option value="vip">{categoryLabel("vip")}</option>
              <option value="regular">{categoryLabel("regular")}</option>
              <option value="partner">{categoryLabel("partner")}</option>
              <option value="prospect">{categoryLabel("prospect")}</option>
              <option value="inactive">{categoryLabel("inactive")}</option>
            </select>

            {/* Source */}
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              aria-label={t("filterBySource")}
              className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 px-3 text-sm bg-background focus:outline-none cursor-pointer text-muted-foreground hover:border-foreground/40 transition-colors"
            >
              <option value="">{t("allSources")}</option>
              {sourceOptions.map(source => (
                <option key={source} value={source}>{sourceLabels[source] || source}</option>
              ))}
              {hasLeadsWithoutSource && <option value="__none__">{t("sourceNotSpecified")}</option>}
            </select>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 px-3 text-sm bg-background focus:outline-none cursor-pointer text-muted-foreground hover:border-foreground/40 transition-colors"
            >
              <option value="score_desc">{t("sortScoreDesc")}</option>
              <option value="score_asc">{t("sortScoreAsc")}</option>
              <option value="name_asc">{t("sortNameAsc")}</option>
              <option value="name_desc">{t("sortNameDesc")}</option>
              <option value="newest">{t("sortNewest")}</option>
              <option value="oldest">{t("sortOldest")}</option>
            </select>

            {/* View toggle */}
            <div className="flex items-center border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              {([
                { mode: "table"  as const, Icon: List,       label: tc("list") },
                { mode: "kanban" as const, Icon: LayoutGrid, label: tc("kanban") },
              ]).map(({ mode, Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  title={label}
                  className={cn(
                    "p-2 transition-colors",
                    viewMode === mode
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>

            {/* Count */}
            <span className="text-sm text-muted-foreground ml-auto">
              {filtered.length !== leads.length
                ? `${filtered.length} / ${leads.length}`
                : `${leads.length}`}
            </span>
          </div>

          {/* ── KANBAN VIEW ──────────────────────────────────────────── */}
          {viewMode === "kanban" && (() => {
            const KNOWN_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const
            // Orphan leads: status values not in the standard set (legacy/imported data).
            // Show them in an extra "Other" column so they don't silently disappear.
            const orphanLeads = filtered.filter(l => !KNOWN_STATUSES.includes(l.status as any))
            const showOther = orphanLeads.length > 0
            return (
            <div data-tour-id="leads-convert">
            <MotionList
              className={cn("grid gap-4", showOther ? "grid-cols-6" : "grid-cols-5")}
              staggerDelay={0.06}
            >
              {KNOWN_STATUSES.map(status => {
                const statusLeads = filtered.filter(l => l.status === status)
                return (
                  <MotionItem key={status} className="min-w-0">
                    {/* Whole column is the drop target (tasks-kanban parity);
                        dashed outline appears while any card is dragged. */}
                    <div
                      className={cn("h-full rounded-lg", dragLeadId && "outline-dashed outline-2 outline-zinc-300 dark:outline-zinc-600")}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const id = e.dataTransfer.getData("text/plain")
                        if (id) handleKanbanDrop(id, status)
                      }}
                    >
                    <div className="mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full flex-shrink-0", statusDot[status])} />
                        <span className="text-xs font-semibold text-foreground">
                          {statusLabels[status] || status}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">{statusLeads.length}</span>
                    </div>

                    <div className="min-h-[200px] space-y-2">
                      {statusLeads.map(lead => {
                        const letter = getGrade(lead.score)
                        return (
                          <div
                            key={lead.id}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDragLeadId(lead.id) }}
                            onDragEnd={() => setDragLeadId(null)}
                            className={cn(
                              "bg-card border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-foreground/30 hover:shadow-sm transition-all",
                              dragLeadId === lead.id && "opacity-50",
                            )}
                            onClick={() => router.push(`/leads/${lead.id}`)}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={cn("w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-sm flex-shrink-0", gradeStyle[letter])}>
                                {letter}
                              </span>
                              <span className="font-medium text-xs text-foreground truncate flex-1">
                                {lead.contactName}
                              </span>
                            </div>
                            {lead.companyName && (
                              <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                                <Building2 className="h-2.5 w-2.5" /> {lead.companyName}
                              </p>
                            )}
                            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                              <p className="flex items-center gap-1 truncate">
                                <Calendar className="h-3 w-3 shrink-0" />
                                {formatDate(lead.createdAt, locale)}
                              </p>
                              <p className="truncate">
                                {tc("assignee")}: {lead.assignedToName || tc("unassigned")}
                              </p>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-[11px] text-muted-foreground">{lead.score}/100</span>
                              {lead.estimatedValue ? (
                                <span className="text-xs font-semibold text-foreground">
                                  ${lead.estimatedValue.toLocaleString()}
                                </span>
                              ) : null}
                            </div>
                            <div
                              className="flex gap-1 mt-2 border-t border-zinc-200 dark:border-zinc-700 pt-2"
                              onClick={e => e.stopPropagation()}
                            >
                              {lead.status !== "converted" && (
                                <button
                                  className="text-emerald-600 p-0.5 hover:opacity-70 transition-opacity"
                                  onClick={() => setConvertLead(lead)}
                                  title={t("convertTooltip")}
                                >
                                  <ArrowRight className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                className="text-muted-foreground p-0.5 hover:text-foreground transition-colors"
                                onClick={() => { setEditData(lead); setShowForm(true) }}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                className="text-muted-foreground p-0.5 hover:text-destructive transition-colors ml-auto"
                                onClick={() => { setDeleteId(lead.id); setDeleteName(lead.contactName) }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                      {statusLeads.length === 0 && (
                        <div className="flex h-20 items-center justify-center text-xs text-muted-foreground/40 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
                          —
                        </div>
                      )}
                    </div>
                    </div>
                  </MotionItem>
                )
              })}
              {/* "Other" column for any leads with non-standard status (legacy/imported data) */}
              {showOther && (
                <MotionItem className="min-w-0">
                  <div className="mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full flex-shrink-0 bg-zinc-400" />
                      <span className="text-xs font-semibold text-foreground">{tc("other")}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{orphanLeads.length}</span>
                  </div>
                  {/* Orphan cards can be dragged OUT into a real stage; the
                      Other column itself is not a drop target (no canonical
                      status to assign). */}
                  <div className="min-h-[200px] space-y-2">
                    {orphanLeads.map(lead => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDragLeadId(lead.id) }}
                        onDragEnd={() => setDragLeadId(null)}
                        onClick={() => router.push(`/leads/${lead.id}`)}
                        className={cn(
                          "rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow bg-card",
                          dragLeadId === lead.id && "opacity-50",
                        )}
                      >
                        <div className="text-sm font-semibold truncate">{lead.contactName}</div>
                        {lead.companyName && (
                          <div className="text-xs text-muted-foreground truncate">{lead.companyName}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                          {t("colStatus")}: {lead.status || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </MotionItem>
              )}
            </MotionList>
            </div>
            )
          })()}

          {/* ── TABLE VIEW ───────────────────────────────────────────── */}
          {viewMode === "table" && (
            <>
            {/* Bulk-actions bar — Roadmap #19 Phase C. Table view only.
                Status picker + destructive Delete. Reassign deferred until
                a shared UserPicker popover lands across deals/leads/companies. */}
            <EntityBulkBar
              selectedCount={selectedLeadIds.size}
              onClearSelection={() => {
                setSelectedLeadIds(new Set())
                setShowAiQueuePreview(false)
              }}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">{t("bulkSetStatus")}</span>
                <select
                  key={statusMenuKey}
                  defaultValue=""
                  onChange={(e) => {
                    const status = e.target.value
                    if (!status) return
                    handleBulkAction("update_status", status)
                    setStatusMenuKey(k => k + 1)
                  }}
                  className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
                  aria-label={t("bulkSetStatus")}
                >
                  <option value="" disabled>{t("bulkSetStatus")}</option>
                  {(["new", "contacted", "qualified", "lost"] as const).map((s) => (
                    <option key={s} value={s}>{statusLabels[s]}</option>
                  ))}
                </select>
              </div>
              {/* Phase F: reassign popover. Endpoint supported it; UI added now. */}
              <UserPicker
                orgId={orgId ? String(orgId) : undefined}
                onSelect={(userId) => handleBulkAction("reassign", userId ?? "")}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setShowBulkEnroll(true)}
              >
                <Zap className="h-3.5 w-3.5" /> {t("addToSequence")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1"
                aria-expanded={showAiQueuePreview}
                aria-controls="voice-call-queue-preview-title"
                onClick={() => setShowAiQueuePreview(true)}
              >
                <PhoneCall aria-hidden="true" className="h-3.5 w-3.5" />
                {t("aiCallSelected")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1 ml-auto"
                onClick={() => setBulkConfirmAction("delete")}
              >
                <Trash2 className="h-3.5 w-3.5" /> {tc("delete")}
              </Button>
            </EntityBulkBar>

            {showAiQueuePreview && selectedQueueLeads.length > 0 ? (
              <VoiceCallQueuePreview
                leads={selectedQueueLeads}
                organizationId={orgId ? String(orgId) : undefined}
                onClose={() => setShowAiQueuePreview(false)}
                onCreated={(queueId) => {
                  const ownerQuery = selectedQueueOwnerUserId
                    ? `?ownerUserId=${encodeURIComponent(selectedQueueOwnerUserId)}`
                    : ""
                  router.push(`/voip/call-queues/${encodeURIComponent(queueId)}${ownerQuery}`)
                }}
              />
            ) : null}

            <EnrollInSequenceDialog
              open={showBulkEnroll}
              onClose={() => setShowBulkEnroll(false)}
              entityType="lead"
              entityIds={Array.from(selectedLeadIds)}
              onDone={() => setSelectedLeadIds(new Set())}
            />

            {/* Roadmap #20 — saved-view chips */}
            <SavedViewBar
              entityType="leads"
              currentFilters={currentFiltersSnapshot}
              onApply={applySavedView}
              onDefaultLoad={onDefaultLoadGuarded}
            />

            {/* Mobile stacked-card view (#18) — shown below md:.
                Tap → /leads/[id]; explicit convert/edit/delete buttons. */}
            <div className="md:hidden space-y-2">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
                  {search ? t("noResults") : t("noLeads")}
                </div>
              ) : (
                filtered.map((lead) => {
                  const letter = getGrade(lead.score)
                  const convProb = (lead.scoreDetails as any)?.conversionProb ?? Math.round(lead.score * 0.85)
                  const convColor = convProb >= 50
                    ? "text-emerald-600 dark:text-emerald-400"
                    : convProb >= 30
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-[#FF4D00]"
                  return (
                    <div
                      key={lead.id}
                      className={cn(
                        "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
                        selectedLeadIds.has(lead.id) && "ring-1 ring-primary/40 bg-primary/[0.04]",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {/* Bulk select — 44px touch target via padding (Phase C) */}
                        <button
                          type="button"
                          onClick={() => toggleLeadSelect(lead.id)}
                          aria-label={tc("selectRow")}
                          className="flex h-11 w-6 items-center justify-center -ml-1 shrink-0"
                        >
                          {selectedLeadIds.has(lead.id)
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/leads/${lead.id}`)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-sm shrink-0", gradeStyle[letter])}>
                              {letter}
                            </span>
                            <h3 className="text-base font-semibold leading-snug">{lead.contactName}</h3>
                            <span className={cn("text-sm font-semibold tabular-nums ml-auto", convColor)}>
                              {convProb}%
                            </span>
                          </div>
                          {lead.companyName && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Building2 className="h-3 w-3 shrink-0" />
                              {lead.companyName}
                              {lead.estimatedValue ? <span className="ml-auto">${lead.estimatedValue.toLocaleString()}</span> : null}
                            </div>
                          )}
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {lead.email && (
                              <div className="flex items-center gap-1.5">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="truncate">{lead.email}</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-1.5">
                                <Phone className="h-3 w-3 shrink-0" />
                                <span className="truncate">{lead.phone}</span>
                              </div>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {lead.status && statusLabels[lead.status] && (
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                                STATUS_BADGE_CLASSES[lead.status] || "bg-zinc-100 text-zinc-600",
                              )}>
                                {statusLabels[lead.status]}
                              </span>
                            )}
                            {lead.source && sourceLabels[lead.source] && (
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                                SOURCE_BADGE_CLASSES[lead.source] || "bg-zinc-100 text-zinc-600",
                              )}>
                                {sourceLabels[lead.source]}
                              </span>
                            )}
                            {lead.category && CATEGORY_BADGE_CLASSES[lead.category] && (
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                                CATEGORY_BADGE_CLASSES[lead.category] || "bg-zinc-100 text-zinc-600",
                              )}>
                                {categoryLabel(lead.category)}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="flex flex-col gap-1 shrink-0">
                          <LeadBrowserCallAction leadId={lead.id} phone={lead.phone} />
                          {lead.status !== "converted" && (
                            <button
                              type="button"
                              onClick={() => setConvertLead(lead)}
                              aria-label={t("convertTooltip")}
                              className="h-11 w-11 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                            >
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { setEditData(lead); setShowForm(true) }}
                            aria-label={tc("edit")}
                            className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeleteId(lead.id); setDeleteName(lead.contactName) }}
                            aria-label={tc("delete")}
                            className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
                <table className="w-full text-sm min-w-[1040px]">
                  <thead className="bg-muted border-b border-zinc-200 dark:border-zinc-700">
                    <tr>
                      {/* Bulk-select header — Roadmap #19 Phase C. Tri-state. */}
                      {(() => {
                        const allOnPageSelected = filtered.length > 0 && filtered.every(l => selectedLeadIds.has(l.id))
                        const someOnPageSelected = !allOnPageSelected && filtered.some(l => selectedLeadIds.has(l.id))
                        return (
                          <th className="px-3 py-2.5 w-10">
                            <button
                              type="button"
                              onClick={() => {
                                if (allOnPageSelected) setSelectedLeadIds(new Set())
                                else setSelectedLeadIds(new Set(filtered.map(l => l.id)))
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
                      {[
                        { key: "score",      label: t("ldmGrade"),      className: "w-16" },
                        { key: "name",       label: t("colLead"),       className: "min-w-[180px]" },
                        { key: "company",    label: t("colCompany"),    className: "min-w-[130px]" },
                        { key: null,         label: t("colContacts"),   className: "min-w-[200px]" },
                        { key: "conversion", label: t("colConversion"), className: "min-w-[100px]" },
                        { key: "source",     label: t("colSource"),     className: "min-w-[110px]" },
                        { key: null,         label: t("colCategory"),   className: "min-w-[90px]" },
                        { key: "status",     label: t("colStatus"),     className: "min-w-[80px]" },
                        { key: null,         label: "",                 className: "w-16" },
                      ].map((col, i) => {
                        const isActive = col.key && sortBy.startsWith(col.key)
                        const isDesc   = sortBy.endsWith("_desc")
                        const SortIcon = !col.key ? null : isActive ? (isDesc ? ArrowDown : ArrowUp) : ArrowUpDown
                        return (
                          <th
                            key={i}
                            className={cn(
                              "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none whitespace-nowrap",
                              col.key && "cursor-pointer hover:text-foreground transition-colors",
                              col.className
                            )}
                            onClick={col.key ? () => {
                              const active = sortBy.startsWith(col.key!)
                              const desc   = sortBy.endsWith("_desc")
                              setSortBy(`${col.key}_${active && desc ? "asc" : "desc"}`)
                            } : undefined}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {SortIcon && (
                                <SortIcon className={cn("h-3 w-3", isActive ? "text-[#FF4D00]" : "opacity-30")} />
                              )}
                            </span>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody data-tour-id="leads-convert">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-14 text-center text-muted-foreground text-sm">
                          {search ? t("noResults") : t("noLeads")}
                        </td>
                      </tr>
                    ) : filtered.map(lead => {
                      const letter   = getGrade(lead.score)
                      const convProb = (lead.scoreDetails as any)?.conversionProb ?? Math.round(lead.score * 0.85)
                      return (
                        <tr
                          key={lead.id}
                          className={cn(
                            "group border-b border-zinc-200 dark:border-zinc-700 last:border-0 hover:bg-muted/50 transition-colors",
                            selectedLeadIds.has(lead.id) && "bg-primary/[0.04]",
                          )}
                        >
                          {/* Bulk-select cell (Phase C) */}
                          <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => toggleLeadSelect(lead.id)}
                              aria-label={tc("selectRow")}
                              className="p-0.5 rounded hover:bg-muted"
                            >
                              {selectedLeadIds.has(lead.id)
                                ? <CheckSquare className="h-4 w-4 text-primary" />
                                : <Square className="h-4 w-4 text-muted-foreground" />}
                            </button>
                          </td>
                          {/* Grade + Score */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={cn("w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-sm flex-shrink-0", gradeStyle[letter])}>
                                {letter}
                              </span>
                              <span className="text-sm text-muted-foreground tabular-nums">{lead.score}</span>
                            </div>
                          </td>

                          {/* Name (click → /leads/[id], double-click → rename inline) */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold text-foreground">
                                <InlineTitleCell
                                  value={lead.contactName}
                                  onSave={(v) => inlineUpdate(lead.id, { contactName: v })}
                                  onOpen={() => router.push(`/leads/${lead.id}`)}
                                />
                              </div>
                              {lead.estimatedValue ? (
                                <span className="text-xs text-muted-foreground">
                                  ${lead.estimatedValue.toLocaleString()}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          {/* Company */}
                          <td className="px-4 py-3">
                            {lead.companyName ? (
                              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                                <Building2 className="h-3 w-3 shrink-0" /> {lead.companyName}
                              </span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>

                          {/* Contacts — both Email and Phone inline editable */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground min-w-0">
                              <div className="flex items-center gap-1 w-full min-w-0">
                                <Mail className="h-3 w-3 shrink-0" />
                                <InlineTextCell
                                  value={lead.email ?? ""}
                                  inputType="text"
                                  placeholder={t("noEmail")}
                                  onSave={(v) => inlineUpdate(lead.id, { email: v === "" ? null : v })}
                                />
                              </div>
                              <div className="flex items-center gap-1 whitespace-nowrap">
                                <Phone className="h-3 w-3 shrink-0" />
                                <InlineTextCell
                                  value={lead.phone ?? ""}
                                  inputType="text"
                                  placeholder={t("noPhone")}
                                  onSave={(v) => inlineUpdate(lead.id, { phone: v === "" ? null : v })}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Conversion probability */}
                          <td className="px-4 py-3">
                            <span className={cn(
                              "text-sm font-semibold tabular-nums",
                              convProb >= 50 ? "text-emerald-600 dark:text-emerald-400" :
                              convProb >= 30 ? "text-amber-600 dark:text-amber-400" :
                              "text-[#FF4D00]"
                            )}>
                              {convProb}%
                            </span>
                          </td>

                          {/* Source — inline editable select */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <InlineSelectCell
                                value={lead.source ?? ""}
                                options={[...SOURCE_OPTIONS]}
                                labels={sourceLabels}
                                badgeClasses={SOURCE_BADGE_CLASSES}
                                placeholder={t("selectSourcePlaceholder")}
                                onSave={(v) => inlineUpdate(lead.id, { source: v })}
                              />
                              {lead.brand && (
                                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                                  {lead.brand}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Category pill — inline editable select */}
                          <td className="px-4 py-3">
                            <InlineSelectCell
                              value={lead.category ?? ""}
                              options={[...CATEGORY_OPTIONS]}
                              labels={categoryLabels}
                              badgeClasses={CATEGORY_BADGE_CLASSES}
                              placeholder={t("selectCategoryPlaceholder")}
                              onSave={(v) => inlineUpdate(lead.id, { category: v })}
                            />
                          </td>

                          {/* Status — inline editable select (pill style).
                              Invariant: status is required; no placeholder prop means
                              the Clear button is unreachable, so v is never null at runtime. */}
                          <td className="px-4 py-3">
                            <InlineSelectCell
                              value={lead.status}
                              options={[...STATUS_OPTIONS]}
                              labels={statusLabels}
                              badgeClasses={STATUS_BADGE_CLASSES}
                              onSave={(v) => v ? inlineUpdate(lead.id, { status: v }) : Promise.resolve()}
                            />
                          </td>

                          {/* Actions — always 50%, full on hover/focus (touch-friendly) */}
                          <td className="px-4 py-3 w-[112px]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-0.5 opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                              <LeadBrowserCallAction leadId={lead.id} phone={lead.phone} />
                              {lead.status !== "converted" && (
                                <button
                                  className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                  onClick={() => setConvertLead(lead)}
                                  title={t("convertTooltip")}
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                onClick={() => { setEditData(lead); setShowForm(true) }}
                                title={tc("edit")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                onClick={() => { setDeleteId(lead.id); setDeleteName(lead.contactName) }}
                                title={tc("delete")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              {filtered.length > 0 && (
                <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-700 bg-muted/30 text-xs text-muted-foreground">
                  {filtered.length !== leads.length
                    ? `${filtered.length} из ${leads.length} ${t("title").toLowerCase()}`
                    : `${leads.length} ${t("title").toLowerCase()}`}
                </div>
              )}
            </div>
            </>
          )}
        </>
      )}

      {/* ── DIALOGS ───────────────────────────────────────────────────────── */}
      <LeadForm
        open={showForm}
        onOpenChange={open => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={() => {
          // A successful create should never appear to vanish behind a saved
          // view or stale local filter. Edits keep the user's current context.
          if (!editData) {
            setSearch("")
            setStatusFilter("all")
            setCategoryFilter("")
            setSourceFilter("")
            setSortBy("newest")
            setTab("workspace")
          }
          void fetchLeads()
        }}
        initialData={editData}
        orgId={orgId}
      />
      {convertLead && (
        <LeadConvertDialog
          open={!!convertLead}
          onOpenChange={open => { if (!open) setConvertLead(null) }}
          onConverted={fetchLeads}
          lead={convertLead as any}
          orgId={orgId}
        />
      )}
      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={open => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteLead")}
        itemName={deleteName}
      />

      {/* Bulk-delete confirmation — Roadmap #19 Phase C. ICU-plural label so
          EN/RU agree ("1 lead" vs "5 leads"; "1 лид" vs "5 лидов"). */}
      <DeleteConfirmDialog
        open={bulkConfirmAction === "delete"}
        onOpenChange={(open) => { if (!open) setBulkConfirmAction(null) }}
        onConfirm={async () => {
          await handleBulkAction("delete")
          setBulkConfirmAction(null)
        }}
        title={t("deleteLead")}
        itemName={t("bulkDeleteItemName", { count: selectedLeadIds.size })}
      />
    </div>
  )
}
