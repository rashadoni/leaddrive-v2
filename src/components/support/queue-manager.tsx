"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { SkillPicker } from "@/components/skill-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  eligibleAgentsForQueue,
  routingCoverage,
  type RoutingAgent,
  type RoutingQueue,
} from "@/lib/skill-routing/presentation"

type QueueFilter = "all" | "active" | "uncovered" | "inactive"
type QueueFormData = Pick<RoutingQueue, "name" | "skills" | "priority" | "autoAssign" | "assignMethod">
const routingSwitchClass = "relative h-11 w-11 border-0 bg-transparent p-1 shadow-none before:absolute before:left-1 before:h-5 before:w-9 before:rounded-full data-[state=checked]:bg-transparent data-[state=unchecked]:bg-transparent data-[state=checked]:before:bg-primary data-[state=unchecked]:before:bg-input [&>span]:relative"

function QueueFormDialog({ open, onOpenChange, editQueue, availableSkills, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editQueue: RoutingQueue | null
  availableSkills: string[]
  onSaved: () => void
}) {
  const t = useTranslations("ticketQueues")
  const tc = useTranslations("common")
  const [form, setForm] = useState<QueueFormData>({ name: "", skills: [], priority: 0, autoAssign: true, assignMethod: "least_loaded" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setForm(editQueue
      ? { name: editQueue.name, skills: editQueue.skills, priority: editQueue.priority, autoAssign: editQueue.autoAssign, assignMethod: editQueue.assignMethod }
      : { name: "", skills: [], priority: 0, autoAssign: true, assignMethod: "least_loaded" })
    setError("")
  }, [editQueue, open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(editQueue ? `/api/v1/ticket-queues/${editQueue.id}` : "/api/v1/ticket-queues", {
        method: editQueue ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      })
      if (!response.ok) throw new Error(t("saveFailed"))
      onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogHeader><DialogTitle>{editQueue ? t("editTicketQueue") : t("createTicketQueue")}</DialogTitle></DialogHeader>
      <form onSubmit={submit} data-testid="routing-queue-form">
        <DialogContent>
          <p className="mb-4 text-sm text-muted-foreground">{t("queueFormIntro")}</p>
          {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="routing-queue-form-error">{error}</p>}
          <div className="grid gap-4">
            <div className="space-y-1"><Label htmlFor="routing-queue-name">{t("queueName")}</Label><Input id="routing-queue-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("queueNamePlaceholder")} className="min-h-11" required data-dialog-initial-focus /></div>
            <div className="space-y-1"><Label>{t("skills")}</Label><SkillPicker value={form.skills} onChange={(skills) => setForm((current) => ({ ...current, skills }))} options={availableSkills} allowAdd addPlaceholder={t("skillsPlaceholder")} addLabel={t("addSkill")} emptyHint={t("noSkillsInQueue")} ariaLabel={t("queueSkillsLabel")} /><p className="text-xs text-muted-foreground">{t("skillsHint")}</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="routing-queue-priority">{t("priorityLabel")}</Label><Input id="routing-queue-priority" type="number" min={0} max={100} value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) || 0 }))} className="min-h-11" /><p className="text-xs text-muted-foreground">{t("priorityHint")}</p></div>
              <Select label={t("assignmentMethod")} value={form.assignMethod} onChange={(event) => setForm((current) => ({ ...current, assignMethod: event.target.value }))} className="min-h-11"><option value="least_loaded">{t("leastLoaded")}</option><option value="round_robin">{t("roundRobin")}</option></Select>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border px-2 pr-3 text-sm"><Switch className={routingSwitchClass} checked={form.autoAssign} onCheckedChange={(autoAssign) => setForm((current) => ({ ...current, autoAssign }))} aria-label={t("autoAssign")} />{t("autoAssign")}<span className="ml-auto text-xs text-muted-foreground">{form.autoAssign ? t("enabled") : t("disabled")}</span></label>
            <p className="-mt-3 text-xs text-muted-foreground">{t("autoAssignHint")}</p>
          </div>
        </DialogContent>
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={saving}>{tc("cancel")}</Button><Button type="submit" className="min-h-11 text-zinc-950" disabled={saving || !form.name.trim()} data-testid="routing-queue-form-submit">{saving ? <><Loader2 className="animate-spin motion-reduce:animate-none" />{tc("saving")}</> : editQueue ? tc("save") : t("createQueue")}</Button></DialogFooter>
      </form>
    </Dialog>
  )
}

