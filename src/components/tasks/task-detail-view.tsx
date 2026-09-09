"use client"

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate as formatDateI18n } from "@/lib/format-date"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TaskForm } from "@/components/task-form"
// Mixed-intent imports: DeleteConfirmDialog for the destructive "Delete task"
// dialog below; ConfirmDialog (same component, semantic-accurate alias) for
// the non-destructive "Stop series" dialog. See 2026-05-28 rename in
// src/components/delete-confirm-dialog.tsx.
import { DeleteConfirmDialog, ConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  ArrowLeft, Clock, CalendarDays, AlertTriangle, User, Calendar,
  Pencil, Trash2, Loader2, CheckCircle2, FileText, ExternalLink,
  Plus, Send, CheckSquare, Square, GripVertical, MessageSquare,
  Repeat, Paperclip, X, Download,
  Building2, Handshake, Target, Ticket, Search,
} from "lucide-react"
import { getRelatedSearchEndpoint, parseRelatedResults, RELATED_ENTITY_VALUES } from "@/lib/tasks/related-entity-search"
import { isClosedStatus } from "@/lib/tasks/status"
import { describeRecurrence } from "@/lib/recurrence/parse"
import { cn } from "@/lib/utils"
import { pipeStatusBucket } from "@/lib/tasks/status-pipeline"
import { CANONICAL_STAGES, STAGE_LABELS } from "@/lib/tasks/board-columns"
import { InfoHint } from "@/components/info-hint"
import { InlineCustomFieldCell, type CustomFieldDef } from "@/components/tasks/inline-tasks-table"
import { useTaskTypes, useEventTypes } from "@/components/tasks/use-task-types"
import { toast } from "sonner"

interface ChecklistItem {
  id: string
  title: string
  completed: boolean
  sortOrder: number
}

interface TaskComment {
  id: string
  content: string
  isSystem: boolean
  createdAt: string
  user?: { id: string; name: string; avatar?: string | null } | null
}

interface TaskAttachment {
  id: string
  fileName: string
  originalName: string
  fileSize: number
  mimeType: string
  createdAt: string
}

interface TaskData {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  type?: string | null
  eventType?: string | null
  assignedTo: string | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  collaborators?: { user: { id: string; name: string; avatar?: string | null } }[]
  creator?: { id: string; name: string } | null
  relatedType: string | null
  relatedId: string | null
  relatedName?: string | null
  projectId?: string | null
  project?: { id: string; name: string; color?: string | null } | null
  divisionId?: string | null
  recurrenceRule?: string | null
  recurrenceEndAt?: string | null
  recurrenceCount?: number | null
  recurrenceParentId?: string | null
  recurrenceParent?: { id: string; title: string; status: string; dueDate: string | null } | null
  recurrenceChildren?: { id: string; title: string; status: string; dueDate: string | null }[]
  customFields?: Record<string, unknown> | null
  completedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  checklist?: ChecklistItem[]
  comments?: TaskComment[]
  attachments?: TaskAttachment[]
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_PIPELINE = ["pending", "in_progress", "completed", "cancelled"]
// The 6 canonical stages — used as the status-pipeline fallback for a board task
// whose division has NO custom columns (legacy/dead path: every board is seeded).
// Mirrors the board modal's own COLUMNS fallback (boards/[divisionId]/page.tsx),
// so the standalone page never disagrees with the board even on that edge.
const CANONICAL_PIPE_STAGES = CANONICAL_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] }))
const STATUS_PIPELINE_COLORS: Record<string, string> = {
  pending: "bg-blue-500",
  todo: "bg-blue-500",
  backlog: "bg-zinc-400",
  in_progress: "bg-yellow-500",
  testing: "bg-purple-500",
  review: "bg-cyan-500",
  completed: "bg-green-500",
  done: "bg-green-500",
  cancelled: "bg-muted-foreground",
}

