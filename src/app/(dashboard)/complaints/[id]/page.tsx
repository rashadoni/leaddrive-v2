"use client"

import { use, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Play,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { safeComplaintReturnTo } from "@/lib/complaints/workspace-state"
import { formatFileSize } from "@/lib/format-file-size"

const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }
const riskStyles: Record<string, string> = {
  high: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  medium: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  low: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
}
const terminalStatuses = new Set(["resolved", "closed"])

type Attachment = {
  id: string
  fileName: string
  originalName: string
  fileSize: number
}

type Complaint = {
  id: string
  ticketNumber: string
  subject: string
  description: string | null
  status: string
  priority: string
  source: string | null
  createdAt: string
  updatedAt: string
  slaDueAt: string | null
  assignedTo: string | null
  assigneeName: string | null
  contact: { id: string; fullName: string | null; phone: string | null; email: string | null } | null
  complaintMeta: {
    externalRegistryNumber: number | null
    complaintType: string
    brand: string | null
    productionArea: string | null
    productCategory: string | null
    complaintObject: string | null
    complaintObjectDetail: string | null
    responsibleDepartment: string | null
    riskLevel: string | null
  } | null
  comments: Array<{
    id: string
    comment: string
    isInternal: boolean
    createdAt: string
    userName: string | null
    attachments?: Attachment[]
  }>
  timeline?: Array<{
    id: string
    action: string
    createdAt: string
    actor: string
    oldValue: Record<string, unknown> | null
    newValue: Record<string, unknown> | null
  }>
}

type UserOption = { id: string; name: string | null; email: string }

