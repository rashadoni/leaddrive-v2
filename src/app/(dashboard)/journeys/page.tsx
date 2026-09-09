"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ColorStatCard } from "@/components/color-stat-card"
import { JourneyForm } from "@/components/journey-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  Plus, Workflow, Users, CheckCircle, Target, Play, Pause, Pencil, Trash2, Eye,
  X, Mail, Clock, GitBranch, MessageSquare, Bell, FileText, UserPlus, Send,
  Loader2, Smartphone, Heart, Settings, Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import dynamic from "next/dynamic"

const JourneyFlowEditor = dynamic(() => import("@/components/journey-flow-editor").then(m => ({ default: m.JourneyFlowEditor })), { ssr: false })

interface JourneyStep {
  id: string
  stepOrder: number
  stepType: string
  config: any
  statsEntered: number
  statsCompleted: number
}

interface Journey {
  id: string
  name: string
  description?: string
  status: string
  triggerType: string
  entryCount: number
  activeCount: number
  completedCount: number
  conversionCount?: number
  goalType?: string
  goalTarget?: number
  goalConditions?: any
  exitOnGoal?: boolean
  maxEnrollmentDays?: number
  steps?: JourneyStep[]
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700",
  active: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-yellow-100 text-yellow-700 border-yellow-200",
  completed: "bg-blue-100 text-blue-700 border-blue-200",
}

function getStepInfo(type: string, stepTypesList: { value: string; label: string; icon: any; color: string; borderColor: string }[]) {
  return stepTypesList.find(st => st.value === type) || stepTypesList[0]
}

function getStepSummary(step: { stepType: string; config: any }, t: (key: string, params?: any) => string): string {
  const c = step.config || {}
  switch (step.stepType) {
    case "send_email": return c.subject ? t("summarySubject", { subject: c.subject }) : t("summaryNoSubject")
    case "wait": return t("summaryWait", { days: c.days || 1 })
    case "condition": {
      const scenario = conditionScenarios.find(s => s.id === c._scenario)
      if (scenario && scenario.id !== "custom") return t(scenario.labelKey)
      if (c.field && c.operator) {
        const fld = t(conditionFields.find(f => f.value === c.field)?.labelKey || c.field)
        const op = t(conditionOperators.find(o => o.value === c.operator)?.labelKey || c.operator)
        return c.operator === "not_empty" ? `${fld} ${op}` : `${fld} ${op} "${c.value}"`
      }
      return t("condition")
    }
    case "create_task": return c.title || t("summaryNewTask")
    case "send_telegram": return c.message ? c.message.slice(0, 40) : t("summaryTelegramMsg")
    case "send_whatsapp": return c.message ? c.message.slice(0, 40) : t("summaryWhatsappMsg")
    case "sms": return c.message ? c.message.slice(0, 40) : t("summarySmsMsg")
    case "update_field": return c.field ? `${c.field} = ${c.value || "..."}` : t("summaryUpdateField")
    default: return ""
  }
}