const STATUS_STYLES: Record<string, { className: string }> = {
  pending: { className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  todo: { className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  backlog: { className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  in_progress: { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  testing: { className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300" },
  review: { className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300" },
  completed: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  done: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  cancelled: { className: "bg-muted text-foreground" },
}

const PRIORITY_STYLES: Record<string, { className: string }> = {
  urgent: { className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
  high: { className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300" },
  medium: { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" },
  low: { className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
}

const RELATED_TYPE_ROUTES: Record<string, string> = {
  deal: "/deals",
  contact: "/contacts",
  company: "/companies",
  lead: "/leads",
  ticket: "/tickets",
}

const RELATED_ENTITY_ICONS: Record<string, typeof User> = {
  company: Building2, contact: User, deal: Handshake, lead: Target, ticket: Ticket,
}

// ─── Inline Related-Entity Picker (task detail Info card) ────────
// Editable link to a company/contact/deal/lead/ticket. Type tabs + a
// debounced search per type (reusing TaskForm's endpoints via the shared
// related-entity-search util). Picking writes relatedType+relatedId together
// (the route validates the pair); the clear row sets both null. Self-contained
// outside-click / Escape dismissal.
function InlineRelatedEntityCell({ relatedType, relatedId, relatedName, orgId, onSave }: {
  relatedType: string | null
  relatedId: string | null
  relatedName?: string
  orgId?: string
  onSave: (patch: { relatedType: string | null; relatedId: string | null }) => Promise<void> | void
}) {
  const tc = useTranslations("common")
  const t = useTranslations("tasks")
  const [open, setOpen] = useState(false)
  const [typeSel, setTypeSel] = useState<string>(relatedType || "contact")
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])

  useEffect(() => {
    if (open) { setTypeSel(relatedType || "contact"); setSearch(""); setResults([]); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open, relatedType])

  useEffect(() => {
    if (!open || !typeSel || search.length < 1) { setResults([]); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(getRelatedSearchEndpoint(typeSel, search), {
          headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
        })
        const json = await res.json()
        if (json.success) setResults(parseRelatedResults(typeSel, json.data))
      } catch { /* keep last results */ } finally { setLoading(false) }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [search, typeSel, open, orgId])

  const commit = async (patch: { relatedType: string | null; relatedId: string | null }) => {
    setOpen(false)
    setSaving(true)
    try { await onSave(patch) } catch { /* parent logs */ } finally { setSaving(false) }
  }

  const CurIcon = relatedType ? RELATED_ENTITY_ICONS[relatedType] : null

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="flex w-full items-center gap-1.5 rounded-md p-1 -ml-1 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {relatedType && relatedId ? (
          relatedName ? (
            <>
              {CurIcon && <CurIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate">{tc(relatedType)} — {relatedName}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground" title={relatedId}>{tc(relatedType)} — {t("relatedNotFound")}</span>
          )
        ) : (
          <span className="italic text-muted-foreground">—</span>
        )}
        {saving && <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[240px] rounded-md border border-zinc-200 bg-popover shadow-lg dark:border-zinc-700">
          <div className="flex items-center gap-1 border-b border-zinc-200 p-1.5 dark:border-zinc-700">
            {RELATED_ENTITY_VALUES.map((v) => {
              const Icon = RELATED_ENTITY_ICONS[v]
              return (
                <button
                  key={v}
                  type="button"
                  title={tc(v)}
                  onClick={() => { setTypeSel(v); setSearch(""); setResults([]); inputRef.current?.focus() }}
                  className={cn(
                    "flex flex-1 items-center justify-center rounded p-1.5 transition-colors",
                    typeSel === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${tc(typeSel)}…`}
              className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-48 overflow-auto py-1">
            {relatedId && (
              <button
                type="button"
                onClick={() => commit({ relatedType: null, relatedId: null })}
                className="w-full px-3 py-1.5 text-left text-xs italic text-muted-foreground transition-colors hover:bg-muted"
              >
                {t("inlineClearSelect")}
              </button>
            )}
            {loading && (
              <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin" />
              </div>
            )}
            {!loading && search.length >= 1 && results.length === 0 && (
              <div className="px-3 py-2 text-center text-xs text-muted-foreground">{tc("noResults")}</div>
            )}
            {!loading && search.length < 1 && (
              <div className="px-3 py-2 text-center text-xs text-muted-foreground/70">{tc("search")}</div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => commit({ relatedType: typeSel, relatedId: r.id })}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                  r.id === relatedId && "bg-primary/5 font-medium",
                )}
              >
                <span className="flex-1 truncate">{r.name}</span>
                {r.id === relatedId && <CheckCircle2 className="ml-auto h-3 w-3 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(d: string | null, locale: string) {
  if (!d) return "\u2014"
  return formatDateI18n(d, locale, { day: "2-digit", month: "short", year: "numeric" }) + ", " + new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function formatDateShort(d: string | null, locale: string) {
  if (!d) return "\u2014"
  return formatDateI18n(d, locale, { day: "2-digit", month: "short", year: "numeric" })
}

function formatTimeAgo(d: string, locale: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDateShort(d, locale)
}

function getDaysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)
}

function getDueDateCountdown(dueDate: string | null, t?: (key: string, params?: Record<string, any>) => string): { text: string; overdue: boolean; urgent: boolean } {
  if (!dueDate) return { text: "\u2014", overdue: false, urgent: false }
  const diff = new Date(dueDate).getTime() - Date.now()
  if (diff <= 0) {
    const days = Math.abs(Math.floor(diff / 86400000))
    return { text: t ? t("dueOverdue", { days }) : `${days}d overdue`, overdue: true, urgent: false }
  }
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (days === 0) return { text: t ? t("dueHoursLeft", { hours }) : `${hours}h left`, overdue: false, urgent: true }
  if (days <= 2) return { text: t ? t("dueDaysHoursLeft", { days, hours }) : `${days}d ${hours}h left`, overdue: false, urgent: true }
  return { text: t ? t("dueDaysLeft", { days }) : `${days}d left`, overdue: false, urgent: false }
}

// ─── Recurrence Series Row ──────────────────────────────────────
// One row inside the SeriesPanel. Renders a clickable status pill +
// title + due date. The current task gets a primary outline so users
// know where they are in the timeline.
function SeriesRow({
  task, isCurrent,
}: {
  task: { id: string; title: string; status: string; dueDate: string | null }
  isCurrent: boolean
}) {
  const statusColor = task.status === "completed"
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : task.status === "cancelled"
    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
    : task.status === "in_progress"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors group",
        isCurrent
          ? "border border-primary/40 bg-primary/[0.04] cursor-default pointer-events-none"
          : "hover:bg-muted",
      )}
    >
      <span className={cn(
        "text-[9px] uppercase tracking-wide font-semibold px-1 py-0.5 rounded shrink-0",
        statusColor,
      )}>
        {task.status === "in_progress" ? "wip" : task.status}
      </span>
      <span className={cn(
        "flex-1 truncate",
        task.status === "completed" && "line-through text-muted-foreground",
      )}>
        {task.title}
      </span>
      {task.dueDate && (
        <span className="text-muted-foreground text-[10px] shrink-0">
          {new Date(task.dueDate).toLocaleDateString()}
        </span>
      )}
    </Link>
  )
}

// ─── Checklist Component ────────────────────────────────────────
function TaskChecklistSection({ taskId, orgId, items, onRefresh }: {
  taskId: string; orgId?: string; items: ChecklistItem[]; onRefresh: () => void
}) {
  const t = useTranslations("tasks")
  const [newItem, setNewItem] = useState("")
  const [adding, setAdding] = useState(false)

  async function addItem() {
    if (!newItem.trim()) return
    setAdding(true)
    try {
      await fetch(`/api/v1/tasks/${taskId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify({ title: newItem.trim() }),
      })
      setNewItem("")
      onRefresh()
    } catch (err) { console.error(err) }
    finally { setAdding(false) }
  }

  async function toggleItem(item: ChecklistItem) {
    await fetch(`/api/v1/tasks/${taskId}/checklist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
      body: JSON.stringify({ id: item.id, completed: !item.completed }),
    })
    onRefresh()
  }

  async function deleteItem(itemId: string) {
    await fetch(`/api/v1/tasks/${taskId}/checklist?itemId=${itemId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {},
    })
    onRefresh()
  }

  const completedCount = items.filter(i => i.completed).length
  const progressPct = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            {t("checklist")}
            {items.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                {completedCount}/{items.length}
              </span>
            )}
          </div>
        </CardTitle>
        {items.length > 0 && (
          <div className="w-full bg-muted rounded-full h-1.5 mt-2">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-1 px-4 pb-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 group py-1 px-1 rounded hover:bg-muted/50">
            <button onClick={() => toggleItem(item)} className="flex-shrink-0">
              {item.completed ? (
                <CheckSquare className="h-4 w-4 text-green-500" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground/50 hover:text-primary" />
              )}
            </button>
            <span className={cn("text-sm flex-1", item.completed && "line-through text-muted-foreground")}>{item.title}</span>
            <button
              onClick={() => deleteItem(item.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/20 transition-opacity"
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
            </button>
          </div>
        ))}

        {/* Add new item */}
        <div className="flex items-center gap-2 pt-1">
          <Plus className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem() }}
            placeholder={t("addChecklistItem")}
            className="flex-1 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
            disabled={adding}
          />
          {newItem.trim() && (
            <Button size="sm" variant="ghost" onClick={addItem} disabled={adding} className="h-6 px-2">
              <Plus className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Comments Component ─────────────────────────────────────────
function TaskAttachmentsSection({ taskId, orgId, attachments, canEdit, onRefresh }: {
  taskId: string; orgId?: string; attachments: TaskAttachment[]; canEdit: boolean; onRefresh: () => void
}) {
  const t = useTranslations("tasks")
  const locale = useLocale()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error(t("attachTooLarge")); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/v1/tasks/${taskId}/files`, {
        method: "POST",
        headers: { ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: fd,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) { toast.error(json?.error || t("attachError")); return }
      onRefresh()
    } catch { toast.error(t("attachError")) }
    finally { setUploading(false) }
  }

  async function remove(fileId: string) {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/files/${fileId}`, {
        method: "DELETE",
        headers: { ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
      })
      if (res.ok) onRefresh()
      else toast.error(t("attachDeleteError"))
    } catch { toast.error(t("attachDeleteError")) }
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Paperclip className="h-4 w-4" />
          {t("attachments")}
          {attachments.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{attachments.length}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4">
        {canEdit && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.rar"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f) }}
            />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{t("attachAdd")}</span>
            </Button>
          </div>
        )}

        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">{t("noAttachments")}</p>
        ) : (
          <div className="space-y-1.5">
            {attachments.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-2 bg-muted/20">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.originalName}</p>
                  <p className="text-[10px] text-muted-foreground">{formatFileSize(f.fileSize)} · {formatDateI18n(f.createdAt, locale, { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <a
                  href={`/uploads/tasks/${f.fileName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                  title={t("attachDownload")}
                  aria-label={`${t("attachDownload")}: ${f.originalName}`}
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                    title={t("attachRemove")}
                    aria-label={`${t("attachRemove")}: ${f.originalName}`}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TaskCommentsSection({ taskId, orgId, comments, onRefresh }: {
  taskId: string; orgId?: string; comments: TaskComment[]; onRefresh: () => void
}) {
  const t = useTranslations("tasks")
  const locale = useLocale()
  const [newComment, setNewComment] = useState("")
  const [posting, setPosting] = useState(false)

  async function postComment() {
    if (!newComment.trim()) return
    setPosting(true)
    try {
      await fetch(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify({ content: newComment.trim() }),
      })
      setNewComment("")
      onRefresh()
    } catch (err) { console.error(err) }
    finally { setPosting(false) }
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-4 w-4" />
          {t("comments")}
          {comments.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{comments.length}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4">
        {/* Comment input */}
        <div className="flex gap-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment() }}
            placeholder={t("addComment")}
            rows={2}
            className="flex-1 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-2 resize-none bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={posting}
          />
          <Button size="sm" onClick={postComment} disabled={!newComment.trim() || posting} className="self-end">
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Comments list */}
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">{t("noComments")}</p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div key={comment.id} className={cn("flex gap-2.5", comment.isSystem && "opacity-60")}>
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary flex-shrink-0 mt-0.5">
                  {comment.user?.name?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{comment.user?.name || "System"}</span>
                    <span className="text-[10px] text-muted-foreground">{formatTimeAgo(comment.createdAt, locale)}</span>
                  </div>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-0.5">{comment.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ──────────────────────────────────────────────────
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

/**
 * Full task detail + edit UI. Rendered two ways:
 *  · as the /tasks/[id] route (page mode — default props) with breadcrumb;
 *  · inside the board's task modal (modal mode) where the dialog frame owns
 *    the close affordance, so the breadcrumb is hidden and delete/close call
 *    back to the board instead of navigating.
 */

/**
 * Searchable user dropdown shared by the assignee (single-select) and
 * collaborators (multi-select) pickers in the task detail sidebar. Owns the
 * sticky search header, the case-insensitive name filter, the scroll area and
 * the empty-state. The caller supplies the candidate `users` (already narrowed
 * — e.g. collaborators excludes the current assignee), how to render each row
 * (`renderItem`, which must set its own `key`), and an optional always-visible
 * `prefix` row that sits above the filtered list and is NOT filtered (the
 * assignee "Unassigned" reset). Rendered only while its picker is open, so the
 * query resets on close (unmount) and the input self-focuses on mount. Lives
 * inside the Info-card's outside-click container, so typing never dismisses it.
 */
function SearchableUserList({ users, renderItem, prefix }: {
  users: { id: string; name: string }[]
  renderItem: (user: { id: string; name: string }) => ReactNode
  prefix?: ReactNode
}) {
  const tc = useTranslations("common")
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [])
  const q = search.trim().toLowerCase()
  const filtered = q ? users.filter(u => u.name.toLowerCase().includes(q)) : users
  return (
    <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-popover shadow-lg dark:border-zinc-700">
      {/* Sticky search header above a separate scroll area so the filter never
          scrolls out of view (matters most for the multi-select, which stays
          open while toggling). */}
      <div className="border-b border-zinc-100 p-1.5 dark:border-zinc-700">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tc("searchUsers")}
            className="w-full rounded border border-zinc-200 bg-background py-1.5 pl-7 pr-2 text-sm outline-none transition-colors focus:border-primary dark:border-zinc-700"
          />
        </div>
      </div>
      <div className="max-h-48 overflow-auto">
        {prefix}
        {filtered.map(renderItem)}
        {q && filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">{tc("noResults")}</div>
        )}
      </div>
    </div>
  )
}

export function TaskDetailView({ taskIdProp, modal = false, onClose, onMutated, boardColumns }: { taskIdProp?: string; modal?: boolean; onClose?: () => void; onMutated?: () => void; boardColumns?: { key: string; label: string; columnKey?: string }[] }) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const tab = useTranslations("abTest")
  const tForms = useTranslations("forms")
  const locale = useLocale()
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const taskId = taskIdProp ?? (params.id as string)
  const orgId = session?.user?.organizationId

  const [task, setTask] = useState<TaskData | null>(null)
  useAutoTour("taskDetail")
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Stop-series dialog state. Lives separately from the task-delete
  // dialog because the destructive action is different (clear rule on
  // the series, NOT delete the task) — architect P1 from series-UI review.
  const [stopSeriesOpen, setStopSeriesOpen] = useState(false)
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  // Configurable axes (Bordio): Tip + Event tipi — shown & edited in the
  // sidebar like Priority. Collaborators get an editable checkbox dropdown.
  const [typeOpen, setTypeOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [collabOpen, setCollabOpen] = useState(false)
  const [collabSaving, setCollabSaving] = useState(false)
  // Close all Info-card dropdowns on an outside click. The multi-select
  // collaborators picker keeps itself open while you toggle members, so
  // without this it stayed open after selecting (user-reported bug
  // 2026-06-13); the single-selects self-close on pick but also needed
  // outside-dismiss. One ref on the Info Card; mousedown outside → close all.
  const infoCardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!(assigneeOpen || collabOpen || priorityOpen || typeOpen || eventOpen)) return
    const closeAll = () => {
      setAssigneeOpen(false); setCollabOpen(false); setPriorityOpen(false); setTypeOpen(false); setEventOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (infoCardRef.current && !infoCardRef.current.contains(e.target as Node)) closeAll()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [assigneeOpen, collabOpen, priorityOpen, typeOpen, eventOpen])
  const { types: taskTypes, typeMap: taskTypeMap } = useTaskTypes(true)
  const { types: eventTypes, typeMap: eventTypeMap } = useEventTypes(true)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
  // Board columns resolved from the task's own division — used by the status
  // pipeline when this view is NOT rendered inside the board modal (i.e. the
  // standalone /tasks/[id] page passes no boardColumns prop). Without this, a
  // board task on the standalone page falls back to the legacy 4-stage pipeline
  // and a `backlog`/`done` task highlights nothing + can't reach those columns.
  const [resolvedBoardColumns, setResolvedBoardColumns] = useState<{ key: string; label: string }[] | null>(null)

  // Load users for inline assignee edit (uses /assignable variant so non-admin roles work)
  useEffect(() => {
    fetch("/api/v1/users/assignable", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      .then(async r => {
        if (r.status === 429) {
          console.warn("[users/assignable] 429 — user-list throttled (Roadmap #16 rate-limit)")
          toast.error("Too many user-list requests — try again in a minute")
          return null
        }
        return r.json()
      })
      .then(j => {
        if (!j || !j.success) return
        const raw = (j.data?.users || j.data || []) as Array<{ id: string; name: string | null; email: string | null }>
        setUsers(raw.map(u => ({ id: u.id, name: u.name || u.email || u.id })))
      })
      .catch(() => {})
  }, [orgId])

  // Load custom field definitions for task entity
  useEffect(() => {
    fetch("/api/v1/custom-fields?entityType=task", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      .then(r => r.json())
      .then(j => { if (j.success) setCustomFieldDefs((j.data || []).filter((d: CustomFieldDef) => d.isActive)) })
      .catch(() => {})
  }, [orgId])

  // When the board columns aren't supplied by a parent (standalone /tasks/[id]
  // page) and this is a board task, resolve the task's own board columns so the
  // status pipeline mirrors the board's real flow (BACKLOG/TO DO/IN PROGRESS/
  // DONE …) instead of the legacy generic 4 stages. Maps mapsToStatus→key +
  // sorts by sortOrder, identical to how the board modal builds boardColumns.
  const divisionId = task?.divisionId
  useEffect(() => {
    if (boardColumns && boardColumns.length) return // parent (board modal) already supplied them
    if (!divisionId) { setResolvedBoardColumns(null); return }
    let ignore = false // drop a stale /divisions response if divisionId changes mid-flight
    fetch("/api/v1/divisions", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      .then(r => r.json())
      .then(j => {
        if (ignore) return
        const div = (j.data?.divisions ?? []).find((d: { id: string }) => d.id === divisionId)
        const cols = (div?.boardColumns ?? []) as { key: string; label: string; sortOrder: number; mapsToStatus: string }[]
        // A board with NO custom columns (legacy/dead path) falls back to the 6
        // canonical stages — same as the board modal's visibleColumns fallback,
        // NOT the generic 4-stage pipeline (which would re-introduce the
        // standalone-vs-board disagreement this resolve exists to remove).
        setResolvedBoardColumns(
          cols.length
            ? [...cols].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ key: c.mapsToStatus, label: c.label, columnKey: c.key }))
            : CANONICAL_PIPE_STAGES,
        )
      })
      .catch(() => { if (!ignore) setResolvedBoardColumns(null) })
    return () => { ignore = true }
  }, [boardColumns, divisionId, orgId])

  const handleInlineUpdate = async (field: string, value: string | null | string[]) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({})))?.error || t("updateFailed"))
      }
      fetchTask()
    } catch (err) { console.error(err); toast.error(t("updateFailed")) }
  }

  // Multi-field variant — the related-entity picker writes relatedType +
  // relatedId together (a partial patch of only one would fail the route's
  // pair validation).
  const handleInlinePatch = async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({})))?.error || t("updateFailed"))
      }
      fetchTask()
    } catch (err) { console.error(err); toast.error(t("updateFailed")) }
  }

  // Update a single custom field value (server merges via JSONB partial-update).
  //
  // KNOWN LIMITATION (deferred to Roadmap #11 Phase C — optimistic updates):
  // No client-side queuing. Rapid double-click on two different cells fires
  // two concurrent PATCHes; the server reads `existing.customFields` for the
  // second request BEFORE the first commits, losing the first change. Same
  // pattern is in the list-view cells; addressed together with optimistic
  // updates + write-queue in Phase C.
  const updateCustomField = async (fieldName: string, value: unknown): Promise<void> => {
    const res = await fetch(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
      body: JSON.stringify({ customFields: { [fieldName]: value } }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Update failed")
    fetchTask()
  }

  const STATUS_LABELS: Record<string, string> = {
    pending: t("statusTodo"),
    todo: t("statusTodo"),
    in_progress: t("statusInProgress"),
    completed: t("statusCompleted"),
    cancelled: t("statusCancelled"),
    // Canonical board stages — without these the header badge shows the raw
    // key (user-reported: lowercase "backlog" chip on a board task).
    backlog: t("statusBacklog"),
    testing: t("statusTesting"),
    review: t("statusReview"),
    done: t("statusCompleted"),
  }

  const PRIORITY_LABELS: Record<string, string> = {
    urgent: t("priorityUrgent"),
    high: t("priorityHigh"),
    medium: t("priorityMedium"),
    low: t("priorityLow"),
  }

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setTask(json.data)
      } else {
        setError(json.error || t("failedToLoad"))
      }
    } catch {
      setError(t("failedToLoad"))
    } finally {
      setLoading(false)
    }
  }, [taskId, orgId, t])

  useEffect(() => { fetchTask() }, [fetchTask])

  const handleStatusChange = async (newStatus: string) => {
    if (!task || newStatus === task.status) return
    // A status alone cannot move a card between lanes: resolveLaneKey prefers
    // boardColumnKey, so the card would snap back to its old column on the next
    // load and the strip would look like it had done nothing. The board's list
    // view already co-writes the lane; the modal has to as well.
    const lane = (boardColumns ?? resolvedBoardColumns ?? []).find((c) => c.key === newStatus)?.columnKey
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(lane ? { status: newStatus, boardColumnKey: lane } : { status: newStatus }),
      })
      if (res.ok) fetchTask()
    } catch (err) { console.error(err) } finally { setUpdatingStatus(false) }
  }

  const handleDelete = async () => {
    const res = await fetch(`/api/v1/tasks/${taskId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json()).error || tc("errorDeleteFailed"))
    if (modal) { onMutated?.(); onClose?.() } else { router.push("/tasks") }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="space-y-3">
        {modal ? (
          <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" /> {tc("back")}</Button>
        ) : (
          <Link href="/tasks">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> {tc("back")}</Button>
          </Link>
        )}
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {error || t("taskNotFound")}
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusStyle = STATUS_STYLES[task.status] || STATUS_STYLES.pending
  const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium
  const daysOpen = getDaysOpen(task.createdAt)
  const dueDateInfo = getDueDateCountdown(task.dueDate, t)
  // Closed tasks (done/completed/cancelled) are never "overdue" — getDueDateCountdown
  // ignores status, so for a finished task the strip showed a misleading red
  // "Nd overdue" on its past due date. Match the table's CLOSED_STATUSES rule:
  // closed → plain muted date, not the red/amber countdown.
  const taskClosed = isClosedStatus(task.status)
  // At-a-glance counters for the compact meta strip (consolidates the old
  // two big KPI cards + surfaces checklist/comments/attachments without
  // scrolling — user feedback 2026-06-13: "more compact but more informative").
  const checklistTotal = task.checklist?.length ?? 0
  const checklistDone = task.checklist?.filter((c) => c.completed).length ?? 0
  const commentCount = task.comments?.length ?? 0
  const attachmentCount = task.attachments?.length ?? 0
  // Status pipeline stages: a board task shows the board's configured columns
  // (passed by the board modal); otherwise the legacy 4-stage pipeline. The
  // active segment buckets equivalent statuses (pending≡todo, completed→done;
  // cancelled keeps its own bucket) so a task highlights exactly one stage when
  // its status maps to a visible one.
  const pipeBucket = pipeStatusBucket
  const pipeStages = (boardColumns && boardColumns.length)
    ? boardColumns
    : (resolvedBoardColumns && resolvedBoardColumns.length)
    ? resolvedBoardColumns
    : STATUS_PIPELINE.map((s) => ({ key: s, label: STATUS_LABELS[s] || s }))
  const pipeCurrentIdx = pipeStages.findIndex((st) => pipeBucket(st.key) === pipeBucket(task.status))

  return (
    <div className="space-y-3">
      {/* Breadcrumbs — page only; in the board modal the dialog frame owns the
          close affordance, so the app breadcrumb is hidden. */}
      {!modal && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
          <Link href="/tasks" className="hover:text-foreground transition-colors">{t("title")}</Link>
          <span>/</span>
          <span className="text-foreground font-medium truncate max-w-[400px]">{task.title}</span>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold flex items-center gap-2 min-w-0"><span className="truncate">{task.title}</span> <TourReplayButton tourId="taskDetail" /><HelpButton slug="task-detail" variant="label" className="shrink-0" /></h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={statusStyle.className}>{STATUS_LABELS[task.status] || task.status}</Badge>
            <Badge className={priorityStyle.className}>{PRIORITY_LABELS[task.priority] || task.priority}</Badge>
            {task.relatedType && <Badge variant="outline" className="text-xs">{tc(task.relatedType)}</Badge>}
            {/* Recurrence badge — Roadmap #22. Locale-aware via the
                forms-namespace translator (architect P2). */}
            {task.recurrenceRule && (
              <Badge variant="outline" className="text-xs gap-1">
                <Repeat className="h-3 w-3" />
                {describeRecurrence(task.recurrenceRule, tForms as any)}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { setFormOpen(true) }}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> {tc("edit")}
          </Button>
          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {tc("delete")}
          </Button>
          {task?.dueDate && (
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true)
                try {
                  const res = await fetch("/api/v1/integrations/google-calendar", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
                    },
                    body: JSON.stringify({
                      summary: task.title,
                      description: task.description || "",
                      startTime: task.dueDate,
                    }),
                  })
                  const json = await res.json()
                  if (json.success) alert(t("syncSuccess"))
                  else if (res.status === 403 || json.error?.includes("not connected")) {
                    if (confirm(t("syncNotConnected"))) {
                      window.location.href = "/settings/integrations"
                    }
                  } else alert(json.error || t("syncFailed"))
                } catch { alert(t("syncFailed")) }
                finally { setSyncing(false) }
              }}
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" /> {syncing ? tab("syncing") : tab("syncToCalendar")}
            </Button>
          )}
        </div>
      </div>

      {/* Compact meta strip — at-a-glance stats so nothing important needs a
          scroll: days open, due/overdue countdown, checklist progress,
          comments, attachments, assignee. Consolidates the old two big KPI
          cards (removed from the sidebar) into one dense, more-informative
          line (user feedback 2026-06-13). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-muted/30 px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-1.5" title={t("daysOpen")}>
          <Clock className="h-4 w-4 text-blue-500" />
          <span className="font-semibold">{daysOpen}</span>
          <span className="text-muted-foreground">{t("daysOpen").toLowerCase()}</span>
        </span>
        {task.dueDate && (
          taskClosed ? (
            // Finished task — show the plain due date, no overdue alarm.
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {formatDateShort(task.dueDate, locale)}
            </span>
          ) : (
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-md",
              dueDateInfo.overdue ? "bg-red-500/10 px-2 py-0.5 font-semibold text-red-600 dark:text-red-400"
                : dueDateInfo.urgent ? "bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400" : "",
            )}>
              <CalendarDays className={cn("h-4 w-4", dueDateInfo.overdue ? "text-red-600 dark:text-red-400" : dueDateInfo.urgent ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
              {dueDateInfo.text}
            </span>
          )
        )}
        {checklistTotal > 0 && (
          <span className="inline-flex items-center gap-1.5" title={t("checklist")}>
            <CheckSquare className={cn("h-4 w-4", checklistDone === checklistTotal ? "text-green-600" : "text-muted-foreground")} />
            <span className={cn("font-medium", checklistDone === checklistTotal && "text-green-600")}>{checklistDone}/{checklistTotal}</span>
          </span>
        )}
        {commentCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={t("comments")}>
            <MessageSquare className="h-4 w-4" />
            <span className="font-medium text-foreground">{commentCount}</span>
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={t("attachments")}>
            <Paperclip className="h-4 w-4" />
            <span className="font-medium text-foreground">{attachmentCount}</span>
          </span>
        )}
        {task.assignee && (
          <span className="inline-flex items-center gap-1.5 ml-auto" title={t("colAssignee")}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {task.assignee.name?.charAt(0)?.toUpperCase() || "?"}
            </span>
            <span className="text-muted-foreground">{task.assignee.name}</span>
          </span>
        )}
      </div>

      {/* Status Pipeline */}
      <div className="flex gap-0 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700" data-tour-id="task-status">
        {pipeStages.map((st, i) => {
          const isCurrent = pipeBucket(st.key) === pipeBucket(task.status)
          const isPast = pipeCurrentIdx >= 0 && i < pipeCurrentIdx
          const color = STATUS_PIPELINE_COLORS[st.key] || STATUS_PIPELINE_COLORS[pipeBucket(st.key)] || "bg-primary"

          return (
            <button
              key={st.key}
              onClick={() => handleStatusChange(st.key)}
              className={`flex-1 py-2 px-2 text-xs font-medium text-center transition-all relative ${
                isCurrent
                  ? `${color} text-white shadow-inner`
                  : isPast
                  ? `${color}/20 text-foreground/70`
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
              }`}
              disabled={updatingStatus}
            >
              {st.label}
            </button>
          )
        })}
      </div>

      {/* Two-column layout: main + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: Main content */}
        <div className="lg:col-span-2 space-y-3">
          {/* Description */}
          {task.description && (
            <Card>
              <CardHeader className="px-4 pt-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> {t("description")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Checklist */}
          <TaskChecklistSection
            taskId={task.id}
            orgId={orgId ? String(orgId) : undefined}
            items={task.checklist || []}
            onRefresh={fetchTask}
          />

          {/* Attachments — same server-authoritative posture as checklist/
              comments (the upload/delete routes requireAuth tasks:write/delete). */}
          <TaskAttachmentsSection
            taskId={task.id}
            orgId={orgId ? String(orgId) : undefined}
            attachments={task.attachments || []}
            canEdit={true}
            onRefresh={fetchTask}
          />

          {/* Comments */}
          <TaskCommentsSection
            taskId={task.id}
            orgId={orgId ? String(orgId) : undefined}
            comments={task.comments || []}
            onRefresh={fetchTask}
          />
        </div>

        {/* Right: Sidebar metadata. The old two big KPI cards (days open /
            due date) were consolidated into the compact meta strip at the top
            — their info is preserved there, not lost. */}
        <div className="space-y-3">
          <AdvisorRecordWidget entityType="task" entityId={task.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

          {/* Info card */}
          <Card ref={infoCardRef}>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm">{t("taskInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 px-4 pb-4">
              <div className="relative">
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("colAssignee")}</label>
                <button
                  onClick={() => setAssigneeOpen(!assigneeOpen)}
                  className="flex items-center gap-2 mt-0.5 w-full p-1 -ml-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {task.assignee ? (
                    <>
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                        {task.assignee.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <span className="text-sm font-medium">{task.assignee.name}</span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">{tc("unassigned") || "Unassigned"}</span>
                  )}
                  <Pencil className="h-3 w-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100" />
                </button>
                {assigneeOpen && (
                  <SearchableUserList
                    users={users}
                    prefix={
                      <button
                        onClick={() => { handleInlineUpdate("assignedTo", ""); setAssigneeOpen(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground"
                      >
                        {tc("unassigned") || "Unassigned"}
                      </button>
                    }
                    renderItem={(u) => (
                      <button
                        key={u.id}
                        onClick={() => { handleInlineUpdate("assignedTo", u.id); setAssigneeOpen(false) }}
                        className={cn("w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2", task.assignedTo === u.id && "bg-primary/5 font-medium")}
                      >
                        <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary">
                          {u.name?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        {u.name}
                      </button>
                    )}
                  />
                )}
              </div>

              {/* Co-assignees — editable: click opens a checkbox list (same
                  interaction as the table's assignee dropdown). */}
              <div className="relative">
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("collaborators")}</label>
                <button
                  onClick={() => setCollabOpen(!collabOpen)}
                  disabled={collabSaving}
                  className="mt-0.5 flex w-full flex-wrap items-center gap-1.5 rounded-md p-1 -ml-1 text-left hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {(task.collaborators?.length ?? 0) > 0 ? (
                    task.collaborators!.map((c) => (
                      <span key={c.user.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-medium text-primary">
                          {c.user.name?.charAt(0)?.toUpperCase() || "?"}
                        </span>
                        {c.user.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                  {collabSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </button>
                {collabOpen && (
                  // Candidates = everyone except the current assignee (a person
                  // can't be assignee AND collaborator). The list stays open
                  // while toggling, so SearchableUserList keeps its query across
                  // toggles and only resets when the picker closes (unmounts).
                  <SearchableUserList
                    users={users.filter(u => u.id !== task.assignedTo)}
                    renderItem={(u) => {
                      const on = (task.collaborators ?? []).some(c => c.user.id === u.id)
                      return (
                        <button
                          key={u.id}
                          disabled={collabSaving}
                          aria-pressed={on}
                          onClick={async () => {
                            const ids = (task.collaborators ?? []).map(c => c.user.id)
                            const next = on ? ids.filter(x => x !== u.id) : [...ids, u.id]
                            setCollabSaving(true)
                            try { await handleInlineUpdate("collaboratorIds", next) } finally { setCollabSaving(false) }
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <span className={cn(
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                          )}>
                            {on && <CheckCircle2 className="h-2.5 w-2.5" />}
                          </span>
                          <span className="truncate">{u.name}</span>
                        </button>
                      )
                    }}
                  />
                )}
              </div>

              <div className="relative">
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("colPriority")}</label>
                <button
                  onClick={() => setPriorityOpen(!priorityOpen)}
                  className="mt-0.5 block cursor-pointer"
                >
                  <Badge className={cn(priorityStyle.className, "hover:opacity-80 transition-opacity")}>{PRIORITY_LABELS[task.priority] || task.priority}</Badge>
                </button>
                {priorityOpen && (
                  <div className="absolute z-50 mt-1 bg-popover border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg overflow-hidden">
                    {(["urgent", "high", "medium", "low"] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => { handleInlineUpdate("priority", p); setPriorityOpen(false) }}
                        className={cn("w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2", task.priority === p && "bg-primary/5 font-medium")}
                      >
                        <Badge className={PRIORITY_STYLES[p]?.className}>{PRIORITY_LABELS[p]}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tip — configurable functional axis (colored dot + name, editable). */}
              <div className="relative">
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("opGbType")}</label>
                <button onClick={() => setTypeOpen(!typeOpen)} className="mt-0.5 flex items-center gap-1.5 rounded-md p-1 -ml-1 text-sm hover:bg-muted/50 transition-colors cursor-pointer">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: (task.type && taskTypeMap.get(task.type)?.color) || "#9CA3AF" }} />
                  {(task.type && (taskTypeMap.get(task.type)?.displayName ?? task.type)) || "—"}
                </button>
                {typeOpen && (
                  <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border border-zinc-200 bg-popover shadow-lg dark:border-zinc-700">
                    {taskTypes.map(tt => (
                      <button
                        key={tt.id}
                        onClick={() => { handleInlineUpdate("type", tt.name); setTypeOpen(false) }}
                        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted", task.type === tt.name && "bg-primary/5 font-medium")}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: tt.color }} />
                        {tt.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Event tipi — channel/source axis (nullable; "—" clears). */}
              <div className="relative">
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("opGbEvent")}</label>
                <button onClick={() => setEventOpen(!eventOpen)} className="mt-0.5 flex items-center gap-1.5 rounded-md p-1 -ml-1 text-sm hover:bg-muted/50 transition-colors cursor-pointer">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: (task.eventType && eventTypeMap.get(task.eventType)?.color) || "#9CA3AF" }} />
                  {(task.eventType && (eventTypeMap.get(task.eventType)?.displayName ?? task.eventType)) || "—"}
                </button>
                {eventOpen && (
                  <div className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border border-zinc-200 bg-popover shadow-lg dark:border-zinc-700">
                    <button
                      onClick={() => { handleInlineUpdate("eventType", null); setEventOpen(false) }}
                      className={cn("w-full px-3 py-2 text-left text-sm italic text-muted-foreground transition-colors hover:bg-muted", !task.eventType && "bg-primary/5")}
                    >
                      —
                    </button>
                    {eventTypes.map(et => (
                      <button
                        key={et.id}
                        onClick={() => { handleInlineUpdate("eventType", et.name); setEventOpen(false) }}
                        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted", task.eventType === et.name && "bg-primary/5 font-medium")}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: et.color }} />
                        {et.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {task.completedAt && (
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("completedAt")}</label>
                  <p className="text-sm mt-0.5 flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {formatDate(task.completedAt, locale)}
                  </p>
                </div>
              )}

              {/* Related entity — editable picker (type tabs + search). Always
                  shown so a task with no link can get one. A resolved entity
                  also offers a deep-link icon next to the editor; an
                  unresolvable (deleted) one shows muted "not found" but is
                  still re-pickable. */}
              <div>
                <label className="text-[10px] uppercase text-muted-foreground font-medium">{t("relatedEntity")}</label>
                <div className="mt-0.5 flex items-center gap-1">
                  <InlineRelatedEntityCell
                    relatedType={task.relatedType}
                    relatedId={task.relatedId}
                    relatedName={task.relatedName ?? undefined}
                    orgId={orgId ? String(orgId) : undefined}
                    onSave={(patch) => handleInlinePatch(patch)}
                  />
                  {task.relatedType && task.relatedId && task.relatedName && (
                    <Link
                      href={`${RELATED_TYPE_ROUTES[task.relatedType] || "/"}/${task.relatedId}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                      title={t("relatedEntity")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>

              {/* Linked project — Phase 2 of Notion-tasks plan. Shows the
                  project name as a deep link; the colored dot uses the
                  project's own color so users can identify it at a glance. */}
              {task.project && (
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground font-medium">{tc("project")}</label>
                  <div className="mt-0.5">
                    <Link
                      href={`/projects/${task.project.id}`}
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1.5"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: task.project.color || "#a1a1aa" }}
                      />
                      {task.project.name}
                    </Link>
                  </div>
                </div>
              )}

              <div className="border-t pt-2 mt-1.5 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("createdAt")}</span>
                  <span>{formatDateShort(task.createdAt, locale)}</span>
                </div>
                {task.creator && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t("createdBy")}</span>
                    <span>{task.creator.name}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("updatedAt")}</span>
                  <span>{formatDateShort(task.updatedAt, locale)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recurrence series panel — Roadmap #22 follow-up.
              Two modes:
                · This task IS the parent (recurrenceRule set, no parentId):
                  list all child instances chronologically with status pills.
                · This task is a child (recurrenceParentId set): show a
                  compact "Part of series" link pointing back to the parent.
              "Stop series" button on the parent PATCHes recurrenceRule to
              null — existing children stay, no more spawns occur. */}
          {(task.recurrenceRule || task.recurrenceParentId) && (
            <Card>
              <CardHeader className="px-4 pt-4 pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Repeat className="h-3.5 w-3.5 text-primary" />
                  {tForms("seriesTitle") || "Series"}
                </CardTitle>
                {task.recurrenceRule && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setStopSeriesOpen(true)}
                  >
                    {tForms("seriesStopButton") || "Stop series"}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {task.recurrenceParentId && task.recurrenceParent ? (
                  // Child mode — link back to the parent.
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{tForms("seriesPartOf") || "Part of"}:</span>
                    <Link
                      href={`/tasks/${task.recurrenceParent.id}`}
                      className="text-primary hover:underline flex items-center gap-1 truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{task.recurrenceParent.title}</span>
                    </Link>
                  </div>
                ) : (
                  // Parent mode — show parent + every child in order.
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      {describeRecurrence(task.recurrenceRule || "", tForms as any)}
                      {task.recurrenceCount !== null && task.recurrenceCount !== undefined && (
                        <span> · {tForms("seriesRemaining", { count: task.recurrenceCount }) || `${task.recurrenceCount} remaining`}</span>
                      )}
                    </div>
                    {/* Parent first, then children (each row is clickable) */}
                    <SeriesRow
                      task={{ id: task.id, title: task.title, status: task.status, dueDate: task.dueDate }}
                      isCurrent
                    />
                    {(task.recurrenceChildren ?? []).map((child) => (
                      <SeriesRow
                        key={child.id}
                        task={child}
                        isCurrent={false}
                      />
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Custom Fields */}
          {customFieldDefs.length > 0 && (
            <Card>
              <CardHeader className="px-4 pt-4 pb-2">
                <CardTitle className="text-sm">{t("customFieldsTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {customFieldDefs.map(def => (
                  <div key={def.id}>
                    <label className="text-[10px] uppercase text-muted-foreground font-medium block mb-1">
                      {def.fieldLabel}
                      {def.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <InlineCustomFieldCell
                      def={def}
                      value={task.customFields?.[def.fieldName]}
                      onSave={(v) => updateCustomField(def.fieldName, v)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit Form */}
      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={fetchTask}
        initialData={task}
        orgId={orgId}
      />

      {/* Delete Dialog */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteTask")}
        itemName={task.title}
      />

      {/* Stop-series Dialog — Roadmap #22 follow-up. Calls the dedicated
          /stop-series endpoint which atomically clears the recurrenceRule
          on the parent AND every child (architect P0 fix — without this,
          completing any child respawns the series). */}
      <ConfirmDialog
        open={stopSeriesOpen}
        onOpenChange={setStopSeriesOpen}
        title={tForms("seriesStopButton") || "Stop series"}
        // Non-destructive: /stop-series only clears recurrenceRule on parent + children.
        description={tForms("seriesStopConfirm") || "Stop this series? Existing instances stay, but no new ones will be created."}
        confirmVariant="default"
        confirmLabel={tForms("seriesStopButton") || "Stop series"}
        loadingLabel={tForms("seriesStoppingLabel") || "Stopping..."}
        onConfirm={async () => {
          try {
            const res = await fetch(`/api/v1/tasks/${task.id}/stop-series`, {
              method: "POST",
            })
            if (!res.ok) throw new Error((await res.json()).error || "Failed")
            toast.success(tForms("seriesStoppedToast") || "Series stopped")
            fetchTask()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed")
            // Re-throw so ConfirmDialog's handleConfirm keeps the
            // dialog open and shows the inline error — otherwise on API
            // failure the toast flashes once and the dialog closes as if
            // the stop succeeded (Codex review 2026-05-28).
            throw e
          }
        }}
      />
    </div>
  )
}