export default function ComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations("complaints")
  const tc = useTranslations("common")
  const locale = useLocale()
  const dateLocale = localeMap[locale] || "en-US"
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeComplaintReturnTo(searchParams.get("returnTo"))
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers = useMemo<Record<string, string>>(
    (): Record<string, string> => orgId ? { "x-organization-id": String(orgId) } : {},
    [orgId],
  )
  const responseDraftKey = orgId ? `complaints:response:${orgId}:${id}` : ""
  const [data, setData] = useState<Complaint | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const [usersError, setUsersError] = useState("")
  const [loading, setLoading] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [fetchError, setFetchError] = useState("")
  const [stale, setStale] = useState(false)
  const [response, setResponse] = useState("")
  const [posting, setPosting] = useState(false)
  const [sendError, setSendError] = useState("")
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID())
  const [actionPending, setActionPending] = useState("")
  const [actionError, setActionError] = useState("")
  const [assignee, setAssignee] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const fetchOne = useCallback(async (silent = false) => {
    if (!silent) setFetchError("")
    try {
      const res = await fetch(`/api/v1/complaints/${id}`, { headers })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        if (silent) {
          setStale(true)
          return
        }
        setPermissionDenied(res.status === 403)
        throw new Error(res.status === 403 ? t("detailPermissionError") : t("detailLoadError"))
      }
      setData(json.data)
      setAssignee(json.data.assignedTo || "")
      setStale(false)
      setPermissionDenied(false)
    } catch (failure) {
      if (silent) setStale(true)
      else setFetchError(failure instanceof Error ? failure.message : t("detailLoadError"))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [headers, id, t])

  useEffect(() => { void fetchOne() }, [fetchOne])
  const fetchUsers = useCallback(async () => {
    setUsersError("")
    try {
      const res = await fetch("/api/v1/users", { headers })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(t("ownersLoadError"))
      setUsers(json.data || [])
    } catch {
      setUsersError(t("ownersLoadError"))
    }
  }, [headers, t])
  useEffect(() => { void fetchUsers() }, [fetchUsers])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void fetchOne(true) }
    const interval = window.setInterval(refresh, 12000)
    document.addEventListener("visibilitychange", refresh)
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh) }
  }, [fetchOne])
  useEffect(() => {
    if (!responseDraftKey) return
    try {
      const saved = localStorage.getItem(responseDraftKey)
      if (saved) setResponse(saved)
    } catch {}
  }, [responseDraftKey])
  useEffect(() => {
    if (!responseDraftKey) return
    const timeout = window.setTimeout(() => {
      try {
        if (response.trim()) localStorage.setItem(responseDraftKey, response)
        else localStorage.removeItem(responseDraftKey)
      } catch {}
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [response, responseDraftKey])
  useEffect(() => {
    if (!response.trim()) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", protect)
    return () => window.removeEventListener("beforeunload", protect)
  }, [response])

  async function updateComplaint(fields: Record<string, unknown>, successMessage: string) {
    setActionError("")
    const res = await fetch(`/api/v1/complaints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(fields),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("actionPermissionError") : t("actionError"))
    toast.success(successMessage)
    await fetchOne()
  }

  async function changeStatus(status: string) {
    if (actionPending) return
    setActionPending(status)
    try {
      await updateComplaint({ status }, t("statusChanged"))
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionError"))
    } finally { setActionPending("") }
  }

  async function changeAssignee() {
    if (actionPending || assignee === (data?.assignedTo || "")) return
    setActionPending("assignee")
    try {
      await updateComplaint({ assignedTo: assignee || null }, t("assignmentChanged"))
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : t("actionError"))
      setAssignee(data?.assignedTo || "")
    } finally { setActionPending("") }
  }

  async function postResponse() {
    if (!response.trim() || posting || terminalStatuses.has(data?.status || "")) return
    setPosting(true)
    setSendError("")
    try {
      const res = await fetch(`/api/v1/tickets/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ comment: response, isInternal: false, clientRequestId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("responsePermissionError") : t("responseError"))
      try { if (responseDraftKey) localStorage.removeItem(responseDraftKey) } catch {}
      setResponse("")
      setClientRequestId(crypto.randomUUID())
      toast.success(t("responseSent"))
      await fetchOne()
    } catch (failure) {
      setSendError(failure instanceof Error ? failure.message : t("responseError"))
    } finally { setPosting(false) }
  }

  async function handleDelete() {
    setActionPending("delete")
    setActionError("")
    try {
      const res = await fetch(`/api/v1/complaints/${id}`, { method: "DELETE", headers })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(res.status === 403 ? t("actionPermissionError") : t("deleteError"))
      router.push(returnTo)
    } catch (failure) {
      setDeleteOpen(false)
      setActionError(failure instanceof Error ? failure.message : t("deleteError"))
    } finally { setActionPending("") }
  }

  const statusLabel = (status: string) => status === "open" ? t("statusOpen") : status === "in_progress" ? t("statusInProgress") : status === "resolved" ? t("statusResolved") : status === "closed" ? t("statusClosed") : status === "escalated" ? t("statusEscalated") : t("unknownStatus")
  const riskLabel = (risk: string) => risk === "high" ? t("riskHigh") : risk === "medium" ? t("riskMedium") : risk === "low" ? t("riskLow") : t("unknownRisk")
  const sourceLabel = (source: string | null) => source === "hotline" ? t("sourceHotline") : source === "email" ? t("sourceEmail") : source === "sales_rep" ? t("sourceSalesRep") : source === "whatsapp" ? t("sourceWhatsapp") : source === "instagram" ? t("sourceInstagram") : source === "facebook" ? t("sourceFacebook") : source === "web_chat" ? t("sourceWebChat") : t("unknownSource")
  const priorityLabel = (priority: string) => priority === "urgent" ? tc("priorityUrgent") : priority === "critical" ? tc("priorityCritical") : priority === "high" ? tc("priorityHigh") : priority === "medium" ? tc("priorityMedium") : priority === "low" ? tc("priorityLow") : t("unknownPriority")

  if (loading) return <div data-testid="complaint-detail-loading" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div>
  if (fetchError || !data) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="h-11 sm:h-9" onClick={() => router.push(returnTo, { scroll: false })}><ArrowLeft className="h-4 w-4" />{t("backToRegistry")}</Button>
      <div data-testid="complaint-detail-load-error" className="rounded-xl border p-8 text-center"><p className="text-sm text-muted-foreground">{fetchError || t("notFound")}</p><Button data-testid="complaint-detail-retry-load" variant="outline" size="sm" className="mt-3 h-11 sm:h-9" onClick={() => { setLoading(true); void fetchOne() }}><RefreshCw className="h-4 w-4" />{permissionDenied ? t("checkAccessAgain") : t("retry")}</Button></div>
    </div>
  )

  const meta = data.complaintMeta
  const deadline = data.slaDueAt ? new Date(data.slaDueAt) : null
  const overdue = Boolean(deadline && deadline.getTime() < Date.now() && !terminalStatuses.has(data.status))
  const publicComments = data.comments.filter(comment => !comment.isInternal)
  const attachmentCount = publicComments.reduce((count, comment) => count + (comment.attachments?.length || 0), 0)

  return (
    <SupportPageShell
      data-testid="complaint-detail-workspace"
      width="fluid"
      title={data.subject}
      leading={<Button data-testid="complaint-detail-back" variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={t("backToRegistry")} onClick={() => router.push(returnTo, { scroll: false })}><ArrowLeft className="h-4 w-4" /></Button>}
      utilities={<HelpButton slug="complaint-detail" variant="icon" className="shrink-0" />}
      description={<span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono">#{meta?.externalRegistryNumber ?? data.ticketNumber}</span>
              <Badge variant="outline">{statusLabel(data.status)}</Badge>
              {meta?.riskLevel && <Badge variant="outline" className={riskStyles[meta.riskLevel]}>{riskLabel(meta.riskLevel)}</Badge>}
              {meta?.complaintType === "suggestion" && <Badge variant="outline">{t("badgeSuggestion")}</Badge>}
            </span>}
    >

      {stale && <div data-testid="complaint-detail-stale" role="status" className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"><span>{t("staleDetail")}</span><Button data-testid="complaint-detail-retry-stale" variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => void fetchOne()}><RefreshCw className="h-4 w-4" />{t("retry")}</Button></div>}
      {actionError && <div data-testid="complaint-detail-action-error" role="alert" className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">{actionError}</div>}
      {actionPending && actionPending !== "assignee" && actionPending !== "delete" && <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2.5 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{t("actionSaving")}</p>}

      <section className="sticky top-16 z-20 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85" aria-label={t("lifecycleActions")}>
        <div className="flex flex-wrap items-center gap-2">
          {data.status !== "in_progress" && !terminalStatuses.has(data.status) && <Button data-testid="complaint-status-in-progress" variant="outline" size="sm" className="h-11 sm:h-9" disabled={Boolean(actionPending)} onClick={() => void changeStatus("in_progress")}><Play className="h-4 w-4" />{t("actionTakeToWork")}</Button>}
          {!terminalStatuses.has(data.status) && <Button data-testid="complaint-status-resolved" size="sm" className="h-11 sm:h-9" disabled={Boolean(actionPending)} onClick={() => void changeStatus("resolved")}><CheckCircle2 className="h-4 w-4" />{t("actionCloseOk")}</Button>}
          {data.status !== "escalated" && !terminalStatuses.has(data.status) && <Button data-testid="complaint-status-escalated" variant="outline" size="sm" className="h-11 sm:h-9" disabled={Boolean(actionPending)} onClick={() => void changeStatus("escalated")}><AlertCircle className="h-4 w-4" />{t("actionNotOk")}</Button>}
          {terminalStatuses.has(data.status) && <Button data-testid="complaint-status-open" variant="outline" size="sm" className="h-11 sm:h-9" disabled={Boolean(actionPending)} onClick={() => void changeStatus("open")}><RefreshCw className="h-4 w-4" />{t("reopenComplaint")}</Button>}
          <Button variant="ghost" size="icon" className="ml-auto h-11 w-11 sm:h-9 sm:w-9" aria-label={t("deleteComplaint")} disabled={Boolean(actionPending)} onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4 text-red-700 dark:text-red-300" /></Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border bg-card p-3 lg:grid-cols-4" aria-label={t("caseOverview")}>
        <Overview icon={<UserRound className="h-4 w-4" />} label={t("fieldAssignee")} value={data.assigneeName || t("unassigned")} />
        <Overview icon={<Clock className="h-4 w-4" />} label={t("deadline")} value={deadline ? deadline.toLocaleString(dateLocale) : t("noDeadline")} alert={overdue} />
        <Overview label={t("fieldDepartment")} value={meta?.responsibleDepartment || "—"} />
        <Overview label={t("fieldPriority")} value={priorityLabel(data.priority)} />
        <div className="col-span-2 flex gap-2 lg:col-span-4">
          <Select data-testid="complaint-assignee-select" aria-label={t("fieldAssignee")} value={assignee} onChange={event => setAssignee(event.target.value)} className="h-11 min-w-0 flex-1 sm:h-9"><option value="">{t("unassigned")}</option>{users.map(user => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}</Select>
          <Button data-testid="complaint-assignee-save" variant="outline" size="sm" className="h-11 shrink-0 sm:h-9" disabled={actionPending === "assignee" || assignee === (data.assignedTo || "")} onClick={() => void changeAssignee()}>{actionPending === "assignee" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{t("saveOwner")}</Button>
        </div>
        {usersError && <div role="alert" className="col-span-2 flex items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-300 lg:col-span-4"><span>{usersError}</span><Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => void fetchUsers()}>{t("retry")}</Button></div>}
      </section>

      <section className="rounded-xl border bg-card p-4" aria-labelledby="complaint-conversation-title">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 id="complaint-conversation-title" className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" />{t("cardResponse", { count: publicComments.length })}</h2><span className="text-xs text-muted-foreground">{t("evidenceCount", { count: attachmentCount })}</span></div>
        <div className="space-y-2">
          {publicComments.map(comment => <article key={comment.id} className="rounded-lg border p-3 text-sm"><div className="mb-1 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{comment.userName || t("timelineSystem")}</span><time>{new Date(comment.createdAt).toLocaleString(dateLocale)}</time></div><p className="whitespace-pre-wrap">{comment.comment}</p>{comment.attachments?.map(file => <a key={file.id} href={`/uploads/tickets/${encodeURIComponent(file.fileName)}`} target="_blank" rel="noreferrer" className="mt-2 flex min-h-11 max-w-sm items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"><Paperclip className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate">{file.originalName}</span><span className="text-muted-foreground">{formatFileSize(file.fileSize, locale)}</span></a>)}</article>)}
          {publicComments.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noResponses")}</p>}
        </div>
        <div className="mt-3 space-y-2 border-t pt-3">
          {terminalStatuses.has(data.status) && <p role="status" className="rounded-md bg-muted p-2.5 text-xs">{t("closedResponseHint")}</p>}
          <Textarea data-testid="complaint-response-composer" rows={4} value={response} onChange={event => setResponse(event.target.value)} disabled={posting || terminalStatuses.has(data.status)} placeholder={t("responsePlaceholder")} aria-label={t("responsePlaceholder")} aria-describedby={sendError ? "complaint-response-error" : undefined} />
          {sendError && <div data-testid="complaint-response-error" id="complaint-response-error" role="alert" className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"><span>{sendError}</span><Button data-testid="complaint-response-retry" variant="outline" size="sm" className="h-11 sm:h-9" disabled={posting} onClick={() => void postResponse()}>{t("retrySend")}</Button></div>}
          <div className="flex justify-end"><Button data-testid="complaint-response-send" size="sm" className="h-11 sm:h-9" disabled={posting || !response.trim() || terminalStatuses.has(data.status)} onClick={() => void postResponse()}>{posting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}{posting ? t("sending") : t("send")}</Button></div>
        </div>
      </section>

      <details className="rounded-xl border bg-card">
        <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">{t("caseDetails")}</summary>
        <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
          <InfoGroup title={t("cardCustomer")} rows={[[t("fieldFullName"), data.contact?.fullName], [t("fieldPhone"), data.contact?.phone], [t("fieldEmail"), data.contact?.email]]} />
          <InfoGroup title={t("cardRequest")} rows={[[t("fieldSource"), sourceLabel(data.source)], [t("fieldDate"), new Date(data.createdAt).toLocaleString(dateLocale)], [t("fieldContent"), data.description]]} />
          <InfoGroup title={t("cardProduct")} rows={[[t("fieldBrand"), meta?.brand], [t("fieldProductionArea"), meta?.productionArea], [t("fieldCategory"), meta?.productCategory], [t("fieldObject"), meta?.complaintObject], [t("fieldObjectDetail"), meta?.complaintObjectDetail]]} />
          <InfoGroup title={t("cardAssignment")} rows={[[t("fieldRiskLevel"), meta?.riskLevel ? riskLabel(meta.riskLevel) : null], [t("fieldDepartment"), meta?.responsibleDepartment], [t("updatedLabel"), new Date(data.updatedAt).toLocaleString(dateLocale)]]} />
        </div>
      </details>

      {data.timeline && data.timeline.length > 0 && <details className="rounded-xl border bg-card"><summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">{t("cardHistory", { count: data.timeline.length })}</summary><ol className="space-y-2 border-t p-4 text-xs">{data.timeline.map(event => <li key={event.id} className="grid gap-1 rounded-md border p-2 sm:grid-cols-[10rem_1fr]"><time className="text-muted-foreground">{new Date(event.createdAt).toLocaleString(dateLocale)}</time><span><strong>{event.actor}</strong> {event.action === "create" ? t("timelineCreated") : t("timelineUpdated")}</span></li>)}</ol></details>}

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t("deleteComplaint")} description={t("deleteConfirm")} confirmLabel={t("deleteComplaint")} confirmVariant="destructive" onConfirm={handleDelete} />
    </SupportPageShell>
  )
}

function Overview({ icon, label, value, alert = false }: { icon?: React.ReactNode; label: string; value: string; alert?: boolean }) {
  return <div className="min-w-0"><p className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</p><p className={`truncate text-sm font-medium ${alert ? "text-red-700 dark:text-red-300" : ""}`}>{value}</p></div>
}

function InfoGroup({ title, rows }: { title: string; rows: Array<[string, string | null | undefined]> }) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3><dl className="space-y-1.5">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2 text-xs"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right">{value || "—"}</dd></div>)}</dl></section>
}
