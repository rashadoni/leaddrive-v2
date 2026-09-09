"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, CalendarClock, Check, CheckCircle2, ChevronDown, Clock3, FileText, ImagePlus, PackageCheck, Presentation, RefreshCw, Save, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  loadQueue,
  saveQueue,
  enqueue,
  makeOp,
  pendingBatches,
  pendingCount,
  applyOutcome,
  prune,
  type OutboxOp,
} from "@/lib/mtm/offline-outbox"
import { enqueuePhoto, listPhotos, removePhoto, countPhotos } from "@/lib/mtm/photo-outbox"
import { formatDate, formatDateTime } from "@/lib/format-date"

type ActionKey = "PHOTO" | "PRESENTATION" | "STOCK_CHECK" | "VISIT_NOTE" | "CHECKLIST" | "FEEDBACK" | "NEXT_ACTION"
type RequirementMode = "REQUIRED" | "OPTIONAL" | "HIDDEN"
type WorkspaceTranslator = (key: string, values?: Record<string, string | number>) => string

interface Requirement {
  id: string
  actionKey: ActionKey
  mode: RequirementMode
  minCount: number
  allowWaiver: boolean
}

interface WorkspaceData {
  visit: {
    id: string
    agentId: string
    status: string
    checkInAt: string
    outcome?: string | null
    potential?: string | null
    resultNotes?: string | null
    nextActionDueAt?: string | null
    agent: { id: string; name: string }
    customer: { id: string; name: string; address?: string | null; category: string; objectType: string }
    participants: Array<{ agent: { id: string; name: string } }>
    requirementSnapshot: { sourcePolicy?: { name: string } | null; requirements: Requirement[] } | null
    actionResults: Array<{ id: string; actionKey: ActionKey; status: string; evidence?: Record<string, unknown> | null }>
    photos: Array<{ id: string; url: string; status: string }>
    route?: { id: string; name?: string | null; date: string; status: string } | null
  }
  reminders: Array<{ id: string; title: string; description?: string | null; status: string; priority: string; dueDate?: string | null }>
  previousPromises: Array<{ id: string; checkInAt: string; outcome?: string | null; resultNotes?: string | null; nextActionDueAt?: string | null; agent: { name: string } }>
  previousStockChecks: Array<{ id: string; evidence?: Record<string, unknown> | null; completedAt?: string | null; visit: { checkInAt: string; agent: { name: string } } }>
}

interface ResultDraft {
  outcome: string
  potential: string
  discussedTopics: string
  feedback: string
  finalNote: string
  nextActionTitle: string
  nextActionDueDate: string
  nextActionPriority: string
}

const EMPTY_RESULT: ResultDraft = {
  outcome: "",
  potential: "UNKNOWN",
  discussedTopics: "",
  feedback: "",
  finalNote: "",
  nextActionTitle: "",
  nextActionDueDate: "",
  nextActionPriority: "MEDIUM",
}

const ACTION_ICONS = {
  PHOTO: ImagePlus,
  PRESENTATION: Presentation,
  STOCK_CHECK: PackageCheck,
  VISIT_NOTE: FileText,
  CHECKLIST: CheckCircle2,
  FEEDBACK: FileText,
  NEXT_ACTION: CalendarClock,
} as const

function draftKey(visitId: string) {
  return `mtm-visit-result-draft:${visitId}`
}

