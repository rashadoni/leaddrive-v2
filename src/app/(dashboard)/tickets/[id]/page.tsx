"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { ArrowLeft, Clock, Send, Lock, Star, Loader2, Bot, FileText, Zap, UserCheck, RefreshCw, AlertTriangle, UserPlus, BookOpen, ChevronLeft, ChevronRight, Keyboard, Timer, Play, MessageSquareWarning, Pencil, CheckCircle2, Copy, ShieldCheck, Paperclip, X } from "lucide-react"
import { parseChatDescription, ChatHistoryView, parseCommentSender, ChatBubble } from "@/components/tickets/chat-history-view"
import { InfoHint } from "@/components/info-hint"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { useTicketShortcuts, TICKET_SHORTCUTS } from "@/hooks/use-ticket-shortcuts"
import { ConvertToComplaintDialog } from "@/components/convert-to-complaint-dialog"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { ClickToCallButton } from "@/components/call-widget"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { useStageLabel } from "@/lib/status-labels"
import { safeTicketReturnTo, ticketDetailHref } from "@/lib/ticketing/workspace-state"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { toast } from "sonner"
import { parseTicketReplyDraft, serializeTicketReplyDraft, ticketDraftStorageKey } from "@/lib/ticketing/ticket-draft"
import { formatFileSize } from "@/lib/format-file-size"

interface TicketData {
  id: string
  ticketNumber: string
  subject: string
  description: string | null
  status: string
  priority: string
  category: string
  contactId: string | null
  companyId: string | null
  assignedTo: string | null
  createdBy: string | null
  slaDueAt: string | null
  slaFirstResponseDueAt: string | null
  slaPolicyName: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  satisfactionRating: number | null
  satisfactionComment: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  companyName?: string | null
  assigneeName?: string | null
  requesterName?: string | null
  requesterEmail?: string | null
  requesterPhone?: string | null
  contactName?: string | null
  contactPreferredLanguage?: string | null
  source?: string | null
  comments: CommentData[]
  closureRequest: TicketClosureRequestData | null
  entitlement: TicketEntitlementData | null
}

interface CommentData {
  id: string
  userId: string | null
  comment: string
  isInternal: boolean
  createdAt: string
  userName?: string | null
  attachments?: TicketAttachmentData[]
}

interface TicketAttachmentData {
  id: string
  commentId: string | null
  fileName: string
  originalName: string
  fileSize: number
  mimeType: string
  uploadedBy: string | null
  createdAt: string
}

interface TicketClosureRequestData {
  id: string
  status: "pending" | "confirmed" | "rejected" | "expired" | "canceled" | string
  channel: string | null
  recipient: string | null
  requestedAt: string
  dueAt: string
  confirmedAt: string | null
  rejectedAt: string | null
  expiredAt: string | null
  canceledAt: string | null
  confirmationUrl?: string | null
}

interface TicketEntitlementData {
  id: string
  supportLevel: string
  status: string
  companyName: string
  slaPolicyName: string
  risk: "overdue" | "at_risk" | "on_track" | "complete" | string
  counts: {
    total: number
    open: number
    overdue: number
    atRisk: number
    met: number
  }
  milestones: TicketEntitlementMilestoneData[]
}

interface TicketEntitlementMilestoneData {
  id: string
  type: string
  status: string
  dueAt: string
  completedAt: string | null
  missedAt: string | null
  waivedAt: string | null
  waivedReason: string | null
  definitionName: string
  severityTier: string | null
  isRequired: boolean
}

interface UserOption {
  id: string
  name: string | null
  email: string
}

interface TicketCallLog {
  id: string
  direction: string
  status: string
  fromNumber: string
  toNumber: string
  duration: number | null
  provider: string
  hasRecording?: boolean
  recordingPlaybackUrl: string | null
  createdAt: string
}

interface TicketSiblingData {
  id: string
  ticketNumber: string
  subject: string
}

interface TicketMacroData {
  id: string
  name: string
  shortcutKey?: string | null
  isActive: boolean
}

interface KnowledgeBaseArticle {
  id: string
  title: string
  category?: string | null
}

interface CustomerContextData {
  contact?: {
    id: string
    fullName?: string | null
    position?: string | null
    email?: string | null
    phone?: string | null
  } | null
  company?: {
    id?: string | null
    name?: string | null
    industry?: string | null
  } | null
  lifetimeValue?: number | null
  recentTickets?: Array<{
    id: string
    ticketNumber: string
    subject: string
    status: string
  }>
  openDeals?: Array<{
    id: string
    name: string
    valueAmount?: number | null
    stage?: string | null
    currency?: string | null
  }>
  recentActivity?: Array<{
    id: string
    type: string
    subject: string
  }>
}

