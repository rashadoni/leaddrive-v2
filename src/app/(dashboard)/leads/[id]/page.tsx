"use client"

import { useRouter, useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { useCategoryLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { LeadForm } from "@/components/lead-form"
import { LeadConvertDialog } from "@/components/lead-convert-dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { ColorStatCard } from "@/components/color-stat-card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
  ArrowLeft, Pencil, Trash2, ArrowRight, Loader2,
  Mail, Phone, Building2, User, FileText, Globe,
  TrendingUp, Calendar, DollarSign, Flame, CheckCircle2,
  Brain, Sparkles, Copy, Send, RefreshCw, CheckCircle,
  Activity as ActivityIcon, Plus, MessageSquare, Zap,
} from "lucide-react"
import { EnrollInSequenceDialog } from "@/components/sequences/enroll-in-sequence-dialog"
import { useLocale } from "next-intl"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { getLeadScoreFactorLabel } from "@/lib/leads/score-factor-labels"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/info-hint"
import { InteractionTimeline } from "@/components/interaction-timeline"
import { ClickToCallButton } from "@/components/call-widget"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { HelpButton } from "@/components/help/help-button"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { LeadOverview, LeadStatBoxes, LeadEvaluationCard, useLeadTimelineStats } from "@/components/leads/lead-overview"
import { LeadCallAnalytics } from "@/components/leads/lead-call-analytics"
import { LeadAiCallAction } from "@/components/leads/lead-ai-call-action"
import { LeadManualCallAction } from "@/components/leads/lead-manual-call-action"
import { LeadBrowserCallAction } from "@/components/leads/lead-browser-call-action"
import { LeadVoicePermission } from "@/components/leads/lead-voice-permission"
import { CollapsibleSection } from "@/components/crm/collapsible-section"
import { CustomerDetailsCards } from "@/components/crm/customer-details-cards"

// Shared between the timeline icon lookup AND the Add Activity Type select options.
// Order here defines the order in the Select dropdown.
const ACTIVITY_TYPES = [
  { value: "note",    icon: "📝", label: "Note" },
  { value: "call",    icon: "📞", label: "Call" },
  { value: "email",   icon: "📧", label: "Email" },
  { value: "meeting", icon: "🤝", label: "Meeting" },
  { value: "task",    icon: "✅", label: "Task" },
  { value: "other",   icon: "📌", label: "Other" },
] as const

const ACTIVITY_TYPE_ICONS: Record<string, string> = Object.fromEntries(
  ACTIVITY_TYPES.map(t => [t.value, t.icon])
)

interface Lead {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  phoneWhatsApp: string | null
  telegramHandle: string | null
  source: string | null
  sourceDetail: string | null
  sourceProfileUrl: string | null
  interest: string | null
  brand: string | null
  category: string | null
  status: string
  priority: string
  score: number
  scoreDetails: any
  estimatedValue: number | null
  notes: string | null
  customerStage: string | null
  salesCallOutcomes: string[]
  customerStageReason: string | null
  customerStageUpdatedAt: string | null
  customerStageUpdatedBy: string | null
  assignedTo: string | null
  assignedToName: string | null
  pipelineId: string | null
  pipeline: { name: string } | null
  convertedAt: string | null
  lastScoredAt: string | null
  createdAt: string
  updatedAt: string
}

const STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const
const SALES_CALL_STAGES = [
  "sales_contacted",
  "interested",
  "potential",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
] as const
type SalesCallStage = (typeof SALES_CALL_STAGES)[number]

const SALES_CALL_EXCLUSIVE_GROUPS: SalesCallStage[][] = [
  ["sales_contacted", "unable_to_contact"],
  ["sold", "not_sold", "no_result"],
]

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

function getGrade(score: number): { letter: string; color: string } {
  if (score >= 80) return { letter: "A", color: "bg-green-500 text-white" }
  if (score >= 60) return { letter: "B", color: "bg-blue-500 text-white" }
  if (score >= 40) return { letter: "C", color: "bg-yellow-500 text-white" }
  if (score >= 20) return { letter: "D", color: "bg-orange-500 text-white" }
  return { letter: "F", color: "bg-red-500 text-white" }
}

export default function LeadDetailPage() {
  const t = useTranslations("leads")
  const tc = useTranslations("common")
  const categoryLabel = useCategoryLabel("common", ["vip", "regular", "partner", "prospect", "inactive"])
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showConvert, setShowConvert] = useState(false)
  const [showEnroll, setShowEnroll] = useState(false)
  const [activeTab, setActiveTab] = useState("details")
  const [salesCallOutcomes, setSalesCallOutcomes] = useState<SalesCallStage[]>([])
  const [salesCallReport, setSalesCallReport] = useState("")
  const [savingSalesCall, setSavingSalesCall] = useState(false)

  // Da Vinci state
  const [aiLoading, setAiLoading] = useState(false)
  const [sentiment, setSentiment] = useState<any>(null)
  const [aiTasks, setAiTasks] = useState<any>(null)
  const [creatingTasks, setCreatingTasks] = useState(false)
  const [tasksCreated, setTasksCreated] = useState(false)
  const [textType, setTextType] = useState("Email")
  const [topic, setTopic] = useState("welcome")
  const [tone, setTone] = useState("professional")
  const [instructions, setInstructions] = useState("")
  const [generatedText, setGeneratedText] = useState<any>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState("")
  const [scoring, setScoring] = useState(false)
  // WhatsApp template picker state (phase 4)
  type WaTemplate = { id: string; name: string; language: string; category: string; status: string; bodyText: string | null; variables: string[] }
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([])
  const [waTemplatesLoading, setWaTemplatesLoading] = useState(false)
  const [waSelectedTemplate, setWaSelectedTemplate] = useState<string>("")
  const [waVariables, setWaVariables] = useState<Record<string, string>>({})

  const { isVisible, isEditable } = useFieldPermissions("lead")
  const id = params.id as string
  const orgId = session?.user?.organizationId
  const timelineStats = useLeadTimelineStats(id, orgId ? String(orgId) : undefined)
  const locale = useLocale()

  // Notes inline-edit state
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [assignees, setAssignees] = useState<{ id: string; name: string | null; email: string }[]>([])
  const [savingAssignee, setSavingAssignee] = useState(false)

  const startEditNotes = () => {
    setNotesDraft(lead?.notes ?? "")
    setEditingNotes(true)
  }
  const cancelEditNotes = () => {
    setEditingNotes(false)
    setNotesDraft("")
  }
  const saveNotes = async () => {
    if (!lead) return
    const next = notesDraft.trim() === "" ? null : notesDraft
    if (next === (lead.notes ?? null)) {
      setEditingNotes(false)
      return
    }
    setSavingNotes(true)
    try {
      const res = await fetch(`/api/v1/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({ notes: next }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || t("notesSaveFailed")
        toast.error(msg)
        return
      }
      toast.success(t("notesSaved"))
      setEditingNotes(false)
      await fetchLead()
    } catch {
      toast.error(t("notesSaveFailed"))
    } finally {
      setSavingNotes(false)
    }
  }

  // Activities tab state
  const [activities, setActivities] = useState<any[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [savingActivity, setSavingActivity] = useState(false)
  const [activityForm, setActivityForm] = useState<{ type: string; subject: string; description: string }>({
    type: "note", subject: "", description: "",
  })

  // Stable fetcher — useCallback so its identity doesn't churn the effect deps.
  // AbortController guards against rapid tab toggling races (stale response
  // overwriting newer state).
  const fetchActivities = useCallback(async (signal?: AbortSignal) => {
    setActivitiesLoading(true)
    try {
      const res = await fetch(`/api/v1/activities?relatedType=lead&relatedId=${encodeURIComponent(id)}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        signal,
      })
      const json = await res.json()
      if (signal?.aborted) return
      if (json.success) setActivities(json.data?.activities || [])
    } catch (err: any) {
      if (err?.name === "AbortError") return
      console.error(err)
    } finally {
      if (!signal?.aborted) setActivitiesLoading(false)
    }
  }, [id, orgId])

  // Reload activities when user switches to the tab; abort in-flight on tab change
  useEffect(() => {
    if (activeTab !== "activities" || !id) return
    const ctrl = new AbortController()
    fetchActivities(ctrl.signal)
    return () => ctrl.abort()
  }, [activeTab, id, fetchActivities])

  const handleAddActivity = async () => {
    if (!activityForm.subject.trim()) {
      toast.error(t("activitySubjectRequired"))
      return
    }
    setSavingActivity(true)
    try {
      const res = await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          type: activityForm.type,
          subject: activityForm.subject.trim(),
          description: activityForm.description.trim() || undefined,
          relatedType: "lead",
          relatedId: id,
        }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || `Failed (${res.status})`
        toast.error(msg)
        return
      }
      toast.success(t("activityAdded"))
      setShowAddActivity(false)
      setActivityForm({ type: "note", subject: "", description: "" })
      fetchActivities()
    } catch {
      toast.error(t("activityNetworkError"))
    } finally {
      setSavingActivity(false)
    }
  }

  // (activity type icons live at module scope as ACTIVITY_TYPE_ICONS)

  const statusLabels: Record<string, string> = {
    new: t("statusNew"),
    contacted: t("statusContacted"),
    qualified: t("statusQualified"),
    converted: t("statusConverted"),
    lost: t("statusLost"),
  }

  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"),
    medium: t("priorityMedium"),
    high: t("priorityHigh"),
  }

  const sourceLabels: Record<string, string> = {
    website: t("sourceWebsite"),
    referral: t("sourceReferral"),
    cold_call: t("sourceColdCall"),
    linkedin: t("sourceLinkedin"),
    tiktok: "TikTok",
    facebook: "Facebook",
    instagram: "Instagram",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    vkontakte: "VKontakte",
    sms: "SMS",
    "web-chat": "Web Chat",
    email: t("sourceEmail"),
    event: t("sourceEvent"),
    other: t("sourceOther"),
  }

  // Loaded once for the reassignment picker. The rest of the lead page must
  // still render if the roster cannot be read — but a failed load must not look
  // like an empty team. It did: the request was turned into `[]`, leaving a
  // picker whose only remaining option was "unassigned", so the control offered
  // to STRIP the lead's owner and called it reassignment.
  const [assigneesFailed, setAssigneesFailed] = useState(false)
  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/users", { headers: { "x-organization-id": String(orgId) } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((j) => {
        setAssignees(Array.isArray(j?.data) ? j.data : [])
        setAssigneesFailed(false)
      })
      .catch(() => setAssigneesFailed(true))
  }, [orgId])

  const reassignLead = async (nextAssignee: string) => {
    setSavingAssignee(true)
    try {
      const res = await fetch(`/api/v1/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        // Empty means unassigned, and null is what the API takes for that.
        body: JSON.stringify({ assignedTo: nextAssignee || null }),
      })
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({})))?.error || tc("saveFailed"))
        return
      }
      await fetchLead()
    } finally {
      setSavingAssignee(false)
    }
  }

  const fetchLead = async () => {
    try {
      const res = await fetch(`/api/v1/leads/${id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setLead(json.data)
        setSalesCallOutcomes(
          Array.isArray(json.data.salesCallOutcomes) && json.data.salesCallOutcomes.length > 0
            ? json.data.salesCallOutcomes
            : (json.data.customerStage ? [json.data.customerStage] : []),
        )
        setSalesCallReport(json.data.customerStageReason ?? "")
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Depends on WHO is signed in, never on the session object.
  //
  // `session` is a fresh object on every read next-auth performs — on mount, on
  // its poll, and on every visibilitychange, i.e. every time the seller switches
  // to another window and comes back. Each of those re-ran this effect, and
  // fetchLead() ends with setSalesCallReport(...), which is the value of the
  // call-report textarea. So a seller typing up a call lost it by alt-tabbing to
  // check the customer's number.
  //
  // orgId is a string, so it is stable across those reads; the layout already
  // holds the page unmounted until the session is authenticated.
  useEffect(() => {
    if (id && orgId) fetchLead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])

  const handleStatusChange = async (newStatus: string) => {
    if (!lead || lead.status === newStatus || updatingStatus) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/v1/leads/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (json.success) {
        setLead(json.data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setUpdatingStatus(false)
    }
  }

  const saveSalesCallReport = async () => {
    if (!lead || salesCallOutcomes.length === 0 || savingSalesCall) return
    if (!salesCallReport.trim()) {
      toast.error(t("salesCallReportRequired"))
      return
    }
    setSavingSalesCall(true)
    try {
      const res = await fetch(`/api/v1/leads/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          salesCallOutcomes,
          customerStageReason: salesCallReport.trim(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        toast.error(
          json.code === "phone_required"
            ? t("salesCallPhoneRequired")
            : json.code === "sales_assignee_required"
              ? t("salesCallAssignedSellerOnly")
              : (json.error || t("salesCallSaveFailed")),
        )
        return
      }
      setLead(json.data)
      setSalesCallOutcomes(
        Array.isArray(json.data.salesCallOutcomes) && json.data.salesCallOutcomes.length > 0
          ? json.data.salesCallOutcomes
          : (json.data.customerStage ? [json.data.customerStage] : []),
      )
      setSalesCallReport(json.data.customerStageReason ?? "")
      toast.success(json.meta?.inboxConversationsUpdated > 0
        ? t("salesCallSavedAndSynced", { count: json.meta.inboxConversationsUpdated })
        : t("salesCallSaved"))
    } catch {
      toast.error(t("salesCallSaveFailed"))
    } finally {
      setSavingSalesCall(false)
    }
  }

  const toggleSalesCallOutcome = (stage: SalesCallStage) => {
    setSalesCallOutcomes((current) => {
      if (current.includes(stage)) return current.filter((item) => item !== stage)
      const exclusiveGroup = SALES_CALL_EXCLUSIVE_GROUPS.find((group) => group.includes(stage))
      const withoutConflicts = exclusiveGroup
        ? current.filter((item) => !exclusiveGroup.includes(item))
        : current
      return SALES_CALL_STAGES.filter((item) => [...withoutConflicts, stage].includes(item))
    })
  }

  const handleDelete = async () => {
    await fetch(`/api/v1/leads/${id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    router.push("/leads")
  }

  // Da Vinci helper
  const callAI = async (action: string, options?: any) => {
    setAiLoading(true)
    try {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({ action, leadId: id, options, locale }),
      })
      const json = await res.json()
      if (json.success) return json.data
    } catch (err) { console.error(err) } finally { setAiLoading(false) }
    return null
  }

  const createAllTasks = async () => {
    if (!aiTasks?.tasks?.length) return
    setCreatingTasks(true)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)
      for (const task of aiTasks.tasks) {
        await fetch("/api/v1/tasks", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            priority: (task.priority || "medium").toLowerCase(),
            dueDate: task.dueDate || undefined,
            relatedType: "lead",
            relatedId: id,
          }),
        })
      }
      setTasksCreated(true)
    } catch (err) { console.error(err) } finally { setCreatingTasks(false) }
  }

  const scoreWithAI = async () => {
    setScoring(true)
    try {
      await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ leadId: id, locale }),
      })
      await fetchLead()
    } catch (err) { console.error(err) } finally { setScoring(false) }
  }

  // Map the selected Da Vinci text type → inbox channel + destination address.
  // Email is the only channel that uses the `subject` field; all messaging
  // channels (SMS / WhatsApp / Telegram) reuse the same `body` payload.
  // Each channel reads from its own dedicated lead field and falls back to
  // the primary `phone` where that makes sense (WhatsApp on same number).
  type ChannelKey = "email" | "sms" | "whatsapp" | "telegram"
  const resolveDestination = (type: string, l: Lead): { channel: ChannelKey; to: string | null } => {
    switch (type) {
      case "SMS":      return { channel: "sms",      to: l.phone }
      case "WhatsApp": return { channel: "whatsapp", to: l.phoneWhatsApp || l.phone }
      case "Telegram": return { channel: "telegram", to: l.telegramHandle }
      case "Email":
      default:         return { channel: "email",    to: l.email }
    }
  }

  // Fetch approved WhatsApp templates when the user switches to WhatsApp
  // channel for the first time. Meta requires a pre-approved template to
  // send outside the 24h customer service window — which, for a cold lead,
  // is always. The picker below renders empty-state with a link to
  // /settings/channels/whatsapp/templates when this list is empty.
  useEffect(() => {
    if (textType !== "WhatsApp" || waTemplates.length > 0 || waTemplatesLoading) return
    setWaTemplatesLoading(true)
    fetch("/api/v1/whatsapp/templates?status=APPROVED", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(j => { if (j.success) setWaTemplates(j.data as WaTemplate[]) })
      .catch(() => {})
      .finally(() => setWaTemplatesLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textType])

  // Reset variable inputs when the template selection changes.
  useEffect(() => {
    if (!waSelectedTemplate) { setWaVariables({}); return }
    const tpl = waTemplates.find(t => t.id === waSelectedTemplate)
    if (!tpl) return
    setWaVariables(Object.fromEntries(tpl.variables.map(v => [v, ""])))
  }, [waSelectedTemplate, waTemplates])

  const [waAiSuggesting, setWaAiSuggesting] = useState(false)
  const suggestWaVariables = async () => {
    if (!lead || !waSelectedTemplate) return
    const tpl = waTemplates.find(t => t.id === waSelectedTemplate)
    if (!tpl || tpl.variables.length === 0) return
    setWaAiSuggesting(true)
    try {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          action: "whatsapp_fill_template",
          leadId: lead.id,
          locale: "ru",
          options: {
            variables: tpl.variables,
            templateName: tpl.name,
            templateBody: tpl.bodyText || "",
          },
        }),
      })
      const json = await res.json()
      if (json?.success && json.data?.variables) {
        setWaVariables(prev => ({ ...prev, ...json.data.variables }))
      }
    } catch { /* silent */ } finally {
      setWaAiSuggesting(false)
    }
  }

  const sendWaTemplate = async () => {
    if (!lead) return
    const tpl = waTemplates.find(t => t.id === waSelectedTemplate)
    if (!tpl) return
    const to = lead.phoneWhatsApp || lead.phone
    if (!to) { setSendError(t("waNoPhone")); return }
    setSending(true)
    setSendError("")
    try {
      const res = await fetch("/api/v1/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          to,
          templateName: tpl.name,
          languageCode: tpl.language,
          variables: waVariables,
          leadId: lead.id,
        }),
      })
      const json = await res.json()
      if (json.success) { setSent(true) } else { setSendError(json.error || tc("errorSendFailed")) }
    } catch (err: any) {
      setSendError(err?.message || tc("errorNetwork"))
    } finally {
      setSending(false)
    }
  }

  // Render a template body with variable placeholders substituted. Supports
  // positional ({{1}}..{{N}}) and named ({{param_name}}) Meta placeholders.
  const renderTemplatePreview = (body: string | null | undefined, vars: Record<string, string>): string => {
    if (!body) return ""
    return body.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] || `{{${key}}}`)
  }

  const sendGenerated = async () => {
    if (!generatedText || !lead) return
    const { channel, to } = resolveDestination(textType, lead)
    if (!to) return
    setSending(true)
    setSendError("")
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(
          channel === "email"
            ? { channel: "email", to, subject: generatedText.subject, body: generatedText.body, leadId: lead.id }
            : { channel, to, body: generatedText.body, leadId: lead.id }
        ),
      })
      const json = await res.json()
      if (json.success) { setSent(true) } else { setSendError(json.error || tc("errorSendFailed")) }
    } catch (err) { setSendError(tc("errorNetwork")) } finally { setSending(false) }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
        <div className="h-16 bg-muted rounded-lg animate-pulse" />
        <div className="h-96 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="icon" onClick={() => router.push("/leads")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">{t("detailNotFound")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const normalizedScore = Math.min(100, Math.max(0, Math.round(lead.score || 0)))
  const grade = getGrade(normalizedScore)
  // "Never calculated" and "calculated as worthless" used to render identically
  // as 0/100 (F) — the card asserting a judgement nobody had made. A lead is
  // scored the moment it is created now, so an unstamped one is genuinely a
  // lead the scorer has not reached, and it should say so.
  const isScored = Boolean(lead.lastScoredAt)
  const scoreDisplay = isScored ? `${normalizedScore}/100 (${grade.letter})` : "—"
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / 86400000
  )
  const rawConversionProb = (lead.scoreDetails as any)?.conversionProb ?? Math.round(normalizedScore * 0.85)
  const conversionProb = Math.min(100, Math.max(0, Math.round(Number(rawConversionProb) || 0)))
  const role = session?.user?.role ?? ""
  const canOverrideSalesReport = ["admin", "manager", "superadmin"].includes(role)
  const canReportSalesCall = canOverrideSalesReport
    || (role === "sales" && lead.assignedTo === session?.user?.id)
  // Handing a lead to a different seller is a management decision, so it uses
  // the same set of roles that may override a sales report. A seller moving
  // their own lead off their plate is exactly what this must not allow.
  const canReassign = canOverrideSalesReport

  return (
    <div className="space-y-6">
      {/* Header */}
      {/* Title on its own line, actions on theirs.
       *
       * These used to sit side by side on lg. The title had `flex-1 min-w-0`,
       * so it was allowed to shrink to nothing, while the row of actions was
       * not — seven buttons with Azerbaijani labels take the whole width, the
       * title collapsed behind them, and the lead's first name disappeared:
       * "Azar Aliyev" rendered as "Aliyev".
       *
       * Giving the title a minimum width would only move the failure to the
       * next label that grows. Nothing here is wide enough to share a line
       * honestly, so they stop sharing one. */}
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button className="shrink-0" variant="ghost" size="icon" onClick={() => router.push("/leads")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xl">
                {lead.contactName
                  .split(" ")
                  .map((n: string) => n[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="flex min-w-0 flex-wrap items-center gap-2 break-words text-2xl font-bold">{lead.contactName} <HelpButton slug="lead-detail" variant="label" /></h1>
                  <Badge className={cn("text-xs", statusColors[lead.status])}>
                    {statusLabels[lead.status] || lead.status}
                  </Badge>
                  <Badge className={cn("text-xs", priorityColors[lead.priority])}>
                    {priorityLabels[lead.priority] || lead.priority}
                  </Badge>
                </div>
                {lead.companyName && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Building2 className="h-3.5 w-3.5" /> {lead.companyName}
                  </p>
                )}
                {lead.email && (
                  <p className="text-xs text-muted-foreground mt-0.5">{lead.email}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Wraps within its own line. Left-aligned rather than right: a set
         * that wraps to two rows reads as a ragged edge when pushed right. */}
        <div className="flex w-full flex-wrap items-center gap-2">
          <LeadAiCallAction
            leadId={lead.id}
            organizationId={orgId ? String(orgId) : undefined}
          />
          {/* viewer and ticketing have no voip:write — showing them a button
              that is guaranteed to 403 is worse than showing nothing. */}
          {!["viewer", "ticketing"].includes(role) && (
            <>
              <LeadManualCallAction leadId={lead.id} phone={lead.phone} />
              {/* Renders nothing until this organisation is in the rollout. */}
              <LeadBrowserCallAction leadId={lead.id} phone={lead.phone} />
            </>
          )}
          {lead.status !== "converted" && (
            <Button
              variant="outline"
              className="gap-1.5 text-green-600 hover:text-green-700 hover:border-green-300"
              onClick={() => setShowConvert(true)}
            >
              <ArrowRight className="h-4 w-4" />
              {t("modalConvertToDeal")}
            </Button>
          )}
          <Button variant="outline" className="gap-1.5" onClick={() => setShowEnroll(true)}>
            <Zap className="h-4 w-4" />
            {t("addToSequence")}
          </Button>
          <Button variant="outline" onClick={() => setShowForm(true)}>
            <Pencil className="h-4 w-4" />
            {tc("edit")}
          </Button>
          <Button
            variant="ghost"
            className="text-red-500 hover:text-red-700"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            {tc("delete")}
          </Button>
        </div>
      </div>

      {/* Status pipeline bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-1">
            {STATUSES.map((status, idx) => {
              const currentIdx = STATUSES.indexOf(lead.status as typeof STATUSES[number])
              const isActive = idx <= currentIdx
              const isCurrent = status === lead.status
              const isLost = lead.status === "lost"

              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  disabled={updatingStatus}
                  className={cn(
                    "flex-1 py-2.5 px-3 text-xs font-medium rounded-md transition-all relative",
                    "hover:opacity-80 disabled:opacity-50",
                    isCurrent
                      ? isLost
                        ? "bg-red-500 text-white shadow-sm"
                        : status === "converted"
                          ? "bg-green-500 text-white shadow-sm"
                          : "bg-primary text-primary-foreground shadow-sm"
                      : isActive && !isLost
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {statusLabels[status]}
                  {isCurrent && updatingStatus && (
                    <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2" />
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Two-column workspace: overview and AI context stay together on the
          left, leaving the main working area as wide as possible. */}
      <div className={cn(
        "grid grid-cols-1 gap-4 items-start",
        "[grid-template-areas:'main'_'overview']",
        "lg:grid-cols-[290px_minmax(0,1fr)] lg:[grid-template-areas:'overview_main']",
      )}>
        <div className="space-y-4 [grid-area:overview] min-w-0">
          <LeadOverview
            lead={lead}
            stats={timelineStats}
            priorityLabel={priorityLabels[lead.priority] || lead.priority}
            priorityClass={priorityColors[lead.priority] || ""}
            sourceLabel={lead.source ? (sourceLabels[lead.source] || lead.source) : null}
          />
          <LeadVoicePermission
            key={`${lead.id}:${lead.updatedAt}`}
            leadId={lead.id}
            organizationId={orgId ? String(orgId) : undefined}
          />
          <Card>
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-primary" />
                {t("salesCallTitle")}
              </CardTitle>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {canReportSalesCall ? t("salesCallHint") : t("salesCallReadOnly")}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{t("salesCallResult")}</Label>
                  {salesCallOutcomes.length > 0 && (
                    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                      {t("salesCallSelectedCount", { count: salesCallOutcomes.length })}
                    </span>
                  )}
                </div>
                <div className="grid gap-1.5" role="group" aria-label={t("salesCallResult")}>
                  {SALES_CALL_STAGES.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      aria-pressed={salesCallOutcomes.includes(stage)}
                      disabled={savingSalesCall || !canReportSalesCall}
                      onClick={() => toggleSalesCallOutcome(stage)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        salesCallOutcomes.includes(stage)
                          ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-muted/40",
                        (savingSalesCall || !canReportSalesCall) && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        salesCallOutcomes.includes(stage)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/35 bg-background",
                      )}>
                        {salesCallOutcomes.includes(stage) && <CheckCircle className="h-3 w-3" />}
                      </span>
                      <span>{t(`customerStage_${stage}`)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {t("salesCallMultiSelectHint")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sales-call-report" className="text-xs">{t("salesCallReport")}</Label>
                <Textarea
                  id="sales-call-report"
                  value={salesCallReport}
                  onChange={(event) => setSalesCallReport(event.target.value)}
                  placeholder={t("salesCallReportPlaceholder")}
                  rows={3}
                  maxLength={2000}
                  disabled={savingSalesCall || !canReportSalesCall}
                />
              </div>
              {canReportSalesCall && (
                <Button
                  type="button"
                  className="w-full"
                  onClick={saveSalesCallReport}
                  disabled={salesCallOutcomes.length === 0 || savingSalesCall}
                >
                  {savingSalesCall && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {savingSalesCall ? t("salesCallSaving") : t("salesCallSave")}
                </Button>
              )}
              {lead.customerStageUpdatedAt && (
                <p className="text-[11px] text-muted-foreground">
                  {t("salesCallLastUpdated", { date: formatDate(lead.customerStageUpdatedAt, locale) })}
                </p>
              )}
            </CardContent>
          </Card>
          <AdvisorRecordWidget entityType="lead" entityId={id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />
          <LeadEvaluationCard
            score={isScored ? normalizedScore : null}
            factors={(lead.scoreDetails as any)?.factors ?? null}
            converted={lead.status === "converted"}
            onConvert={() => setShowConvert(true)}
            convertLabel={t("modalConvertToDeal")}
          />
        </div>

        <div className="space-y-6 [grid-area:main] min-w-0">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard
          label={t("detailScoreGrade")}
          value={scoreDisplay}
          icon={<TrendingUp className="h-4 w-4" />}
         
          hint={t("hintColScore")}
        />
        <ColorStatCard
          label={t("detailDaysSinceCreated")}
          value={`${daysSinceCreated} ${t("modalDays")}`}
          icon={<Calendar className="h-4 w-4" />}
         
        />
        {isVisible("estimatedValue") && (
          <ColorStatCard
            label={t("modalEstimatedValue")}
            value={lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : "---"}
            icon={<DollarSign className="h-4 w-4" />}
           
          />
        )}
        <ColorStatCard
          label={t("modalPriority")}
          value={priorityLabels[lead.priority] || lead.priority}
          icon={<Flame className="h-4 w-4" />}
          hint={t("hintColPriority")}
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-x-1 border-b">
        {[
          { id: "details", label: t("modalDetails") || "Details" },
          { id: "activities", label: t("modalActivities") },
          { id: "timeline", label: tc("timelineTab") },
          { id: "sentiment", label: t("modalSentiment") || "Sentiment" },
          { id: "tasks", label: t("modalTasks") || "Tasks" },
          { id: "aitext", label: t("modalAiText") || "Da Vinci Text" },
          { id: "ai", label: t("modalAiScoring") || "Da Vinci Scoring" },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.id === "activities" && <ActivityIcon className="h-3.5 w-3.5 inline mr-1.5" />}
            {tab.id === "sentiment" && <Brain className="h-3.5 w-3.5 inline mr-1.5" />}
            {tab.id === "tasks" && <Sparkles className="h-3.5 w-3.5 inline mr-1.5" />}
            {tab.id === "aitext" && <Mail className="h-3.5 w-3.5 inline mr-1.5" />}
            {tab.id === "ai" && <TrendingUp className="h-3.5 w-3.5 inline mr-1.5" />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Details (Creatio Overview: Lead details + Customer details + Lead Info) */}
      {activeTab === "details" && (
      <div className="space-y-4">
      {/* Lead details — stat boxes, as in the Creatio reference */}
      <CollapsibleSection title={t("leadDetailsSection")}>
        <LeadStatBoxes stats={timelineStats} createdAt={lead.createdAt} />
      </CollapsibleSection>

      <LeadCallAnalytics
        leadId={lead.id}
        organizationId={orgId ? String(orgId) : undefined}
      />

      {/* Customer details — contact + company cards; honor field permissions */}
      <CollapsibleSection title={t("customerDetails")}>
        <CustomerDetailsCards
          person={{
            name: lead.contactName,
            subtitle: lead.companyName,
            email: isVisible("email") ? lead.email : null,
            phone: isVisible("phone") ? lead.phone : null,
          }}
          company={lead.companyName ? { name: lead.companyName } : null}
        />
      </CollapsibleSection>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1.5">{t("modalLeadInfo")} <InfoHint text={t("hintColContact")} size={14} /></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t("modalContactName")}:</span>
              <span className="font-medium">{lead.contactName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t("modalCompany")}:</span>
              <span className="font-medium">{lead.companyName || "---"}</span>
            </div>
            {isVisible("email") && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">{tc("email")}:</span>
                {lead.email ? (
                  <a href={`mailto:${lead.email}`} className="font-medium text-primary hover:underline">
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">---</span>
                )}
              </div>
            )}
            {isVisible("phone") && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">{t("modalPhone")}:</span>
                {lead.phone ? (
                  <a href={`tel:${lead.phone}`} className="font-medium text-primary hover:underline">
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">---</span>
                )}
                {lead.phone && <ClickToCallButton phone={lead.phone} leadId={lead.id} contactName={lead.contactName} />}
              </div>
            )}
            {lead.phoneWhatsApp && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span className="text-muted-foreground">WhatsApp:</span>
                <a href={`https://wa.me/${lead.phoneWhatsApp.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                  {lead.phoneWhatsApp}
                </a>
              </div>
            )}
            {lead.telegramHandle && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-sky-500 flex-shrink-0" />
                <span className="text-muted-foreground">Telegram:</span>
                <a
                  href={lead.telegramHandle.startsWith("@") ? `https://t.me/${lead.telegramHandle.slice(1)}` : `https://t.me/${lead.telegramHandle}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {lead.telegramHandle}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t("modalSource")}:</span>
              <span className="font-medium">
                {lead.source ? (sourceLabels[lead.source] || lead.source) : "---"}
              </span>
              <InfoHint text={t("hintColSource")} size={12} />
            </div>
            {lead.sourceDetail && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("sourceDetail")}:</span>
                <span className="font-medium">{lead.sourceDetail}</span>
              </div>
            )}
            {lead.sourceProfileUrl && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("sourceProfileUrl")}:</span>
                <a
                  href={lead.sourceProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[28rem] truncate font-medium text-primary hover:underline"
                >
                  {lead.sourceProfileUrl}
                </a>
              </div>
            )}
            {lead.brand && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Brand:</span>
                <span className="font-medium">{lead.brand}</span>
              </div>
            )}
            {(lead.pipeline?.name || lead.category) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{tc("category")}:</span>
                <span className="font-medium">
                  {lead.pipeline?.name || categoryLabel(lead.category)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{tc("assignee")}:</span>
              {canReassign && !assigneesFailed ? (
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm font-medium disabled:opacity-60"
                  value={lead.assignedTo ?? ""}
                  disabled={savingAssignee}
                  onChange={(e) => void reassignLead(e.target.value)}
                >
                  <option value="">{tc("unassigned")}</option>
                  {assignees.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              ) : canReassign && assigneesFailed ? (
                // The roster did not load. Showing the picker anyway would offer
                // exactly one action — unassign — dressed as reassignment.
                <span className="font-medium">
                  {lead.assignedToName || tc("unassigned")}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{tc("loadFailed")}</span>
                </span>
              ) : (
                <span className="font-medium">
                  {lead.assignedToName || tc("unassigned")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">{t("modalCreated")}:</span>
              <span className="font-medium">
                {formatDate(lead.createdAt, locale)}
              </span>
            </div>
            {lead.lastScoredAt && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">{t("modalScoredAt")}:</span>
                <span className="font-medium">
                  {formatDate(lead.lastScoredAt, locale)}
                </span>
              </div>
            )}
            {lead.convertedAt && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span className="text-muted-foreground">{t("statusConverted")}:</span>
                <span className="font-medium">
                  {formatDate(lead.convertedAt, locale)}
                </span>
              </div>
            )}
          </div>

          {/* Notes section — click to edit inline */}
          <div className="mt-6 pt-4 border-t group">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("modalNotes")}</span>
              {!editingNotes && lead.notes && (
                <button
                  type="button"
                  onClick={startEditNotes}
                  className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={tc("edit") || "Edit"}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-2">
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={4}
                  autoFocus
                  disabled={savingNotes}
                  placeholder={t("notesPlaceholder")}
                  className="text-sm"
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={cancelEditNotes} disabled={savingNotes}>
                    {tc("cancel")}
                  </Button>
                  <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
                    {savingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    {savingNotes ? tc("saving") : tc("save")}
                  </Button>
                </div>
              </div>
            ) : lead.notes ? (
              <p
                onClick={startEditNotes}
                className="text-sm text-muted-foreground whitespace-pre-wrap cursor-text rounded p-1 -m-1 hover:bg-muted/40 transition-colors"
                title={tc("clickToEdit") || "Click to edit"}
              >
                {lead.notes}
              </p>
            ) : (
              <button
                type="button"
                onClick={startEditNotes}
                className="text-sm text-muted-foreground italic hover:text-foreground hover:bg-muted/40 rounded px-2 py-1 -mx-2 transition-colors inline-flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> {t("modalNoNotes")}
              </button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
      )}

      {/* Tab: Activities */}
      {activeTab === "activities" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-1.5">
              <ActivityIcon className="h-4 w-4" />
              {t("activityTimeline")}
            </CardTitle>
            <Button size="sm" onClick={() => setShowAddActivity(true)}>
              <MessageSquare className="h-4 w-4 mr-1" />
              {t("addActivity")}
            </Button>
          </CardHeader>
          <CardContent>
            {activitiesLoading ? (
              <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("noActivities")}</div>
            ) : (
              <div className="relative space-y-4 pl-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border">
                {activities.map((activity: any) => (
                  <div key={activity.id} className="relative">
                    <div className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-zinc-200 dark:border-zinc-700 text-xs">
                      {ACTIVITY_TYPE_ICONS[activity.type] || "📌"}
                    </div>
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {String(activity.id).startsWith("call_callback_")
                            ? t("callbackActivity")
                            : activity.subject || activity.type}
                        </span>
                        {activity.scheduledAt ? (
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            {t("activityScheduledFor", {
                              time: formatDateTime(activity.scheduledAt, locale),
                            })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {activity.createdAt ? formatDate(activity.createdAt, locale) : "—"}
                          </span>
                        )}
                      </div>
                      {activity.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{activity.description}</p>
                      )}
                      {activity.createdByName && (
                        <p className="mt-1 text-[10px] text-muted-foreground">— {activity.createdByName}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Interactions (unified timeline) */}
      {activeTab === "timeline" && (
        <Card>
          <CardContent className="pt-6">
            <InteractionTimeline entity="lead" id={id} orgId={orgId ? String(orgId) : undefined} />
          </CardContent>
        </Card>
      )}

      {/* Tab: Sentiment */}
      {activeTab === "sentiment" && (
        <Card>
          <CardContent className="pt-6">
            {!sentiment ? (
              <div className="text-center py-8">
                <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <Button onClick={async () => { const d = await callAI("sentiment"); if (d) setSentiment(d) }} disabled={aiLoading} className="gap-2">
                  {aiLoading ? (t("modalAnalyzing") || "Analyzing...") : (t("modalAnalyzeSentiment") || "Analyze Sentiment")}
                </Button>
                <p className="text-sm text-muted-foreground mt-3">{t("modalSentimentDesc") || "Da Vinci will analyze sentiment based on lead data and interactions"}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-6 justify-center">
                  <div className="relative w-28 h-28 flex items-center justify-center">
                    <svg className="w-28 h-28" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                      <circle cx="50" cy="50" r="45" fill="none" stroke={sentiment.score >= 70 ? "#22c55e" : sentiment.score >= 40 ? "#3b82f6" : "#ef4444"} strokeWidth="8" strokeDasharray={`${sentiment.score * 2.83} 283`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                    </svg>
                    <div className="absolute text-center">
                      <div className="text-3xl">{sentiment.emoji}</div>
                      <div className="text-sm font-bold">{sentiment.score}%</div>
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{sentiment.sentiment}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("modalSentimentLabel") || "Sentiment"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Card><CardContent className="pt-3 pb-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{t("modalTrend") || "Trend"}</p>
                    <p className="text-sm font-medium mt-1">{sentiment.trend === "improving" ? (t("modalTrendImproving") || "Improving") : sentiment.trend === "stable" ? (t("modalTrendStable") || "Stable") : (t("modalTrendUnknown") || "Unknown")}</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 pb-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{t("modalRisk") || "Risk"}</p>
                    <p className={cn("text-sm font-bold mt-1", sentiment.risk === "HIGH" ? "text-red-500" : sentiment.risk === "MEDIUM" ? "text-orange-500" : "text-green-500")}>{sentiment.risk}</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 pb-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{t("modalConfidence") || "Confidence"}</p>
                    <p className="text-sm font-bold text-primary mt-1">{sentiment.confidence}%</p>
                  </CardContent></Card>
                </div>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase">{t("modalSummary") || "Summary"}</p>
                  <p className="text-sm leading-relaxed">{sentiment.summary}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Tasks */}
      {activeTab === "tasks" && (
        <Card>
          <CardContent className="pt-6">
            {!aiTasks ? (
              <div className="text-center py-8">
                <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <Button onClick={async () => { const d = await callAI("tasks"); if (d) setAiTasks(d) }} disabled={aiLoading} className="gap-2">
                  {aiLoading ? (t("modalGenerating") || "Generating...") : (t("modalGenerateTasks") || "Generate Tasks")}
                </Button>
                <p className="text-sm text-muted-foreground mt-3">{t("modalTasksDesc") || "Da Vinci will suggest next best actions for this lead"}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg text-sm border border-yellow-200 dark:border-yellow-800">
                  <p className="font-medium text-xs text-yellow-800 dark:text-yellow-300 uppercase mb-1">{t("modalStrategy") || "Strategy"}</p>
                  <p>{aiTasks.strategy}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {aiTasks.tasks?.map((task: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex gap-1">
                            <Badge variant={task.priority === "HIGH" ? "destructive" : "secondary"} className="text-[10px]">{task.priority}</Badge>
                            <Badge variant="outline" className="text-[10px]">{task.type}</Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{task.dueDate}</span>
                        </div>
                        <h4 className="font-medium text-sm mb-1">{task.title}</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="flex gap-2 justify-center pt-2">
                  <Button size="sm" className="gap-1" onClick={createAllTasks} disabled={creatingTasks || tasksCreated}>
                    {creatingTasks ? <><Loader2 className="h-3 w-3 animate-spin" /> {t("modalCreating") || "Creating..."}</> : tasksCreated ? <><CheckCircle className="h-3 w-3" /> {t("modalTasksCreated") || "Tasks Created!"}</> : <><CheckCircle className="h-3 w-3" /> {t("modalCreateAllTasks") || "Create All Tasks"}</>}
                  </Button>
                  <Button size="sm" variant="outline" onClick={async () => { setTasksCreated(false); const d = await callAI("tasks"); if (d) setAiTasks(d) }} className="gap-1"><RefreshCw className="h-3 w-3" /> {t("modalRegenerate") || "Regenerate"}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Da Vinci Text */}
      {activeTab === "aitext" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("modalTextType")}</Label>
                <Select value={textType} onChange={(e: any) => { setTextType(e.target.value); setGeneratedText(null); setSent(false); setSendError("") }}>
                  <option value="Email">Email</option>
                  <option value="SMS">SMS</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Telegram">Telegram</option>
                </Select>
              </div>
            </div>

            {textType === "WhatsApp" ? (
              // ═══ WhatsApp template picker — outside 24h window Meta requires ═══
              // a pre-approved template. For a cold lead that's always. Free text
              // goes through sendWhatsAppText from the messaging lib but is
              // forbidden by the Graph API if no recent inbound — so we don't
              // even offer a free-text UI here.
              <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-emerald-50/30 dark:bg-emerald-950/10">
                <div className="flex items-start gap-2">
                  <div className="text-xs text-emerald-800 dark:text-emerald-200 flex-1">
                    <p className="font-medium mb-0.5">{t("waApiTitle")}</p>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      {t("waApiDesc")}
                    </p>
                  </div>
                </div>

                {waTemplatesLoading ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">{tc("loading")}</p>
                ) : waTemplates.length === 0 ? (
                  <div className="text-center py-6 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-background">
                    <p className="text-sm text-muted-foreground">{t("waNoTemplates")}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.rich("waSyncHint", {
                        link: (chunks) => (
                          <a href="/settings/channels/whatsapp" className="text-primary underline">{chunks}</a>
                        ),
                      })}
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label className="text-xs">{t("waTemplate")}</Label>
                      <Select value={waSelectedTemplate} onChange={(e: any) => setWaSelectedTemplate(e.target.value)}>
                        <option value="">{t("waSelectTemplate")}</option>
                        {waTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.language}) · {t.category}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {waSelectedTemplate && (() => {
                      const tpl = waTemplates.find(t => t.id === waSelectedTemplate)
                      if (!tpl) return null
                      return (
                        <>
                          {tpl.variables.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">{t("waParams")}</Label>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={suggestWaVariables}
                                  disabled={waAiSuggesting}
                                  className="h-7 text-xs gap-1"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {waAiSuggesting ? t("waAiThinking") : "AI suggest"}
                                </Button>
                              </div>
                              {tpl.variables.map((v) => (
                                <div key={v} className="flex items-center gap-2">
                                  <code className="text-[11px] font-mono w-24 text-muted-foreground">{`{{${v}}}`}</code>
                                  <Input
                                    value={waVariables[v] || ""}
                                    onChange={(e: any) => setWaVariables(prev => ({ ...prev, [v]: e.target.value }))}
                                    placeholder={`${t("waVarPlaceholder")} {{${v}}}`}
                                    className="text-sm"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {tpl.bodyText && (
                            <div>
                              <Label className="text-xs">Preview</Label>
                              <div className="text-sm whitespace-pre-wrap bg-background border border-zinc-200 dark:border-zinc-700 rounded p-3 mt-1">
                                {renderTemplatePreview(tpl.bodyText, waVariables)}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 justify-end">
                            {(lead.phoneWhatsApp || lead.phone) && (
                              <Button size="sm" onClick={sendWaTemplate} disabled={sending || sent} className="gap-1">
                                <Send className="h-3 w-3" />
                                {sent ? tc("sent") : sending ? tc("sending") : `Send WhatsApp → ${lead.phoneWhatsApp || lead.phone}`}
                              </Button>
                            )}
                          </div>

                          {sendError && (
                            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{sendError}</p>
                          )}
                        </>
                      )
                    })()}
                  </>
                )}
              </div>
            ) : (
              // ═══ Email / SMS / Telegram — existing Da Vinci free-form flow ═══
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">{t("modalTopic")}</Label>
                    <Select value={topic} onChange={(e: any) => setTopic(e.target.value)}>
                      <option value="welcome">{t("modalWelcome")}</option>
                      <option value="follow_up">{t("modalFollowUp")}</option>
                      <option value="offer">{t("modalOffer")}</option>
                      <option value="meeting_request">{t("modalMeetingRequest")}</option>
                      <option value="reminder">{t("modalReminder")}</option>
                      <option value="thank_you">{t("modalThankYou")}</option>
                      <option value="reengagement">{t("modalReengagement")}</option>
                      <option value="custom">{t("modalCustom")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("modalTone")}</Label>
                    <Select value={tone} onChange={(e: any) => setTone(e.target.value)}>
                      <option value="professional">{t("modalProfessional")}</option>
                      <option value="friendly">{t("modalFriendly")}</option>
                      <option value="formal">{t("modalFormal")}</option>
                      <option value="persuasive">{t("modalPersuasive")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("modalExtraInstructions")}</Label>
                    <Input value={instructions} onChange={(e: any) => setInstructions(e.target.value)} placeholder={t("modalExtraInstructionsPlaceholder")} />
                  </div>
                </div>
                <Button onClick={async () => { const d = await callAI("text", { textType, topic, tone, instructions }); if (d) { setGeneratedText(d); setSent(false); setSendError("") } }} disabled={aiLoading} className="w-full gap-2">
                  {aiLoading ? t("modalGenerating") : t("modalGenerateText")}
                </Button>

                {generatedText && (
                  <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-muted/10">
                    {textType === "Email" && (
                      <div>
                        <Label className="text-xs text-primary uppercase">{t("modalSubject") || "Subject"}</Label>
                        <Input value={generatedText.subject || ""} onChange={(e: any) => setGeneratedText({ ...generatedText, subject: e.target.value })} className="mt-1 bg-background" />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs uppercase">{t("modalText") || "Text"}</Label>
                      <Textarea value={generatedText.body} rows={8} onChange={(e: any) => setGeneratedText({ ...generatedText, body: e.target.value })} className="mt-1 bg-background" />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(generatedText.body)} className="gap-1">
                        <Copy className="h-3 w-3" /> {t("modalCopy") || "Copy"}
                      </Button>
                      {(() => {
                        const { to: dest } = resolveDestination(textType, lead)
                        if (!dest) return null
                        const sendLabel =
                          textType === "SMS"      ? (t("modalSendSMS") || "Send SMS") :
                          textType === "Telegram" ? "Send Telegram" :
                                                    (t("modalSendEmail") || "Send Email")
                        return (
                          <Button size="sm" onClick={sendGenerated} disabled={sending || sent} className="gap-1">
                            <Send className="h-3 w-3" /> {sent ? (t("modalSent") || "Sent!") : sending ? (t("modalSending") || "Sending...") : sendLabel}
                          </Button>
                        )
                      })()}
                      <Button size="sm" variant="outline" onClick={async () => { const d = await callAI("text", { textType, topic, tone, instructions }); if (d) { setGeneratedText(d); setSent(false); setSendError("") } }} className="gap-1">
                        <RefreshCw className="h-3 w-3" /> {t("modalRegenerate") || "Regenerate"}
                      </Button>
                    </div>
                    {sendError && (
                      <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{sendError}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Da Vinci Scoring */}
      {activeTab === "ai" && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-purple-500" /> {t("modalAiAnalysis") || "Da Vinci Analysis"}
              </h4>
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={scoreWithAI} disabled={scoring}>
                {scoring ? (t("modalRecalculating") || "Recalculating...") : (t("modalRecalculate") || "Recalculate")}
              </Button>
            </div>

            {lead.scoreDetails?.reasoning && (
              <div className="p-4 bg-[hsl(var(--ai-from))]/5 rounded-lg border border-[hsl(var(--ai-from))]/20 ai-accent">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-[hsl(var(--ai-from))] shrink-0 mt-0.5" />
                  <p className="text-sm text-foreground leading-relaxed">{lead.scoreDetails.reasoning}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              <Card><CardContent className="pt-4 pb-4">
                <div className={cn("text-3xl font-bold", grade.color.replace("bg-", "text-").replace(" text-white", ""))}>
                  {grade.letter}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{t("modalGrade") || "Grade"}</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4">
                <div className="text-3xl font-bold text-primary">{normalizedScore}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("modalScore") || "Score"}</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4">
                <div className={cn("text-3xl font-bold", conversionProb >= 50 ? "text-green-600" : conversionProb >= 30 ? "text-yellow-600" : "text-red-500")}>
                  {conversionProb}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">{t("modalConversion") || "Conversion"}</div>
              </CardContent></Card>
            </div>

            {lead.scoreDetails?.factors && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">{t("modalFactors")}</p>
                {Object.entries(lead.scoreDetails.factors).map(([key, val]: [string, any]) => {
                  return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{getLeadScoreFactorLabel(key, t)}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${val}%` }} />
                      </div>
                      <span className="font-medium w-8 text-right">{val}%</span>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
        </div>
      </div>

      {/* Lead Form Dialog */}
      <LeadForm
        open={showForm}
        onOpenChange={(open) => setShowForm(open)}
        onSaved={() => {
          setShowForm(false)
          fetchLead()
        }}
        initialData={lead}
        orgId={orgId}
      />

      {/* Convert Dialog */}
      {showConvert && (
        <LeadConvertDialog
          open={showConvert}
          onOpenChange={(open) => {
            if (!open) setShowConvert(false)
          }}
          onConverted={() => {
            setShowConvert(false)
            fetchLead()
          }}
          lead={lead as any}
          orgId={orgId}
        />
      )}

      {/* Add-to-sequence Dialog */}
      <EnrollInSequenceDialog
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        entityType="lead"
        entityIds={[id]}
        entityName={lead.contactName}
      />

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        open={showDelete}
        onOpenChange={(open) => {
          if (!open) setShowDelete(false)
        }}
        onConfirm={handleDelete}
        title={t("deleteLead")}
        itemName={lead.contactName}
      />

      {/* Add Activity Dialog */}
      <Dialog open={showAddActivity} onOpenChange={setShowAddActivity}>
        <DialogHeader><DialogTitle>{t("addActivity")}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="lead-activity-type">{tc("type") || "Type"}</Label>
              <Select
                id="lead-activity-type"
                value={activityForm.type}
                onChange={(e) => setActivityForm(f => ({ ...f, type: e.target.value }))}
              >
                {ACTIVITY_TYPES.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lead-activity-subject">{t("activitySubject")} <span className="text-red-500">*</span></Label>
              <Input
                id="lead-activity-subject"
                value={activityForm.subject}
                onChange={(e) => setActivityForm(f => ({ ...f, subject: e.target.value }))}
                placeholder={t("activitySubjectPlaceholder")}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="lead-activity-description">{tc("description") || "Description"}</Label>
              <Textarea
                id="lead-activity-description"
                value={activityForm.description}
                onChange={(e) => setActivityForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder={t("activityDescriptionPlaceholder")}
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddActivity(false)} disabled={savingActivity}>{tc("cancel")}</Button>
          <Button onClick={handleAddActivity} disabled={savingActivity || !activityForm.subject.trim()} className="gap-1.5">
            {savingActivity ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {savingActivity ? tc("saving") : (tc("create") || "Create")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