export function VisitWorkspace({ visitId, onCompleted }: { visitId: string; onCompleted: () => void }) {
  const t = useTranslations("mtmVisitWorkspace") as unknown as WorkspaceTranslator
  const locale = useLocale()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState<Array<{ actionKey: ActionKey; requiredCount: number; completedCount: number }>>([])
  const [result, setResult] = useState<ResultDraft>(EMPTY_RESULT)
  const [presentation, setPresentation] = useState({ material: "", version: "", topic: "" })
  const [stock, setStock] = useState({ product: "", state: "AVAILABLE", quantity: "" })
  const [checklist, setChecklist] = useState("")
  const [online, setOnline] = useState(true)
  // G — offline outbox: count of visit mutations queued while offline, awaiting sync.
  const [pendingSync, setPendingSync] = useState(0)
  // G — count of photos captured offline, awaiting upload on reconnect.
  const [pendingPhotos, setPendingPhotos] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/v1/mtm/visits/${visitId}/workspace`)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("loadFailed"))
      setData(body.data)
      const stored = localStorage.getItem(draftKey(visitId))
      if (stored) setResult({ ...EMPTY_RESULT, ...JSON.parse(stored) })
      else setResult({
        ...EMPTY_RESULT,
        outcome: body.data.visit.outcome ?? "",
        potential: body.data.visit.potential ?? "UNKNOWN",
        finalNote: body.data.visit.resultNotes ?? "",
        nextActionDueDate: body.data.visit.nextActionDueAt?.slice(0, 16) ?? "",
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t, visitId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(draftKey(visitId), JSON.stringify(result)), 250)
    return () => window.clearTimeout(timer)
  }, [result, visitId])

  // G — flush the offline outbox to the idempotent sync engine (safe to retry).
  const flushOutbox = useCallback(async () => {
    const q = await loadQueue()
    const batches = pendingBatches(q)
    if (batches.length === 0) { setPendingSync(0); return }
    let next = q
    let syncedCount = 0
    let conflicts = 0
    let processed = false
    try {
      // Sequential batches preserve operation order and stay within the
      // endpoint's zod max(100) contract. Persist each accepted batch so a
      // later network failure cannot replay already-settled local state.
      for (const batch of batches) {
        const res = await fetch("/api/v1/mtm/sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operations: batch.map((o: OutboxOp) => ({ operationId: o.operationId, entity: o.entity, op: o.op, data: o.data, clientTimestamp: o.clientTimestamp })) }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.success) break // keep this and later batches queued

        for (const outcome of (body.data?.results ?? []) as Array<{ operationId: string; status: "ok" | "conflict" | "error" }>) {
          next = applyOutcome(next, outcome.operationId, { status: outcome.status })
          if (outcome.status === "ok") syncedCount++
          if (outcome.status === "conflict") conflicts++
        }
        processed = true
        next = prune(next)
        await saveQueue(next)
      }
      setPendingSync(pendingCount(next))
      if (syncedCount > 0) toast.success(t("syncedVisits", { count: syncedCount }))
      if (conflicts > 0) toast.error(t("syncConflicts", { count: conflicts }))
      if (processed) void load()
    } catch {
      // offline again / transient — leave the queue for the next attempt
      setPendingSync(pendingCount(next))
    }
  }, [t, load])

  // G — upload photos captured offline once the network is back.
  const flushPhotos = useCallback(async () => {
    const photos = await listPhotos()
    if (photos.length === 0) { setPendingPhotos(0); return }
    let uploaded = 0
    for (const p of photos) {
      try {
        const form = new FormData()
        form.append("file", p.blob, p.filename)
        form.append("agentId", p.agentId)
        form.append("visitId", p.visitId)
        // The endpoint dedupes on clientPhotoId, so a retry never double-uploads.
        form.append("clientPhotoId", p.id)
        const res = await fetch("/api/v1/mtm/photos", { method: "POST", body: form })
        if (res.ok) { await removePhoto(p.id); uploaded++ }
        else break // server rejected — stop; keep the rest queued for a later retry
      } catch {
        break // offline again — leave the queue intact
      }
    }
    setPendingPhotos(await countPhotos())
    if (uploaded > 0) { toast.success(t("photosUploaded", { count: uploaded })); void load() }
  }, [t, load])

  useEffect(() => {
    void loadQueue().then((q) => setPendingSync(pendingCount(q)))
    void countPhotos().then(setPendingPhotos)
  }, [])
  useEffect(() => { if (online) { void flushOutbox(); void flushPhotos() } }, [online, flushOutbox, flushPhotos])

  const completedCounts = useMemo(() => {
    const counts = new Map<ActionKey, number>()
    for (const item of data?.visit.actionResults ?? []) {
      if (item.status === "COMPLETED" || item.status === "WAIVED") counts.set(item.actionKey, (counts.get(item.actionKey) ?? 0) + 1)
    }
    if (data) counts.set("PHOTO", Math.max(counts.get("PHOTO") ?? 0, data.visit.photos.length))
    return counts
  }, [data])

  const saveAction = async (actionKey: ActionKey, evidence: Record<string, unknown>) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/v1/mtm/visits/${visitId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionKey, status: "COMPLETED", evidence }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("actionFailed"))
      toast.success(t("actionSaved"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"))
    } finally {
      setBusy(false)
    }
  }

  const uploadPhoto = async (file: File | null) => {
    if (!file || !data) return
    // G — offline: stash the photo Blob on-device; it uploads on reconnect.
    if (!online) {
      await enqueuePhoto({ blob: file, agentId: data.visit.agentId, visitId, filename: file.name || "photo.jpg" })
      setPendingPhotos(await countPhotos())
      toast.success(t("photoQueued"))
      return
    }
    const form = new FormData()
    form.append("file", file)
    form.append("agentId", data.visit.agentId)
    form.append("visitId", visitId)
    setBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/photos", { method: "POST", body: form })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || t("photoFailed"))
      toast.success(t("photoSaved"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("photoFailed"))
    } finally {
      setBusy(false)
    }
  }


  const updateReminder = async (id: string, action: "complete" | "acknowledge" | "reschedule") => {
    const dueDate = action === "reschedule" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined
    const status = action === "complete" ? "COMPLETED" : action === "acknowledge" ? "IN_PROGRESS" : "PENDING"
    const response = await fetch(`/api/v1/mtm/tasks/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, ...(dueDate ? { dueDate } : {}) }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      toast.error(body?.error || t("reminderFailed"))
      return
    }
    await load()
  }

  const saveResult = async () => {
    if (!result.outcome) throw new Error(t("outcomeRequired"))
    if (result.outcome === "RESCHEDULE" && (!result.nextActionTitle || !result.nextActionDueDate)) {
      throw new Error(t("rescheduleRequiresAction"))
    }
    const response = await fetch(`/api/v1/mtm/visits/${visitId}/result`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        outcome: result.outcome,
        potential: result.potential,
        discussedTopics: result.discussedTopics.split(",").map((item) => item.trim()).filter(Boolean),
        feedback: result.feedback || null,
        finalNote: result.finalNote || null,
        nextAction: result.nextActionTitle && result.nextActionDueDate ? {
          title: result.nextActionTitle,
          dueDate: new Date(result.nextActionDueDate).toISOString(),
          priority: result.nextActionPriority,
        } : null,
      }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || t("resultFailed"))
    localStorage.removeItem(draftKey(visitId))
    return body
  }

  const completeVisit = async () => {
    if (!online) {
      // G — queue the check-out offline; it syncs idempotently on reconnect.
      // Survey results are already drafted in localStorage (a later slice queues
      // them too); the server re-checks requirements on flush and flags a conflict
      // if they're incomplete.
      const op = makeOp("visits", "update", { kind: "checkout", visitId, checkOutAt: new Date().toISOString() })
      const q = enqueue(await loadQueue(), op)
      await saveQueue(q)
      setPendingSync(pendingCount(q))
      toast.success(t("queuedForSync"))
      onCompleted()
      return
    }
    setBusy(true)
    setMissing([])
    try {
      await saveResult()
      const response = await fetch(`/api/v1/mtm/visits/${visitId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "CHECKED_OUT" }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        if (body?.code === "MTM_VISIT_REQUIREMENTS_INCOMPLETE") setMissing(body.missing ?? [])
        throw new Error(body?.error || t("completeFailed"))
      }
      toast.success(t("completed"))
      onCompleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("completeFailed"))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="h-72 animate-pulse rounded-md bg-muted" />
  if (!data) return null

  const requirements = data.visit.requirementSnapshot?.requirements.filter((item) => item.mode !== "HIDDEN") ?? []
  const visibleActions = new Set(requirements.map((item) => item.actionKey))
  const required = requirements.filter((item) => item.mode === "REQUIRED")
  const optional = requirements.filter((item) => item.mode === "OPTIONAL")

  const actionRow = (requirement: Requirement) => {
    const Icon = ACTION_ICONS[requirement.actionKey]
    const count = completedCounts.get(requirement.actionKey) ?? 0
    const done = count >= requirement.minCount
    return (
      <div key={requirement.id} className="border-t border-zinc-200 py-4 first:border-t-0 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t(`actions.${requirement.actionKey}`)}</span>
            <span className={`text-xs ${done ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>{count}/{requirement.minCount}</span>
          </div>
          {done && <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" /> {t("done")}</span>}
        </div>
        {!done && requirement.actionKey === "PHOTO" && (
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
            <Upload className="h-4 w-4" /> {t("uploadPhoto")}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" onChange={(event) => void uploadPhoto(event.target.files?.[0] ?? null)} />
          </label>
        )}
        {!done && requirement.actionKey === "PRESENTATION" && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input value={presentation.material} onChange={(event) => setPresentation({ ...presentation, material: event.target.value })} placeholder={t("material")} className="h-9" />
            <Input value={presentation.version} onChange={(event) => setPresentation({ ...presentation, version: event.target.value })} placeholder={t("version")} className="h-9" />
            <div className="flex gap-2"><Input value={presentation.topic} onChange={(event) => setPresentation({ ...presentation, topic: event.target.value })} placeholder={t("topic")} className="h-9" /><Button size="icon" className="h-9 w-9 shrink-0" disabled={!presentation.material || busy} onClick={() => { const completedAt = new Date().toISOString(); void saveAction("PRESENTATION", { ...presentation, openedAt: completedAt, completedAt }) }} title={t("saveAction")}><Save className="h-4 w-4" /></Button></div>
          </div>
        )}
        {!done && requirement.actionKey === "STOCK_CHECK" && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_120px_auto]">
            <Input value={stock.product} onChange={(event) => setStock({ ...stock, product: event.target.value })} placeholder={t("product")} className="h-9" />
            <select value={stock.state} onChange={(event) => setStock({ ...stock, state: event.target.value })} className="h-9 rounded-md border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700"><option value="AVAILABLE">{t("available")}</option><option value="NOT_AVAILABLE">{t("notAvailable")}</option><option value="UNKNOWN">{t("unknown")}</option></select>
            <Input type="number" min={0} value={stock.quantity} onChange={(event) => setStock({ ...stock, quantity: event.target.value })} placeholder={t("quantity")} className="h-9" />
            <Button size="icon" className="h-9 w-9" disabled={!stock.product || busy} onClick={() => void saveAction("STOCK_CHECK", { ...stock, quantity: stock.quantity ? Number(stock.quantity) : null })} title={t("saveAction")}><Save className="h-4 w-4" /></Button>
          </div>
        )}
        {!done && requirement.actionKey === "CHECKLIST" && (
          <div className="mt-3 flex gap-2"><Input value={checklist} onChange={(event) => setChecklist(event.target.value)} placeholder={t("checklistResult")} className="h-9" /><Button size="icon" className="h-9 w-9" disabled={!checklist || busy} onClick={() => void saveAction("CHECKLIST", { result: checklist })} title={t("saveAction")}><Save className="h-4 w-4" /></Button></div>
        )}
        {!done && ["VISIT_NOTE", "FEEDBACK", "NEXT_ACTION"].includes(requirement.actionKey) && <p className="mt-2 text-xs text-muted-foreground">{t("completeInResult")}</p>}
      </div>
    )
  }

  return (
    <section className="border-y border-zinc-200 bg-background py-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t("activeVisit")}</span></div>
          <h2 className="mt-1 text-xl font-semibold">{data.visit.customer.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{data.visit.customer.address || t("noAddress")} - {data.visit.agent.name}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground"><div className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatDateTime(new Date(data.visit.checkInAt), locale)}</div>{data.visit.requirementSnapshot?.sourcePolicy?.name && <div className="mt-1">{data.visit.requirementSnapshot.sourcePolicy.name}</div>}</div>
      </div>

      {!online && <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle className="h-4 w-4" /> {t("offlineDraft")}</div>}

      <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7">
          <div><h3 className="text-sm font-semibold">{t("requiredActions")}</h3><div className="mt-2">{required.length ? required.map(actionRow) : <p className="py-3 text-sm text-muted-foreground">{t("noRequiredActions")}</p>}</div></div>
          {optional.length > 0 && <details className="group"><summary className="flex cursor-pointer list-none items-center justify-between border-y border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-800">{t("optionalActions")}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div>{optional.map(actionRow)}</div></details>}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t("visitResult")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("outcome")}</span><select value={result.outcome} onChange={(event) => setResult({ ...result, outcome: event.target.value })} className="h-10 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"><option value="">{t("selectOutcome")}</option>{["SUCCESSFUL", "PARTIAL", "NO_CONTACT", ...(visibleActions.has("NEXT_ACTION") ? ["RESCHEDULE"] : [])].map((value) => <option key={value} value={value}>{t(`outcomes.${value}`)}</option>)}</select></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("potential")}</span><select value={result.potential} onChange={(event) => setResult({ ...result, potential: event.target.value })} className="h-10 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700">{["HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((value) => <option key={value} value={value}>{t(`potentials.${value}`)}</option>)}</select></label>
            </div>
            {visibleActions.has("VISIT_NOTE") && <><Input value={result.discussedTopics} onChange={(event) => setResult({ ...result, discussedTopics: event.target.value })} placeholder={t("topicsPlaceholder")} /><textarea value={result.finalNote} onChange={(event) => setResult({ ...result, finalNote: event.target.value })} placeholder={t("notePlaceholder")} className="min-h-24 w-full rounded-md border border-zinc-200 bg-background p-3 text-sm dark:border-zinc-700" /></>}
            {visibleActions.has("FEEDBACK") && <textarea value={result.feedback} onChange={(event) => setResult({ ...result, feedback: event.target.value })} placeholder={t("feedbackPlaceholder")} className="min-h-20 w-full rounded-md border border-zinc-200 bg-background p-3 text-sm dark:border-zinc-700" />}
            {visibleActions.has("NEXT_ACTION") && <div className="grid gap-2 sm:grid-cols-[1fr_190px_140px]"><Input value={result.nextActionTitle} onChange={(event) => setResult({ ...result, nextActionTitle: event.target.value })} placeholder={t("nextActionPlaceholder")} /><Input type="datetime-local" value={result.nextActionDueDate} onChange={(event) => setResult({ ...result, nextActionDueDate: event.target.value })} /><select value={result.nextActionPriority} onChange={(event) => setResult({ ...result, nextActionPriority: event.target.value })} className="h-10 rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700">{["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => <option key={value} value={value}>{t(`priorities.${value}`)}</option>)}</select></div>}
            <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => { setBusy(true); saveResult().then(() => { toast.success(t("resultSaved")); return load() }).catch((error) => toast.error(error instanceof Error ? error.message : t("resultFailed"))).finally(() => setBusy(false)) }}><Save className="mr-1 h-4 w-4" /> {t("saveDraft")}</Button>
          </div>
        </div>

        <aside className="space-y-6">
          <div><h3 className="text-sm font-semibold">{t("reminders")}</h3><div className="mt-2 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{data.reminders.length ? data.reminders.map((reminder) => <div key={reminder.id} className="py-3"><div className="flex items-start justify-between gap-2"><div><div className="text-sm font-medium">{reminder.title}</div>{reminder.dueDate && <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(new Date(reminder.dueDate), locale)}</div>}</div><span className="text-[11px] text-muted-foreground">{reminder.priority}</span></div><div className="mt-2 flex gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void updateReminder(reminder.id, "complete")}><Check className="mr-1 h-3.5 w-3.5" />{t("complete")}</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void updateReminder(reminder.id, "acknowledge")}>{t("acknowledge")}</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void updateReminder(reminder.id, "reschedule")}><RefreshCw className="mr-1 h-3.5 w-3.5" />{t("tomorrow")}</Button></div></div>) : <p className="py-4 text-sm text-muted-foreground">{t("noReminders")}</p>}</div></div>
          <div><h3 className="text-sm font-semibold">{t("previousPromises")}</h3><div className="mt-2 space-y-3">{data.previousPromises.length ? data.previousPromises.map((promise) => <div key={promise.id} className="text-sm"><div className="text-xs text-muted-foreground">{formatDate(new Date(promise.checkInAt), locale)} - {promise.agent.name}</div>{promise.resultNotes && <p className="mt-1">{promise.resultNotes}</p>}{promise.nextActionDueAt && <p className="mt-1 text-xs text-muted-foreground">{t("due", { date: formatDateTime(new Date(promise.nextActionDueAt), locale) })}</p>}</div>) : <p className="text-sm text-muted-foreground">{t("noPreviousPromises")}</p>}</div></div>
          {data.previousStockChecks.length > 0 && <div><h3 className="text-sm font-semibold">{t("previousStock")}</h3><div className="mt-2 space-y-2">{data.previousStockChecks.map((item) => <div key={item.id} className="text-sm"><span className="font-medium">{String(item.evidence?.product ?? t("unknownProduct"))}</span><span className="ml-2 text-muted-foreground">{String(item.evidence?.state ?? "-")}{item.evidence?.quantity != null ? ` (${String(item.evidence?.quantity)})` : ""}</span><div className="text-xs text-muted-foreground">{formatDate(new Date(item.completedAt ?? item.visit.checkInAt), locale)} - {item.visit.agent.name}</div></div>)}</div></div>}
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 mt-6 border-t border-zinc-200 bg-background/95 px-1 py-3 backdrop-blur-sm dark:border-zinc-800">
        {missing.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{missing.map((item) => <span key={item.actionKey} className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{t(`actions.${item.actionKey}`)} {item.completedCount}/{item.requiredCount}</span>)}</div>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {online ? t("manualCompletionHint") : t("offlineQueueHint")}
            {pendingSync > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{t("pendingSync", { count: pendingSync })}</span>}
            {pendingPhotos > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{t("pendingPhotos", { count: pendingPhotos })}</span>}
          </p>
          <Button size="sm" disabled={busy} onClick={() => void completeVisit()}><CheckCircle2 className="mr-1 h-4 w-4" /> {busy ? t("completing") : online ? t("completeVisit") : t("queueCheckout")}</Button>
        </div>
      </div>
    </section>
  )
}