const STATUS_STYLES: Record<string, { className: string }> = {
  new: { className: "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" },
  open: { className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" },
  in_progress: { className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  waiting: { className: "bg-muted text-muted-foreground" },
  resolved: { className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  closed: { className: "bg-muted text-foreground" },
}

const STATUS_PIPELINE = ["new", "open", "in_progress", "waiting", "resolved", "closed"]
const STATUS_PIPELINE_COLORS: Record<string, string> = {
  new: "bg-orange-700 text-white",
  open: "bg-blue-600 text-white",
  in_progress: "bg-amber-500 text-white",
  waiting: "bg-zinc-600 text-white",
  resolved: "bg-emerald-600 text-white",
  closed: "bg-zinc-700 text-white",
}

const PRIORITY_STYLES: Record<string, { className: string }> = {
  urgent: { className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  critical: { className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  high: { className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300" },
  medium: { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  low: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
}

function formatDate(d: string | null, locale: string) {
  if (!d) return "—"
  return new Date(d).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function getSlaTimeLeft(
  slaDueAt: string | null,
  status: string,
  resolvedLabel: string,
  breachedLabel: string,
  hrAbbr = "h",
  minAbbr = "m",
  secAbbr = "s",
): { text: string; breached: boolean; urgent: boolean } {
  if (!slaDueAt) return { text: "—", breached: false, urgent: false }
  if (status === "resolved" || status === "closed") return { text: resolvedLabel, breached: false, urgent: false }
  const diff = new Date(slaDueAt).getTime() - Date.now()
  if (diff <= 0) return { text: breachedLabel, breached: true, urgent: false }
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  const urgent = diff < 2 * 3600000 // less than 2 hours
  const text = urgent
    ? `${hours}${hrAbbr} ${minutes.toString().padStart(2, "0")}${minAbbr} ${seconds.toString().padStart(2, "0")}${secAbbr}`
    : `${hours}${hrAbbr} ${minutes}${minAbbr}`
  return { text, breached: false, urgent }
}

function getInitials(str: string | null): string {
  if (!str) return "?"
  return str.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

export default function TicketDetailPage() {
  const t = useTranslations("tickets")
  const tc = useTranslations("common")
  const locale = useLocale()
  const dealStageLabel = useStageLabel()
  const t360 = useTranslations("customer360")
  const tv = useTranslations("voip")
  const tsk = useTranslations("ticketShortcuts")
  const tm = useTranslations("macrosPage")
  const params = useParams()
  const searchParams = useSearchParams()
  useAutoTour("ticketDetail")
  const { data: session } = useSession()
  const ticketId = params.id as string
  const returnTo = safeTicketReturnTo(searchParams.get("returnTo"))
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tick, setTick] = useState(0) // live countdown tick
  const [newComment, setNewComment] = useState("")
  const [isInternal, setIsInternal] = useState(false)
  const [showInternal, setShowInternal] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState("")
  const [attachments, setAttachments] = useState<TicketAttachmentData[]>([])
  const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([])
  const [attachmentLoading, setAttachmentLoading] = useState(true)
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState("")
  const [failedAttachment, setFailedAttachment] = useState<File | null>(null)
  const [clientRequestId, setClientRequestId] = useState<string>(() => crypto.randomUUID())
  const [draftReady, setDraftReady] = useState(false)
  const [draftRecovered, setDraftRecovered] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [staleTicket, setStaleTicket] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [actionError, setActionError] = useState("")

  // Related KB articles
  const [kbArticles, setKbArticles] = useState<KnowledgeBaseArticle[]>([])

  // Inline status change
  const [newStatus, setNewStatus] = useState("")
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [recentClosureRequest, setRecentClosureRequest] = useState<TicketClosureRequestData | null>(null)
  const [closureLinkCopied, setClosureLinkCopied] = useState(false)

  // Inline edit subject/description
  const [editingSubject, setEditingSubject] = useState(false)
  const [editSubject, setEditSubject] = useState("")
  const [editingDesc, setEditingDesc] = useState(false)
  const [editDesc, setEditDesc] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  // Inline reassign
  const [users, setUsers] = useState<UserOption[]>([])
  const [newAssignee, setNewAssignee] = useState("")
  const [updatingAssignee, setUpdatingAssignee] = useState(false)

  // Da Vinci features
  const [aiLoading, setAiLoading] = useState<string | null>(null) // "reply" | "summary" | "steps"
  const [aiResult, setAiResult] = useState<{ type: string; text: string } | null>(null)
  const [aiError, setAiError] = useState("")
  const [aiLang, setAiLang] = useState(() => ["az", "ru", "en"].includes(locale) ? locale : "az")

  // Agent Desktop v2 features
  const router = useRouter()
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [siblings, setSiblings] = useState<{ prev: TicketSiblingData | null; next: TicketSiblingData | null }>({ prev: null, next: null })
  const [customerContext, setCustomerContext] = useState<CustomerContextData | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState(false)
  const [contextRetryKey, setContextRetryKey] = useState(0)
  const [ticketCalls, setTicketCalls] = useState<TicketCallLog[]>([])
  const [showContext, setShowContext] = useState(true)
  const [context360Collapsed, setContext360Collapsed] = useState(false)
  const [macros, setMacros] = useState<TicketMacroData[]>([])
  const [handleTimer, setHandleTimer] = useState(0)
  const handleTimerValueRef = useRef(0)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showMacrosMenu, setShowMacrosMenu] = useState(false)
  const [applyingMacroId, setApplyingMacroId] = useState<string | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [waivingMilestoneId, setWaivingMilestoneId] = useState<string | null>(null)
  const [savingWaiverId, setSavingWaiverId] = useState<string | null>(null)
  const [waiverReasons, setWaiverReasons] = useState<Record<string, string>>({})
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const orgId = session?.user?.organizationId
  const draftKey = orgId ? ticketDraftStorageKey(String(orgId), ticketId) : ""
  const {
    enabled: supportAiDisabled,
    hasLoaded: supportAiHasLoaded,
    loading: supportAiLoading,
    error: supportAiStateError,
    reload: reloadSupportAi,
  } = useOrganizationFeature(SUPPORT_AI_DISABLED_FEATURE, orgId)
  const supportAiEnabled = Boolean(orgId && supportAiHasLoaded && !supportAiLoading && !supportAiStateError && !supportAiDisabled)
  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])

  useEffect(() => {
    setDraftReady(false)
    setDraftRecovered(false)
    setDraftAttachmentIds([])
    setClientRequestId(crypto.randomUUID())
    if (!draftKey) return
    try {
      const draft = parseTicketReplyDraft(localStorage.getItem(draftKey))
      if (draft) {
        setNewComment(draft.text)
        setIsInternal(draft.isInternal)
        setDraftAttachmentIds(draft.attachmentIds)
        setClientRequestId(draft.clientRequestId)
        setDraftRecovered(true)
      }
    } catch {
      // A corrupt or unavailable local draft must never block the composer.
    } finally {
      setDraftReady(true)
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftReady || !draftKey) return
    const timeout = window.setTimeout(() => {
      try {
        if (newComment.trim() || draftAttachmentIds.length > 0) {
          localStorage.setItem(draftKey, serializeTicketReplyDraft(newComment, isInternal, draftAttachmentIds, clientRequestId))
        } else {
          localStorage.removeItem(draftKey)
        }
      } catch {
        // The visible composer remains usable when storage is unavailable.
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [clientRequestId, draftAttachmentIds, draftKey, draftReady, isInternal, newComment])

  useEffect(() => {
    if (!newComment.trim() && draftAttachmentIds.length === 0) return
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", protectDraft)
    return () => window.removeEventListener("beforeunload", protectDraft)
  }, [draftAttachmentIds.length, newComment])

  const STATUS_LABELS: Record<string, string> = {
    new: t("statusNew"),
    open: t("statusOpen"),
    in_progress: t("statusInProgress"),
    waiting: t("statusWaiting"),
    resolved: t("statusResolved"),
    closed: t("statusClosed"),
  }

  const PRIORITY_LABELS: Record<string, string> = {
    urgent: tc("priorityUrgent"),
    critical: tc("critical"),
    high: tc("high"),
    medium: tc("medium"),
    low: tc("low"),
  }
  const CATEGORY_LABELS: Record<string, string> = {
    general: t("categoryGeneral"),
    technical: t("categoryTechnical"),
    billing: t("categoryBilling"),
    feature_request: t("categoryFeatureRequest"),
    complaint: t("categoryComplaint"),
  }
  const ACTIVITY_TYPE_LABELS: Record<string, string> = {
    call: t360("activityCall"),
    email: t360("activityEmail"),
    meeting: t360("activityMeeting"),
    note: t360("activityNote"),
    task: t360("activityTask"),
    message: t360("activityMessage"),
  }
  const MILESTONE_TYPE_LABELS: Record<string, string> = {
    first_response: t("milestoneFirstResponse"),
    problem_identified: t("milestoneProblemIdentified"),
    workaround_delivered: t("milestoneWorkaroundDelivered"),
    resolution: t("milestoneResolution"),
    escalation: t("milestoneEscalation"),
  }
  const MILESTONE_STATUS_LABELS: Record<string, string> = {
    pending: t("milestoneStatusPending"),
    in_progress: t("milestoneStatusInProgress"),
    met: t("milestoneStatusMet"),
    missed: t("milestoneStatusMissed"),
    waived: t("milestoneStatusWaived"),
  }

  // `silent` = a background live-poll: refresh the ticket + its comment thread ONLY. It must NOT
  // reset the agent's in-progress status/assignee dropdowns, re-fetch KB, or surface a transient
  // error — those belong to the foreground load (initial / after an action).
  const fetchTicket = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setStaleTicket(false)
        setPermissionDenied(false)
        if (!opts?.silent) setError("")
        setTicket(json.data)
        if (json.data.status !== "resolved") setRecentClosureRequest(null)
        if (!opts?.silent) {
          setNewStatus(json.data.status)
          setNewAssignee(json.data.assignedTo || "")
          if (["az", "ru", "en"].includes(json.data.contactPreferredLanguage)) {
            setAiLang(json.data.contactPreferredLanguage)
          }
          // Fetch related KB articles by category/tags
          try {
            const kbRes = await fetch(`/api/v1/kb?limit=5&search=${encodeURIComponent(json.data.category || "")}`)
            const kbJson = await kbRes.json()
            if (kbJson.success) setKbArticles(kbJson.data?.articles || kbJson.data || [])
          } catch (err) { console.error(err) }
        }
      } else if (opts?.silent) {
        setStaleTicket(true)
      } else {
        setPermissionDenied(res.status === 403)
        setError(res.status === 403 ? t("ticketPermissionError") : t("failedToLoad"))
      }
    } catch {
      if (opts?.silent) setStaleTicket(true)
      else setError(t("failedToLoad"))
    } finally {
      setLoading(false)
    }
  }, [ticketId, t])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/skill-routing/agents")
      const json = await res.json()
      if (json.success) setUsers(json.data || [])
    } catch { /* ignore */ }
  }, [])

  const fetchAttachments = useCallback(async () => {
    setAttachmentLoading(true)
    setAttachmentError("")
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/files`, { headers })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(res.status === 403 ? t("attachmentPermissionError") : t("attachmentLoadError"))
      }
      setAttachments(json.data || [])
    } catch (failure) {
      setAttachmentError(failure instanceof Error ? failure.message : t("attachmentLoadError"))
    } finally {
      setAttachmentLoading(false)
    }
  }, [headers, ticketId, t])

  useEffect(() => { fetchTicket(); fetchUsers(); void fetchAttachments() }, [fetchAttachments, fetchTicket, fetchUsers])

  // Live thread: poll every 8s (silent — no form/KB clobber). Paused while the tab is hidden so a
  // background tab doesn't hammer the API; refreshes once immediately on becoming visible again.
  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") fetchTicket({ silent: true }) }
    const interval = setInterval(poll, 8000)
    const onVisible = () => { if (document.visibilityState === "visible") fetchTicket({ silent: true }) }
    document.addEventListener("visibilitychange", onVisible)
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible) }
  }, [fetchTicket])

  // Live SLA countdown — tick every second
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // Fetch siblings, macros, and start handle timer
  useEffect(() => {
    if (!ticketId) return
    // Siblings
    fetch(`/api/v1/tickets/${ticketId}/siblings`, { headers }).then(r => r.json()).then(j => {
      if (j.success) setSiblings(j.data)
    }).catch(() => {})
    // Macros
    fetch("/api/v1/ticket-macros", { headers }).then(r => r.json()).then(j => {
      if (j.success) setMacros(j.data || [])
    }).catch(() => {})
    // Handle timer — load existing value from ticket data, use ref for save-on-unmount
    const loadAndStartTimer = async () => {
      try {
        const res = await fetch(`/api/v1/tickets/${ticketId}`, { headers })
        const json = await res.json()
        if (json.success && json.data?.handleTimeSeconds) {
          setHandleTimer(json.data.handleTimeSeconds)
          handleTimerValueRef.current = json.data.handleTimeSeconds
        }
      } catch {}
      timerRef.current = setInterval(() => {
        setHandleTimer(t => {
          const next = t + 1
          handleTimerValueRef.current = next
          return next
        })
      }, 1000)
    }
    loadAndStartTimer()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      // Save handle time on unmount using ref (avoids stale closure)
      const finalTime = handleTimerValueRef.current
      if (finalTime > 0) {
        fetch(`/api/v1/tickets/${ticketId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ handleTimeSeconds: finalTime }),
        }).catch(() => {})
      }
    }
  }, [ticketId, headers])

  // Fetch Customer 360 context when toggled
  useEffect(() => {
    if (showContext && !customerContext && ticketId) {
      setContextLoading(true)
      setContextError(false)
      fetch(`/api/v1/tickets/${ticketId}/context`, { headers }).then(r => r.json()).then(j => {
        if (j.success) setCustomerContext(j.data)
        else setContextError(true)
      }).catch(() => setContextError(true)).finally(() => setContextLoading(false))
    }
  }, [showContext, customerContext, ticketId, headers, contextRetryKey])

  const fetchTicketCalls = useCallback(() => {
    if (!ticketId) return
    fetch(`/api/v1/calls?ticketId=${encodeURIComponent(ticketId)}&limit=10`, { headers })
      .then(r => r.json())
      .then(j => {
        if (j.success) setTicketCalls(j.data || [])
      })
      .catch(() => {})
  }, [ticketId, headers])

  useEffect(() => { fetchTicketCalls() }, [fetchTicketCalls])

  const applyMacro = useCallback(async (macro: TicketMacroData) => {
    if (applyingMacroId) return
    setApplyingMacroId(macro.id)
    try {
      const response = await fetch(`/api/v1/ticket-macros/${macro.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ ticketId }),
      })
      if (!response.ok) throw new Error(tm("applyError"))
      await fetchTicket()
      toast.success(tm("appliedSuccess", { name: macro.name }))
    } catch {
      toast.error(tm("applyError"))
    } finally {
      setApplyingMacroId(null)
    }
  }, [applyingMacroId, fetchTicket, headers, ticketId, tm])

  // Keyboard shortcuts
  useTicketShortcuts({
    onReply: () => { setIsInternal(false); commentRef.current?.focus() },
    onInternalNote: () => { setIsInternal(true); commentRef.current?.focus() },
    onAssignToMe: () => {
      if (session?.user?.id) void handleAssignToMe()
    },
    onEscalate: () => { if (ticket?.priority !== "critical") void handleEscalate() },
    onClose: () => { void updateTicketFields({ status: "closed" }, t("statusUpdated")) },
    onPrevTicket: () => { if (siblings.prev) navigateSafely(ticketDetailHref(siblings.prev.id, returnTo)) },
    onNextTicket: () => { if (siblings.next) navigateSafely(ticketDetailHref(siblings.next.id, returnTo)) },
    onCopyNumber: () => { if (ticket?.ticketNumber) navigator.clipboard.writeText(ticket.ticketNumber) },
    onToggleShortcuts: () => setShowShortcuts(s => !s),
    macros: macros.filter(m => m.isActive).map(m => ({
      execute: () => {
        void applyMacro(m)
      },
    })),
  })

  function navigateSafely(target: string) {
    if (newComment.trim() || draftAttachmentIds.length > 0) {
      setPendingNavigation(target)
      return
    }
    router.push(target)
  }

  async function updateTicketFields(fields: Record<string, unknown>, successMessage: string) {
    setActionError("")
    const res = await fetch(`/api/v1/tickets/${ticketId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(fields),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(res.status === 403 ? t("actionPermissionError") : t("actionFailed"))
    toast.success(successMessage)
    await fetchTicket()
    return json
  }

  const handleSendComment = async () => {
    if (!newComment.trim() || sending || attachmentUploading) return
    if (ticket?.status === "closed") {
      setSendError(t("closedComposerHint"))
      return
    }
    setSending(true)
    setSendError("")
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ comment: newComment, isInternal, attachmentIds: draftAttachmentIds, clientRequestId }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        try { if (draftKey) localStorage.removeItem(draftKey) } catch {}
        setNewComment("")
        setDraftAttachmentIds([])
        setClientRequestId(crypto.randomUUID())
        setDraftRecovered(false)
        toast.success(isInternal ? t("internalNoteSent") : t("replySent"))
        void Promise.all([fetchTicket(), fetchAttachments()])
      } else {
        throw new Error(
          res.status === 403
            ? t("sendPermissionError")
            : json?.errorKey === "ticketClosed"
              ? t("closedComposerHint")
              : json?.errorKey === "attachmentConflict" || json?.errorKey === "duplicateRequestConflict"
                ? t("attachmentConflict")
              : t("sendFailed"),
        )
      }
    } catch (sendFailure) {
      setSendError(sendFailure instanceof Error ? sendFailure.message : t("sendFailed"))
    } finally { setSending(false) }
  }

  const handleUploadAttachment = async (file: File) => {
    if (attachmentUploading || ticket?.status === "closed") return
    setAttachmentUploading(true)
    setAttachmentError("")
    setFailedAttachment(null)
    try {
      const formData = new FormData()
      formData.set("file", file)
      const res = await fetch(`/api/v1/tickets/${ticketId}/files`, {
        method: "POST",
        headers,
        body: formData,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(
          res.status === 403
            ? t("attachmentPermissionError")
            : json?.errorKey === "ticketClosed"
              ? t("closedComposerHint")
              : t("attachmentUploadError"),
        )
      }
      const uploaded = json.data as TicketAttachmentData
      setAttachments(current => [...current.filter(item => item.id !== uploaded.id), uploaded])
      setDraftAttachmentIds(current => current.includes(uploaded.id) ? current : [...current, uploaded.id])
      toast.success(t("attachmentUploaded"))
    } catch (failure) {
      setFailedAttachment(file)
      setAttachmentError(failure instanceof Error ? failure.message : t("attachmentUploadError"))
    } finally {
      setAttachmentUploading(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ""
    }
  }

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (attachmentUploading) return
    setAttachmentUploading(true)
    setAttachmentError("")
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/files/${encodeURIComponent(attachmentId)}`, {
        method: "DELETE",
        headers,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(res.status === 403 ? t("attachmentPermissionError") : t("attachmentRemoveError"))
      }
      setAttachments(current => current.filter(item => item.id !== attachmentId))
      setDraftAttachmentIds(current => current.filter(id => id !== attachmentId))
    } catch (failure) {
      setAttachmentError(failure instanceof Error ? failure.message : t("attachmentRemoveError"))
    } finally {
      setAttachmentUploading(false)
    }
  }

  const handleWaiveMilestone = async (milestoneId: string) => {
    const reason = (waiverReasons[milestoneId] || "").trim()
    if (!reason || savingWaiverId) return
    setSavingWaiverId(milestoneId)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/entitlement-milestones/${milestoneId}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ reason }),
      })
      if (res.ok) {
        setWaiverReasons(prev => {
          const next = { ...prev }
          delete next[milestoneId]
          return next
        })
        setWaivingMilestoneId(null)
        fetchTicket()
      }
    } catch { /* ignore */ } finally {
      setSavingWaiverId(null)
    }
  }

  const handleUpdateStatus = async () => {
    if (!ticket || newStatus === ticket.status) return
    setUpdatingStatus(true)
    try {
      const json = await updateTicketFields({ status: newStatus }, t("statusUpdated"))
      if (json?.closureRequest) {
        setRecentClosureRequest(json.closureRequest)
        setClosureLinkCopied(false)
      }
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
    } finally { setUpdatingStatus(false) }
  }

  const handleCopyClosureLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setClosureLinkCopied(true)
      window.setTimeout(() => setClosureLinkCopied(false), 1800)
    } catch {
      setClosureLinkCopied(false)
    }
  }

  const handleSaveSubjectDesc = async (field: "subject" | "description", value: string) => {
    if (!ticket) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        fetchTicket()
        if (field === "subject") setEditingSubject(false)
        if (field === "description") setEditingDesc(false)
      }
    } catch { /* ignore */ } finally { setSavingEdit(false) }
  }

  const handleReassign = async () => {
    if (!ticket) return
    setUpdatingAssignee(true)
    try {
      await updateTicketFields({ assignedTo: newAssignee || "" }, t("assignmentUpdated"))
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
    } finally { setUpdatingAssignee(false) }
  }

  const handleAiAction = async (action: string) => {
    setAiLoading(action)
    setAiResult(null)
    setAiError("")
    try {
      const res = await fetch("/api/v1/tickets/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ticketId, lang: aiLang }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const text = json.data.text
        if (action === "reply") {
          setNewComment(text)
        } else {
          setAiResult({ type: action, text })
        }
      } else {
        throw new Error(json?.errorKey === "supportAiDisabled" ? t("aiStateDisabled") : t("aiActionFailed"))
      }
    } catch (failure) {
      setAiError(failure instanceof Error ? failure.message : t("aiActionFailed"))
    } finally { setAiLoading(null) }
  }

  const handleReopen = async () => {
    if (!ticket || updatingStatus) return
    setUpdatingStatus(true)
    setSendError("")
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status: "open" }),
      })
      if (!res.ok) throw new Error(t("reopenFailed"))
      setTicket(current => current ? { ...current, status: "open", closedAt: null, resolvedAt: null } : current)
      setNewStatus("open")
      toast.success(t("ticketReopened"))
      void fetchTicket({ silent: true })
    } catch (failure) {
      setSendError(failure instanceof Error ? failure.message : t("reopenFailed"))
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleAutoAssign = async () => {
    setUpdatingAssignee(true)
    setActionError("")
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("actionPermissionError") : t("actionFailed"))
      toast.success(t("assignmentUpdated"))
      await fetchTicket()
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
    } finally { setUpdatingAssignee(false) }
  }

  const handleAssignToMe = async () => {
    const userId = session?.user?.id
    if (!userId) return
    setUpdatingAssignee(true)
    try {
      await updateTicketFields({ assignedTo: userId }, t("assignedToYou"))
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
    } finally { setUpdatingAssignee(false) }
  }

  const handleEscalate = async () => {
    setUpdatingStatus(true)
    try {
      await updateTicketFields({ priority: "critical" }, t("ticketEscalated"))
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
    } finally { setUpdatingStatus(false) }
  }

  if (loading) {
    return (
      <div data-testid="ticket-detail-loading" role="status" className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
        <span className="sr-only">{tc("loading")}</span>
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Link href={returnTo}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> {t("back")}</Button>
        </Link>
        <Card data-testid="ticket-detail-load-error">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
            <p>{error || t("ticketNotFound")}</p>
            <Button data-testid="ticket-detail-retry-load" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => { setError(""); setPermissionDenied(false); setLoading(true); void fetchTicket() }}>
              <RefreshCw className="h-3.5 w-3.5" /> {permissionDenied ? t("checkAccessAgain") : t("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusStyle = STATUS_STYLES[ticket.status] || STATUS_STYLES.new
  const priorityStyle = PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.medium
  const comments = ticket.comments || []
  const sortedComments = [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const filteredComments = showInternal ? sortedComments : sortedComments.filter(c => !c.isInternal)
  const composerAttachments = draftAttachmentIds
    .map(id => attachments.find(attachment => attachment.id === id))
    .filter((attachment): attachment is TicketAttachmentData => Boolean(attachment))
  const sla = getSlaTimeLeft(ticket.slaDueAt, ticket.status, t("statusResolved"), t("slaBreached"), t("hrAbbr"), t("minAbbr"), t("secAbbr")) // recalculates every `tick`
  void tick // ensure re-render on tick
  const channelLabels: Record<string, string> = {
    portal: t("channelPortal"),
    email: t("channelEmail"),
    whatsapp: t("channelWhatsapp"),
    web_chat: t("channelWebChat"),
    facebook: "Facebook",
    instagram: "Instagram",
    telegram: "Telegram",
    agent: t("channelAgent"),
  }
  const ticketChannel = ticket.source || "agent"
  const customerLabel = ticket.requesterName || ticket.contactName || ticket.companyName || t("unknownCustomer")
  const activeMacros = macros.filter(m => m.isActive)
  const openDeals = customerContext?.openDeals ?? []
  const storedClosureRequest = ticket.closureRequest
  const closureRequest = recentClosureRequest && (!storedClosureRequest || recentClosureRequest.id === storedClosureRequest.id)
    ? { ...(storedClosureRequest || {}), ...recentClosureRequest }
    : storedClosureRequest
  const closureStatusLabels: Record<string, string> = {
    pending: t("closureRequestPending"),
    confirmed: t("closureRequestConfirmed"),
    rejected: t("closureRequestRejected"),
    expired: t("closureRequestExpired"),
    canceled: t("closureRequestCanceled"),
  }
  const statusLabel = (value: string | null | undefined) => value ? STATUS_LABELS[value] || t("unknownStatus") : t("unknownStatus")
  const priorityLabel = (value: string | null | undefined) => value ? PRIORITY_LABELS[value] || t("unknownPriority") : t("unknownPriority")
  const categoryLabel = (value: string | null | undefined) => value ? CATEGORY_LABELS[value] || t("unknownCategory") : t("unknownCategory")
  const supportLevelLabel = (value: string | null | undefined) => value ? ({
    basic: t("supportLevelBasic"),
    standard: t("supportLevelStandard"),
    premium: t("supportLevelPremium"),
    enterprise: t("supportLevelEnterprise"),
  } as Record<string, string>)[value] || t("supportLevelUnknown") : t("supportLevelUnknown")
  const channelLabel = (value: string | null | undefined) => value ? channelLabels[value] || t("unknownChannel") : t("unknownChannel")
  const milestoneStatusLabel = (value: string | null | undefined) => value ? MILESTONE_STATUS_LABELS[value] || t("unknownMilestoneStatus") : t("unknownMilestoneStatus")
  const closureStatusLabel = (value: string | null | undefined) => value ? closureStatusLabels[value] || t("unknownClosureStatus") : t("unknownClosureStatus")
  const callStatusLabel = (value: string) => {
    const key = ({
      initiated: "initiated",
      ringing: "ringing",
      in_progress: "inProgress",
      completed: "completed",
      no_answer: "noAnswer",
      busy: "busy",
      failed: "failed",
    } as Record<string, string>)[value] || "unknown"
    return tv(`statusLabels.${key}`)
  }
  const closureIsPending = closureRequest?.status === "pending"
  const entitlementRiskLabel = ticket.entitlement
    ? ticket.entitlement.risk === "overdue"
      ? t("entitlementRiskOverdue")
      : ticket.entitlement.risk === "at_risk"
      ? t("entitlementRiskAtRisk")
      : ticket.entitlement.risk === "complete"
      ? t("entitlementRiskComplete")
      : t("entitlementRiskOnTrack")
    : ""
  const entitlementRiskClass = ticket.entitlement?.risk === "overdue"
    ? "border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/10"
    : ticket.entitlement?.risk === "at_risk"
    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/10"
    : "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/10"

  return (
    <SupportPageShell
      data-testid="ticket-detail-workspace"
      width="fluid"
      className="support-case-workspace"
      title={ticket.subject}
      titleSize="compact"
      leading={<>
        <Button data-testid="ticket-detail-back" variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={tc("back")} onClick={() => navigateSafely(returnTo)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
            variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9"
            disabled={!siblings.prev}
            aria-label={siblings.prev ? `${siblings.prev.ticketNumber}: ${siblings.prev.subject}` : tc("previousPage")}
            onClick={() => siblings.prev && navigateSafely(ticketDetailHref(siblings.prev.id, returnTo))}
            title={siblings.prev ? `${siblings.prev.ticketNumber}: ${siblings.prev.subject}` : ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        <Button
            variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9"
            disabled={!siblings.next}
            aria-label={siblings.next ? `${siblings.next.ticketNumber}: ${siblings.next.subject}` : tc("nextPage")}
            onClick={() => siblings.next && navigateSafely(ticketDetailHref(siblings.next.id, returnTo))}
            title={siblings.next ? `${siblings.next.ticketNumber}: ${siblings.next.subject}` : ""}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
      </>}
      utilities={<>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <TourReplayButton tourId="ticketDetail" />
              <HelpButton slug="ticket-detail" variant="label" className="shrink-0" />
            </div>
          <div className="flex min-h-11 items-center gap-2 sm:hidden">
            <TourReplayButton tourId="ticketDetail" className="min-h-11 px-2" />
            <HelpButton slug="ticket-detail" className="h-11 w-11 shrink-0" />
          </div>
      </>}
      description={<span className="flex flex-wrap items-center gap-2">
            <span data-tour-id="ticket-header-sla" className="text-xs text-muted-foreground font-mono">{ticket.ticketNumber}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {handleTimer >= 3600
                ? t("handleTimerHoursMinutes", { hours: Math.floor(handleTimer / 3600), minutes: Math.floor((handleTimer % 3600) / 60) })
                : t("handleTimerMinutesSeconds", { minutes: Math.floor(handleTimer / 60), seconds: (handleTimer % 60).toString().padStart(2, "0") })}
            </span>
            {ticket.category && <Badge variant="outline" className="text-xs">{categoryLabel(ticket.category)}</Badge>}
          </span>}
      actions={<div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-1 xl:w-auto xl:pb-0">
          {ticket.status !== "resolved" && ticket.status !== "closed" && (
            <>
              <Button
                data-testid="ticket-escalate"
                size="sm" variant="outline"
                className="h-11 shrink-0 border-amber-300 text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30 sm:h-9"
                onClick={handleEscalate}
                disabled={ticket.priority === "critical" || updatingStatus}
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> {t("escalate")}
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-11 shrink-0 sm:h-9"
                onClick={handleAssignToMe}
                disabled={updatingAssignee}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" /> {t("assignToMe")}
              </Button>
            </>
          )}
          {ticket.category !== "complaint" && (
            <Button
              size="sm" variant="outline"
              className="h-11 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20 sm:h-9"
              onClick={() => setConvertOpen(true)}
              title={t("complaintsMoveFull")}
            >
              <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> {t("complaintsMove")}
            </Button>
          )}
          {ticket.category === "complaint" && (
              <Button size="sm" variant="outline" className="h-11 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300 sm:h-9" onClick={() => navigateSafely(`/complaints/${ticketId}`)}>
                <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> {t("inComplaints")}
              </Button>
          )}
          {/* Macros dropdown — click toggle */}
          {activeMacros.length > 0 && (
            <div className="relative">
              <Button data-tour-id="ticket-macros" size="sm" variant="outline" className="h-11 shrink-0 sm:h-9" onClick={() => setShowMacrosMenu(!showMacrosMenu)}>
                <Zap className="mr-1 h-3.5 w-3.5" /> {tc("macros")}
              </Button>
              {showMacrosMenu && (
                <>
                  <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-10 cursor-default" onClick={() => setShowMacrosMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-card border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-1 min-w-[200px] z-20">
                    {activeMacros.map(m => (
                      <button
                        key={m.id}
                        disabled={Boolean(applyingMacroId)}
                        className="flex min-h-11 w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        onClick={() => {
                          setShowMacrosMenu(false)
                          void applyMacro(m)
                        }}
                      >
                        <span>{applyingMacroId === m.id ? tm("applying") : m.name}</span>
                        {m.shortcutKey && <kbd className="text-xs bg-muted px-1 rounded ml-2">{m.shortcutKey}</kbd>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Customer 360 toggle */}
          <Button data-testid="ticket-context-toggle" size="sm" className="h-11 shrink-0 sm:h-9" variant={showContext ? "default" : "outline"} onClick={() => setShowContext(!showContext)}>
            <UserCheck className="h-3.5 w-3.5 mr-1" /> 360
          </Button>
          {/* Shortcuts help */}
          <Button aria-label={tsk("title")} size="icon" variant="ghost" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" onClick={() => setShowShortcuts(!showShortcuts)} title={tsk("title")}>
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>}
    >

      {/* Shortcuts help panel */}
      {showShortcuts && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-muted/30">
          <h3 className="text-xs font-semibold mb-2">{tsk("title")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {TICKET_SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center gap-2 text-xs">
                <kbd className="px-1.5 py-0.5 bg-card rounded border border-zinc-200 dark:border-zinc-700 text-xs font-mono">{s.keys}</kbd>
                <span className="text-muted-foreground">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {staleTicket && (
        <div data-testid="ticket-detail-stale" role="status" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("staleTicketHint")}</span>
          <Button data-testid="ticket-detail-retry-stale" size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => void fetchTicket()}><RefreshCw className="h-3.5 w-3.5" /> {t("retry")}</Button>
        </div>
      )}

      {/* Customer 360 moved to sidebar below */}

      {/* Status Pipeline */}
      <div className="flex min-w-0 max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-card p-1 dark:border-zinc-700" aria-label={t("statusProgress")}>
        {STATUS_PIPELINE.map((s, i) => {
          const isCurrent = ticket.status === s
          const currentIdx = STATUS_PIPELINE.indexOf(ticket.status)
          const isPast = i < currentIdx
          const color = STATUS_PIPELINE_COLORS[s]

          return (
            <button
              key={s}
              onClick={async () => {
                if (s === ticket.status) return
                setUpdatingStatus(true)
                try {
                  await updateTicketFields({ status: s }, t("statusUpdated"))
                } catch (failure) {
                  setActionError(failure instanceof Error ? failure.message : t("actionFailed"))
                } finally { setUpdatingStatus(false) }
              }}
              aria-pressed={isCurrent}
              className={`relative min-h-11 min-w-[7rem] flex-1 rounded-md px-2 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                isCurrent
                  ? `${color} shadow-sm`
                  : isPast
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
              disabled={updatingStatus}
            >
              {statusLabel(s)}
            </button>
          )
        })}
      </div>

      {/* Stable case spine: the facts needed for the next action remain reachable on desktop. */}
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card shadow-sm sm:grid-cols-4 lg:sticky lg:top-2 lg:z-10 xl:grid-cols-7">
        {[
          { label: t("customerLabel"), value: customerLabel },
          { label: t("channelLabel"), value: channelLabel(ticketChannel) },
          { label: t("assignedLabel"), value: ticket.assigneeName || t("notAssigned") },
          { label: t("statusLabel"), value: statusLabel(ticket.status) },
          { label: t("priorityLabel"), value: priorityLabel(ticket.priority) },
          { label: t("slaResolution"), value: sla.text },
        ].map(item => (
          <div key={item.label} className="min-w-0 border-b border-r p-2.5 xl:border-b-0">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</span>
            <span className="mt-1 block truncate text-xs font-semibold" title={item.value}>{item.value}</span>
          </div>
        ))}
        <div className="col-span-3 flex items-center p-2 sm:col-span-2 xl:col-span-1">
          {ticket.status === "closed" ? (
            <Button size="sm" variant="outline" className="h-11 w-full sm:h-9" disabled={updatingStatus} onClick={() => void handleReopen()}>{t("reopenTicket")}</Button>
          ) : !ticket.assignedTo ? (
            <Button size="sm" className="h-11 w-full sm:h-9" disabled={updatingAssignee} onClick={() => void handleAssignToMe()}>{t("assignToMe")}</Button>
          ) : (
            <Button size="sm" className="h-11 w-full sm:h-9" onClick={() => { setIsInternal(false); commentRef.current?.focus() }}>{t("replyBtn")}</Button>
          )}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{actionError}</span>
          <Button type="button" size="sm" variant="ghost" className="h-11 sm:h-9" onClick={() => setActionError("")}>{tc("close")}</Button>
        </div>
      )}

      {/* SLA & Priority Warnings */}
      {sla.breached && ticket.status !== "resolved" && ticket.status !== "closed" && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-3">
          <Clock className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{t("slaBreachedWarning")}</p>
            <p className="text-xs text-red-600 dark:text-red-400">{t("slaDeadline")}: {formatDate(ticket.slaDueAt, locale)} · {t("priority")}: {priorityLabel(ticket.priority)}</p>
          </div>
          {!ticket.assignedTo && (
            <Button size="sm" variant="destructive" className="h-11 sm:h-9" onClick={handleAutoAssign} disabled={updatingAssignee}>
              <Zap className="h-3.5 w-3.5 mr-1" /> {t("assign")}
            </Button>
          )}
        </div>
      )}
      {!sla.breached && ticket.slaDueAt && ticket.status !== "resolved" && ticket.status !== "closed" && (() => {
        const hoursLeft = (new Date(ticket.slaDueAt).getTime() - Date.now()) / 3600000
        if (hoursLeft > 0 && hoursLeft < 2) return (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 flex items-center gap-3">
            <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">{t("slaExpiringWarning")}</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400">{t("slaRemaining")}: {sla.text} · {t("priority")}: {priorityLabel(ticket.priority)}</p>
            </div>
          </div>
        )
        return null
      })()}
      {(ticket.priority === "critical" || ticket.priority === "high") && !ticket.assignedTo && ticket.status !== "resolved" && ticket.status !== "closed" && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 text-orange-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-300">{t("highPriorityUnassigned")}</p>
            <p className="text-xs text-orange-600 dark:text-orange-400">{t("priority")}: {priorityLabel(ticket.priority)} · {t("requiresAssignment")}</p>
          </div>
          <Button size="sm" className="h-11 sm:h-9" onClick={handleAutoAssign} disabled={updatingAssignee}>
            <Zap className="h-3.5 w-3.5 mr-1" /> {t("autoAssign")}
          </Button>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        {/* Main content */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {/* Ticket info */}
          <details className="order-2 rounded-xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              {t("requestDetails")}<span className="text-xs font-normal text-muted-foreground">{t("expandDetails")}</span>
            </summary>
          <Card className="border-0 shadow-none">
            <CardHeader className="p-4">
              {editingSubject ? (
                <div className="flex items-center gap-2">
                  <input
                    aria-label={tc("subject")}
                    className="text-xl font-semibold bg-transparent border-b border-primary outline-none flex-1"
                    value={editSubject}
                    onChange={e => setEditSubject(e.target.value)}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === "Enter") handleSaveSubjectDesc("subject", editSubject)
                      if (e.key === "Escape") setEditingSubject(false)
                    }}
                  />
                  <Button size="sm" onClick={() => handleSaveSubjectDesc("subject", editSubject)} disabled={savingEdit}>
                    {savingEdit ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : tc("save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingSubject(false)}>{tc("cancel")}</Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="min-h-11 rounded-sm text-left text-base font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => { setEditSubject(ticket.subject); setEditingSubject(true) }}
                  title={tc("clickToEdit")}
                >
                  {ticket.subject}
                </button>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("companyLabel")}: <strong>{ticket.companyName || "—"}</strong></span>
                <span>{t("assignedLabel")}: <strong>{ticket.assigneeName || t("notAssigned")}</strong></span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("priorityLabel")}: <strong>{priorityLabel(ticket.priority)}</strong></span>
                <span>{t("categoryLabel")}: <strong>{categoryLabel(ticket.category)}</strong></span>
              </div>
              {editingDesc ? (
                <div className="mt-3 space-y-2">
                  <Textarea
                    aria-label={tc("description")}
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    rows={4}
                    autoFocus
                    onKeyDown={e => { if (e.key === "Escape") setEditingDesc(false) }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveSubjectDesc("description", editDesc)} disabled={savingEdit}>
                      {savingEdit ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : tc("save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>{tc("cancel")}</Button>
                  </div>
                </div>
              ) : (() => {
                // Auto-generated WhatsApp / web-chat transcripts render as a styled chat (bubbles +
                // platform & AI-engine badges); everything else keeps the plain click-to-edit text.
                const parsedChat = parseChatDescription(ticket.description)
                if (parsedChat) {
                  return (
                    <div className="mt-3">
                      <div className="-mb-1 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs text-muted-foreground"
                          onClick={() => { setEditDesc(ticket.description || ""); setEditingDesc(true) }}
                        >
                          <Pencil className="h-3 w-3" /> {tc("edit")}
                        </Button>
                      </div>
                      <ChatHistoryView parsed={parsedChat} />
                    </div>
                  )
                }
                return (
                  <button
                    type="button"
                    className="mt-3 min-h-11 w-full rounded-lg bg-muted/50 p-3 text-left hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    onClick={() => { setEditDesc(ticket.description || ""); setEditingDesc(true) }}
                    title={tc("clickToEdit")}
                  >
                    <p className="text-sm whitespace-pre-wrap">{ticket.description || tc("noDescription")}</p>
                  </button>
                )
              })()}
            </CardHeader>
          </Card>
          </details>

          {/* Comments */}
          <Card data-tour-id="ticket-comments" className="order-1">
            <CardHeader className="flex flex-col items-start gap-2 p-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">{t("comments")} ({filteredComments.length})</CardTitle>
              <Button variant="ghost" size="sm" className="h-11 max-w-full whitespace-normal sm:h-9" onClick={() => setShowInternal(!showInternal)}>
                <Lock className="h-3.5 w-3.5 mr-1" />
                {showInternal ? t("hideInternal") : t("showInternal")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4">
              {filteredComments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">{t("noComments")}</p>
              )}
              {filteredComments.map(comment => {
                // Inbound email replies get a 📧 prefix from /api/v1/public/email-inbound.
                // Strip it from the visible text and render a "via email" badge instead.
                const viaEmail = typeof comment.comment === "string" && comment.comment.startsWith("📧 ")
                const visibleText = viaEmail ? comment.comment.slice(2).trimStart() : comment.comment
                // Synced WhatsApp/web chat comments ("[Клиент (WhatsApp)] …" / "[Da Vinci Bot] …")
                // render as messenger bubbles to match the description chat view; agent replies,
                // internal notes and email replies keep the avatar layout.
                const chat = !comment.isInternal && !viaEmail ? parseCommentSender(visibleText) : null
                if (chat) {
                  return (
                    <div key={comment.id} className="space-y-1.5">
                      <ChatBubble
                        sender={chat.sender}
                        label={chat.sender === "customer"
                          ? t("chatHistoryCustomer")
                          : /^(?:operator|agent|оператор|агент|менеджер)$/i.test(chat.name)
                            ? t("chatHistoryOperator")
                            : t("chatHistoryAssistant")}
                        channel={chat.channel}
                        text={chat.body}
                        footer={formatDate(comment.createdAt, locale)}
                      />
                      {comment.attachments?.map(attachment => (
                        <a
                          key={attachment.id}
                          href={`/uploads/tickets/${encodeURIComponent(attachment.fileName)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-11 flex min-h-11 max-w-sm items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{attachment.originalName}</span>
                          <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.fileSize, locale)}</span>
                        </a>
                      ))}
                    </div>
                  )
                }
                return (
                  <div key={comment.id} className={`flex gap-3 rounded-lg px-3 py-2 ${comment.isInternal ? "bg-amber-50/70 dark:bg-amber-950/20" : viaEmail ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium flex-shrink-0">
                      {getInitials(comment.userName || tc("system"))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${comment.isInternal ? "text-amber-700 dark:text-amber-400" : viaEmail ? "text-sky-700 dark:text-sky-400" : ""}`}>
                          {comment.userName || tc("system")}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt, locale)}</span>
                        {comment.isInternal && (
                          <Badge variant="outline" className="text-xs h-4 border-amber-400 text-amber-600">
                            <Lock className="h-2.5 w-2.5 mr-0.5" /> {t("internalBadge")}
                          </Badge>
                        )}
                        {viaEmail && (
                          <Badge variant="outline" className="text-xs h-4 border-sky-400 text-sky-600">
                            ✉ {t("viaEmailBadge")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{visibleText}</p>
                      {comment.attachments?.map(attachment => (
                        <a
                          key={attachment.id}
                          href={`/uploads/tickets/${encodeURIComponent(attachment.fileName)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 flex min-h-11 max-w-sm items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{attachment.originalName}</span>
                          <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.fileSize, locale)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })}

              {/* Comment input area */}
              <div className="space-y-3 border-t pt-4">
                {ticket.status === "closed" && (
                  <div data-testid="ticket-closed-state" role="status" className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>{t("closedComposerHint")}</span>
                    <Button data-testid="ticket-reopen" size="sm" variant="outline" className="h-11 sm:h-9" disabled={updatingStatus} onClick={() => void handleReopen()}>
                      {updatingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      {t("reopenTicket")}
                    </Button>
                  </div>
                )}
                {draftRecovered && newComment.trim() && (
                  <p role="status" className="text-xs text-muted-foreground">{t("draftRecovered")}</p>
                )}
                <div className="flex w-fit rounded-full border bg-card p-0.5" role="group" aria-label={t("messageVisibility")}>
                  <button
                    data-testid="ticket-compose-reply"
                    type="button"
                    aria-pressed={!isInternal}
                    onClick={() => setIsInternal(false)}
                    disabled={sending || ticket.status === "closed"}
                    className={`h-11 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${!isInternal ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Send className="mr-1.5 inline h-3.5 w-3.5" />{t("replyBtn")}
                  </button>
                  <button
                    data-testid="ticket-compose-internal"
                    type="button"
                    aria-pressed={isInternal}
                    onClick={() => setIsInternal(true)}
                    disabled={sending || ticket.status === "closed"}
                    className={`h-11 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${isInternal ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Lock className="mr-1.5 inline h-3.5 w-3.5" />{t("internalNote")}
                  </button>
                </div>
                <label htmlFor="ticket-comment-composer" className="sr-only">
                  {isInternal ? t("internalNotePlaceholder") : t("replyPlaceholder")}
                </label>
                <Textarea
                  id="ticket-comment-composer"
                  data-testid="ticket-comment-composer"
                  ref={commentRef}
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder={isInternal ? t("internalNotePlaceholder") : t("replyPlaceholder")}
                  rows={4}
                  disabled={sending || ticket.status === "closed"}
                  aria-describedby={sendError ? "ticket-send-error" : isInternal ? "ticket-internal-note-hint" : undefined}
                  className={isInternal ? "border-amber-300 bg-amber-50/30 focus-visible:ring-amber-300/30 dark:border-amber-900 dark:bg-amber-950/10" : "bg-background"}
                />

                <div className="space-y-2" aria-busy={attachmentUploading || attachmentLoading}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={attachmentInputRef}
                      id="ticket-attachment-input"
                      data-testid="ticket-attachment-input"
                      type="file"
                      className="peer sr-only"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
                      disabled={attachmentUploading || ticket.status === "closed" || draftAttachmentIds.length >= 10}
                      onChange={event => {
                        const file = event.target.files?.[0]
                        if (file) void handleUploadAttachment(file)
                      }}
                    />
                    <label
                      htmlFor="ticket-attachment-input"
                      aria-disabled={attachmentUploading || ticket.status === "closed" || draftAttachmentIds.length >= 10}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-9"
                    >
                      {attachmentUploading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                        : <Paperclip className="h-3.5 w-3.5" />}
                      {attachmentUploading ? t("attachmentUploading") : t("attachFile")}
                    </label>
                    <span className="text-xs text-muted-foreground">{t("attachmentHint")}</span>
                  </div>

                  {composerAttachments.length > 0 && (
                    <ul className="grid gap-1.5" aria-label={t("draftAttachments")}>
                      {composerAttachments.map(attachment => (
                        <li key={attachment.id} className="flex min-h-11 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <a
                            href={`/uploads/tickets/${encodeURIComponent(attachment.fileName)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          >
                            {attachment.originalName}
                          </a>
                          <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.fileSize, locale)}</span>
                          {!attachment.commentId && attachment.uploadedBy === session?.user?.id && (
                            <button
                              type="button"
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                              aria-label={`${t("removeAttachment")}: ${attachment.originalName}`}
                              disabled={attachmentUploading}
                              onClick={() => void handleRemoveAttachment(attachment.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {attachmentLoading && draftAttachmentIds.length > 0 && (
                    <p role="status" className="text-xs text-muted-foreground">{t("attachmentLoading")}</p>
                  )}
                  {!attachmentLoading && draftAttachmentIds.length > composerAttachments.length && (
                    <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t("attachmentUnavailable")}</p>
                  )}
                  {attachmentError && (
                    <div data-testid="ticket-attachment-error" role="alert" className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
                      <span>{attachmentError}</span>
                      <div className="flex gap-2">
                        {failedAttachment && (
                          <Button data-testid="ticket-retry-attachment" type="button" size="sm" variant="outline" className="h-11 sm:h-9" disabled={attachmentUploading} onClick={() => void handleUploadAttachment(failedAttachment)}>
                            {t("retryAttachment")}
                          </Button>
                        )}
                        {!failedAttachment && (
                          <Button type="button" size="sm" variant="outline" className="h-11 sm:h-9" disabled={attachmentLoading} onClick={() => void fetchAttachments()}>
                            {t("retry")}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {sendError && (
                  <div id="ticket-send-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
                    <span>{sendError}</span>
                    {ticket.status !== "closed" && <Button data-testid="ticket-retry-send" type="button" size="sm" variant="outline" className="h-11 sm:h-9" disabled={sending || attachmentUploading || !newComment.trim()} onClick={() => void handleSendComment()}>{t("retrySend")}</Button>}
                  </div>
                )}

                {/* Reply buttons row */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="ticket-send-message"
                    size="sm"
                    onClick={() => void handleSendComment()}
                    disabled={sending || attachmentUploading || !newComment.trim() || ticket.status === "closed"}
                    className={isInternal ? "h-11 bg-amber-700 hover:bg-amber-800 sm:h-9" : "h-11 sm:h-9"}
                  >
                    {sending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    {isInternal ? t("addInternalNote") : t("replyBtn")}
                  </Button>

                  <div className="mx-1 h-6 border-l" />

                  {supportAiEnabled && ticket.status !== "closed" && (
                    <>
                      {/* Da Vinci language selector */}
                      <select
                        value={aiLang}
                        onChange={e => setAiLang(e.target.value)}
                        aria-label={t("aiLanguage")}
                        className="h-11 rounded-md border border-zinc-200 bg-background px-2 text-xs dark:border-zinc-700 sm:h-9"
                      >
                        <option value="ru">{t("languageRussian")}</option>
                        <option value="az">{t("languageAzerbaijani")}</option>
                        <option value="en">{t("languageEnglish")}</option>
                      </select>

                      {/* Da Vinci buttons */}
                      <Button
                        data-tour-id="ticket-ai-draft"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("reply")}
                        disabled={aiLoading !== null}
                        className="h-11 text-foreground sm:h-9"
                      >
                        {aiLoading === "reply" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
                        {t("aiReply")}
                      </Button>
                      <Button
                        data-tour-id="ticket-ai-summary"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("summary")}
                        disabled={aiLoading !== null}
                        className="h-11 text-foreground sm:h-9"
                      >
                        {aiLoading === "summary" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
                        {t("aiSummary")}
                      </Button>
                      <Button
                        data-tour-id="ticket-ai-steps"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("steps")}
                        disabled={aiLoading !== null}
                        className="h-11 text-foreground sm:h-9"
                      >
                        {aiLoading === "steps" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                        {t("aiSteps")}
                      </Button>
                    </>
                  )}
                </div>

                {!supportAiEnabled && (
                  <div
                    data-testid="ticket-ai-state"
                    data-state={!orgId || supportAiLoading ? "loading" : supportAiStateError ? "unavailable" : !supportAiHasLoaded ? "loading" : "disabled"}
                    className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span role="status">{!orgId || supportAiLoading ? t("aiStateLoading") : supportAiStateError ? t("aiStateUnavailable") : !supportAiHasLoaded ? t("aiStateLoading") : t("aiStateDisabled")}</span>
                    {supportAiStateError && (
                      <Button data-testid="ticket-ai-retry-state" type="button" size="sm" variant="ghost" className="h-11 px-2 sm:h-8" disabled={supportAiLoading} onClick={() => void reloadSupportAi()}>
                        <RefreshCw className="h-3.5 w-3.5" /> {t("retry")}
                      </Button>
                    )}
                  </div>
                )}
                {aiError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{aiError}</p>}

                {isInternal && (
                  <p id="ticket-internal-note-hint" className="text-xs text-amber-700 dark:text-amber-300">{t("internalNoteHint")}</p>
                )}

                {/* Da Vinci Result display */}
                {aiResult && (
                  <div className="rounded-lg border border-zinc-200 bg-muted/50 p-3 dark:border-zinc-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-foreground" />
                      <span className="text-xs font-medium text-foreground">
                        {aiResult.type === "summary" ? t("aiSummaryLabel") : t("aiStepsLabel")}
                      </span>
                      <button type="button" aria-label={tc("close")} onClick={() => setAiResult(null)} className="ml-auto flex h-11 w-11 items-center justify-center rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-8 sm:w-8">✕</button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{aiResult.text}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Inline actions: Status + Reassign */}
          <Card className="order-3">
            <CardContent className="space-y-3 p-4">
              {/* Status change */}
              <div className="flex flex-wrap items-center gap-2">
                <Select data-testid="ticket-status-select" aria-label={tc("status")} value={newStatus} onChange={e => setNewStatus(e.target.value)} className="h-11 w-48 sm:h-9">
                  <option value="new">{t("statusNew")}</option>
                  <option value="open">{t("statusOpen")}</option>
                  <option value="in_progress">{t("statusInProgress")}</option>
                  <option value="waiting">{t("statusWaiting")}</option>
                  <option value="resolved">{t("statusResolved")}</option>
                  <option value="closed">{t("statusClosed")}</option>
                </Select>
                <Button
                  data-testid="ticket-status-submit"
                  data-state={updatingStatus ? "saving" : newStatus === ticket.status ? "synced" : "ready"}
                  onClick={handleUpdateStatus}
                  disabled={updatingStatus || newStatus === ticket.status}
                  className="h-11 bg-foreground text-background hover:bg-foreground/90 sm:h-9"
                >
                  {updatingStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  {t("updateStatus")}
                </Button>
              </div>

              {/* Reassign */}
              <div className="flex flex-wrap items-center gap-2">
                <Select data-testid="ticket-assignee-select" aria-label={tc("assigned")} value={newAssignee} onChange={e => setNewAssignee(e.target.value)} className="h-11 w-48 sm:h-9">
                  <option value="">{t("unassignedOption")}</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </Select>
                <Button
                  data-testid="ticket-assignee-submit"
                  data-state={updatingAssignee ? "saving" : newAssignee === (ticket.assignedTo || "") ? "synced" : "ready"}
                  variant="outline"
                  onClick={handleReassign}
                  disabled={updatingAssignee || newAssignee === (ticket.assignedTo || "")}
                  className="h-11 text-foreground sm:h-9"
                >
                  {updatingAssignee ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
                  {t("reassign")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAutoAssign}
                  disabled={updatingAssignee}
                  className="h-11 text-foreground sm:h-9"
                >
                  {updatingAssignee ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                  {t("auto")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <details data-testid="ticket-secondary-context" className="self-start rounded-xl border bg-card lg:sticky lg:top-24">
          <summary data-testid="ticket-secondary-context-toggle" className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
            {t("secondaryContext")}<span className="text-xs font-normal text-muted-foreground">{t("expandDetails")}</span>
          </summary>
          <div className="space-y-3 p-2 pt-0">
          <AdvisorRecordWidget entityType="ticket" entityId={ticket.id} orgId={orgId ? String(orgId) : undefined} title={t("advisorRisk")} />

          {ticket.entitlement && (
            <Card className={entitlementRiskClass}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  {t("entitlementCard")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-xs capitalize">
                    {supportLevelLabel(ticket.entitlement.supportLevel)}
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground">{entitlementRiskLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-background/70 p-2">
                    <span className="block text-muted-foreground">{t("companyLabel")}</span>
                    <span className="block truncate font-medium">{ticket.entitlement.companyName || "—"}</span>
                  </div>
                  <div className="rounded-md bg-background/70 p-2">
                    <span className="block text-muted-foreground">{t("entitlementSlaPolicy")}</span>
                    <span className="block truncate font-medium">{ticket.entitlement.slaPolicyName || t("slaNotSet")}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{t("entitlementMilestones")}</span>
                    <span className="text-muted-foreground">
                      {ticket.entitlement.counts.open}/{ticket.entitlement.counts.total}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {ticket.entitlement.milestones.map((milestone) => {
                      const openMilestone = milestone.status === "pending" || milestone.status === "in_progress" || milestone.status === "missed"
                      const overdue = openMilestone && new Date(milestone.dueAt).getTime() <= Date.now()
                      const soon = openMilestone && !overdue && new Date(milestone.dueAt).getTime() <= Date.now() + 24 * 60 * 60 * 1000
                      const waiverOpen = waivingMilestoneId === milestone.id
                      const statusTone = milestone.status === "met" || milestone.status === "waived"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : overdue
                        ? "text-red-700 dark:text-red-300"
                        : soon
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground"
                      return (
                        <div key={milestone.id} className="rounded-md border border-border/70 bg-background/70 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-medium">
                              {MILESTONE_TYPE_LABELS[milestone.type] || milestone.definitionName || t("unknownMilestoneType")}
                            </span>
                            <span className={`shrink-0 text-xs font-medium ${statusTone}`}>
                              {milestoneStatusLabel(milestone.status)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{milestone.isRequired ? t("entitlementRequired") : t("entitlementOptional")}</span>
                            <span className={statusTone}>{formatDate(milestone.dueAt, locale)}</span>
                          </div>
                          {milestone.waivedReason && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("entitlementWaiveReason")}: {milestone.waivedReason}
                            </p>
                          )}
                          {openMilestone && (
                            <div className="mt-2 border-t border-border/60 pt-2">
                              {waiverOpen ? (
                                <div className="space-y-2">
                                  <Textarea
                                    aria-label={t("entitlementWaiveReason")}
                                    value={waiverReasons[milestone.id] || ""}
                                    onChange={event => setWaiverReasons(prev => ({ ...prev, [milestone.id]: event.target.value }))}
                                    placeholder={t("entitlementWaivePlaceholder")}
                                    className="min-h-[56px] text-xs"
                                  />
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-11 px-2 text-xs sm:h-7"
                                      onClick={() => setWaivingMilestoneId(null)}
                                    >
                                      {t("entitlementWaiveCancel")}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-11 px-2 text-xs sm:h-7"
                                      disabled={savingWaiverId === milestone.id || !(waiverReasons[milestone.id] || "").trim()}
                                      onClick={() => handleWaiveMilestone(milestone.id)}
                                    >
                                      {savingWaiverId === milestone.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" /> : null}
                                      {t("entitlementWaiveConfirm")}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => setWaivingMilestoneId(milestone.id)}
                                >
                                  {t("entitlementWaive")}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {closureRequest && (
            <Card className={closureIsPending ? "border-blue-200 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/10" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className={closureIsPending ? "h-4 w-4 text-blue-600" : "h-4 w-4 text-muted-foreground"} />
                  {t("closureRequestCard")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={closureIsPending ? "default" : "outline"} className="text-xs">
                    {closureStatusLabel(closureRequest.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(closureRequest.dueAt, locale)}</span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {closureIsPending ? t("closureRequestSentDesc") : t("closureRequestFinalDesc")}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-background/70 p-2">
                    <span className="block text-muted-foreground">{t("closureRequestChannel")}</span>
                    <span className="font-medium">{closureRequest.channel || "—"}</span>
                  </div>
                  <div className="rounded-md bg-background/70 p-2">
                    <span className="block text-muted-foreground">{t("closureRequestRecipient")}</span>
                    <span className="block truncate font-medium">{closureRequest.recipient || "—"}</span>
                  </div>
                </div>
                {closureIsPending && (
                  <div className="rounded-md border border-blue-200/70 bg-background/70 p-2 text-xs text-muted-foreground dark:border-blue-900/60">
                    {t("closureRequestAutoClose")}: <span className="font-medium text-foreground">{formatDate(closureRequest.dueAt, locale)}</span>
                  </div>
                )}
                {closureRequest.confirmationUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => closureRequest.confirmationUrl && handleCopyClosureLink(closureRequest.confirmationUrl)}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    {closureLinkCopied ? t("closureRequestLinkCopied") : t("closureRequestCopyLink")}
                  </Button>
                ) : closureIsPending ? (
                  <p className="text-xs text-muted-foreground">{t("closureRequestNoLink")}</p>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Customer 360 Context — collapsible */}
          {showContext && contextLoading && <p data-testid="ticket-context-loading" role="status" className="rounded-lg border p-3 text-xs text-muted-foreground">{t("contextLoading")}</p>}
          {showContext && contextError && !customerContext && (
            <div data-testid="ticket-context-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <span>{t("contextUnavailable")}</span>
              <Button data-testid="ticket-context-retry" type="button" size="sm" variant="outline" className="h-11 shrink-0 sm:h-9" disabled={contextLoading} onClick={() => setContextRetryKey((value) => value + 1)}>
                <RefreshCw className="h-3.5 w-3.5" /> {t("retry")}
              </Button>
            </div>
          )}
          {showContext && customerContext && (
            <Card data-testid="ticket-context-content">
              <CardHeader className="py-2">
                <button type="button" aria-expanded={!context360Collapsed} className="flex min-h-11 w-full items-center justify-between rounded text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => setContext360Collapsed(c => !c)}>
                  {t360("title")}
                  <span className="text-muted-foreground text-xs">{context360Collapsed ? "+" : "−"}</span>
                </button>
              </CardHeader>
              {!context360Collapsed && <CardContent className="space-y-4 text-sm">
                {/* Contact */}
                <div>
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("contact")}</h4>
                  {customerContext.contact ? (
                    <div className="space-y-1.5">
                      <p className="font-medium">{customerContext.contact.fullName}</p>
                      <p className="text-xs text-muted-foreground">{customerContext.contact.position}</p>
                      <p className="text-xs">{customerContext.contact.email}</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs">{customerContext.contact.phone}</p>
                        {customerContext.contact.phone ? (
                          <ClickToCallButton
                            phone={customerContext.contact.phone}
                            contactId={customerContext.contact.id ?? undefined}
                            companyId={customerContext.company?.id ?? undefined}
                            ticketId={ticket.id}
                            contactName={customerContext.contact.fullName ?? undefined}
                            showLabel
                            label={tc("call")}
                            className="h-7 gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-900/40 dark:bg-green-950/25 dark:text-green-300"
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">{t360("noContact")}</p>}
                </div>
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">{t("calls")}</h4>
                  {ticketCalls.length > 0 ? (
                    <div className="space-y-1.5">
                      {ticketCalls.map((call) => (
                        <div key={call.id} className="rounded-md border bg-muted/25 px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{call.direction === "inbound" ? call.fromNumber : call.toNumber}</span>
                            <Badge variant="outline" className="text-xs">{callStatusLabel(call.status)}</Badge>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{new Date(call.createdAt).toLocaleString(locale)}</span>
                            {call.recordingPlaybackUrl ? (
                              <a href={call.recordingPlaybackUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                <Play className="h-3 w-3" />
                                {t("recording")}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("noCalls")}</p>
                  )}
                </div>
                {/* Company */}
                {customerContext.company && (
                  <div>
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("company")}</h4>
                    <p className="font-medium">{customerContext.company.name}</p>
                    <p className="text-xs text-muted-foreground">{customerContext.company.industry}</p>
                    <p className="text-xs">{t360("ltv")}: ${(customerContext.lifetimeValue || 0).toLocaleString(locale)}</p>
                  </div>
                )}
                {/* Recent Tickets */}
                <div>
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("recentTickets")} ({customerContext.recentTickets?.length || 0})</h4>
                  <div className="space-y-1">
                    {(customerContext.recentTickets || []).map(rt => (
                      <button key={rt.id} type="button" onClick={() => navigateSafely(ticketDetailHref(rt.id, returnTo))} className="block min-h-11 w-full truncate text-left text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                        <span className="font-mono">{rt.ticketNumber}</span> {rt.subject}
                        <Badge className="ml-1 px-1 text-xs">{STATUS_LABELS[rt.status] || t360("statusOther")}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Open Deals */}
                {openDeals.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("openDeals")} ({openDeals.length})</h4>
                    {openDeals.map(d => (
                      <p key={d.id} className="text-xs">
                        {d.name} — {d.valueAmount?.toLocaleString(locale)} {d.currency || "AZN"} ({d.stage ? dealStageLabel(d.stage) : t360("stageOther")})
                      </p>
                    ))}
                  </div>
                )}
                {/* Recent Activity */}
                <div>
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("recentActivity")}</h4>
                  <div className="space-y-1">
                    {(customerContext.recentActivity || []).slice(0, 5).map(act => (
                      <p key={act.id} className="text-xs truncate">
                        <span className="font-medium">{ACTIVITY_TYPE_LABELS[act.type.toLowerCase()] || t360("activityOther")}</span>: {act.subject}
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>}
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1">{t("detailsCard")} <InfoHint text={t("hintColSubject")} size={12} /></CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("statusLabel")}</span>
                <Badge className={statusStyle.className}>{statusLabel(ticket.status)}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("priorityLabel")}</span>
                <Badge className={priorityStyle.className}>{priorityLabel(ticket.priority)}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("categoryLabel")}</span>
                <span>{categoryLabel(ticket.category)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("createdLabel")}</span>
                <span>{formatDate(ticket.createdAt, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("updatedLabel")}</span>
                <span>{formatDate(ticket.updatedAt, locale)}</span>
              </div>
              {ticket.tags.length > 0 && (
                <div>
                  <span className="text-muted-foreground">{t("tagsLabel")}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ticket.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1">{t("peopleCard")} <InfoHint text={t("hintColAssigned")} size={12} /></CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t("assignedLabel")}</span>
                <p className="font-medium">{ticket.assigneeName || t("notAssigned")}</p>
              </div>
              {ticket.companyId && (
                <div>
                  <span className="text-muted-foreground">{t("companyLabel")}</span>
                  <p className="font-medium">{ticket.companyName || t("unknownCompany")}</p>
                </div>
              )}
              {ticket.contactId && (
                <div>
                  <span className="text-muted-foreground">{t("contactLabel")}</span>
                  <p className="font-medium">{ticket.contactName || ticket.requesterName || t("unknownCustomer")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> {t("slaCard")} <InfoHint text={t("hintColSla")} size={12} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("slaDeadline")}</span>
                <span>{ticket.slaDueAt ? formatDate(ticket.slaDueAt, locale) : t("slaNotSet")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("slaTimeRemaining")}</span>
                <span className={`font-mono font-medium ${sla.breached ? "text-red-600" : "text-green-600"}`}>
                  {sla.text}
                </span>
              </div>
              {ticket.firstResponseAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("slaFirstResponse")}</span>
                  <span className="text-green-600">{formatDate(ticket.firstResponseAt, locale)}</span>
                </div>
              )}
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("slaResolved")}</span>
                  <span>{formatDate(ticket.resolvedAt, locale)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Star className="h-3.5 w-3.5" /> {t("csatCard")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.satisfactionRating ? (
                <div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <Star key={i} className={`h-4 w-4 ${i <= ticket.satisfactionRating! ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                    ))}
                  </div>
                  {ticket.satisfactionComment && (
                    <p className="text-sm text-muted-foreground mt-1">{ticket.satisfactionComment}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("notRated")}</p>
              )}
            </CardContent>
          </Card>

          {/* Related KB Articles */}
          {kbArticles.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5" /> {t("kbArticles")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {kbArticles.slice(0, 3).map(article => (
                    <Link
                      key={article.id}
                      href={`/knowledge-base`}
                      className="block rounded-lg p-2 transition-colors hover:bg-muted/50 motion-reduce:transition-none"
                    >
                      <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{article.category || t("generalCategory")}</p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          </div>
        </details>
      </div>

      <ConvertToComplaintDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        ticketId={ticketId}
        orgId={orgId ? String(orgId) : undefined}
        onConverted={(id) => router.push(`/complaints/${id}`)}
      />
      <ConfirmDialog
        open={Boolean(pendingNavigation)}
        onOpenChange={(open) => { if (!open) setPendingNavigation(null) }}
        title={t("leaveWithDraftTitle")}
        description={t("leaveWithDraftHint")}
        confirmLabel={t("leaveKeepDraft")}
        confirmVariant="default"
        onConfirm={async () => {
          const target = pendingNavigation
          if (!target) return
          try {
            if (draftKey && (newComment.trim() || draftAttachmentIds.length > 0)) {
              localStorage.setItem(draftKey, serializeTicketReplyDraft(newComment, isInternal, draftAttachmentIds, clientRequestId))
            }
          } catch {}
          setPendingNavigation(null)
          router.push(target)
        }}
      />
    </SupportPageShell>
  )
}
