"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import {
  AlertTriangle,
  BellRing,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  CloudOff,
  Download,
  FileLock2,
  FileText,
  Loader2,
  MessageSquare,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { MtmWorkflowGuide } from "@/components/mtm/mtm-workflow-guide"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { createDateFormatter } from "@/lib/format-date"

type Agent = {
  id: string
  name: string
  role: string
  avatar?: string | null
  team?: { id: string; name: string } | null
}

type MessageThread = {
  id: string
  type: "DIRECT" | "BROADCAST" | "SYSTEM"
  subject?: string | null
  lastMessageAt: string
  participants: Array<{ role: string; agent: Agent }>
  lastMessage: {
    id: string
    senderName: string
    body?: string | null
    sentAt: string
    acknowledgementRequired: boolean
    attachmentDocument?: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null
  } | null
  acknowledgement?: { required: number; acknowledged: number; read: number } | null
}

type OperationsDocument = {
  id: string
  title?: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  downloadUrl: string
  assignments: Array<{
    id: string
    required: boolean
    expiresAt?: string | null
    readAt?: string | null
    downloadedAt?: string | null
    agent: { id: string; name: string }
  }>
}

type HrmRequest = {
  id: string
  type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  startDate: string
  endDate: string
  requestedStartAt?: string | null
  requestedEndAt?: string | null
  reason: string
  decisionNote?: string | null
  submittedAt: string
  decidedAt?: string | null
  agent: { id: string; name: string; role: string }
}

type RouteConflict = { id: string; name?: string | null; date: string; status: string; totalPoints: number }

type OperationsData = {
  agents: Agent[]
  threads: MessageThread[]
  documents: OperationsDocument[]
  hrmRequests: HrmRequest[]
  counts: { pendingHrm: number; acknowledgementDue: number; requiredDocumentsUnread: number }
  capabilities: { canReviewHrm: boolean; privateStorage: boolean; externalCloudStorage: boolean }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function localDateTimeValue(value: Date): string {
  const local = new Date(value.getTime() - (value.getTimezoneOffset() * 60_000))
  return local.toISOString().slice(0, 16)
}

function AudiencePicker({
  agents,
  selected,
  onChange,
  multiple,
  title,
  searchPlaceholder,
  selectAllLabel,
  clearLabel,
  selectedLabel,
  emptyLabel,
}: {
  agents: Agent[]
  selected: string[]
  onChange: (ids: string[]) => void
  multiple: boolean
  title: string
  searchPlaceholder: string
  selectAllLabel: string
  clearLabel: string
  selectedLabel: (count: number) => string
  emptyLabel: string
}) {
  const [search, setSearch] = useState("")
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return agents
    return agents.filter((agent) => [agent.name, agent.role, agent.team?.name]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query)))
  }, [agents, search])

  function toggle(agentId: string) {
    if (!multiple) {
      onChange(selected.includes(agentId) ? [] : [agentId])
      return
    }
    onChange(selected.includes(agentId)
      ? selected.filter((id) => id !== agentId)
      : [...selected, agentId])
  }

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700" aria-label={title}>
      <div className="flex flex-col gap-2 border-b border-zinc-200 bg-muted/30 p-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{selectedLabel(selected.length)}</p>
        </div>
        {multiple ? (
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(agents.map((agent) => agent.id))}>{selectAllLabel}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])} disabled={selected.length === 0}>{clearLabel}</Button>
          </div>
        ) : null}
      </div>
      <div className="relative border-b border-zinc-200 p-2 dark:border-zinc-700">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} className="h-9 pl-9" />
      </div>
      <div className="max-h-56 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-700">
        {visible.map((agent) => {
          const checked = selected.includes(agent.id)
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => toggle(agent.id)}
              className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600"}`}>
                {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{agent.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{agent.team?.name || agent.role}</span>
              </span>
              <Badge variant="outline" className="text-[10px]">{agent.role}</Badge>
            </button>
          )
        })}
        {visible.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">{emptyLabel}</p> : null}
      </div>
    </section>
  )
}

