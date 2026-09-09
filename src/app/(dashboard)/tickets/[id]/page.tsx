"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { ArrowLeft, Clock, Send, Lock, Star, Loader2, Bot, FileText, Zap, UserCheck, RefreshCw, AlertTriangle, UserPlus, BookOpen, ChevronLeft, ChevronRight, Keyboard, Timer, Play, MessageSquareWarning, Pencil, CheckCircle2, Copy, ShieldCheck } from "lucide-react"
import { parseChatDescription, ChatHistoryView, parseCommentSender, ChatBubble } from "@/components/tickets/chat-history-view"
import { InfoHint } from "@/components/info-hint"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { useTicketShortcuts, TICKET_SHORTCUTS } from "@/hooks/use-ticket-shortcuts"
import { ConvertToComplaintDialog } from "@/components/convert-to-complaint-dialog"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { ClickToCallButton } from "@/components/call-widget"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"

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
  }>
  recentActivity?: Array<{
    id: string
    type: string
    subject: string
  }>
}

const STATUS_STYLES: Record<string, { className: string }> = {
  new: { className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  open: { className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300" },
  in_progress: { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  waiting: { className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300" },
  resolved: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  closed: { className: "bg-muted text-foreground" },
}

const STATUS_PIPELINE = ["new", "open", "in_progress", "waiting", "resolved", "closed"]
const STATUS_PIPELINE_COLORS: Record<string, string> = {
  new: "bg-blue-500",
  open: "bg-cyan-500",
  in_progress: "bg-yellow-500",
  waiting: "bg-purple-500",
  resolved: "bg-green-500",
  closed: "bg-muted-foreground/50",
}

const PRIORITY_STYLES: Record<string, { className: string }> = {
  critical: { className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  high: { className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300" },
  medium: { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  low: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
}

function formatDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
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
  const t360 = useTranslations("customer360")
  const tsk = useTranslations("ticketShortcuts")
  const params = useParams()
  useAutoTour("ticketDetail")
  const { data: session } = useSession()
  const ticketId = params.id as string
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tick, setTick] = useState(0) // live countdown tick
  const [newComment, setNewComment] = useState("")
  const [isInternal, setIsInternal] = useState(false)
  const [showInternal, setShowInternal] = useState(true)
  const [sending, setSending] = useState(false)

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
  const [aiLang, setAiLang] = useState("ru") // "ru" | "az" | "en"

  // Agent Desktop v2 features
  const router = useRouter()
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [siblings, setSiblings] = useState<{ prev: TicketSiblingData | null; next: TicketSiblingData | null }>({ prev: null, next: null })
  const [customerContext, setCustomerContext] = useState<CustomerContextData | null>(null)
  const [ticketCalls, setTicketCalls] = useState<TicketCallLog[]>([])
  const [showContext, setShowContext] = useState(true)
  const [context360Collapsed, setContext360Collapsed] = useState(false)
  const [macros, setMacros] = useState<TicketMacroData[]>([])
  const [handleTimer, setHandleTimer] = useState(0)
  const handleTimerValueRef = useRef(0)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showMacrosMenu, setShowMacrosMenu] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [waivingMilestoneId, setWaivingMilestoneId] = useState<string | null>(null)
  const [savingWaiverId, setSavingWaiverId] = useState<string | null>(null)
  const [waiverReasons, setWaiverReasons] = useState<Record<string, string>>({})
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const orgId = session?.user?.organizationId
  const {
    enabled: supportAiDisabled,
    loading: supportAiLoading,
    error: supportAiStateError,
  } = useOrganizationFeature(SUPPORT_AI_DISABLED_FEATURE, orgId)
  const supportAiEnabled = !supportAiLoading && !supportAiStateError && !supportAiDisabled
  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])

  const STATUS_LABELS: Record<string, string> = {
    new: t("statusNew"),
    open: t("statusOpen"),
    in_progress: t("statusInProgress"),
    waiting: t("statusWaiting"),
    resolved: t("statusResolved"),
    closed: t("statusClosed"),
  }

  const PRIORITY_LABELS: Record<string, string> = {
    critical: tc("critical"),
    high: tc("high"),
    medium: tc("medium"),
    low: tc("low"),
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
      const res = await fetch(`/api/v1/tickets/${ticketId}`)
      const json = await res.json()
      if (json.success) {
        setTicket(json.data)
        if (json.data.status !== "resolved") setRecentClosureRequest(null)
        if (!opts?.silent) {
          setNewStatus(json.data.status)
          setNewAssignee(json.data.assignedTo || "")
          // Fetch related KB articles by category/tags
          try {
            const kbRes = await fetch(`/api/v1/kb?limit=5&search=${encodeURIComponent(json.data.category || "")}`)
            const kbJson = await kbRes.json()
            if (kbJson.success) setKbArticles(kbJson.data?.articles || kbJson.data || [])
          } catch (err) { console.error(err) }
        }
      } else if (!opts?.silent) {
        setError(json.error || t("failedToLoad"))
      }
    } catch {
      if (!opts?.silent) setError(t("failedToLoad"))
    } finally {
      setLoading(false)
    }
  }, [ticketId, t])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users")
      const json = await res.json()
      if (json.success) setUsers(json.data || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchTicket(); fetchUsers() }, [fetchTicket, fetchUsers])

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
      fetch(`/api/v1/tickets/${ticketId}/context`, { headers }).then(r => r.json()).then(j => {
        if (j.success) setCustomerContext(j.data)
      }).catch(() => {})
    }
  }, [showContext, customerContext, ticketId, headers])

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

  // Keyboard shortcuts
  useTicketShortcuts({
    onReply: () => { setIsInternal(false); commentRef.current?.focus() },
    onInternalNote: () => { setIsInternal(true); commentRef.current?.focus() },
    onAssignToMe: () => {
      if (session?.user?.id) {
        fetch(`/api/v1/tickets/${ticketId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ assignedTo: session.user.id }),
        }).then(() => fetchTicket()).catch(() => {})
      }
    },
    onEscalate: () => { if (ticket?.priority !== "critical") handleEscalate() },
    onClose: () => {
      fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status: "closed" }),
      }).then(() => fetchTicket()).catch(() => {})
    },
    onPrevTicket: () => { if (siblings.prev) router.push(`/tickets/${siblings.prev.id}`) },
    onNextTicket: () => { if (siblings.next) router.push(`/tickets/${siblings.next.id}`) },
    onCopyNumber: () => { if (ticket?.ticketNumber) navigator.clipboard.writeText(ticket.ticketNumber) },
    onToggleShortcuts: () => setShowShortcuts(s => !s),
    macros: macros.filter(m => m.isActive).map(m => ({
      execute: () => {
        fetch(`/api/v1/ticket-macros/${m.id}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ ticketId }),
        }).then(() => fetchTicket()).catch(() => {})
      },
    })),
  })

  const handleSendComment = async () => {
    if (!newComment.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newComment, isInternal }),
      })
      const json = await res.json()
      if (json.success) {
        setNewComment("")
        fetchTicket()
      }
    } catch { /* ignore */ } finally { setSending(false) }
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
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        if (json?.closureRequest) {
          setRecentClosureRequest(json.closureRequest)
          setClosureLinkCopied(false)
        }
        fetchTicket()
      }
    } catch { /* ignore */ } finally { setUpdatingStatus(false) }
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
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: newAssignee || "" }),
      })
      if (res.ok) fetchTicket()
    } catch { /* ignore */ } finally { setUpdatingAssignee(false) }
  }

  const handleAiAction = async (action: string) => {
    setAiLoading(action)
    setAiResult(null)
    try {
      const res = await fetch("/api/v1/tickets/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ticketId, lang: aiLang }),
      })
      const json = await res.json()
      if (json.success) {
        const text = json.data.text
        if (action === "reply") {
          setNewComment(text)
        } else {
          setAiResult({ type: action, text })
        }
      }
    } catch { /* ignore */ } finally { setAiLoading(null) }
  }

  const handleAutoAssign = async () => {
    setUpdatingAssignee(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      })
      const json = await res.json()
      if (json.success) fetchTicket()
    } catch { /* ignore */ } finally { setUpdatingAssignee(false) }
  }

  const handleAssignToMe = async () => {
    const userId = session?.user?.id
    if (!userId) return
    setUpdatingAssignee(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: userId }),
      })
      if (res.ok) fetchTicket()
    } catch { /* ignore */ } finally { setUpdatingAssignee(false) }
  }

  const handleEscalate = async () => {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "critical" }),
      })
      if (res.ok) fetchTicket()
    } catch { /* ignore */ } finally { setUpdatingStatus(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Link href="/tickets">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> {t("back")}</Button>
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {error || t("ticketNotFound")}
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
  const sla = getSlaTimeLeft(ticket.slaDueAt, ticket.status, t("statusResolved"), t("slaBreached"), t("hrAbbr"), t("minAbbr"), t("secAbbr")) // recalculates every `tick`
  const slaFirstResponse = getSlaTimeLeft(ticket.slaFirstResponseDueAt, ticket.status, t("statusResolved"), t("slaBreached"), t("hrAbbr"), t("minAbbr"), t("secAbbr"))
  const hasFirstResponse = !!ticket.firstResponseAt
  void tick // ensure re-render on tick
  const daysOpen = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86400000)
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
    <div className="space-y-6">
      {/* Header with navigation */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/tickets">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        {/* Prev/Next navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            disabled={!siblings.prev}
            onClick={() => siblings.prev && router.push(`/tickets/${siblings.prev.id}`)}
            title={siblings.prev ? `${siblings.prev.ticketNumber}: ${siblings.prev.subject}` : ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            disabled={!siblings.next}
            onClick={() => siblings.next && router.push(`/tickets/${siblings.next.id}`)}
            title={siblings.next ? `${siblings.next.ticketNumber}: ${siblings.next.subject}` : ""}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold flex items-center gap-2 min-w-0"><span className="truncate">{ticket.subject}</span> <TourReplayButton tourId="ticketDetail" /><HelpButton slug="ticket-detail" variant="label" className="shrink-0" /></h1>
            <span data-tour-id="ticket-header-sla" className="text-xs text-muted-foreground font-mono">{ticket.ticketNumber}</span>
            {/* Handle timer */}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {handleTimer >= 3600
                ? `${Math.floor(handleTimer / 3600)}h ${Math.floor((handleTimer % 3600) / 60)}m`
                : `${Math.floor(handleTimer / 60)}m ${(handleTimer % 60).toString().padStart(2, "0")}s`}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={statusStyle.className}>{STATUS_LABELS[ticket.status] || ticket.status}</Badge>
            <Badge className={priorityStyle.className}>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</Badge>
            {ticket.category && <Badge variant="outline" className="text-xs">{ticket.category}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ticket.status !== "resolved" && ticket.status !== "closed" && (
            <>
              <Button
                size="sm" variant="outline"
                className="border-amber-300 text-amber-600 hover:bg-amber-50"
                onClick={handleEscalate}
                disabled={ticket.priority === "critical" || updatingStatus}
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> {t("escalate")}
              </Button>
              <Button
                size="sm" variant="outline"
                className="border-primary/30 text-primary hover:bg-primary/5"
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
              className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={() => setConvertOpen(true)}
              title={t("complaintsMoveFull")}
            >
              <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> {t("complaintsMove")}
            </Button>
          )}
          {ticket.category === "complaint" && (
            <Link href={`/complaints/${ticketId}`}>
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700">
                <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> {t("inComplaints")}
              </Button>
            </Link>
          )}
          {/* Macros dropdown — click toggle */}
          {activeMacros.length > 0 && (
            <div className="relative">
              <Button data-tour-id="ticket-macros" size="sm" variant="outline" onClick={() => setShowMacrosMenu(!showMacrosMenu)}>
                <Zap className="h-3.5 w-3.5 mr-1" /> {tc("macros") || "Macros"}
              </Button>
              {showMacrosMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMacrosMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-card border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-1 min-w-[200px] z-20">
                    {activeMacros.map(m => (
                      <button
                        key={m.id}
                        className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted flex items-center justify-between"
                        onClick={() => {
                          setShowMacrosMenu(false)
                          fetch(`/api/v1/ticket-macros/${m.id}/apply`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", ...headers },
                            body: JSON.stringify({ ticketId }),
                          }).then(() => fetchTicket()).catch(() => {})
                        }}
                      >
                        <span>{m.name}</span>
                        {m.shortcutKey && <kbd className="text-[10px] bg-muted px-1 rounded ml-2">{m.shortcutKey}</kbd>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Customer 360 toggle */}
          <Button size="sm" variant={showContext ? "default" : "outline"} onClick={() => setShowContext(!showContext)}>
            <UserCheck className="h-3.5 w-3.5 mr-1" /> 360
          </Button>
          {/* Shortcuts help */}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowShortcuts(!showShortcuts)} title={tsk("title")}>
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Shortcuts help panel */}
      {showShortcuts && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-muted/30">
          <h3 className="text-xs font-semibold mb-2">{tsk("title")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {TICKET_SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center gap-2 text-xs">
                <kbd className="px-1.5 py-0.5 bg-card rounded border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono">{s.keys}</kbd>
                <span className="text-muted-foreground">{s.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer 360 moved to sidebar below */}

      {/* Status Pipeline */}
      <div className="flex gap-0 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700">
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
                  const res = await fetch(`/api/v1/tickets/${ticketId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: s }),
                  })
                  if (res.ok) fetchTicket()
                } catch (err) { console.error(err) } finally { setUpdatingStatus(false) }
              }}
              className={`flex-1 py-2.5 px-2 text-xs font-medium text-center transition-all relative ${
                isCurrent
                  ? `${color} text-white shadow-inner`
                  : isPast
                  ? `${color}/20 text-foreground/70`
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
              }`}
              disabled={updatingStatus}
            >
              {STATUS_LABELS[s] || s}
            </button>
          )
        })}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-primary text-primary-foreground rounded-xl p-4 flex flex-col gap-1 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("daysOpen")}</span>
            <Clock className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-2xl font-bold">{daysOpen}</span>
        </div>
        <div className={`${sla.breached ? "bg-red-500" : sla.urgent ? "bg-amber-500" : "bg-green-500"} text-white rounded-xl p-4 flex flex-col gap-1 shadow-sm`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("slaResolution") || "SLA Resolution"}</span>
            <Clock className="h-4 w-4 opacity-80" />
          </div>
          {ticket.slaPolicyName && <span className="text-[10px] font-medium opacity-70">{ticket.slaPolicyName}</span>}
          <span className="text-lg font-bold leading-tight font-mono">{sla.text}</span>
        </div>
        <div className={`${hasFirstResponse ? "bg-green-500" : slaFirstResponse.breached ? "bg-red-500" : slaFirstResponse.urgent ? "bg-amber-500" : "bg-primary"} text-white rounded-xl p-4 flex flex-col gap-1 shadow-sm`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("slaFirstResponse")}</span>
            <Send className="h-4 w-4 opacity-80" />
          </div>
          {hasFirstResponse ? (
            <span className="text-lg font-bold leading-tight font-mono">
              {(() => {
                const ms = new Date(ticket.firstResponseAt!).getTime() - new Date(ticket.createdAt).getTime()
                const h = Math.floor(ms / 3600000)
                const m = Math.floor((ms % 3600000) / 60000)
                return h > 0 ? `${h}${t("hrAbbr")} ${m}${t("minAbbr")}` : `${m}${t("minAbbr")}`
              })()}
            </span>
          ) : (
            <span className="text-lg font-bold leading-tight font-mono">{slaFirstResponse.text}</span>
          )}
        </div>
        <div className={`${ticket.priority === "critical" ? "bg-red-500" : ticket.priority === "high" ? "bg-orange-500" : "bg-muted-foreground/50"} text-white rounded-xl p-4 flex flex-col gap-1 shadow-sm`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("priorityLabel")}</span>
            <AlertTriangle className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-xl font-bold capitalize">{PRIORITY_LABELS[ticket.priority] || ticket.priority}</span>
        </div>
      </div>

      {/* SLA & Priority Warnings */}
      {sla.breached && ticket.status !== "resolved" && ticket.status !== "closed" && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-3">
          <Clock className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">⚠️ {t("slaBreachedWarning")}</p>
            <p className="text-xs text-red-600 dark:text-red-400">{t("slaDeadline")}: {formatDate(ticket.slaDueAt)} · {t("priority")}: {PRIORITY_LABELS[ticket.priority] || ticket.priority}</p>
          </div>
          {!ticket.assignedTo && (
            <Button size="sm" variant="destructive" onClick={handleAutoAssign} disabled={updatingAssignee}>
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
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">⏰ {t("slaExpiringWarning")}</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400">{t("slaRemaining")}: {sla.text} · {t("priority")}: {PRIORITY_LABELS[ticket.priority] || ticket.priority}</p>
            </div>
          </div>
        )
        return null
      })()}
      {(ticket.priority === "critical" || ticket.priority === "high") && !ticket.assignedTo && ticket.status !== "resolved" && ticket.status !== "closed" && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 text-orange-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-300">🔥 {t("highPriorityUnassigned")}</p>
            <p className="text-xs text-orange-600 dark:text-orange-400">{t("priority")}: {PRIORITY_LABELS[ticket.priority] || ticket.priority} · {t("requiresAssignment")}</p>
          </div>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={handleAutoAssign} disabled={updatingAssignee}>
            <Zap className="h-3.5 w-3.5 mr-1" /> {t("autoAssign")}
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Ticket info */}
          <Card>
            <CardHeader>
              {editingSubject ? (
                <div className="flex items-center gap-2">
                  <input
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
                    {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : tc("save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingSubject(false)}>{tc("cancel")}</Button>
                </div>
              ) : (
                <CardTitle
                  className="text-xl cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { setEditSubject(ticket.subject); setEditingSubject(true) }}
                  title={tc("clickToEdit")}
                >
                  {ticket.subject}
                </CardTitle>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                <span>{t("companyLabel")}: <strong>{ticket.companyName || "—"}</strong></span>
                <span>{t("assignedLabel")}: <strong>{ticket.assigneeName || t("notAssigned")}</strong></span>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{t("priorityLabel")}: <strong>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</strong></span>
                <span>{t("categoryLabel")}: <strong>{ticket.category}</strong></span>
              </div>
              {editingDesc ? (
                <div className="mt-3 space-y-2">
                  <Textarea
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    rows={4}
                    autoFocus
                    onKeyDown={e => { if (e.key === "Escape") setEditingDesc(false) }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveSubjectDesc("description", editDesc)} disabled={savingEdit}>
                      {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : tc("save")}
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
                  <div
                    className="mt-3 p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => { setEditDesc(ticket.description || ""); setEditingDesc(true) }}
                    title={tc("clickToEdit")}
                  >
                    <p className="text-sm whitespace-pre-wrap">{ticket.description || tc("noDescription")}</p>
                  </div>
                )
              })()}
            </CardHeader>
          </Card>

          {/* Comments */}
          <Card data-tour-id="ticket-comments">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">{t("comments")} ({filteredComments.length})</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowInternal(!showInternal)}>
                <Lock className="h-3.5 w-3.5 mr-1" />
                {showInternal ? t("hideInternal") : t("showInternal")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    <ChatBubble
                      key={comment.id}
                      sender={chat.sender}
                      label={chat.name}
                      channel={chat.channel}
                      text={chat.body}
                      footer={formatDate(comment.createdAt)}
                    />
                  )
                }
                return (
                  <div key={comment.id} className={`flex gap-3 ${comment.isInternal ? "bg-amber-50/50 dark:bg-amber-950/20 -mx-3 px-3 py-2 rounded border-l-2 border-amber-400" : viaEmail ? "bg-sky-50/50 dark:bg-sky-950/20 -mx-3 px-3 py-2 rounded border-l-2 border-sky-400" : ""}`}>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium flex-shrink-0">
                      {getInitials(comment.userName || "System")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${comment.isInternal ? "text-amber-700 dark:text-amber-400" : viaEmail ? "text-sky-700 dark:text-sky-400" : ""}`}>
                          {comment.userName || "System"}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                        {comment.isInternal && (
                          <Badge variant="outline" className="text-[10px] h-4 border-amber-400 text-amber-600">
                            <Lock className="h-2.5 w-2.5 mr-0.5" /> {t("internalBadge")}
                          </Badge>
                        )}
                        {viaEmail && (
                          <Badge variant="outline" className="text-[10px] h-4 border-sky-400 text-sky-600">
                            ✉ via email
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{visibleText}</p>
                    </div>
                  </div>
                )
              })}

              {/* Comment input area */}
              <div className="border-t pt-4 space-y-3">
                <Textarea
                  ref={commentRef}
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder={isInternal ? t("internalNotePlaceholder") : t("replyPlaceholder")}
                  rows={3}
                  disabled={sending}
                />

                {/* Reply buttons row */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSendComment}
                    disabled={sending || !newComment.trim()}
                    className="bg-orange-500 hover:bg-orange-600"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    {t("replyBtn")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setIsInternal(!isInternal) }}
                    className={isInternal ? "border-amber-400 text-amber-600" : ""}
                  >
                    <Lock className="h-3.5 w-3.5 mr-1" />
                    {t("internalNote")}
                  </Button>

                  <div className="border-l h-6 mx-1" />

                  {supportAiEnabled && (
                    <>
                      {/* Da Vinci language selector */}
                      <select
                        value={aiLang}
                        onChange={e => setAiLang(e.target.value)}
                        className="h-8 px-2 text-xs border border-zinc-200 dark:border-zinc-700 rounded-md bg-background"
                      >
                        <option value="ru">RU</option>
                        <option value="az">AZ</option>
                        <option value="en">EN</option>
                      </select>

                      {/* Da Vinci buttons */}
                      <Button
                        data-tour-id="ticket-ai-draft"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("reply")}
                        disabled={aiLoading !== null}
                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950"
                      >
                        {aiLoading === "reply" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
                        {t("aiReply")}
                      </Button>
                      <Button
                        data-tour-id="ticket-ai-summary"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("summary")}
                        disabled={aiLoading !== null}
                        className="border-[hsl(var(--ai-from))]/30 text-[hsl(var(--ai-from))] hover:bg-[hsl(var(--ai-from))]/5"
                      >
                        {aiLoading === "summary" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
                        {t("aiSummary")}
                      </Button>
                      <Button
                        data-tour-id="ticket-ai-steps"
                        variant="outline"
                        size="sm"
                        onClick={() => handleAiAction("steps")}
                        disabled={aiLoading !== null}
                        className="border-yellow-300 text-yellow-700 hover:bg-yellow-50 dark:border-yellow-700 dark:text-yellow-400 dark:hover:bg-yellow-950"
                      >
                        {aiLoading === "steps" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                        {t("aiSteps")}
                      </Button>
                    </>
                  )}
                </div>

                {isInternal && (
                  <p className="text-xs text-amber-600">{t("internalNoteHint")}</p>
                )}

                {/* Da Vinci Result display */}
                {aiResult && (
                  <div className="p-3 bg-muted/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-green-600" />
                      <span className="text-xs font-medium text-green-600">
                        {aiResult.type === "summary" ? t("aiSummaryLabel") : t("aiStepsLabel")}
                      </span>
                      <button onClick={() => setAiResult(null)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{aiResult.text}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Inline actions: Status + Reassign */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* Status change */}
              <div className="flex items-center gap-3">
                <Select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-48">
                  <option value="new">{t("statusNew")}</option>
                  <option value="in_progress">{t("statusInProgress")}</option>
                  <option value="waiting">{t("statusWaiting")}</option>
                  <option value="resolved">{t("statusResolved")}</option>
                  <option value="closed">{t("statusClosed")}</option>
                </Select>
                <Button
                  onClick={handleUpdateStatus}
                  disabled={updatingStatus || newStatus === ticket.status}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {updatingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  {t("updateStatus")}
                </Button>
              </div>

              {/* Reassign */}
              <div className="flex items-center gap-3">
                <Select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} className="w-48">
                  <option value="">{t("unassignedOption")}</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  onClick={handleReassign}
                  disabled={updatingAssignee || newAssignee === (ticket.assignedTo || "")}
                  className="border-orange-300 text-orange-600 hover:bg-orange-50"
                >
                  {updatingAssignee ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
                  {t("reassign")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAutoAssign}
                  disabled={updatingAssignee}
                  className="border-yellow-300 text-yellow-600 hover:bg-yellow-50"
                >
                  {updatingAssignee ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
                  {t("auto")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <AdvisorRecordWidget entityType="ticket" entityId={ticket.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

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
                  <Badge variant="outline" className="text-[11px] capitalize">
                    {ticket.entitlement.supportLevel}
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
                              {MILESTONE_TYPE_LABELS[milestone.type] || milestone.definitionName || milestone.type}
                            </span>
                            <span className={`shrink-0 text-[11px] font-medium ${statusTone}`}>
                              {MILESTONE_STATUS_LABELS[milestone.status] || milestone.status}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>{milestone.isRequired ? t("entitlementRequired") : t("entitlementOptional")}</span>
                            <span className={statusTone}>{formatDate(milestone.dueAt)}</span>
                          </div>
                          {milestone.waivedReason && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {t("entitlementWaiveReason")}: {milestone.waivedReason}
                            </p>
                          )}
                          {openMilestone && (
                            <div className="mt-2 border-t border-border/60 pt-2">
                              {waiverOpen ? (
                                <div className="space-y-2">
                                  <Textarea
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
                                      className="h-7 px-2 text-xs"
                                      onClick={() => setWaivingMilestoneId(null)}
                                    >
                                      {t("entitlementWaiveCancel")}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      disabled={savingWaiverId === milestone.id || !(waiverReasons[milestone.id] || "").trim()}
                                      onClick={() => handleWaiveMilestone(milestone.id)}
                                    >
                                      {savingWaiverId === milestone.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
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
                  <Badge variant={closureIsPending ? "default" : "outline"} className="text-[11px]">
                    {closureStatusLabels[closureRequest.status] || closureRequest.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(closureRequest.dueAt)}</span>
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
                    {t("closureRequestAutoClose")}: <span className="font-medium text-foreground">{formatDate(closureRequest.dueAt)}</span>
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
          {showContext && customerContext && (
            <Card>
              <CardHeader className="py-3 cursor-pointer" onClick={() => setContext360Collapsed(c => !c)}>
                <CardTitle className="text-sm flex items-center justify-between">
                  {t360("title")}
                  <span className="text-muted-foreground text-xs">{context360Collapsed ? "+" : "−"}</span>
                </CardTitle>
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
                  <h4 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">{tc("calls") || "Calls"}</h4>
                  {ticketCalls.length > 0 ? (
                    <div className="space-y-1.5">
                      {ticketCalls.map((call) => (
                        <div key={call.id} className="rounded-md border bg-muted/25 px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{call.direction === "inbound" ? call.fromNumber : call.toNumber}</span>
                            <Badge variant="outline" className="text-[10px]">{call.status}</Badge>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>{new Date(call.createdAt).toLocaleString()}</span>
                            {call.recordingPlaybackUrl ? (
                              <a href={call.recordingPlaybackUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                <Play className="h-3 w-3" />
                                {tc("recording") || "Recording"}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tc("noCalls") || "No calls yet"}</p>
                  )}
                </div>
                {/* Company */}
                {customerContext.company && (
                  <div>
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("company")}</h4>
                    <p className="font-medium">{customerContext.company.name}</p>
                    <p className="text-xs text-muted-foreground">{customerContext.company.industry}</p>
                    <p className="text-xs">{t360("ltv")}: ${(customerContext.lifetimeValue || 0).toLocaleString()}</p>
                  </div>
                )}
                {/* Recent Tickets */}
                <div>
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("recentTickets")} ({customerContext.recentTickets?.length || 0})</h4>
                  <div className="space-y-1">
                    {(customerContext.recentTickets || []).map(rt => (
                      <Link key={rt.id} href={`/tickets/${rt.id}`} className="block text-xs hover:underline truncate">
                        <span className="font-mono">{rt.ticketNumber}</span> {rt.subject}
                        <Badge className="ml-1 text-[10px] px-1">{rt.status}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
                {/* Open Deals */}
                {openDeals.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("openDeals")} ({openDeals.length})</h4>
                    {openDeals.map(d => (
                      <p key={d.id} className="text-xs">{d.name} — ${d.valueAmount?.toLocaleString()} ({d.stage})</p>
                    ))}
                  </div>
                )}
                {/* Recent Activity */}
                <div>
                  <h4 className="font-semibold text-xs text-muted-foreground uppercase mb-1.5">{t360("recentActivity")}</h4>
                  <div className="space-y-1">
                    {(customerContext.recentActivity || []).slice(0, 5).map(act => (
                      <p key={act.id} className="text-xs truncate">
                        <span className="capitalize font-medium">{act.type}</span>: {act.subject}
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
                <Badge className={statusStyle.className}>{STATUS_LABELS[ticket.status] || ticket.status}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("priorityLabel")}</span>
                <Badge className={priorityStyle.className}>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("categoryLabel")}</span>
                <span>{ticket.category === "general" ? t("generalCategory") : ticket.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("createdLabel")}</span>
                <span>{formatDate(ticket.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("updatedLabel")}</span>
                <span>{formatDate(ticket.updatedAt)}</span>
              </div>
              {ticket.tags.length > 0 && (
                <div>
                  <span className="text-muted-foreground">{t("tagsLabel")}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ticket.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
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
                  <p className="font-medium">{ticket.companyName || ticket.companyId}</p>
                </div>
              )}
              {ticket.contactId && (
                <div>
                  <span className="text-muted-foreground">{t("contactLabel")}</span>
                  <p className="font-medium font-mono text-xs">{ticket.contactId}</p>
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
                <span>{ticket.slaDueAt ? formatDate(ticket.slaDueAt) : t("slaNotSet")}</span>
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
                  <span className="text-green-600">{formatDate(ticket.firstResponseAt)}</span>
                </div>
              )}
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("slaResolved")}</span>
                  <span>{formatDate(ticket.resolvedAt)}</span>
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
                      className="block p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{article.category || t("generalCategory")}</p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConvertToComplaintDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        ticketId={ticketId}
        orgId={orgId ? String(orgId) : undefined}
        onConverted={(id) => router.push(`/complaints/${id}`)}
      />
    </div>
  )
}
