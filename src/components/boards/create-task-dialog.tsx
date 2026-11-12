"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Loader2, X } from "lucide-react"
import { endOfDayIso } from "@/components/tasks/task-panel/task-panel-subtasks"
import type { TaskTypeDTO } from "@/components/tasks/use-task-types"
import { boardTaskFromTemplate, type BoardTaskTemplate } from "@/lib/task-templates/board-task-from-template"

/**
 * The «Yeni tapşırıq» window — the board's, and since 2026-11-12 also «Mənim
 * işlərim»'s (owner: «в разделе мои задачи нет кнопки создать задачу» →
 * mockup → «Да, делай»), where the person also picks the board.
 */
const C = {
  primary: "hsl(var(--crm-action))",
  text: "hsl(var(--foreground))",
  sub: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",
  page: "hsl(var(--background))",
  colBg: "color-mix(in srgb, hsl(var(--background)) 70%, hsl(var(--card)) 30%)",
  card: "hsl(var(--card))",
  green: "#00875A",
  red: "#DE350B",
  amber: "#FF8B00",
  purple: "#6554C0",
  teal: "#00B8D9",
}

const PRIORITIES = ["critical", "high", "medium", "low"] as const
const priorityKey = (p: string) => `priority${p[0].toUpperCase()}${p.slice(1)}`
const CATEGORIES = ["Q1", "Q2", "Q3", "Q4"] as const
const LAST_BOARD_KEY = "ld-new-task-board"
interface OrgUser { id: string; name: string; avatar?: string | null }

export function CreateTaskDialog({
  divisionId: givenDivisionId = "", boards, taskTypes, defaultAssignee = "", onClose, onCreated,
}: {
  /** The board the task goes on; with `boards`, the one picked first. */
  divisionId?: string
  /** «Mənim işlərim» has no board of its own: the person picks one (the last one is remembered). */
  boards?: readonly { id: string; label: string }[]
  taskTypes: TaskTypeDTO[]
  defaultAssignee?: string
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations("board")
  const [divisionId, setDivisionId] = useState(() => {
    if (!boards?.length) return givenDivisionId
    let last = ""
    try { last = localStorage.getItem(LAST_BOARD_KEY) ?? "" } catch { /* no storage */ }
    return boards.some((b) => b.id === last) ? last : givenDivisionId || boards[0].id
  })
  const tCommon = useTranslations("common")
  // Lazy: the full org user list is only fetched when this dialog opens.
  const [users, setUsers] = useState<OrgUser[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setUsers(j.data ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const [title, setTitle] = useState("")
  const [type, setType] = useState<string>(taskTypes[0]?.name ?? "task")
  const [priority, setPriority] = useState<string>("medium")
  const [category, setCategory] = useState<string>("")
  const [assignedTo, setAssignedTo] = useState<string>(defaultAssignee)
  const [dueDate, setDueDate] = useState<string>("")
  const [description, setDescription] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Task templates (settings → «Tapşırıq şablonları») fill this dialog too —
  // until 2026-11-09 only the CRM task form offered them, so a person who has
  // the boards alone could make templates and never use one.
  const { data: session } = useSession()
  const tTemplates = useTranslations("taskTemplates")
  const [templates, setTemplates] = useState<BoardTaskTemplate[]>([])
  const [templateId, setTemplateId] = useState("")
  const [pendingChecklist, setPendingChecklist] = useState<{ title: string; sortOrder?: number }[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/v1/task-templates", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && Array.isArray(j?.data)) setTemplates(j.data) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const tpl = templates.find((x) => x.id === id)
    if (!tpl) return
    const filled = boardTaskFromTemplate(tpl, { userName: session?.user?.name ?? "", locale: navigator.language })
    setTitle(filled.title)
    setDescription(filled.description)
    if (filled.priority) setPriority(filled.priority)
    setAssignedTo(filled.assignedTo)
    setDueDate(filled.dueDate)
    setPendingChecklist(filled.checklist)
    // Usage counter, as the CRM form does — fire-and-forget.
    fetch(`/api/v1/task-templates/${tpl.id}/instantiate`, { method: "POST", credentials: "include" }).catch(() => {})
  }

  // Spec: the board "New Task" dialog enforces title 3..200 client-side.
  const valid = title.trim().length >= 3 && title.trim().length <= 200 && !!divisionId

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim(),
          divisionId,
          status: "backlog",
          type,
          priority,
          ...(category ? { category } : {}),
          ...(assignedTo ? { assignedTo } : {}),
          // The end of the chosen day in the person's own time, as everywhere
          // else on the boards (task panel, subtasks): `new Date("yyyy-mm-dd")`
          // is midnight UTC — 04:00 in Baku — so the task was overdue from the
          // morning of its due day (found 2026-11-09).
          ...(dueDate ? { dueDate: endOfDayIso(dueDate) } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.message || j?.error || t("changeFailed"))
        return
      }
      // The template's checklist becomes the task's subtasks — the task API
      // takes them one by one, after the task exists. Best effort: the task
      // is already made, a lost item must not undo it.
      if (pendingChecklist.length) {
        const created = await res.json().catch(() => null)
        const taskId = created?.data?.id
        if (taskId) {
          await Promise.allSettled(pendingChecklist.map((item, i) =>
            fetch(`/api/v1/tasks/${taskId}/checklist`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ title: item.title, sortOrder: item.sortOrder ?? i }),
            })))
        }
      }
      if (boards?.length) { try { localStorage.setItem(LAST_BOARD_KEY, divisionId) } catch { /* no storage */ } }
      onCreated()
    } catch {
      setError(t("networkError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div data-crm-dialog="" className="mx-4 w-full max-w-md rounded-lg border border-border p-6 shadow-xl" style={{ background: C.card, color: C.text }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("newTask")}</h2>
          <button onClick={onClose} style={{ color: C.sub }}><X className="h-5 w-5" /></button>
        </div>

        {boards && boards.length > 0 && (
          <>
            <label className="mb-1 block text-sm font-medium">{t("boardLabel")}</label>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="mb-3 w-full rounded-md border px-2 py-2 text-sm"
              style={{ borderColor: C.input, background: C.card }}
              data-testid="board-create-board"
            >
              {boards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </>
        )}

        {templates.length > 0 && (
          <select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="mb-3 w-full rounded-md border px-2 py-2 text-sm"
            style={{ borderColor: C.input, background: C.card }}
            data-testid="board-create-template"
          >
            <option value="">{tTemplates("pickerButton")}</option>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        )}

        <label className="mb-1 block text-sm font-medium">{t("titleLabel")}</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t("titlePlaceholder")}
          className="mb-3 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.input }}
          data-testid="board-create-title"
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("type")}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.input, background: C.card }}>
              {taskTypes.map((tt) => <option key={tt.id} value={tt.name}>{tt.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("priority")}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.input, background: C.card }}>
              {PRIORITIES.map((x) => <option key={x} value={x}>{tCommon(priorityKey(x))}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("assignee")}</label>
            <select data-testid="board-create-assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.input, background: C.card }}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("category")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.input, background: C.card }}>
              <option value="">—</option>
              {CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>

        <label className="mb-1 block text-sm font-medium">{t("dueDate")}</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-4 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.input }}
        />

        {error && <p className="mb-3 text-sm" style={{ color: C.red }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.border }}>{t("cancel")}</button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: C.primary }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("creating") : t("create")}
          </button>
        </div>
      </div>
    </div>
  )
}