export function QueueManager({
  queues,
  agents,
  selectedQueueId,
  canWrite,
  loading,
  error,
  errorRetryable,
  onSelect,
  onRetry,
  onQueuesChange,
  onReload,
}: {
  queues: RoutingQueue[]
  agents: RoutingAgent[]
  selectedQueueId: string | null
  canWrite: boolean
  loading: boolean
  error: string
  errorRetryable: boolean
  onSelect: (id: string) => void
  onRetry: () => void
  onQueuesChange: (queues: RoutingQueue[]) => void
  onReload: () => void
}) {
  const t = useTranslations("ticketQueues")
  const tc = useTranslations("common")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<QueueFilter>("all")
  const [formOpen, setFormOpen] = useState(false)
  const [editQueue, setEditQueue] = useState<RoutingQueue | null>(null)
  const [deleteQueue, setDeleteQueue] = useState<RoutingQueue | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const uncoveredIds = useMemo(() => new Set(routingCoverage(queues, agents).uncoveredQueues.map((queue) => queue.id)), [agents, queues])
  const visibleQueues = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return queues.filter((queue) => {
      if (needle && !`${queue.name} ${queue.skills.join(" ")}`.toLowerCase().includes(needle)) return false
      if (filter === "active" && !queue.isActive) return false
      if (filter === "inactive" && queue.isActive) return false
      if (filter === "uncovered" && !uncoveredIds.has(queue.id)) return false
      return true
    })
  }, [filter, query, queues, uncoveredIds])
  const availableSkills = useMemo(() => Array.from(new Set([...queues.flatMap((queue) => queue.skills), ...agents.flatMap((agent) => agent.skills)])).sort(), [agents, queues])

  const toggleQueue = async (queue: RoutingQueue) => {
    if (!canWrite || savingId) return
    const previous = queues
    onQueuesChange(queues.map((item) => item.id === queue.id ? { ...item, isActive: !item.isActive } : item))
    setSavingId(queue.id)
    setStatus(null)
    try {
      const response = await fetch(`/api/v1/ticket-queues/${queue.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !queue.isActive }) })
      if (!response.ok) throw new Error(t("saveFailed"))
      setStatus({ kind: "success", text: queue.isActive ? t("queueDisabled", { name: queue.name }) : t("queueEnabled", { name: queue.name }) })
      onReload()
    } catch {
      onQueuesChange(previous)
      setStatus({ kind: "error", text: t("queueToggleRolledBack", { name: queue.name }) })
    } finally {
      setSavingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteQueue) return
    const response = await fetch(`/api/v1/ticket-queues/${deleteQueue.id}`, { method: "DELETE" })
    if (!response.ok) throw new Error(t("deleteFailed"))
    setStatus({ kind: "success", text: t("queueDeleted", { name: deleteQueue.name }) })
    setDeleteQueue(null)
    onReload()
  }

  return (
    <section aria-labelledby="routing-queues-title" className="min-w-0 rounded-xl border bg-card" data-testid="routing-queues-manager" data-state={loading ? "loading" : error ? "error" : queues.length === 0 ? "empty" : "ready"}>
      <div className="border-b p-3 sm:p-4">
        <div className="flex items-start gap-2"><h2 id="routing-queues-title" className="min-w-0 flex-1 text-base font-semibold">{t("title")}</h2>{canWrite && <Button type="button" className="min-h-11 shrink-0 text-zinc-950" onClick={() => { setEditQueue(null); setFormOpen(true) }} data-testid="routing-queue-create"><Plus />{t("newQueue")}</Button>}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("queueFirstHint")}</p>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_8rem] gap-2 lg:grid-cols-1">
          <label className="relative block"><span className="sr-only">{t("searchQueues")}</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchQueues")} className="min-h-11 pl-9" data-testid="routing-queue-search" /></label>
          <Select aria-label={t("filterQueues")} value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)} className="min-h-11" data-testid="routing-queue-filter"><option value="all">{t("filterAll")}</option><option value="active">{t("filterActive")}</option><option value="uncovered">{t("filterUncovered")}</option><option value="inactive">{t("filterInactive")}</option></Select>
        </div>
      </div>

      {status && <div role="status" aria-live="polite" className={`m-3 flex items-center gap-2 rounded-lg border p-3 text-sm ${status.kind === "error" ? "border-destructive/30" : ""}`} data-testid="routing-queue-status" data-kind={status.kind}>{status.kind === "error" ? <AlertCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4" />}{status.text}</div>}

      {loading ? (
        <div aria-busy="true" className="space-y-2 p-3" data-testid="routing-queues-loading">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/30 motion-reduce:animate-none" />)}</div>
      ) : error ? (
        <div role="alert" className="flex min-h-48 flex-col items-center justify-center p-5 text-center" data-testid="routing-queues-error"><AlertCircle className="h-7 w-7 text-destructive" /><p className="mt-2 text-sm font-medium">{error}</p>{errorRetryable && <Button variant="outline" className="mt-3 min-h-11" onClick={onRetry} data-testid="routing-queues-retry">{t("retry")}</Button>}</div>
      ) : queues.length === 0 ? (
        <div className="p-6 text-center" data-testid="routing-queues-empty"><h3 className="text-sm font-semibold">{t("noQueues")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("noQueuesDesc")}</p>{canWrite && <Button className="mt-4 min-h-11 text-zinc-950" onClick={() => setFormOpen(true)}><Plus />{t("createFirstQueue")}</Button>}</div>
      ) : visibleQueues.length === 0 ? (
        <div className="p-6 text-center" data-testid="routing-queues-no-results"><p className="text-sm font-medium">{t("noQueueResults")}</p><Button variant="ghost" className="mt-2 min-h-11" onClick={() => { setQuery(""); setFilter("all") }} data-testid="routing-queues-reset">{t("resetFilters")}</Button></div>
      ) : (
        <div className="divide-y">
          {visibleQueues.map((queue) => {
            const coverage = eligibleAgentsForQueue(agents, queue).length
            const selected = queue.id === selectedQueueId
            return (
              <article key={queue.id} className={selected ? "bg-muted/20" : undefined} data-testid="routing-queue-row" data-queue-id={queue.id}>
                <button type="button" className="min-h-11 w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-pressed={selected} onClick={() => onSelect(queue.id)} data-testid={`routing-queue-select-${queue.id}`}>
                  <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate text-sm font-medium">{queue.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{queue.skills.length > 0 ? queue.skills.join(", ") : t("catchAll")}</span></span><span className="shrink-0 text-xs">{coverage > 0 ? t("coverageCount", { count: coverage }) : t("uncovered")}</span></span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{queue.assignMethod === "round_robin" ? t("roundRobin") : t("leastLoaded")}</span><span>{t("priorityValue", { value: queue.priority })}</span><span>{queue.autoAssign ? t("autoAssignOn") : t("autoAssignOff")}</span></span>
                </button>
                {canWrite && <div className="flex items-center gap-1 px-1 pb-2"><label className="flex min-h-11 items-center gap-1 text-xs"><Switch className={routingSwitchClass} checked={queue.isActive} onCheckedChange={() => void toggleQueue(queue)} disabled={savingId === queue.id} aria-label={queue.isActive ? t("disableNamed", { name: queue.name }) : t("enableNamed", { name: queue.name })} data-testid={`routing-queue-toggle-${queue.id}`} />{queue.isActive ? t("active") : t("inactive")}</label><Button type="button" variant="ghost" size="icon" className="ml-auto h-11 w-11" aria-label={t("editNamed", { name: queue.name })} onClick={() => { setEditQueue(queue); setFormOpen(true) }} data-testid={`routing-queue-edit-${queue.id}`}><Pencil /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("deleteNamed", { name: queue.name })} onClick={() => setDeleteQueue(queue)} data-testid={`routing-queue-delete-${queue.id}`}><Trash2 /></Button></div>}
              </article>
            )
          })}
        </div>
      )}

      {!canWrite && !loading && !error && <p className="border-t p-3 text-xs text-muted-foreground">{t("readOnlyHint")}</p>}

      <QueueFormDialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditQueue(null) }} editQueue={editQueue} availableSkills={availableSkills} onSaved={() => { setStatus({ kind: "success", text: editQueue ? t("queueSaved") : t("queueCreated") }); onReload() }} />
      <ConfirmDialog open={Boolean(deleteQueue)} onOpenChange={(open) => { if (!open) setDeleteQueue(null) }} onConfirm={confirmDelete} title={t("deleteTitle")} description={deleteQueue ? t("deleteDescription", { name: deleteQueue.name, coverage: eligibleAgentsForQueue(agents, deleteQueue).length }) : undefined} confirmLabel={tc("delete")} />
    </section>
  )
}
