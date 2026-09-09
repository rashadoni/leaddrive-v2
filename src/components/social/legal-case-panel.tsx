"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Scale, FileText, Printer, Plus, Trash2, X, ExternalLink, Lock, Unlock, RefreshCw, ShieldAlert, SlidersHorizontal, Check, Hand, Bot, Save, Send, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { formatDateTime } from "@/lib/format-date"
import {
  SOCIAL_LEGAL_CATEGORIES,
  SOCIAL_LEGAL_LETTER_LANGUAGES,
  type SocialLegalCategory,
} from "@/lib/social/legal-categories"

interface LegalCaseMention {
  id: string
  platform: string
  sourceType: string
  text: string
  url: string | null
  authorName: string | null
  authorHandle: string | null
  sentiment: string | null
  publishedAt: string | null
  createdAt: string
}

interface LegalCase {
  id: string
  category: string
  status: string
  aiSuggested: boolean
  notes: string | null
  createdAt: string
  subject: { id: string; name: string; type: string } | null
  mention: LegalCaseMention
}

interface LegalCandidate {
  id: string
  status: string
  category: string | null
  confidence: number
  severity: number
  rationale: string | null
  suggestedActions: string[]
  subject: { id: string; name: string; type: string } | null
  mention: LegalCaseMention
}

interface LegalPolicy {
  enabled: boolean
  candidateThreshold: number
  autoPromote: boolean
  requireHumanReview: boolean
  allowedCategories: string[]
}

interface MonitoringSubjectOption {
  id: string
  name: string
  type: string
  status: string
}

interface ManualEngagementTask {
  id: string
  platform: string
  reason: string
  status: string
  targetUrl: string | null
  subject: { id: string; name: string; assignedAgentId: string | null } | null
  officialResponder: { accountId: string; name: string } | null
  mention: {
    id: string
    text: string
    sourceType: string
    contentKind: string
    url: string | null
    authorName: string | null
    authorHandle: string | null
    publishedAt: string | null
    createdAt: string
  }
  draft: {
    id: string
    replyText: string | null
    status: string
    language: string
    tone: string
    reasoning: string | null
    createdAt: string
    agent: {
      id: string | null
      version: number | null
      model: string | null
      binding: string | null
    } | null
  } | null
  integrity: {
    safe: boolean
    reasons: string[]
    foreignBrandNames: string[]
  }
  risk: {
    eligible: boolean
    reasons: string[]
  }
}

interface LegalReport {
  id: string
  title: string
  recipient: string | null
  periodStart: string
  periodEnd: string
  status: string
  letterLanguage: string
  letterText: string | null
  letterSource: string
  caseCount?: number
  createdAt: string
}

interface LegalReportDetail extends LegalReport {
  cases: Array<LegalCase & {
    mention: LegalCaseMention & {
      evidences: Array<{ id: string; permalink: string | null; screenshotUrl: string | null; capturedAt: string }>
    }
  }>
}

async function readJson<T>(res: Response, fallback: string): Promise<{ success?: boolean; error?: string; code?: string; data?: T }> {
  try {
    return await res.json()
  } catch {
    return { success: false, error: fallback }
  }
}

function toDatetimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function LegalCasePanel({ headers }: { headers: Record<string, string> }) {
  const t = useTranslations("socialMonitoring.legal")
  const locale = useLocale()
  const [cases, setCases] = useState<LegalCase[]>([])
  const [candidates, setCandidates] = useState<LegalCandidate[]>([])
  const [manualTasks, setManualTasks] = useState<ManualEngagementTask[]>([])
  const [monitoringSubjects, setMonitoringSubjects] = useState<MonitoringSubjectOption[]>([])
  const [policy, setPolicy] = useState<LegalPolicy>({ enabled: true, candidateThreshold: 0.65, autoPromote: false, requireHumanReview: true, allowedCategories: ["insult", "defamation", "false_accusation", "threat"] })
  const [reports, setReports] = useState<LegalReport[]>([])
  const [view, setView] = useState<"candidates" | "cases" | "reports" | "rules">("candidates")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState(() => ({
    title: "",
    recipient: "",
    language: "az",
    periodStart: toDatetimeLocal(new Date(Date.now() - 24 * 3600000)),
    periodEnd: toDatetimeLocal(new Date()),
    generateLetter: true,
  }))

  const [detail, setDetail] = useState<LegalReportDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [letterDraft, setLetterDraft] = useState("")
  const [savingLetter, setSavingLetter] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [candidatesRes, casesRes, reportsRes, policyRes, tasksRes, subjectsRes] = await Promise.all([
        fetch("/api/v1/social/legal-candidates", { headers }),
        fetch("/api/v1/social/legal-cases", { headers }),
        fetch("/api/v1/social/legal-reports", { headers }),
        fetch("/api/v1/social/legal-policy", { headers }),
        fetch("/api/v1/social/manual-engagement-tasks", { headers }),
        fetch("/api/v1/social/monitoring-subjects", { headers }),
      ])
      const candidatesJson = await readJson<LegalCandidate[]>(candidatesRes, t("loadFailed"))
      const casesJson = await readJson<LegalCase[]>(casesRes, t("loadFailed"))
      const reportsJson = await readJson<{ reports: LegalReport[]; openCaseCount: number }>(reportsRes, t("loadFailed"))
      const policyJson = await readJson<LegalPolicy>(policyRes, t("loadFailed"))
      const tasksJson = await readJson<ManualEngagementTask[]>(tasksRes, t("loadFailed"))
      const subjectsJson = await readJson<{ subjects: MonitoringSubjectOption[] }>(subjectsRes, t("loadFailed"))
      if (candidatesJson.success) setCandidates(candidatesJson.data ?? [])
      if (casesJson.success) setCases(casesJson.data ?? [])
      if (reportsJson.success) setReports(reportsJson.data?.reports ?? [])
      if (policyJson.success && policyJson.data) setPolicy(policyJson.data)
      if (tasksJson.success) setManualTasks(tasksJson.data ?? [])
      if (subjectsJson.success) setMonitoringSubjects(subjectsJson.data?.subjects ?? [])
    } finally {
      setLoading(false)
    }
  }, [headers, t])

  useEffect(() => { load() }, [load])

  const subjectOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const subject of monitoringSubjects) {
      if (subject.status === "active" || subject.status === "paused") {
        byId.set(subject.id, subject.name)
      }
    }
    for (const item of candidates) {
      if (item.subject) byId.set(item.subject.id, item.subject.name)
    }
    for (const item of cases) {
      if (item.subject) byId.set(item.subject.id, item.subject.name)
    }
    for (const item of manualTasks) {
      if (item.subject) byId.set(item.subject.id, item.subject.name)
    }
    return Array.from(byId, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [candidates, cases, manualTasks, monitoringSubjects, locale])
  const filteredCandidates = subjectFilter === "all"
    ? candidates
    : candidates.filter((item) => item.subject?.id === subjectFilter)
  const filteredCases = subjectFilter === "all"
    ? cases
    : cases.filter((item) => item.subject?.id === subjectFilter)
  const filteredManualTasks = subjectFilter === "all"
    ? manualTasks
    : manualTasks.filter((item) => item.subject?.id === subjectFilter)

  const patchManualTask = async (taskId: string, status: "IN_PROGRESS" | "CANCELLED") => {
    const res = await fetch(`/api/v1/social/manual-engagement-tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ status }),
    })
    const json = await readJson(res, t("manualTaskActionFailed"))
    if (!res.ok || !json.success) {
      throw new Error(json.error || t("manualTaskActionFailed"))
    }
  }

  const patchAiDraft = async (
    task: ManualEngagementTask,
    action: "approve" | "reject" | "update_text" | "enqueue_live",
    replyText?: string,
  ) => {
    if (!task.draft) throw new Error(t("manualTaskNoDraft"))
    const res = await fetch(`/api/v1/social/mentions/${task.mention.id}/ai-drafts`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        draftId: task.draft.id,
        action,
        ...(replyText ? { replyText } : {}),
      }),
    })
    const json = await readJson(res, t("manualTaskActionFailed"))
    if (!res.ok || !json.success) {
      const error = new Error(json.error || t("manualTaskActionFailed"))
      Object.assign(error, { code: json.code })
      throw error
    }
    return json
  }

  const saveManualDraft = async (task: ManualEngagementTask) => {
    if (!task.draft) return
    const replyText = (draftEdits[task.id] ?? task.draft.replyText ?? "").trim()
    if (!replyText) return toast.error(t("manualTaskReplyRequired"))
    setBusyTaskId(task.id)
    try {
      await patchAiDraft(task, "update_text", replyText)
      toast.success(t("manualTaskDraftSaved"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manualTaskActionFailed"))
    } finally {
      setBusyTaskId(null)
    }
  }

  const regenerateManualDraft = async (task: ManualEngagementTask) => {
    setBusyTaskId(task.id)
    try {
      const res = await fetch(`/api/v1/social/mentions/${task.mention.id}/ai-drafts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          regenerateReason: "brand_binding_changed",
          ...(task.draft?.id ? { sourceDraftId: task.draft.id } : {}),
          autoSendPositive: false,
        }),
      })
      const json = await readJson(res, t("manualTaskActionFailed"))
      if (!res.ok || !json.success) {
        throw new Error(json.error || t("manualTaskActionFailed"))
      }
      toast.success(t("manualTaskRegenerated"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manualTaskActionFailed"))
    } finally {
      setBusyTaskId(null)
    }
  }

  const confirmManualReply = async (task: ManualEngagementTask) => {
    if (!task.draft) return
    const replyText = (draftEdits[task.id] ?? task.draft.replyText ?? "").trim()
    if (!replyText) return toast.error(t("manualTaskReplyRequired"))
    setBusyTaskId(task.id)
    try {
      if (replyText !== task.draft.replyText) {
        await patchAiDraft(task, "update_text", replyText)
      }
      await patchAiDraft(task, "approve")
      const enqueued = await patchAiDraft(task, "enqueue_live")
      await patchManualTask(task.id, "IN_PROGRESS")
      toast.success(enqueued.code === "outbound_already_exists"
        ? t("manualTaskAlreadyQueued")
        : t("manualTaskQueued"))
      setConfirmingTaskId(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manualTaskActionFailed"))
    } finally {
      setBusyTaskId(null)
    }
  }

  const rejectManualReply = async (task: ManualEngagementTask) => {
    setBusyTaskId(task.id)
    try {
      if (task.draft) await patchAiDraft(task, "reject")
      await patchManualTask(task.id, "CANCELLED")
      toast.success(t("manualTaskRejected"))
      setConfirmingTaskId(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("manualTaskActionFailed"))
    } finally {
      setBusyTaskId(null)
    }
  }

  const reviewCandidate = async (id: string, action: "promote" | "dismiss") => {
    const res = await fetch(`/api/v1/social/legal-candidates/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ action }),
    })
    const json = await readJson(res, t("saveFailed"))
    if (!res.ok || !json.success) return toast.error(json.error || t("saveFailed"))
    toast.success(action === "promote" ? t("candidatePromoted") : t("candidateDismissed"))
    await load()
  }

  const savePolicy = async () => {
    const res = await fetch("/api/v1/social/legal-policy", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        enabled: policy.enabled,
        candidateThreshold: policy.candidateThreshold,
        allowedCategories: policy.allowedCategories,
        autoPromote: false,
        requireHumanReview: true,
      }),
    })
    const json = await readJson<LegalPolicy>(res, t("saveFailed"))
    if (!res.ok || !json.success) return toast.error(json.error || t("saveFailed"))
    if (json.data) setPolicy(json.data)
    toast.success(t("rulesSaved"))
  }

  const dismissCase = async (mentionId: string) => {
    const res = await fetch(`/api/v1/social/mentions/${mentionId}/legal-case`, { method: "DELETE", headers })
    const json = await readJson(res, t("dismissFailed"))
    if (!res.ok || !json.success) {
      toast.error(json.error || t("dismissFailed"))
      return
    }
    toast.success(t("caseDismissed"))
    load()
  }

  const createReport = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/v1/social/legal-reports", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          title: createForm.title.trim() || undefined,
          recipient: createForm.recipient.trim() || undefined,
          language: createForm.language,
          periodStart: new Date(createForm.periodStart).toISOString(),
          periodEnd: new Date(createForm.periodEnd).toISOString(),
          generateLetter: createForm.generateLetter,
        }),
      })
      const json = await readJson<LegalReport & { letterSkipped?: string }>(res, t("createFailed"))
      if (!res.ok || !json.success) {
        toast.error(json.error || t("createFailed"))
        return
      }
      if (json.data?.letterSkipped) {
        toast.warning(t("letterSkipped"))
      } else {
        toast.success(t("reportCreated"))
      }
      setShowCreate(false)
      await load()
      if (json.data?.id) openReport(json.data.id)
    } finally {
      setCreating(false)
    }
  }

  const openReport = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/v1/social/legal-reports/${id}`, { headers })
      const json = await readJson<LegalReportDetail>(res, t("loadFailed"))
      if (json.success && json.data) {
        setDetail(json.data)
        setLetterDraft(json.data.letterText ?? "")
      } else {
        toast.error(json.error || t("loadFailed"))
      }
    } finally {
      setDetailLoading(false)
    }
  }

  const patchReport = async (id: string, body: Record<string, unknown>, successMessage: string) => {
    const res = await fetch(`/api/v1/social/legal-reports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
    const json = await readJson<LegalReport>(res, t("saveFailed"))
    if (!res.ok || !json.success) {
      toast.error(json.error || t("saveFailed"))
      return false
    }
    toast.success(successMessage)
    await load()
    await openReport(id)
    return true
  }

  const saveLetter = async () => {
    if (!detail) return
    setSavingLetter(true)
    try {
      await patchReport(detail.id, { letterText: letterDraft || null }, t("letterSaved"))
    } finally {
      setSavingLetter(false)
    }
  }

  const deleteReport = async (id: string) => {
    if (!window.confirm(t("deleteConfirm"))) return
    const res = await fetch(`/api/v1/social/legal-reports/${id}`, { method: "DELETE", headers })
    const json = await readJson(res, t("deleteFailed"))
    if (!res.ok || !json.success) {
      toast.error(json.error || t("deleteFailed"))
      return
    }
    toast.success(t("reportDeleted"))
    setDetail(null)
    load()
  }

  const printReport = () => {
    if (!detail) return
    const escapeHtml = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const appendix = detail.cases.map((item) => {
      const links = [
        ...(item.mention.url ? [item.mention.url] : []),
        ...item.mention.evidences.flatMap((evidence) => [evidence.screenshotUrl, evidence.permalink].filter((v): v is string => Boolean(v))),
      ]
      return `<li>
        <p><strong>[${escapeHtml(item.mention.platform)}/${escapeHtml(item.mention.sourceType)}]</strong>
        ${escapeHtml(t(`category.${item.category}` as Parameters<typeof t>[0]))} —
        ${escapeHtml(item.mention.authorName || item.mention.authorHandle || "?")},
        ${escapeHtml(formatDateTime(item.mention.publishedAt || item.mention.createdAt, locale))}</p>
        <blockquote>${escapeHtml(item.mention.text)}</blockquote>
        ${links.map((link) => `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`).join("")}
      </li>`
    }).join("\n")
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(detail.title)}</title>
      <style>body{font-family:serif;max-width:800px;margin:40px auto;line-height:1.5}pre{white-space:pre-wrap;font-family:serif}blockquote{border-left:3px solid #999;margin:8px 0;padding:4px 12px;color:#333}li{margin-bottom:16px}</style>
      </head><body>
      <pre>${escapeHtml(detail.letterText ?? "")}</pre>
      <hr><h3>${escapeHtml(t("printAppendixTitle"))}</h3><ol>${appendix}</ol>
      </body></html>`
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const categoryBadgeVariant = (category: string) =>
    category === "threat" ? "destructive" : category === "defamation" || category === "false_accusation" ? "warning" : "secondary"

  const isDetailDraft = detail?.status === "draft"

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-muted/40 p-1 [scrollbar-width:none] dark:border-zinc-700 [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("workspaceTabsLabel")}>
        {([
          ["candidates", t("tabCandidates"), filteredCandidates.length],
          ["cases", t("tabCases"), filteredCases.length],
          ["reports", t("tabReports"), reports.length],
          ["rules", t("tabRules"), null],
        ] as const).map(([id, label, count]) => (
          <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}>
            {label}{count !== null && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{count}</span>}
          </button>
        ))}
      </div>

      {(view === "candidates" || view === "cases") && subjectOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-card px-3 py-2 dark:border-zinc-700">
          <Label htmlFor="social-legal-subject-filter" className="text-xs font-medium text-muted-foreground">
            {t("brandFilterLabel")}
          </Label>
          <Select
            id="social-legal-subject-filter"
            value={subjectFilter}
            onChange={(event) => setSubjectFilter(event.target.value)}
            className="h-9 min-w-52 sm:w-auto"
          >
            <option value="all">{t("allBrands")}</option>
            {subjectOptions.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </div>
      )}

      {view === "candidates" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldAlert className="h-4 w-4 text-amber-600" /> {t("candidatesTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("candidatesDesc")}</p>
              </div>
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {t("refresh")}</Button>
            </div>
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">{t("candidateHumanGate")}</p>
            {filteredCandidates.length === 0 && !loading && <p className="mt-4 text-sm text-muted-foreground">{t("noCandidates")}</p>}
            <div className="mt-3 space-y-2">
              {filteredCandidates.map(candidate => (
                <div key={candidate.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] uppercase">{candidate.mention.platform}</Badge>
                    <Badge variant={candidate.category ? categoryBadgeVariant(candidate.category) : "outline"} className="text-[10px]">{candidate.category ? t(`category.${candidate.category}` as Parameters<typeof t>[0]) : t("categoryUnclear")}</Badge>
                    <span className="text-xs font-medium">{Math.round(candidate.confidence * 100)}%</span>
                    <span className="text-xs text-muted-foreground">{t("severity", { value: candidate.severity })}</span>
                    {candidate.subject && <span className="text-xs text-muted-foreground">· {candidate.subject.name}</span>}
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm">{candidate.mention.text}</p>
                  {candidate.rationale && <p className="mt-1 text-xs text-muted-foreground">{candidate.rationale}</p>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1">{candidate.suggestedActions.map(action => <Badge key={action} variant="outline" className="text-[10px]">{action}</Badge>)}</div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => reviewCandidate(candidate.id, "dismiss")} className="gap-1"><X className="h-3.5 w-3.5" /> {t("dismissCandidate")}</Button>
                      <Button size="sm" onClick={() => reviewCandidate(candidate.id, "promote")} className="gap-1"><Check className="h-3.5 w-3.5" /> {t("promoteCandidate")}</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Hand className="h-4 w-4 text-violet-600" /> {t("manualTasksTitle")} <Badge variant="secondary">{filteredManualTasks.length}</Badge></h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("manualTasksDesc")}</p>
            {filteredManualTasks.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("noManualTasks")}</p>
            ) : (
              <div className="mt-3 space-y-3">
                {filteredManualTasks.map(task => {
                  const sourceUrl = task.targetUrl || task.mention.url
                  const author = task.mention.authorName || task.mention.authorHandle
                  const isCommentOrReply = ["comment", "reply"].includes(task.mention.sourceType.toLowerCase())
                    || ["COMMENT", "REPLY"].includes(task.mention.contentKind.toUpperCase())
                  const draftText = draftEdits[task.id] ?? task.draft?.replyText ?? ""
                  const tenantResponderReady = task.integrity.safe
                    && task.draft?.agent?.binding === "ORGANIZATION"
                    && Boolean(task.officialResponder)
                  const taskBusy = busyTaskId === task.id
                  return (
                    <article key={task.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="uppercase">{task.platform}</Badge>
                          <span className="font-medium">{task.subject?.name ?? t("unknownSubject")}</span>
                          <Badge variant={isCommentOrReply ? (task.integrity.safe ? "secondary" : "destructive") : "warning"} className="text-[10px]">
                            {isCommentOrReply
                              ? (task.integrity.safe ? t("manualTaskVerified") : t("manualTaskQuarantined"))
                              : t("manualTaskRiskReview")}
                          </Badge>
                        </div>
                        {sourceUrl && (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            {t("manualTaskOpenSource")} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isCommentOrReply && task.reason === "external_comment_reply_capability_unavailable"
                          ? t("manualTaskCapabilityUnavailable")
                          : !isCommentOrReply || task.reason === "brand_risk_review_required"
                            ? t("manualTaskRiskReviewDesc")
                          : task.reason}
                      </p>
                      <div className="mt-3 rounded-md border border-zinc-200 bg-muted/40 p-3 dark:border-zinc-700">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{isCommentOrReply ? t("manualTaskOriginalComment") : t("manualTaskOriginalMaterial")}</span>
                          <span>
                            {author ? t("manualTaskAuthor", { value: author }) : t("manualTaskUnknownAuthor")}
                            {" · "}
                            {formatDateTime(task.mention.publishedAt || task.mention.createdAt, locale)}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{task.mention.text}</p>
                      </div>
                      {!task.integrity.safe ? (
                        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                          <p className="font-semibold">{t("manualTaskUnsafeTitle")}</p>
                          <p className="mt-1">{t("manualTaskUnsafeDesc")}</p>
                          {task.integrity.foreignBrandNames.length > 0 && (
                            <p className="mt-1">
                              {t("manualTaskForeignBrands", { value: task.integrity.foreignBrandNames.join(", ") })}
                            </p>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3 gap-1.5 border-amber-400 bg-background"
                            onClick={() => regenerateManualDraft(task)}
                            disabled={taskBusy}
                          >
                            {taskBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {t("manualTaskRegenerate")}
                          </Button>
                        </div>
                      ) : task.draft?.replyText ? (
                        <div className="mt-3 overflow-hidden rounded-lg border border-violet-200 bg-violet-50/40 dark:border-violet-900/70 dark:bg-violet-950/20">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-200 px-3 py-2 dark:border-violet-900/70">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
                                <Bot className="h-3.5 w-3.5" />
                              </span>
                              <div>
                                <p className="text-xs font-semibold">{t("manualTaskDraftReply")}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {tenantResponderReady
                                    ? t("manualTaskAgentBound", {
                                        version: task.draft.agent?.version ?? "—",
                                        model: task.draft.agent?.model ?? "—",
                                        responder: task.officialResponder?.name ?? "—",
                                      })
                                    : t("manualTaskAgentFallback")}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="outline" className="text-[10px]">{task.draft.language.toUpperCase()}</Badge>
                              <Badge variant="outline" className="text-[10px]">{task.draft.tone}</Badge>
                            </div>
                          </div>
                          <div className="space-y-3 p-3">
                            <div>
                              <Label htmlFor={`manual-reply-${task.id}`} className="text-xs">
                                {t("manualTaskReplyPreview")}
                              </Label>
                              <Textarea
                                id={`manual-reply-${task.id}`}
                                value={draftText}
                                onChange={event => setDraftEdits(current => ({ ...current, [task.id]: event.target.value }))}
                                rows={5}
                                maxLength={2000}
                                className="mt-1 resize-y bg-background text-sm leading-relaxed"
                                disabled={taskBusy}
                              />
                              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span>{t("manualTaskEditHint")}</span>
                                <span>{draftText.length}/2000</span>
                              </div>
                            </div>
                            {!tenantResponderReady && (
                              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                                {t("manualTaskAgentRequired")}
                              </div>
                            )}
                            {confirmingTaskId === task.id ? (
                              <div className="rounded-md border border-orange-300 bg-orange-50 p-3 dark:border-orange-900/70 dark:bg-orange-950/30">
                                <p className="text-xs font-semibold text-orange-950 dark:text-orange-100">{t("manualTaskConfirmTitle")}</p>
                                <p className="mt-1 text-xs text-orange-900/80 dark:text-orange-200/80">{t("manualTaskConfirmDesc")}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => confirmManualReply(task)}
                                    disabled={taskBusy || !tenantResponderReady || !draftText.trim()}
                                  >
                                    {taskBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    {t("manualTaskConfirmSend")}
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => setConfirmingTaskId(null)} disabled={taskBusy}>
                                    {t("cancel")}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => saveManualDraft(task)}
                                  disabled={taskBusy || !draftText.trim() || draftText === task.draft?.replyText}
                                >
                                  {taskBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                  {t("manualTaskSaveDraft")}
                                </Button>
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="ghost" size="sm" onClick={() => rejectManualReply(task)} disabled={taskBusy}>
                                    {t("manualTaskReject")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => setConfirmingTaskId(task.id)}
                                    disabled={taskBusy || !tenantResponderReady || !draftText.trim()}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    {t("manualTaskReviewAndConfirm")}
                                  </Button>
                                </div>
                              </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">{t("manualTaskExternalOnlyNote")}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md border border-zinc-200 bg-muted/30 p-3 text-xs text-muted-foreground dark:border-zinc-700">
                          <p>{t("manualTaskNoDraft")}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3 gap-1.5 bg-background"
                            onClick={() => regenerateManualDraft(task)}
                            disabled={taskBusy}
                          >
                            {taskBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {t("manualTaskCreateDraft")}
                          </Button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {view === "cases" && <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Scale className="h-4 w-4 text-amber-600" /> {t("openCasesTitle")}
              {filteredCases.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{filteredCases.length}</span>
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("openCasesDesc")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {t("refresh")}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} disabled={cases.length === 0} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> {t("createReport")}
            </Button>
          </div>
        </div>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {t("humanReviewNote")}
        </p>
        {filteredCases.length === 0 && !loading && (
          <p className="mt-4 text-sm text-muted-foreground">{t("noOpenCases")}</p>
        )}
        <div className="mt-3 space-y-2">
          {filteredCases.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase">{item.mention.platform}</Badge>
                  <Badge variant={categoryBadgeVariant(item.category)} className="text-[10px]">
                    {t(`category.${item.category}` as Parameters<typeof t>[0])}
                  </Badge>
                  {item.subject && <span className="text-xs text-muted-foreground">· {item.subject.name}</span>}
                  {item.aiSuggested && <Badge variant="outline" className="text-[10px]">{t("aiSuggested")}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {item.mention.authorName || item.mention.authorHandle || "?"} · {formatDateTime(item.mention.publishedAt || item.mention.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{item.mention.text}</p>
                {item.notes && <p className="mt-1 text-xs text-muted-foreground">{t("notesLabel")}: {item.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {item.mention.url && (
                  <a href={item.mention.url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title={t("openOriginal")}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                )}
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title={t("dismissCase")} onClick={() => dismissCase(item.mention.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {view === "reports" && <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4 text-blue-600" /> {t("reportsTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("reportsDesc")}</p>
        {reports.length === 0 && !loading && (
          <p className="mt-4 text-sm text-muted-foreground">{t("noReports")}</p>
        )}
        <div className="mt-3 space-y-2">
          {reports.map((report) => (
            <button
              key={report.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-md border border-zinc-200 p-3 text-left transition-colors hover:bg-muted/40 dark:border-zinc-700"
              onClick={() => openReport(report.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{report.title}</span>
                  <Badge variant={report.status === "final" ? "success" : "secondary"} className="text-[10px]">
                    {report.status === "final" ? t("statusFinal") : t("statusDraft")}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(report.periodStart, locale)} — {formatDateTime(report.periodEnd, locale)}
                  {typeof report.caseCount === "number" && <> · {t("caseCount", { count: report.caseCount })}</>}
                </p>
              </div>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>}

      {view === "rules" && (
        <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <h2 className="flex items-center gap-2 text-base font-semibold"><SlidersHorizontal className="h-4 w-4 text-blue-600" /> {t("rulesTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("rulesDesc")}</p>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><p className="text-sm font-medium">{t("classificationEnabled")}</p><p className="text-xs text-muted-foreground">{t("classificationEnabledHint")}</p></div><Switch checked={policy.enabled} onCheckedChange={enabled => setPolicy(current => ({ ...current, enabled }))} /></div>
            <div className="space-y-2"><Label>{t("candidateThreshold", { value: Math.round(policy.candidateThreshold * 100) })}</Label><input type="range" min={0.5} max={0.95} step={0.05} value={policy.candidateThreshold} onChange={event => setPolicy(current => ({ ...current, candidateThreshold: Number(event.target.value) }))} className="w-full accent-amber-600" /></div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"><p className="font-medium">{t("humanGateLocked")}</p><p className="mt-1 text-xs">{t("humanGateLockedHint")}</p></div>
            <Button onClick={savePolicy}>{t("saveRules")}</Button>
          </div>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogHeader>
          <DialogTitle>{t("createReportTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("createReportDesc", { count: cases.length })}</p>
          <div className="space-y-1">
            <Label>{t("fieldTitle")}</Label>
            <Input value={createForm.title} onChange={(e) => setCreateForm((c) => ({ ...c, title: e.target.value }))} placeholder={t("fieldTitlePlaceholder")} />
          </div>
          <div className="space-y-1">
            <Label>{t("fieldRecipient")}</Label>
            <Input value={createForm.recipient} onChange={(e) => setCreateForm((c) => ({ ...c, recipient: e.target.value }))} placeholder={t("fieldRecipientPlaceholder")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("fieldPeriodStart")}</Label>
              <Input type="datetime-local" value={createForm.periodStart} onChange={(e) => setCreateForm((c) => ({ ...c, periodStart: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("fieldPeriodEnd")}</Label>
              <Input type="datetime-local" value={createForm.periodEnd} onChange={(e) => setCreateForm((c) => ({ ...c, periodEnd: e.target.value }))} />
            </div>
          </div>
          <Select label={t("fieldLanguage")} value={createForm.language} onChange={(e) => setCreateForm((c) => ({ ...c, language: e.target.value }))}>
            {SOCIAL_LEGAL_LETTER_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{t(`language.${lang}` as Parameters<typeof t>[0])}</option>
            ))}
          </Select>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm">{t("fieldGenerateLetter")}</Label>
              <p className="text-xs text-muted-foreground">{t("fieldGenerateLetterHelp")}</p>
            </div>
            <Switch checked={createForm.generateLetter} onCheckedChange={(checked) => setCreateForm((c) => ({ ...c, generateLetter: checked }))} />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
          <Button onClick={createReport} disabled={creating}>{creating ? t("creating") : t("create")}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={Boolean(detail) || detailLoading} onOpenChange={(next) => { if (!next) setDetail(null) }} widthClassName="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-amber-600" /> {detail?.title ?? t("loading")}
          </DialogTitle>
        </DialogHeader>
        {detail && (
          <DialogContent className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={detail.status === "final" ? "success" : "secondary"} className="text-[10px]">
                {detail.status === "final" ? t("statusFinal") : t("statusDraft")}
              </Badge>
              <span>{formatDateTime(detail.periodStart, locale)} — {formatDateTime(detail.periodEnd, locale)}</span>
              {detail.recipient && <span>· {detail.recipient}</span>}
            </div>
            <div className="space-y-1">
              <Label>{t("letterLabel")}</Label>
              <Textarea
                value={letterDraft}
                onChange={(e) => setLetterDraft(e.target.value)}
                rows={14}
                disabled={!isDetailDraft}
                placeholder={t("letterPlaceholder")}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("letterReviewHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("casesInReport", { count: detail.cases.length })}</Label>
              <div className="space-y-2">
                {detail.cases.map((item) => (
                  <div key={item.id} className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] uppercase">{item.mention.platform}</Badge>
                      <Badge variant={categoryBadgeVariant(item.category)} className="text-[10px]">
                        {t(`category.${item.category}` as Parameters<typeof t>[0])}
                      </Badge>
                      <span className="text-muted-foreground">
                        {item.mention.authorName || item.mention.authorHandle || "?"} · {formatDateTime(item.mention.publishedAt || item.mention.createdAt, locale)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2">{item.mention.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {detail && isDetailDraft && (
            <>
              <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={() => deleteReport(detail.id)}>
                <Trash2 className="h-3.5 w-3.5" /> {t("deleteReport")}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={saveLetter} disabled={savingLetter}>
                {savingLetter ? t("saving") : t("saveLetter")}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => patchReport(detail.id, { status: "final" }, t("reportFinalized"))}>
                <Lock className="h-3.5 w-3.5" /> {t("finalize")}
              </Button>
            </>
          )}
          {detail && !isDetailDraft && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => patchReport(detail.id, { status: "draft" }, t("reportReopened"))}>
              <Unlock className="h-3.5 w-3.5" /> {t("reopen")}
            </Button>
          )}
          {detail && (
            <Button size="sm" className="gap-1.5" onClick={printReport} disabled={!detail.letterText && !letterDraft}>
              <Printer className="h-3.5 w-3.5" /> {t("print")}
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  )
}

export { SOCIAL_LEGAL_CATEGORIES }
export type { SocialLegalCategory }