// Pre-built condition scenarios (intuitive for non-technical users)
const conditionScenarios = [
  { id: "lead_status_new", labelKey: "scenarioLeadNew", descKey: "scenarioLeadNewDesc", icon: "🆕", field: "status", operator: "equals", value: "new" },
  { id: "lead_status_qualified", labelKey: "scenarioLeadQualified", descKey: "scenarioLeadQualifiedDesc", icon: "✅", field: "status", operator: "equals", value: "qualified" },
  { id: "lead_status_lost", labelKey: "scenarioLeadLost", descKey: "scenarioLeadLostDesc", icon: "❌", field: "status", operator: "equals", value: "lost" },
  { id: "has_email", labelKey: "scenarioHasEmail", descKey: "scenarioHasEmailDesc", icon: "📧", field: "email", operator: "not_empty", value: "" },
  { id: "has_phone", labelKey: "scenarioHasPhone", descKey: "scenarioHasPhoneDesc", icon: "📱", field: "phone", operator: "not_empty", value: "" },
  { id: "has_company", labelKey: "scenarioHasCompany", descKey: "scenarioHasCompanyDesc", icon: "🏢", field: "companyName", operator: "not_empty", value: "" },
  { id: "source_website", labelKey: "scenarioSourceWebsite", descKey: "scenarioSourceWebsiteDesc", icon: "🌐", field: "source", operator: "equals", value: "website" },
  { id: "source_referral", labelKey: "scenarioSourceReferral", descKey: "scenarioSourceReferralDesc", icon: "🤝", field: "source", operator: "equals", value: "referral" },
  { id: "custom", labelKey: "scenarioCustom", descKey: "scenarioCustomDesc", icon: "⚙️", field: "", operator: "equals", value: "" },
]
const conditionActions = [
  { value: "continue", labelKey: "actionContinue" },
  { value: "skip_next", labelKey: "actionSkipNext" },
  { value: "skip_2", labelKey: "actionSkip2" },
  { value: "restart", labelKey: "actionRestart" },
  { value: "stop", labelKey: "actionStop" },
]
const conditionFields = [
  { value: "status", labelKey: "fieldStatus" },
  { value: "source", labelKey: "fieldSource" },
  { value: "companyName", labelKey: "fieldCompany" },
  { value: "email", labelKey: "fieldEmail" },
  { value: "phone", labelKey: "fieldPhone" },
  { value: "contactName", labelKey: "fieldName" },
]
const conditionOperators = [
  { value: "equals", labelKey: "opEquals" },
  { value: "not_equals", labelKey: "opNotEquals" },
  { value: "contains", labelKey: "opContains" },
  { value: "not_empty", labelKey: "opNotEmpty" },
]