export default function MtmOperationsPage() {
  const { data: session } = useSession()
  const t = useTranslations("mtmOperationsPage")
  const locale = useLocale()
  const orgId = session?.user?.organizationId ? String(session.user.organizationId) : undefined
  const [data, setData] = useState<OperationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSection, setActiveSection] = useState<"messages" | "documents" | "hrm">("messages")

  const [messageType, setMessageType] = useState<"BROADCAST" | "DIRECT">("BROADCAST")
  const [messageSubject, setMessageSubject] = useState("")
  const [messageBody, setMessageBody] = useState("")
  const [messageRecipients, setMessageRecipients] = useState<string[]>([])
  const defaultMessageAudienceApplied = useRef(false)
  const [acknowledgementRequired, setAcknowledgementRequired] = useState(false)
  const [keyMessage, setKeyMessage] = useState(false)
  const [keyMessageFrom, setKeyMessageFrom] = useState("")
  const [keyMessageUntil, setKeyMessageUntil] = useState("")
  const [localizedBodies, setLocalizedBodies] = useState({ en: "", ru: "", az: "" })
  const [sendingMessage, setSendingMessage] = useState(false)
  const keyMessageRangeValid = !keyMessage || (
    Boolean(keyMessageFrom)
    && Boolean(keyMessageUntil)
    && Number.isFinite(new Date(keyMessageFrom).getTime())
    && Number.isFinite(new Date(keyMessageUntil).getTime())
    && new Date(keyMessageUntil) > new Date(keyMessageFrom)
  )

  const [documentTitle, setDocumentTitle] = useState("")
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [documentRecipients, setDocumentRecipients] = useState<string[]>([])
  const [documentRequired, setDocumentRequired] = useState(false)
  const [documentExpiresOn, setDocumentExpiresOn] = useState("")
  const [uploadingDocument, setUploadingDocument] = useState(false)

  const [hrmFilter, setHrmFilter] = useState<"PENDING" | "ALL">("PENDING")
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({})
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null)
  const [routeConflicts, setRouteConflicts] = useState<Record<string, RouteConflict[]>>({})

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/operations", {
        headers: orgId ? { "x-organization-id": orgId } : {},
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || t("loadFailed"))
      setData(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [orgId, t])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!data || defaultMessageAudienceApplied.current) return
    defaultMessageAudienceApplied.current = true
    setMessageRecipients(data.agents.map((agent) => agent.id))
  }, [data])

  async function sendMessage() {
    if (!messageBody.trim() || messageRecipients.length === 0 || (messageType === "BROADCAST" && !messageSubject.trim())) return
    if (!keyMessageRangeValid) return
    setSendingMessage(true)
    try {
      const response = await fetch("/api/v1/mtm/operations/messages", {
        method: "POST",
        headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({
          type: messageType,
          subject: messageType === "BROADCAST" ? messageSubject.trim() : null,
          body: messageBody.trim(),
          agentIds: messageRecipients,
          acknowledgementRequired: messageType === "BROADCAST" && (acknowledgementRequired || keyMessage),
          keyMessage: messageType === "BROADCAST" && keyMessage,
          ...(messageType === "BROADCAST" && keyMessage ? {
            effectiveFrom: new Date(keyMessageFrom).toISOString(),
            effectiveUntil: new Date(keyMessageUntil).toISOString(),
            localizations: localizedBodies,
          } : {}),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t("sendFailed"))
      toast.success(t("messageSent"))
      setMessageBody("")
      setMessageSubject("")
      setAcknowledgementRequired(false)
      setKeyMessage(false)
      setKeyMessageFrom("")
      setKeyMessageUntil("")
      setLocalizedBodies({ en: "", ru: "", az: "" })
      if (messageType === "DIRECT") setMessageRecipients([])
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sendFailed"))
    } finally {
      setSendingMessage(false)
    }
  }

  async function uploadDocument() {
    if (!documentFile || documentRecipients.length === 0) return
    setUploadingDocument(true)
    try {
      const form = new FormData()
      form.set("file", documentFile)
      form.set("title", documentTitle.trim())
      form.set("agentIds", JSON.stringify(documentRecipients))
      form.set("required", String(documentRequired))
      if (documentExpiresOn) form.set("expiresOn", documentExpiresOn)
      const response = await fetch("/api/v1/mtm/operations/documents", {
        method: "POST",
        headers: orgId ? { "x-organization-id": orgId } : {},
        body: form,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t("uploadFailed"))
      toast.success(t("documentAssigned"))
      setDocumentFile(null)
      setDocumentTitle("")
      setDocumentRequired(false)
      setDocumentExpiresOn("")
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("uploadFailed"))
    } finally {
      setUploadingDocument(false)
    }
  }

  async function decideHrm(request: HrmRequest, decision: "APPROVED" | "REJECTED", acknowledgeRouteConflicts = false) {
    const note = decisionNotes[request.id]?.trim() || ""
    if (decision === "REJECTED" && !note) return
    setDecisionBusyId(request.id)
    try {
      const response = await fetch(`/api/v1/mtm/operations/hrm/${request.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({ decision, note: note || undefined, acknowledgeRouteConflicts }),
      })
      const result = await response.json()
      if (response.status === 409 && result.code === "MTM_HRM_ROUTE_CONFLICT") {
        setRouteConflicts((current) => ({ ...current, [request.id]: result.conflicts || [] }))
        toast.warning(t("routeConflictFound"))
        return
      }
      if (!response.ok) throw new Error(result.error || t("decisionFailed"))
      toast.success(decision === "APPROVED" ? t("requestApproved") : t("requestRejected"))
      setRouteConflicts((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("decisionFailed"))
    } finally {
      setDecisionBusyId(null)
    }
  }

  const filteredHrm = useMemo(() => (data?.hrmRequests ?? []).filter((request) => (
    hrmFilter === "ALL" || request.status === "PENDING"
  )), [data?.hrmRequests, hrmFilter])
  const canReviewHrm = data?.capabilities.canReviewHrm === true
  useEffect(() => {
    if (data && !data.capabilities.canReviewHrm && activeSection === "hrm") setActiveSection("messages")
  }, [activeSection, data])
  const dateTime = (value: string) => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  const dateOnly = (value: string) => createDateFormatter(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value))

  if (loading) {
    return (
      <div className="space-y-5">
        <PageDescription icon={Radio} title={t("title")} description={t("subtitle")} />
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PageDescription icon={Radio} title={t("title")} description={t("subtitle")} />
        <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4" />}
          {t("refresh")}
        </Button>
      </div>

      <div className={`grid gap-3 ${canReviewHrm ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Card className="overflow-hidden"><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><BellRing className="h-5 w-5" /></span><div><p className="text-2xl font-semibold tabular-nums">{data?.counts.acknowledgementDue ?? 0}</p><p className="text-xs text-muted-foreground">{t("acknowledgementsDue")}</p></div></CardContent></Card>
        <Card className="overflow-hidden"><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"><FileLock2 className="h-5 w-5" /></span><div><p className="text-2xl font-semibold tabular-nums">{data?.counts.requiredDocumentsUnread ?? 0}</p><p className="text-xs text-muted-foreground">{t("requiredUnread")}</p></div></CardContent></Card>
        {canReviewHrm ? <Card className="overflow-hidden"><CardContent className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300"><CalendarCheck2 className="h-5 w-5" /></span><div><p className="text-2xl font-semibold tabular-nums">{data?.counts.pendingHrm ?? 0}</p><p className="text-xs text-muted-foreground">{t("pendingHrm")}</p></div></CardContent></Card> : null}
      </div>

      <MtmWorkflowGuide
        title={t("clarityGuide.title")}
        description={t("clarityGuide.description")}
        steps={[
          { title: t("messagesTab"), description: t("composeDescription"), icon: Send, active: activeSection === "messages", onClick: () => setActiveSection("messages") },
          { title: t("documentsTab"), description: t("assignDocumentDescription"), icon: FileText, active: activeSection === "documents", onClick: () => setActiveSection("documents") },
          ...(canReviewHrm ? [{ title: t("hrmTab"), description: t("hrmRequestsDescription"), icon: CalendarCheck2, active: activeSection === "hrm", onClick: () => setActiveSection("hrm") }] : []),
        ]}
      />

      <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as "messages" | "documents" | "hrm")}>
        <TabsList className={`grid h-auto w-full sm:w-auto ${canReviewHrm ? "grid-cols-3" : "grid-cols-2"}`}>
          <TabsTrigger value="messages" className="gap-2"><MessageSquare className="h-4 w-4" />{t("messagesTab")}</TabsTrigger>
          <TabsTrigger value="documents" className="gap-2"><FileText className="h-4 w-4" />{t("documentsTab")}</TabsTrigger>
          {canReviewHrm ? <TabsTrigger value="hrm" className="gap-2"><CalendarCheck2 className="h-4 w-4" />{t("hrmTab")}{data?.counts.pendingHrm ? <Badge variant="warning" className="ml-1 px-1.5">{data.counts.pendingHrm}</Badge> : null}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="messages" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <Card>
              <CardHeader className="p-5 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4 text-primary" />{t("composeTitle")}</CardTitle><CardDescription>{t("composeDescription")}</CardDescription></CardHeader>
              <CardContent className="space-y-4 p-5 pt-0">
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-1">
                  <Button type="button" variant={messageType === "BROADCAST" ? "default" : "ghost"} onClick={() => { setMessageType("BROADCAST"); setMessageRecipients(data?.agents.map((agent) => agent.id) ?? []) }}><Radio className="mr-2 h-4 w-4" />{t("broadcast")}</Button>
                  <Button type="button" variant={messageType === "DIRECT" ? "default" : "ghost"} onClick={() => { setMessageType("DIRECT"); setMessageRecipients([]); setAcknowledgementRequired(false); setKeyMessage(false) }}><UserRound className="mr-2 h-4 w-4" />{t("direct")}</Button>
                </div>
                {messageType === "BROADCAST" ? <div><Label htmlFor="operations-message-subject">{t("subject")} *</Label><Input id="operations-message-subject" value={messageSubject} onChange={(event) => setMessageSubject(event.target.value)} placeholder={t("subjectPlaceholder")} className="mt-1.5" /></div> : null}
                <div><Label htmlFor="operations-message-body">{t("message")} *</Label><Textarea id="operations-message-body" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder={t("messagePlaceholder")} rows={6} className="mt-1.5 resize-y" maxLength={4000} /><p className="mt-1 text-right text-[11px] text-muted-foreground">{messageBody.length}/4000</p></div>
                {messageType === "BROADCAST" ? <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><input type="checkbox" checked={acknowledgementRequired || keyMessage} disabled={keyMessage} onChange={(event) => setAcknowledgementRequired(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary disabled:cursor-not-allowed" /><span><span className="block text-sm font-medium">{t("requireAcknowledgement")}</span><span className="block text-xs text-muted-foreground">{t("requireAcknowledgementHint")}</span></span></label> : null}
                {messageType === "BROADCAST" ? (
                  <div className="space-y-3 border border-zinc-200 p-3 dark:border-zinc-700">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={keyMessage}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setKeyMessage(checked)
                          if (checked && !keyMessageFrom) {
                            const from = new Date()
                            const until = new Date(from.getTime() + (7 * 24 * 60 * 60 * 1000))
                            setKeyMessageFrom(localDateTimeValue(from))
                            setKeyMessageUntil(localDateTimeValue(until))
                            setAcknowledgementRequired(true)
                          }
                        }}
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span><span className="block text-sm font-medium">{t("keyMessage")}</span><span className="block text-xs text-muted-foreground">{t("keyMessageHint")}</span></span>
                    </label>
                    {keyMessage ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div><Label htmlFor="operations-key-from">{t("keyMessageFrom")}</Label><Input id="operations-key-from" type="datetime-local" value={keyMessageFrom} onChange={(event) => setKeyMessageFrom(event.target.value)} className="mt-1.5" /></div>
                          <div><Label htmlFor="operations-key-until">{t("keyMessageUntil")}</Label><Input id="operations-key-until" type="datetime-local" value={keyMessageUntil} onChange={(event) => setKeyMessageUntil(event.target.value)} className="mt-1.5" /></div>
                        </div>
                        {!keyMessageRangeValid ? <p role="alert" className="text-xs font-medium text-destructive">{t("keyMessageRangeInvalid")}</p> : null}
                        <div className="space-y-2">
                          <p className="text-xs font-medium">{t("keyMessageTranslations")}</p>
                          {(["en", "ru", "az"] as const).map((language) => (
                            <div key={language}>
                              <Label htmlFor={`operations-key-${language}`}>{language.toUpperCase()}</Label>
                              <Textarea
                                id={`operations-key-${language}`}
                                value={localizedBodies[language]}
                                onChange={(event) => setLocalizedBodies((current) => ({ ...current, [language]: event.target.value }))}
                                placeholder={t("keyMessageTranslationPlaceholder")}
                                rows={2}
                                maxLength={4000}
                                className="mt-1"
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <AudiencePicker agents={data?.agents ?? []} selected={messageRecipients} onChange={setMessageRecipients} multiple={messageType === "BROADCAST"} title={messageType === "BROADCAST" ? t("audience") : t("recipient")} searchPlaceholder={t("searchAgents")} selectAllLabel={t("selectAll")} clearLabel={t("clear")} selectedLabel={(count) => t("selectedAgents", { count })} emptyLabel={t("noAgents")} />
                <Button className="w-full" onClick={sendMessage} disabled={sendingMessage || !messageBody.trim() || messageRecipients.length === 0 || !keyMessageRangeValid || (messageType === "BROADCAST" && !messageSubject.trim())}>{sendingMessage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{messageType === "BROADCAST" ? t("sendBroadcast") : t("sendDirect")}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-5 pb-3"><CardTitle className="text-base">{t("messageHistory")}</CardTitle><CardDescription>{t("messageHistoryDescription")}</CardDescription></CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[760px] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-700">
                  {(data?.threads ?? []).map((thread) => (
                    <article key={thread.id} className="space-y-3 p-4 first:pt-2 sm:p-5">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={thread.type === "BROADCAST" ? "brand" : "outline"}>{thread.type === "BROADCAST" ? t("broadcast") : t("direct")}</Badge><span className="text-xs text-muted-foreground">{dateTime(thread.lastMessageAt)}</span></div><h3 className="mt-2 truncate text-sm font-semibold">{thread.subject || thread.participants.map((participant) => participant.agent.name).join(", ") || t("conversation")}</h3></div></div>
                      <p className="line-clamp-3 text-sm leading-relaxed">{thread.lastMessage?.body || t("attachmentOnly")}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{t("recipientCount", { count: thread.participants.length })}</span>{thread.acknowledgement ? <><span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{t("ackProgress", { acknowledged: thread.acknowledgement.acknowledged, total: thread.acknowledgement.required })}</span><span>{t("readProgress", { read: thread.acknowledgement.read, total: thread.acknowledgement.required })}</span></> : null}</div>
                    </article>
                  ))}
                  {(data?.threads.length ?? 0) === 0 ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"><MessageSquare className="h-5 w-5" />{t("noMessages")}</div> : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(380px,1.1fr)]">
            <Card>
              <CardHeader className="p-5 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4 text-primary" />{t("assignDocument")}</CardTitle><CardDescription>{t("assignDocumentDescription")}</CardDescription></CardHeader>
              <CardContent className="space-y-4 p-5 pt-0">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-medium">{t("privateStorageTitle")}</p><p className="mt-0.5 text-xs opacity-80">{t("privateStorageDescription")}</p></div></div>
                <div><Label htmlFor="operations-document-title">{t("documentTitle")}</Label><Input id="operations-document-title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} placeholder={t("documentTitlePlaceholder")} className="mt-1.5" /></div>
                <div><Label htmlFor="operations-document-file">{t("file")} *</Label><Input id="operations-document-file" type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} className="mt-1.5 h-auto py-2" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.zip" />{documentFile ? <p className="mt-1 text-xs text-muted-foreground">{documentFile.name} · {formatBytes(documentFile.size)}</p> : <p className="mt-1 text-xs text-muted-foreground">{t("fileLimit")}</p>}</div>
                <div className="grid gap-3 sm:grid-cols-2"><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><input type="checkbox" checked={documentRequired} onChange={(event) => setDocumentRequired(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" /><span><span className="block text-sm font-medium">{t("requiredDocument")}</span><span className="block text-xs text-muted-foreground">{t("requiredDocumentHint")}</span></span></label><div><Label htmlFor="operations-document-expiry">{t("expiresOn")}</Label><Input id="operations-document-expiry" type="date" value={documentExpiresOn} onChange={(event) => setDocumentExpiresOn(event.target.value)} className="mt-1.5" /></div></div>
                <AudiencePicker agents={data?.agents ?? []} selected={documentRecipients} onChange={setDocumentRecipients} multiple title={t("audience")} searchPlaceholder={t("searchAgents")} selectAllLabel={t("selectAll")} clearLabel={t("clear")} selectedLabel={(count) => t("selectedAgents", { count })} emptyLabel={t("noAgents")} />
                <Button className="w-full" onClick={uploadDocument} disabled={uploadingDocument || !documentFile || documentRecipients.length === 0}>{uploadingDocument ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{t("uploadAndAssign")}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-5 pb-3"><CardTitle className="text-base">{t("documentLibrary")}</CardTitle><CardDescription>{t("documentLibraryDescription")}</CardDescription></CardHeader>
              <CardContent className="p-0"><div className="max-h-[820px] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-700">{(data?.documents ?? []).map((document) => { const read = document.assignments.filter((assignment) => assignment.readAt).length; const required = document.assignments.filter((assignment) => assignment.required).length; return <article key={document.id} className="space-y-3 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"><FileText className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{document.title || document.fileName}</h3><p className="truncate text-xs text-muted-foreground">{document.fileName} · {formatBytes(document.sizeBytes)} · {dateTime(document.createdAt)}</p></div><Button asChild variant="outline" size="sm"><a href={document.downloadUrl}><Download className="mr-1 h-3.5 w-3.5" />{t("download")}</a></Button></div><div className="flex flex-wrap gap-2"><Badge variant="outline">{t("assignedCount", { count: document.assignments.length })}</Badge><Badge variant={read === document.assignments.length && read > 0 ? "success" : "warning"}>{t("readCount", { read, total: document.assignments.length })}</Badge>{required > 0 ? <Badge variant="destructive">{t("requiredCount", { count: required })}</Badge> : null}</div><div className="flex flex-wrap gap-1.5">{document.assignments.slice(0, 12).map((assignment) => <span key={assignment.id} className={`rounded-full border px-2 py-0.5 text-[11px] ${assignment.readAt ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-zinc-200 text-muted-foreground dark:border-zinc-700"}`}>{assignment.agent.name}{assignment.readAt ? " ✓" : ""}</span>)}</div></article> })}{(data?.documents.length ?? 0) === 0 ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"><FileLock2 className="h-5 w-5" />{t("noDocuments")}</div> : null}</div></CardContent>
            </Card>
          </div>
        </TabsContent>

        {canReviewHrm ? <TabsContent value="hrm" className="space-y-4">
          <Card>
            <CardHeader className="flex-col items-stretch gap-3 space-y-0 p-5 pb-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><CalendarCheck2 className="h-4 w-4 text-primary" />{t("hrmRequests")}</CardTitle><CardDescription className="mt-1">{t("hrmRequestsDescription")}</CardDescription></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm" className="min-h-10"><Link href="/workforce/requests">{t("openWorkforce")}</Link></Button><Select value={hrmFilter} onChange={(event) => setHrmFilter(event.target.value as "PENDING" | "ALL")} className="w-40"><option value="PENDING">{t("pendingOnly")}</option><option value="ALL">{t("allRequests")}</option></Select></div></CardHeader>
            <CardContent className="p-0"><div className="divide-y divide-zinc-200 dark:divide-zinc-700">{filteredHrm.map((request) => { const busy = decisionBusyId === request.id; const conflicts = routeConflicts[request.id] ?? []; return <article key={request.id} className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Badge variant={request.status === "PENDING" ? "warning" : request.status === "APPROVED" ? "success" : request.status === "REJECTED" ? "destructive" : "outline"}>{t(`status.${request.status}`)}</Badge><Badge variant="outline">{t(`type.${request.type}`)}</Badge><span className="text-xs text-muted-foreground">{dateTime(request.submittedAt)}</span></div><div><h3 className="text-lg font-semibold">{request.agent.name}</h3><p className="mt-1 text-sm text-muted-foreground">{dateOnly(request.startDate)} — {dateOnly(request.endDate)}</p>{request.type === "TIME_CORRECTION" ? <p className="mt-1 text-sm text-muted-foreground">{request.requestedStartAt ? t("requestedStart", { time: dateTime(request.requestedStartAt) }) : null}{request.requestedStartAt && request.requestedEndAt ? " · " : ""}{request.requestedEndAt ? t("requestedEnd", { time: dateTime(request.requestedEndAt) }) : null}</p> : null}</div><div className="rounded-lg bg-muted/45 p-3"><p className="text-xs font-medium text-muted-foreground">{t("reason")}</p><p className="mt-1 text-sm leading-relaxed">{request.reason}</p></div>{request.decisionNote ? <div className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /><div><p className="font-medium">{t("decisionNote")}</p><p className="text-muted-foreground">{request.decisionNote}</p></div></div> : null}{conflicts.length > 0 ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-semibold">{t("routeConflictTitle", { count: conflicts.length })}</p><p className="mt-0.5 text-xs opacity-80">{t("routeConflictDescription")}</p></div></div><div className="mt-2 space-y-1">{conflicts.map((conflict) => <div key={conflict.id} className="flex items-center justify-between gap-2 rounded bg-card/80 px-2 py-1 text-xs"><span className="truncate">{conflict.name || conflict.id}</span><span>{dateOnly(conflict.date)} · {conflict.totalPoints} {t("stops")}</span></div>)}</div></div> : null}</div>{request.status === "PENDING" ? <aside className="space-y-3"><div><Label htmlFor={`hrm-note-${request.id}`}>{t("decisionNote")}</Label><Textarea id={`hrm-note-${request.id}`} value={decisionNotes[request.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder={t("decisionNotePlaceholder")} rows={4} className="mt-1.5 resize-y" /></div>{conflicts.length > 0 ? <><Button className="w-full" onClick={() => decideHrm(request, "APPROVED", true)} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}{t("approveWithConflicts")}</Button><Button className="w-full" variant="outline" onClick={() => setRouteConflicts((current) => { const next = { ...current }; delete next[request.id]; return next })}>{t("backToDecision")}</Button></> : <Button className="w-full" onClick={() => decideHrm(request, "APPROVED")} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{t("approveRequest")}</Button>}<Button className="w-full text-destructive hover:text-destructive" variant="outline" onClick={() => decideHrm(request, "REJECTED")} disabled={busy || !decisionNotes[request.id]?.trim()}><X className="mr-2 h-4 w-4" />{t("rejectRequest")}</Button><p className="text-xs text-muted-foreground">{t("rejectRequiresNote")}</p></aside> : <aside className="flex min-h-28 items-center justify-center rounded-lg bg-muted/30 p-4 text-center text-sm text-muted-foreground">{request.status === "APPROVED" ? t("approvedAndSynced") : request.status === "REJECTED" ? t("rejectedAndSynced") : t("cancelledByAgent")}</aside>}</article> })}{filteredHrm.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-6 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /></span><div><p className="text-sm font-semibold">{t("noHrmTitle")}</p><p className="mt-1 text-sm text-muted-foreground">{t("noHrmDescription")}</p></div></div> : null}</div></CardContent>
          </Card>
        </TabsContent> : null}
      </Tabs>
    </div>
  )
}