// Enrollment Management Table component
function EnrollmentTable({ journeyId }: { journeyId: string }) {
  const t = useTranslations("journeys")
  const tc = useTranslations("common")
  const [enrollments, setEnrollments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/journeys/enroll?journeyId=${journeyId}`)
      const json = await res.json()
      if (json.success) setEnrollments(json.data || [])
    } catch { /* ignore */ }
    finally { setLoading(false); setLoaded(true) }
  }

  useEffect(() => { load() }, [journeyId])

  const handleAction = async (enrollmentId: string, action: "pause" | "resume" | "cancel") => {
    try {
      await fetch(`/api/v1/journeys/enrollments/${enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      load()
    } catch { /* ignore */ }
  }

  if (!loaded && loading) return <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
  if (enrollments.length === 0) return null

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-muted text-muted-foreground",
  }

  return (
    <div className="mt-4 border-t pt-4">
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Users className="h-4 w-4" /> {t("enrollments", { count: enrollments.length })}
      </h4>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {enrollments.map((e: any) => (
          <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm">
            <div className="flex items-center gap-2">
              <Badge className={`text-[10px] ${statusColors[e.status] || "bg-muted"}`}>{e.status}</Badge>
              <span className="text-xs text-muted-foreground">
                {e.leadId ? t("enrollLeadId", { id: e.leadId.slice(0, 8) }) : e.contactId ? t("enrollContactId", { id: e.contactId.slice(0, 8) }) : "—"}
              </span>
              {e.exitReason && <span className="text-[10px] text-muted-foreground">({e.exitReason})</span>}
            </div>
            <div className="flex items-center gap-1">
              {e.status === "active" && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => handleAction(e.id, "pause")}>
                  <Pause className="h-3 w-3 mr-0.5" /> {t("pause")}
                </Button>
              )}
              {e.status === "paused" && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => handleAction(e.id, "resume")}>
                  <Play className="h-3 w-3 mr-0.5" /> {t("resume")}
                </Button>
              )}
              {(e.status === "active" || e.status === "paused") && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-red-500 hover:text-red-600" onClick={() => handleAction(e.id, "cancel")}>
                  <X className="h-3 w-3 mr-0.5" /> {tc("cancel")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function JourneysPage() {
  const { data: session } = useSession()
  const t = useTranslations("journeys")
  const tc = useTranslations("common")
  useAutoTour("journeys")
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Journey | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [stepsJourney, setStepsJourney] = useState<Journey | null>(null)
  const [steps, setSteps] = useState<{ stepType: string; config: any }[]>([])
  const [savingSteps, setSavingSteps] = useState(false)
  const [addStepOpen, setAddStepOpen] = useState(false)
  const [flowView, setFlowView] = useState(false)
  const [newStepType, setNewStepType] = useState("send_email")
  const [newStepConfig, setNewStepConfig] = useState<any>({})
  const [enrollOpen, setEnrollOpen] = useState<Journey | null>(null)
  const [enrollLeadId, setEnrollLeadId] = useState("")
  const [enrolling, setEnrolling] = useState(false)
  const [leads, setLeads] = useState<{ id: string; contactName: string; email?: string; companyName?: string; status: string }[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadSearch, setLeadSearch] = useState("")
  const [selectedLead, setSelectedLead] = useState<{ id: string; contactName: string; email?: string; companyName?: string } | null>(null)
  const [exitReasonCounts, setExitReasonCounts] = useState<Record<string, number>>({})
  const [enrollmentStatusCounts, setEnrollmentStatusCounts] = useState<Record<string, number>>({ active: 0, paused: 0, completed: 0 })
  const orgId = session?.user?.organizationId

  const statusLabels: Record<string, string> = {
    draft: t("statusDraft"),
    active: t("statusActive"),
    paused: t("statusPaused"),
    completed: t("statusCompleted"),
  }
  const triggerLabels: Record<string, string> = {
    lead_created: t("triggerLeadCreated"),
    contact_created: t("triggerContactCreated"),
    deal_stage_change: t("triggerDealStageChange"),
    manual: t("triggerManual"),
  }
  const stepTypes = [
    { value: "send_email", label: t("stepEmail"), icon: Mail, color: "bg-blue-500", borderColor: "border-blue-200 bg-blue-50/50 dark:bg-blue-900/10" },
    { value: "sms", label: t("stepSms"), icon: Smartphone, color: "bg-muted-foreground", borderColor: "border-zinc-200 dark:border-zinc-700 bg-muted/50" },
    { value: "wait", label: t("stepWait"), icon: Clock, color: "bg-yellow-500", borderColor: "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-900/10" },
    { value: "condition", label: t("chainStepCondition"), icon: GitBranch, color: "bg-pink-500", borderColor: "border-pink-200 bg-pink-50/50 dark:bg-pink-900/10" },
    { value: "create_task", label: t("stepTask"), icon: FileText, color: "bg-teal-500", borderColor: "border-teal-200 bg-teal-50/50 dark:bg-teal-900/10" },
    { value: "send_telegram", label: t("stepTelegram"), icon: Send, color: "bg-sky-500", borderColor: "border-sky-200 bg-sky-50/50 dark:bg-sky-900/10" },
    { value: "send_whatsapp", label: t("stepWhatsapp"), icon: Heart, color: "bg-green-500", borderColor: "border-green-200 bg-green-50/50 dark:bg-green-900/10" },
    { value: "update_field", label: t("stepUpdateField"), icon: Settings, color: "bg-purple-500", borderColor: "border-purple-200 bg-purple-50/50 dark:bg-purple-900/10" },
  ]

  const fetchJourneys = async () => {
    try {
      const res = await fetch("/api/v1/journeys?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setJourneys(json.data.journeys)
      // Fetch enrollment exit reason counts
      fetch("/api/v1/journeys/enroll").then(r => r.json()).then(json => {
        if (json.success) {
          const counts: Record<string, number> = {}
          const sCounts: Record<string, number> = { active: 0, paused: 0, completed: 0 }
          for (const e of (json.data || [])) {
            if (e.exitReason) counts[e.exitReason] = (counts[e.exitReason] || 0) + 1
            if (e.status) sCounts[e.status] = (sCounts[e.status] || 0) + 1
          }
          setExitReasonCounts(counts)
          setEnrollmentStatusCounts(sCounts)
        }
      }).catch(() => {})
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchJourneys() }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/journeys/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchJourneys()
  }

  const toggleStatus = async (journey: Journey) => {
    const newStatus = journey.status === "active" ? "paused" : "active"
    await fetch(`/api/v1/journeys/${journey.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
      },
      body: JSON.stringify({ name: journey.name, status: newStatus }),
    })
    fetchJourneys()
  }

  function openSteps(journey: Journey) {
    setStepsJourney(journey)
    const existingSteps = (journey.steps || [])
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(s => ({ stepType: s.stepType, config: s.config || {} }))
    setSteps(existingSteps)
  }

  function openAddStep() {
    setNewStepType("send_email")
    setNewStepConfig({})
    setAddStepOpen(true)
  }

  function confirmAddStep() {
    setSteps(prev => [...prev, { stepType: newStepType, config: { ...newStepConfig } }])
    setAddStepOpen(false)
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  async function saveSteps() {
    if (!stepsJourney) return
    setSavingSteps(true)
    try {
      await fetch(`/api/v1/journeys/${stepsJourney.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          name: stepsJourney.name,
          steps: steps.map((s, i) => ({ stepType: s.stepType, stepOrder: i + 1, config: s.config })),
        }),
      })
      setStepsJourney(null)
      fetchJourneys()
    } catch (err) { console.error(err) } finally { setSavingSteps(false) }
  }

  const fetchLeads = async () => {
    setLeadsLoading(true)
    try {
      const res = await fetch("/api/v1/leads?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setLeads(json.data.leads || [])
    } catch (err) { console.error(err) } finally { setLeadsLoading(false) }
  }

  // Load leads when enroll dialog opens
  useEffect(() => {
    if (enrollOpen && leads.length === 0) fetchLeads()
  }, [enrollOpen])

  const filteredLeads = leads.filter(l => {
    if (!leadSearch.trim()) return true
    const q = leadSearch.toLowerCase()
    return (
      l.contactName?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      l.companyName?.toLowerCase().includes(q)
    )
  })

  async function handleEnroll() {
    if (!enrollOpen || !selectedLead) return
    setEnrolling(true)
    try {
      await fetch("/api/v1/journeys/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ journeyId: enrollOpen.id, leadId: selectedLead.id }),
      })
      setEnrollOpen(null)
      setSelectedLead(null)
      setLeadSearch("")
      fetchJourneys()
    } catch (err) { console.error(err) } finally { setEnrolling(false) }
  }

  const totalJourneys = journeys.length
  const activeCount = journeys.filter(j => j.status === "active").length
  const totalEntries = journeys.reduce((s, j) => s + j.entryCount, 0)
  const conversionRate = totalEntries > 0
    ? Math.round(journeys.reduce((s, j) => s + j.completedCount, 0) / totalEntries * 100)
    : 0

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-32 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour-id="journeys-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            {t("title")} <TourReplayButton tourId="journeys" /> <HelpButton slug="campaign-orchestrator" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button data-tour-id="journeys-new" onClick={() => { setEditData(undefined); setShowForm(true) }} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("newJourney")}
        </Button>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="journeys" className="mb-4" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard label={t("statTotal")} value={totalJourneys} icon={<Workflow className="h-4 w-4" />} hint={t("hintTotalJourneys")} />
        <ColorStatCard label={t("statActive")} value={activeCount} icon={<CheckCircle className="h-4 w-4" />} hint={t("hintActiveJourneys")} />
        <ColorStatCard label={t("statEntries")} value={totalEntries} icon={<Users className="h-4 w-4" />} hint={t("hintTotalEntries")} />
        <ColorStatCard label={t("statCompleted")} value={`${conversionRate}%`} icon={<Target className="h-4 w-4" />} hint={t("hintCompletionRate")} />
      </div>

      {/* Exit Reason Breakdown */}
      {Object.keys(exitReasonCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">{t("exitReasons")}:</span>
          {Object.entries(exitReasonCounts).map(([reason, count]) => (
            <Badge key={reason} variant="outline" className="text-xs">
              {reason}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Journey cards */}
      <div data-tour-id="journeys-list" className="space-y-3">
        {journeys.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed bg-muted/20 py-16 text-center">
            <Workflow className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">{t("noJourneys")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("noJourneysHint")}</p>
            <Button className="mt-4 gap-1.5" onClick={() => { setEditData(undefined); setShowForm(true) }}>
              <Plus className="h-4 w-4" /> {t("newJourney")}
            </Button>
          </div>
        ) : journeys.map(journey => (
          <div key={journey.id} className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card hover:shadow-md transition-shadow">
            <div className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-xs px-2.5 py-0.5 rounded-full font-medium border border-zinc-200 dark:border-zinc-700", statusColors[journey.status])}>
                    {statusLabels[journey.status] || journey.status}
                  </span>
                  <h3 className="font-semibold truncate">{journey.name}</h3>
                </div>
                {journey.description && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{journey.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Target className="h-3 w-3 text-orange-500" /> {triggerLabels[journey.triggerType] || journey.triggerType}
                  </span>
                  <span className="flex items-center gap-1">
                    <UserPlus className="h-3 w-3" /> {t("entered")}: {journey.entryCount}
                  </span>
                  <span>{t("activeCountLabel")}: {journey.activeCount}</span>
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" /> {t("completedCountLabel")}: {journey.completedCount}
                  </span>
                  {journey.goalTarget && journey.goalTarget > 0 && (
                    <div className="flex items-center gap-1 text-xs">
                      <Target className="h-3 w-3 text-green-500" />
                      <span>{t("goalLabel")}: {journey.conversionCount || 0}/{journey.goalTarget}</span>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden ml-1">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, ((journey.conversionCount || 0) / journey.goalTarget) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => openSteps(journey)}>
                  <Eye className="h-3 w-3" /> {t("steps")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => { setEditData(journey); setShowForm(true) }}>
                  <Pencil className="h-3 w-3" /> {t("edit")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => { setEnrollOpen(journey); setSelectedLead(null); setLeadSearch("") }}>
                  <UserPlus className="h-3 w-3" /> {t("enrollLead")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn("gap-1 text-xs h-8", journey.status === "active" ? "text-yellow-600" : "text-green-600")}
                  onClick={() => toggleStatus(journey)}
                >
                  {journey.status === "active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {journey.status === "active" ? t("pause") : t("statusActive")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                  onClick={() => { setDeleteId(journey.id); setDeleteName(journey.name) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ===== STEPS MODAL ===== */}
      {stepsJourney && (
        <Dialog open={!!stepsJourney} onOpenChange={open => { if (!open) setStepsJourney(null) }}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>{stepsJourney.name}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tc("status")}: {statusLabels[stepsJourney.status]} · {t("trigger")}: {triggerLabels[stepsJourney.triggerType]}
                  {stepsJourney.goalType && (
                    <span> · {t("goalLabel")}: {stepsJourney.goalType} ({stepsJourney.conversionCount || 0}/{stepsJourney.goalTarget || "∞"})</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={flowView ? "default" : "outline"}
                  className="gap-1 text-xs h-7"
                  onClick={() => setFlowView(!flowView)}
                >
                  <Workflow className="h-3 w-3" /> {flowView ? t("listView") : t("visualBuilder")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs h-7"
                  onClick={() => { setEnrollOpen(stepsJourney); setSelectedLead(null); setLeadSearch("") }}
                >
                  <UserPlus className="h-3 w-3" /> {t("enrollLead")}
                </Button>
              </div>
            </div>
          </DialogHeader>
          <DialogContent className="max-h-[65vh] overflow-y-auto">
            {/* Visual Flow Builder — Creatio-style workspace: info rail + canvas */}
            {flowView && (
              <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3 items-start">
                <div className="space-y-3">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("panelCampaignInfo")}</p>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">{tc("status")}</p>
                        <span className={cn("inline-flex mt-0.5 text-xs px-2.5 py-0.5 rounded-full font-medium border border-zinc-200 dark:border-zinc-700", statusColors[stepsJourney.status])}>
                          {statusLabels[stepsJourney.status] || stepsJourney.status}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tc("name")}</p>
                        <p className="font-medium truncate">{stepsJourney.name}</p>
                      </div>
                      {stepsJourney.goalType && (
                        <div>
                          <p className="text-xs text-muted-foreground">{t("goalLabel")}</p>
                          <p className="font-medium">{stepsJourney.goalType} ({stepsJourney.conversionCount || 0}/{stepsJourney.goalTarget || "∞"})</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("panelWorkflowSettings")}</p>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">{t("trigger")}</p>
                        <p className="font-medium">{triggerLabels[stepsJourney.triggerType]}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("panelParticipants")}</p>
                        <p className="font-medium">{stepsJourney.activeCount} / {stepsJourney.entryCount}</p>
                      </div>
                    </div>
                  </div>

                  {/* AI launcher — opens the existing Da Vinci assistant with journey context (Creatio campaign-agent rail) */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-gradient-to-br from-violet-500/10 to-purple-500/5 p-3.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" /> {t("aiLauncherTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground mb-2.5">{t("aiLauncherDesc")}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 text-xs"
                      onClick={() => window.dispatchEvent(new CustomEvent("davinci:open", {
                        detail: { query: t("aiJourneyPrompt", { name: stepsJourney.name }) },
                      }))}
                    >
                      <Sparkles className="h-3 w-3" /> {t("aiLauncherButton")}
                    </Button>
                  </div>
                </div>

                <JourneyFlowEditor
                  steps={stepsJourney?.steps?.map(s => ({ id: s.id, stepOrder: s.stepOrder, stepType: s.stepType, config: s.config })) || []}
                  onSave={async (newSteps) => {
                    await fetch(`/api/v1/journeys/${stepsJourney!.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: stepsJourney!.name,
                        steps: newSteps,
                      }),
                    })
                    setStepsJourney(null)
                    setFlowView(false)
                    fetchJourneys()
                  }}
                />
              </div>
            )}
            {/* Linear Steps View */}
            {!flowView && <>
            {/* Trigger node */}
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-500 text-white shrink-0">
                <Target className="h-4 w-4" />
              </div>
              <div className="flex-1 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-lg px-4 py-3">
                <span className="font-semibold text-sm text-purple-800 dark:text-purple-200">
                  {t("trigger")}: {triggerLabels[stepsJourney.triggerType]}
                </span>
              </div>
            </div>

            {/* Steps flow */}
            {steps.map((step, index) => {
              const info = getStepInfo(step.stepType, stepTypes)
              const Icon = info.icon
              const summary = getStepSummary(step, t)
              return (
                <div key={index}>
                  {/* Connector line */}
                  <div className="ml-[17px] h-5 w-0.5 bg-primary/20" />
                  {/* Step node */}
                  <div className="flex items-start gap-3">
                    <div className={cn("flex items-center justify-center w-9 h-9 rounded-full text-white shrink-0 mt-1", info.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className={cn("flex-1 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-3", info.borderColor)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">{index + 1}. {info.label}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setNewStepType(step.stepType)
                              setNewStepConfig({ ...step.config })
                              // Replace: remove old, open edit
                              removeStep(index)
                              setAddStepOpen(true)
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground"
                            title={t("edit")}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => removeStep(index)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t("entered")}: {(step as any).statsEntered || 0} · {t("passed")}: {(step as any).statsCompleted || 0}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Add step */}
            <div>
              <div className="ml-[17px] h-5 w-0.5 bg-primary/10" />
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <Plus className="h-4 w-4" />
                </div>
                <button
                  onClick={openAddStep}
                  className="flex-1 border-2 border-dashed rounded-lg px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors text-center"
                >
                  + {t("addStep")}
                </button>
              </div>
            </div>
          </>}

          {/* Enrollments Management */}
          {!flowView && (
            <EnrollmentTable journeyId={stepsJourney.id} />
          )}
          </DialogContent>
          <DialogFooter>
            {!flowView && <>
              <Button variant="outline" onClick={() => setStepsJourney(null)}>{tc("close")}</Button>
              <Button onClick={saveSteps} disabled={savingSteps} className="gap-1.5">
                {savingSteps ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {savingSteps ? tc("saving") : t("saveSteps")}
              </Button>
            </>}
          </DialogFooter>
        </Dialog>
      )}

      {/* ===== ADD STEP DIALOG ===== */}
      <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
        <DialogHeader>
          <DialogTitle>{t("addStepNumber", { number: steps.length + 1 })}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {/* Step type grid */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {stepTypes.map(st => {
              const Icon = st.icon
              const selected = newStepType === st.value
              return (
                <button
                  key={st.value}
                  onClick={() => { setNewStepType(st.value); setNewStepConfig({}) }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs font-medium transition-all",
                    selected
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-muted/50 text-muted-foreground hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {st.label}
                </button>
              )
            })}
          </div>

          {/* Step config per type */}
          <div className="space-y-3">
            {newStepType === "send_email" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("emailSubjectLabel")}</Label>
                  <Input
                    value={newStepConfig.subject || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, subject: e.target.value }))}
                    placeholder={t("emailSubjectPlaceholder")}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("emailBodyLabel")}
                  </Label>
                  <Textarea
                    value={newStepConfig.body || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, body: e.target.value }))}
                    placeholder={t("emailBodyPlaceholder")}
                    rows={4}
                  />
                </div>
              </>
            )}

            {newStepType === "sms" && (
              <div>
                <Label className="text-xs text-muted-foreground">{t("smsTextLabel")}</Label>
                <Textarea
                  value={newStepConfig.message || ""}
                  onChange={e => setNewStepConfig((c: any) => ({ ...c, message: e.target.value }))}
                  placeholder={t("smsTextPlaceholder")}
                  rows={3}
                />
              </div>
            )}

            {newStepType === "wait" && (
              <div>
                <Label className="text-xs text-muted-foreground">{t("waitDurationLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={newStepConfig.days || 1}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, days: parseInt(e.target.value) || 1 }))}
                    className="w-24"
                  />
                  <Select
                    value={newStepConfig.unit || "days"}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, unit: e.target.value }))}
                    className="flex-1"
                  >
                    <option value="hours">{t("unitHours")}</option>
                    <option value="days">{t("unitDays")}</option>
                    <option value="weeks">{t("unitWeeks")}</option>
                  </Select>
                </div>
              </div>
            )}

            {newStepType === "condition" && (
              <div className="space-y-4">
                {/* Scenario cards */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">{t("selectCondition")}</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {conditionScenarios.map(sc => {
                      const isSelected = newStepConfig._scenario === sc.id
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => setNewStepConfig({
                            _scenario: sc.id,
                            field: sc.field,
                            operator: sc.operator,
                            value: sc.value,
                            onFalse: newStepConfig.onFalse || "continue",
                          })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-3 rounded-lg border-2 text-xs transition-all text-center",
                            isSelected
                              ? "border-primary bg-primary/5 text-primary shadow-sm"
                              : "border-transparent bg-muted/40 text-muted-foreground hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-muted/60"
                          )}
                        >
                          <span className="text-lg">{sc.icon}</span>
                          <span className="font-medium leading-tight">{t(sc.labelKey)}</span>
                          <span className="text-[10px] opacity-60">{t(sc.descKey)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom fields (only show when "custom" scenario selected) */}
                {newStepConfig._scenario === "custom" && (
                  <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t("fieldLabel")}</Label>
                        <Select
                          value={newStepConfig.field || "status"}
                          onChange={e => setNewStepConfig((c: any) => ({ ...c, field: e.target.value }))}
                        >
                          {conditionFields.map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t("operatorLabel")}</Label>
                        <Select
                          value={newStepConfig.operator || "equals"}
                          onChange={e => setNewStepConfig((c: any) => ({ ...c, operator: e.target.value }))}
                        >
                          {conditionOperators.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                        </Select>
                      </div>
                    </div>
                    {newStepConfig.operator !== "not_empty" && (
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{tc("value")}</Label>
                        <Input
                          value={newStepConfig.value || ""}
                          onChange={e => setNewStepConfig((c: any) => ({ ...c, value: e.target.value }))}
                          placeholder="new, qualified, website..."
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* What to do if condition is FALSE */}
                <div className="p-3 bg-red-50/50 dark:bg-red-900/10 rounded-lg border border-red-200/50 dark:border-red-800/30">
                  <Label className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5 mb-2">
                    <X className="h-3.5 w-3.5" /> {t("conditionFalseLabel")}:
                  </Label>
                  <Select
                    value={newStepConfig.onFalse || "continue"}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, onFalse: e.target.value }))}
                  >
                    {conditionActions.map(a => <option key={a.value} value={a.value}>{t(a.labelKey)}</option>)}
                  </Select>
                </div>
              </div>
            )}

            {newStepType === "create_task" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("taskTitleLabel")}</Label>
                  <Input
                    value={newStepConfig.title || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, title: e.target.value }))}
                    placeholder={t("taskTitlePlaceholder")}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tc("description")}</Label>
                  <Textarea
                    value={newStepConfig.description || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, description: e.target.value }))}
                    placeholder={t("taskDescPlaceholder")}
                    rows={2}
                  />
                </div>
              </>
            )}

            {newStepType === "send_telegram" && (
              <div>
                <Label className="text-xs text-muted-foreground">{t("telegramMsgLabel")}</Label>
                <Textarea
                  value={newStepConfig.message || ""}
                  onChange={e => setNewStepConfig((c: any) => ({ ...c, message: e.target.value }))}
                  placeholder={t("messagePlaceholder")}
                  rows={3}
                />
              </div>
            )}

            {newStepType === "send_whatsapp" && (
              <div>
                <Label className="text-xs text-muted-foreground">{t("whatsappMsgLabel")}</Label>
                <Textarea
                  value={newStepConfig.message || ""}
                  onChange={e => setNewStepConfig((c: any) => ({ ...c, message: e.target.value }))}
                  placeholder={t("messagePlaceholder")}
                  rows={3}
                />
              </div>
            )}

            {newStepType === "update_field" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("fieldLabel")}</Label>
                  <Select
                    value={newStepConfig.field || "lead_status"}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, field: e.target.value }))}
                  >
                    {conditionFields.map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("newValueLabel")}</Label>
                  <Input
                    value={newStepConfig.value || ""}
                    onChange={e => setNewStepConfig((c: any) => ({ ...c, value: e.target.value }))}
                    placeholder="qualified"
                  />
                </div>
              </>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddStepOpen(false)}>{tc("cancel")}</Button>
          <Button onClick={confirmAddStep}>{tc("add")}</Button>
        </DialogFooter>
      </Dialog>

      {/* ===== ENROLL LEAD DIALOG ===== */}
      <Dialog open={!!enrollOpen} onOpenChange={open => { if (!open) { setEnrollOpen(null); setSelectedLead(null); setLeadSearch("") } }}>
        <DialogHeader>
          <DialogTitle>{t("enrollLead")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-3">
            {t("title")}: <strong>{enrollOpen?.name}</strong>
          </p>

          {/* Selected lead chip */}
          {selectedLead && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg mb-3">
              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{selectedLead.contactName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[selectedLead.email, selectedLead.companyName].filter(Boolean).join(" · ") || t("noEmail")}
                </p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-800 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Search input */}
          {!selectedLead && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t("searchByNameEmailCompany")}</Label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={leadSearch}
                  onChange={e => setLeadSearch(e.target.value)}
                  placeholder={t("searchLeadPlaceholder")}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {/* Leads list */}
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg max-h-[240px] overflow-y-auto">
                {leadsLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t("loadingLeads")}
                  </div>
                ) : filteredLeads.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {leadSearch ? t("noResults") : t("noLeadsAvailable")}
                  </div>
                ) : (
                  filteredLeads.map(lead => (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left border-b last:border-b-0"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0 text-xs font-semibold">
                        {lead.contactName?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{lead.contactName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[lead.email, lead.companyName].filter(Boolean).join(" · ") || t("noData")}
                        </p>
                      </div>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                        lead.status === "new" ? "bg-blue-100 text-blue-700" :
                        lead.status === "qualified" ? "bg-green-100 text-green-700" :
                        lead.status === "contacted" ? "bg-yellow-100 text-yellow-700" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {lead.status === "new" ? t("leadStatusNew") :
                         lead.status === "qualified" ? t("leadStatusQualified") :
                         lead.status === "contacted" ? t("leadStatusContacted") :
                         lead.status === "converted" ? t("leadStatusConverted") :
                         lead.status === "lost" ? t("leadStatusLost") : lead.status}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("leadsCount", { filtered: filteredLeads.length, total: leads.length })}
              </p>
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEnrollOpen(null); setSelectedLead(null); setLeadSearch("") }}>{tc("cancel")}</Button>
          <Button onClick={handleEnroll} disabled={enrolling || !selectedLead} className="gap-1.5">
            {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t("enrollButton")}
          </Button>
        </DialogFooter>
      </Dialog>

      <JourneyForm
        open={showForm}
        onOpenChange={open => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchJourneys}
        initialData={editData}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={open => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteJourney")}
        itemName={deleteName}
      />
    </div>
  )
}
