"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Calendar, CalendarClock, ChevronsUp, Clock, Download, Hourglass, Link2, ListChecks, MoreHorizontal, Paperclip, Play, Repeat, Square, Tag, Trash2, X,
} from "lucide-react"
import { useTaskTypes } from "@/components/tasks/use-task-types"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { formatDate } from "@/lib/format-date"
import { TaskPanelFeed } from "@/components/tasks/task-panel/task-panel-feed"
import { TaskPanelSubtasks, endOfDayIso, type Subtask } from "@/components/tasks/task-panel/task-panel-subtasks"
import { applyTaskPatch, revertTaskPatch } from "@/lib/client/optimistic-task-patch"
import { STATUS_TO_STAGE, foldToVisibleStage } from "@/lib/tasks/board-columns"
import { listLinesOf, newSubtaskTitles } from "@/lib/tasks/list-lines"
import { fileDownloadUrl } from "@/lib/tasks/message-files"
import { saveTaskFiles } from "@/lib/tasks/save-task-files"

/**
 * The task card as a panel on the right of the board — Bordio's card (owner,
 * 2026-11-07: «Как в Bordio, с макетом» → «да, сделай»). Left: the fields,
 * each changed where it stands; the action chips (file, timer, write time,
 * tag, repeat); the description; subtasks with their own people and dates.
 * Right: the time line and the message box (task-panel-feed.tsx).
 * The board stays visible to the left; Escape or ✕ closes.
 */

interface Person { id: string; name: string; avatar?: string | null }
interface PanelTask {
  id: string
  divisionId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  type: string | null
  taskKey: string | null
  dueDate: string | null
  startDate: string | null
  assignedTo: string | null
  assignee: Person | null
  collaborators: { user: Person }[]
  reporterId: string | null
  reporter: Person | null
  creator: { id: string; name: string } | null
  tags: string[]
  estimatedHours: string | number | null
  recurrenceRule: string | null
  customFields: Record<string, unknown> | null
  checklist: Subtask[]
  attachments: { id: string; fileName: string; originalName: string; mimeType?: string | null }[]
  createdAt: string
  /** What the reader may do with it — the server's rule (lib/tasks/task-ownership.ts). */
  you?: { mayManage: boolean; mayDelete: boolean }
}
interface TimeSummary { totalMinutes: number; running: { startedAt: string } | null }
export interface PanelColumn { key: string; label: string; columnKey?: string }

const PRIORITIES = ["low", "medium", "high", "urgent", "critical"] as const
const REPEATS = ["", "daily", "weekly", "monthly", "yearly"] as const
const dayInput = (iso: string | null | undefined) => {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
/** «1:30» — hours and minutes, the same in every language. */
const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`

export function TaskPanel({ taskId, columns: givenColumns, path: givenPath, canEdit: canEditBoard, onClose, onMutated }: {
  taskId: string
  /** The board's stages; without them (department view) the panel reads the task's own board. */
  columns?: readonly PanelColumn[]
  /** «Digital Marketing / Pharmastore» — where the task lives. */
  path?: string
  canEdit: boolean
  onClose: () => void
  onMutated: () => void
}) {
  const t = useTranslations("taskPanel")
  const locale = useLocale()
  const { types } = useTaskTypes(true)
  const [task, setTask] = useState<PanelTask | null>(null)
  const [failed, setFailed] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [brandOptions, setBrandOptions] = useState<string[] | null>(null)
  const [time, setTime] = useState<TimeSummary | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [splitting, setSplitting] = useState(false)
  const [splitNote, setSplitNote] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState<string | null>(null)
  const [logDraft, setLogDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  // Edits show at once and go to the server behind the screen. While any is
  // on its way a load must not paint the card over it: the load started
  // before the edit landed and would put the old value back for a moment.
  // The last edit to come back loads the card again.
  const inFlight = useRef(0)
  const taskRef = useRef<PanelTask | null>(null)
  useEffect(() => { taskRef.current = task }, [task])
  const [boardInfo, setBoardInfo] = useState<{ columns: PanelColumn[]; path: string } | null>(null)
  // Moved to another board here (Xayala, 2026-11-12): the board's own columns are read again.
  const [moved, setMoved] = useState(false)
  const taskBoard = task?.divisionId ?? null
  const needBoard = (moved || !givenColumns?.length) && Boolean(taskBoard)
  useEffect(() => {
    if (!needBoard || !taskBoard) return
    let alive = true
    fetch("/api/v1/divisions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive) return
        const list = (json?.data?.divisions ?? []) as { id: string; name: string; parentDivisionId?: string | null; boardColumns?: { key: string; label: string; mapsToStatus: string }[] }[]
        const board = list.find((d) => d.id === taskBoard)
        if (!board) return
        setBoardInfo({
          columns: (board.boardColumns ?? []).map((c) => ({ key: c.mapsToStatus, label: c.label, columnKey: c.key })),
          path: [list.find((d) => d.id === board.parentDivisionId)?.name, board.name].filter(Boolean).join(" / "),
        })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [needBoard, taskBoard])
  const columns: readonly PanelColumn[] = useMemo(
    () => (!moved && givenColumns?.length ? givenColumns : boardInfo?.columns ?? []),
    [givenColumns, boardInfo, moved],
  )
  const path = (!moved && givenPath) || boardInfo?.path
  // The boards a task can move to: every board (not a folder) the reader sees.
  const [boardChoices, setBoardChoices] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    if (!canEditBoard || !taskBoard) return
    let alive = true
    fetch("/api/v1/divisions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive) return
        const list = (json?.data?.divisions ?? []) as { id: string; name: string; isDepartment?: boolean; parentDivisionId?: string | null }[]
        if (!Array.isArray(list)) return
        setBoardChoices(list.filter((d) => !d.isDepartment).map((d) => ({
          id: d.id, label: [list.find((p) => p.id === d.parentDivisionId)?.name, d.name].filter(Boolean).join(" · "),
        })))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [canEditBoard, taskBoard])

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/time`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([taskJson, timeJson]) => {
      if (!alive || inFlight.current > 0) return
      const loaded = taskJson.data as PanelTask
      setTask(loaded)
      setTitle(loaded.title)
      setDescription(loaded.description ?? "")
      setTime(timeJson?.data ?? null)
      setFailed(false)
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [taskId, reloadKey])

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch("/api/v1/users/assignable", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/v1/custom-fields?entityType=task", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([usersJson, fieldsJson]) => {
      if (!alive) return
      setPeople((usersJson?.data ?? []) as Person[])
      const brand = ((fieldsJson?.data ?? []) as { fieldName: string; options?: string[]; isActive?: boolean }[]).find((f) => f.fieldName === "brand" && f.isActive !== false)
      setBrandOptions(brand?.options ?? null)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const running = Boolean(time?.running)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const patch = useCallback(async (fields: Record<string, unknown>) => {
    setError(null)
    const original = taskRef.current
    if (original) setTask((current) => (current ? applyTaskPatch(current, fields, people) : current))
    inFlight.current += 1
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(fields),
    }).catch(() => null)
    inFlight.current -= 1
    if (!res?.ok) {
      // Refused: only this edit's fields go back; an edit still on its way stays.
      if (original) setTask((current) => (current ? revertTaskPatch(current, original, fields) : current))
      if ("title" in fields) setTitle(original?.title ?? "")
      if ("description" in fields) setDescription(original?.description ?? "")
      const json = await res?.json().catch(() => null)
      setError(json?.error ?? t("saveFailed"))
    }
    if (inFlight.current === 0) {
      reload()
      onMutated()
    }
  }, [taskId, people, reload, onMutated, t])

  const timeAction = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/time`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
    }).catch(() => null)
    if (res?.ok) setTime((await res.json()).data)
    else setError(t("saveFailed"))
    reload()
  }

  const [removing, setRemoving] = useState<string | null>(null)
  // Several files at once (Xayala, 2026-11-12: «qrup halında silmək imkanı olsun»).
  const [pickedFiles, setPickedFiles] = useState<ReadonlySet<string>>(new Set())
  // Several files saved at one press: how far it has got, and what it could not save.
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const saveFiles = async () => {
    if (!task || saving) return
    const chosen = pickedFiles.size > 0 ? task.attachments.filter((file) => pickedFiles.has(file.id)) : task.attachments
    setSaveNote(null)
    setSaving({ done: 0, total: chosen.length })
    const result = await saveTaskFiles(chosen, { onProgress: (done, total) => setSaving({ done, total }) })
    setSaving(null)
    if (result.failed.length > 0) setSaveNote(t("filesNotSaved", { count: String(result.failed.length), names: result.failed.join(", ") }))
  }
  const [confirmBulk, setConfirmBulk] = useState(false)
  const togglePicked = (id: string) => setPickedFiles((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const removePicked = async () => {
    const ids = [...pickedFiles]
    setConfirmBulk(false)
    if (ids.length === 0) return
    const query = ids.map((id) => `fileId=${encodeURIComponent(id)}`).join("&")
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/files?${query}`, { method: "DELETE", credentials: "include" }).catch(() => null)
    if (!res?.ok) setError(t("saveFailed"))
    else setPickedFiles(new Set())
    reload()
  }
  const removeFile = async (fileId: string) => {
    setRemoving(null)
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE", credentials: "include" }).catch(() => null)
    if (!res?.ok) setError(t("saveFailed"))
    reload()
  }

  const upload = async (file: File) => {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/files`, { method: "POST", credentials: "include", body: form }).catch(() => null)
    if (!res?.ok) setError(t("uploadFailed"))
    reload()
  }

  // A status the board has no column for (the CRM's «pending» from the quick
  // add row, «completed», «cancelled») is shown as the column the board puts
  // the task in — the same fold as the lanes (board-columns.ts) — not as the
  // raw word («pending» in an Azerbaijani card, 2026-11-09). Display only:
  // nothing is written until the person picks a status.
  const shownStatus = useCallback((value: string) => {
    if (columns.some((c) => c.key === value)) return value
    const folded = foldToVisibleStage(STATUS_TO_STAGE[value] ?? value, new Set(columns.map((c) => c.key)))
    return columns.some((c) => c.key === folded) ? folded : value
  }, [columns])
  const statusLabel = useCallback((value: string) => columns.find((c) => c.key === shownStatus(value))?.label ?? value, [columns, shownStatus])
  const statusValue = useMemo(() => (task ? shownStatus(task.status) : ""), [shownStatus, task])
  const runningSeconds = time?.running ? Math.max(0, Math.floor((now - new Date(time.running.startedAt).getTime()) / 1000)) : 0
  const people4mention = useMemo(() => people.map((p) => ({ id: p.id, name: p.name })), [people])

  const field = (label: string, control: React.ReactNode, icon?: React.ReactNode) => (
    <>
      <span className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground">{icon}{label}</span>
      <div className="min-w-0 py-1 text-sm">{control}</div>
    </>
  )
  // A board task is changed by its own people and deleted by its author (Ulviyya,
  // 2026-11-12): everyone else reads it and writes in its feed.
  const canEdit = canEditBoard && (task?.you?.mayManage ?? true)
  const canDelete = canEditBoard && (task?.you?.mayDelete ?? true)
  // A list in the description becomes subtasks at one press (Elvira, 2026-11-12:
  // «45 ədəd vinil» arrives as a numbered list). Lines already subtasks are not offered again.
  const listToAdd = task ? newSubtaskTitles(listLinesOf(description), task.checklist.map((item) => item.title)) : []
  const splitList = async () => {
    if (!task || listToAdd.length === 0) return
    setSplitting(true)
    setSplitNote(null)
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(task.id)}/checklist`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: listToAdd }),
    }).catch(() => null)
    const json = res?.ok ? await res.json().catch(() => null) : null
    setSplitting(false)
    if (!json) { setSplitNote(t("saveFailed")); return }
    setSplitNote(t("listAdded", { count: String(json.data?.added ?? 0) }))
    reload()
    onMutated()
  }
  const selectClass = "w-full max-w-xs rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-border focus:border-border disabled:opacity-70"

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={task?.title ?? t("task")}>
      <button type="button" aria-label={t("close")} onClick={onClose} className="hidden flex-1 bg-black/25 md:block" />
      <div className="flex h-full w-full max-w-[1120px] flex-col overflow-hidden border-l bg-background shadow-2xl md:w-[88vw]" data-crm-dialog="">
        {failed ? (
          <div className="p-6">
            <p className="text-sm text-destructive">{t("loadFailed")}</p>
            <button type="button" onClick={onClose} className="mt-3 rounded-md border px-3 py-1.5 text-sm">{t("close")}</button>
          </div>
        ) : !task ? (
          <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto border-r px-6 py-4" data-testid="task-panel">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{path ? `${path} / ` : ""}<b className="font-semibold text-foreground">{task.taskKey ?? ""}</b></span>
                <div className="relative ml-auto flex items-center gap-1">
                  <button type="button" aria-label={t("more")} onClick={() => setMenuOpen((v) => !v)} className="rounded p-1.5 hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></button>
                  {menuOpen && (
                    <div className="absolute right-0 top-8 z-10 min-w-40 rounded-md border bg-background py-1 shadow-lg">
                      <a href={`/tasks/${task.id}`} className="block px-3 py-1.5 text-sm hover:bg-muted">{t("openFull")}</a>
                      {canDelete && (
                        <button type="button" data-testid="task-panel-delete" onClick={() => { setMenuOpen(false); setConfirmDelete(true) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-muted">
                          <Trash2 className="h-4 w-4" /> {t("delete")}
                        </button>
                      )}
                    </div>
                  )}
                  <button type="button" aria-label={t("copyLink")} onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/tasks/${task.id}`)} className="rounded p-1.5 hover:bg-muted"><Link2 className="h-4 w-4" /></button>
                  <button type="button" aria-label={t("close")} onClick={onClose} className="rounded p-1.5 hover:bg-muted"><X className="h-5 w-5" /></button>
                </div>
              </div>

              <textarea
                value={title}
                readOnly={!canEdit}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() && title.trim() !== task.title) void patch({ title: title.trim() }); else setTitle(task.title) }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
                rows={Math.max(1, Math.ceil(title.length / 48))}
                className="mb-3 w-full resize-none rounded-md border border-transparent bg-transparent px-1 text-xl font-semibold leading-snug hover:border-border focus:border-border focus:outline-none"
              />

              {canEditBoard && !canEdit && (
                <p data-testid="task-panel-not-yours" className="mb-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{t("notYours")}</p>
              )}
              {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

              <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-x-3">
                {task.divisionId && boardChoices.length > 1 && field(t("board"), (
                  <select
                    disabled={!canEdit}
                    data-testid="task-panel-board"
                    value={task.divisionId}
                    onChange={(e) => { setMoved(true); void patch({ divisionId: e.target.value }) }}
                    className={selectClass}
                  >
                    {boardChoices.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    {!boardChoices.some((b) => b.id === task.divisionId) && <option value={task.divisionId}>{path ?? task.divisionId}</option>}
                  </select>
                ))}
                {field(t("status"), (
                  <select disabled={!canEdit} value={statusValue} onChange={(e) => {
                    const column = columns.find((c) => c.key === e.target.value)
                    void patch({ status: e.target.value, ...(column?.columnKey ? { boardColumnKey: column.columnKey } : {}) })
                  }} className={selectClass}>
                    {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    {!columns.some((c) => c.key === statusValue) && <option value={statusValue}>{statusValue}</option>}
                  </select>
                ))}
                {field(t("dueDate"), (
                  <input type="date" disabled={!canEdit} value={dayInput(task.dueDate)} onChange={(e) => void patch({ dueDate: endOfDayIso(e.target.value) })} className={selectClass} />
                ), <Calendar className="h-4 w-4" />)}
                {field(t("startDate"), (
                  <input type="date" disabled={!canEdit} value={dayInput(task.startDate)} onChange={(e) => void patch({ startDate: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })} className={selectClass} />
                ), <CalendarClock className="h-4 w-4" />)}
                {field(t("priority"), (
                  <select disabled={!canEdit} value={task.priority} onChange={(e) => void patch({ priority: e.target.value })} className={selectClass}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priorities.${p}` as never)}</option>)}
                  </select>
                ), <ChevronsUp className="h-4 w-4" />)}
                {field(t("assignee"), (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select disabled={!canEdit} value={task.assignedTo ?? ""} onChange={(e) => void patch({ assignedTo: e.target.value || null })} className={`${selectClass} max-w-[12rem]`}>
                      <option value="">{t("nobody")}</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {task.collaborators.map(({ user }) => (
                      <span key={user.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                        {user.name}
                        {canEdit && <button type="button" aria-label={t("remove")} onClick={() => void patch({ collaboratorIds: task.collaborators.map((c) => c.user.id).filter((id) => id !== user.id) })}><X className="h-3 w-3" /></button>}
                      </span>
                    ))}
                    {canEdit && (
                      <select value="" aria-label={t("addPerson")} onChange={(e) => { if (e.target.value) void patch({ collaboratorIds: [...task.collaborators.map((c) => c.user.id), e.target.value] }) }} className="rounded-md border border-dashed bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground">
                        <option value="">+ {t("addPerson")}</option>
                        {people.filter((p) => p.id !== task.assignedTo && !task.collaborators.some((c) => c.user.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {field(t("reporter"), (
                  <select disabled={!canEdit} value={task.reporterId ?? ""} onChange={(e) => void patch({ reporterId: e.target.value || null })} className={selectClass}>
                    <option value="">{task.creator ? t("reporterIsAuthor", { name: task.creator.name }) : t("nobody")}</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ))}
                {field(t("type"), (
                  <select disabled={!canEdit} value={task.type ?? ""} onChange={(e) => void patch({ type: e.target.value })} className={selectClass}>
                    {types.map((type) => <option key={type.name} value={type.name}>{type.displayName}</option>)}
                    {task.type && !types.some((type) => type.name === task.type) && <option value={task.type}>{task.type}</option>}
                  </select>
                ))}
                {brandOptions && field(t("brand"), (
                  <select disabled={!canEdit} value={String(task.customFields?.brand ?? "")} onChange={(e) => void patch({ customFields: { brand: e.target.value || null } })} className={selectClass}>
                    <option value="">—</option>
                    {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                  </select>
                ))}
                {field(t("estimate"), (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number" min={0} step={0.5} disabled={!canEdit}
                      defaultValue={task.estimatedHours === null ? "" : String(Number(task.estimatedHours))}
                      key={`est-${task.estimatedHours}`}
                      onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== (task.estimatedHours === null ? null : Number(task.estimatedHours))) void patch({ estimatedHours: v }) }}
                      className="w-20 rounded-md border bg-transparent px-1.5 py-0.5"
                    />
                    <span className="text-muted-foreground">{t("hoursShort")}</span>
                    <span className="text-muted-foreground">· {t("spent")} {hoursText((time?.totalMinutes ?? 0) + Math.floor(runningSeconds / 60))}</span>
                  </div>
                ), <Clock className="h-4 w-4" />)}
                {task.tags.length > 0 && field(t("tags"), (
                  <div className="flex flex-wrap gap-1.5">
                    {task.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                        #{tag}
                        {canEdit && <button type="button" aria-label={t("remove")} onClick={() => void patch({ tags: task.tags.filter((x) => x !== tag) })}><X className="h-3 w-3" /></button>}
                      </span>
                    ))}
                  </div>
                ), <Tag className="h-4 w-4" />)}
                {task.recurrenceRule && field(t("repeat"), <span>{t(`repeats.${task.recurrenceRule.split(":")[0]}` as never)}</span>, <Repeat className="h-4 w-4" />)}
              </div>

              {canEdit && (
                <div className="my-4 flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = "" }} />
                  <button type="button" data-crm-button="" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"><Paperclip className="h-4 w-4" /> {t("attach")}</button>
                  {time?.running ? (
                    <button type="button" data-crm-button="" onClick={() => void timeAction({ action: "stop" })} className="inline-flex items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-sm text-primary">
                      <Square className="h-4 w-4" /> {t("stopTimer")} {String(Math.floor(runningSeconds / 3600)).padStart(2, "0")}:{String(Math.floor((runningSeconds % 3600) / 60)).padStart(2, "0")}:{String(runningSeconds % 60).padStart(2, "0")}
                    </button>
                  ) : (
                    <button type="button" data-crm-button="" onClick={() => void timeAction({ action: "start" })} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"><Play className="h-4 w-4" /> {t("startTimer")}</button>
                  )}
                  {logDraft === null ? (
                    <button type="button" data-crm-button="" onClick={() => setLogDraft("")} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"><Hourglass className="h-4 w-4" /> {t("logTime")}</button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm">
                      <input autoFocus type="number" min={1} placeholder={t("minutes")} value={logDraft} onChange={(e) => setLogDraft(e.target.value)} className="w-20 bg-transparent outline-none" />
                      <button type="button" onClick={() => { const m = Number(logDraft); if (m > 0) void timeAction({ action: "log", minutes: Math.round(m) }); setLogDraft(null) }} className="font-medium text-primary">{t("save")}</button>
                      <button type="button" aria-label={t("cancel")} onClick={() => setLogDraft(null)}><X className="h-3.5 w-3.5" /></button>
                    </span>
                  )}
                  {tagDraft === null ? (
                    <button type="button" data-crm-button="" onClick={() => setTagDraft("")} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"><Tag className="h-4 w-4" /> {t("addTag")}</button>
                  ) : (
                    <input
                      autoFocus value={tagDraft} placeholder={t("tagPlaceholder")}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && tagDraft.trim()) { void patch({ tags: [...task.tags, tagDraft.trim().replace(/^#/, "")] }); setTagDraft(null) }
                        if (e.key === "Escape") setTagDraft(null)
                      }}
                      onBlur={() => setTagDraft(null)}
                      className="w-36 rounded-md border px-2 py-1 text-sm"
                    />
                  )}
                  <label className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">
                    <Repeat className="h-4 w-4" />
                    <select value={(task.recurrenceRule ?? "").split(":")[0]} aria-label={t("repeat")} onChange={(e) => void patch({ recurrenceRule: e.target.value || null })} className="bg-transparent outline-none">
                      {REPEATS.map((rule) => <option key={rule} value={rule}>{rule ? t(`repeats.${rule}` as never) : t("noRepeat")}</option>)}
                    </select>
                  </label>
                </div>
              )}

              <section className="border-t pt-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{t("description")}</h3>
                  {canEdit && listToAdd.length > 0 && (
                    <button
                      type="button"
                      data-testid="task-panel-split-list"
                      disabled={splitting}
                      onClick={() => void splitList()}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/60 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
                    >
                      <ListChecks className="h-3.5 w-3.5" /> {t("splitList", { count: String(listToAdd.length) })}
                    </button>
                  )}
                  {splitNote && <span role="status" className="ml-auto text-xs text-muted-foreground">{splitNote}</span>}
                </div>
                <textarea
                  value={description}
                  readOnly={!canEdit}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => { if (description !== (task.description ?? "")) void patch({ description }) }}
                  rows={Math.max(3, description.split("\n").length + 1)}
                  placeholder={canEdit ? t("descriptionPlaceholder") : ""}
                  className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 text-sm leading-6 hover:border-border focus:border-border focus:outline-none"
                />
              </section>

              {task.attachments.length > 0 && (
                <section className="border-t py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{t("files")} <span className="font-normal text-muted-foreground">{task.attachments.length}</span></h3>
                    {/* Güllü, 2026-11-13: the visuals of one post are saved at one press, each under its own name. */}
                    {task.attachments.length > 1 && (
                      <button
                        type="button"
                        data-testid="task-files-download-all"
                        disabled={saving !== null}
                        onClick={() => void saveFiles()}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {saving
                          ? t("savingFiles", { done: String(Math.min(saving.done + 1, saving.total)), total: String(saving.total) })
                          : pickedFiles.size > 0 ? t("downloadSelectedFiles", { count: String(pickedFiles.size) }) : t("downloadAllFiles")}
                      </button>
                    )}
                    {canEdit && task.attachments.length > 1 && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          data-testid="task-files-select-all"
                          checked={task.attachments.every((file) => pickedFiles.has(file.id))}
                          onChange={(e) => setPickedFiles(e.target.checked ? new Set(task.attachments.map((file) => file.id)) : new Set())}
                        />
                        {t("selectAllFiles")}
                      </label>
                    )}
                  </div>
                  {canEdit && pickedFiles.size > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" data-testid="task-files-bulk">
                      <span>{t("filesSelected", { count: String(pickedFiles.size) })}</span>
                      {confirmBulk ? (
                        <span className="ml-auto flex items-center gap-1.5">
                          {t("confirmRemoveFiles", { count: String(pickedFiles.size) })}
                          <button type="button" data-testid="task-files-bulk-yes" onClick={() => void removePicked()} className="rounded border border-destructive px-2 py-0.5">{t("yes")}</button>
                          <button type="button" onClick={() => setConfirmBulk(false)} className="rounded border px-2 py-0.5 text-foreground">{t("no")}</button>
                        </span>
                      ) : (
                        <button type="button" data-testid="task-files-bulk-remove" onClick={() => setConfirmBulk(true)} className="ml-auto inline-flex items-center gap-1 rounded border border-destructive px-2 py-0.5">
                          <Trash2 className="h-3.5 w-3.5" /> {t("removeSelectedFiles", { count: String(pickedFiles.size) })}
                        </button>
                      )}
                    </div>
                  )}
                  {saveNote && <p role="alert" className="mb-2 text-xs text-destructive" data-testid="task-files-save-note">{saveNote}</p>}
                  <ul className="flex flex-col gap-1">
                    {task.attachments.map((file) => (
                      <li key={file.id} className="group flex items-center gap-2" data-testid="task-file">
                        {canEdit && (
                          <input type="checkbox" aria-label={file.originalName} data-testid="task-file-pick" checked={pickedFiles.has(file.id)} onChange={() => togglePicked(file.id)} className="shrink-0" />
                        )}
                        <a href={`/uploads/tasks/${file.fileName}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-sm hover:underline"><Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.originalName}</span></a>
                        <a href={fileDownloadUrl(file)} download={file.originalName} aria-label={`${t("downloadFile")}: ${file.originalName}`} title={t("downloadFile")} className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" data-testid="task-file-download"><Download className="h-3.5 w-3.5" /></a>
                        {/* Zeytun, 2026-11-12: «əlavə olunanları da silmək olmur» — a file is removed in two clicks. */}
                        {canEdit && (removing === file.id ? (
                          <button type="button" data-crm-button="" onClick={() => void removeFile(file.id)} className="shrink-0 rounded-md border border-destructive px-2 py-0.5 text-xs text-destructive" data-testid="task-file-remove-confirm">{t("confirmRemoveFile")}</button>
                        ) : (
                          <button type="button" aria-label={`${t("removeFile")}: ${file.originalName}`} title={t("removeFile")} onClick={() => setRemoving(file.id)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive" data-testid="task-file-remove"><Trash2 className="h-3.5 w-3.5" /></button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <TaskPanelSubtasks taskId={task.id} items={task.checklist} people={people} canEdit={canEdit} onChanged={() => { reload(); onMutated() }} />

              <p className="mt-6 text-xs text-muted-foreground">
                {t("createdBy", { name: task.creator?.name ?? "—", date: formatDate(task.createdAt, locale, { day: "numeric", month: "short", year: "numeric" }) })}
              </p>
            </div>

            <div className="min-h-0">
              <TaskPanelFeed taskId={task.id} people={people4mention} statusLabel={statusLabel} reloadKey={reloadKey} files={task.attachments} canAttach={canEditBoard} onChanged={() => { reload(); onMutated() }} />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        itemName={task?.title}
        onConfirm={async () => {
          const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE", credentials: "include" })
          if (!res.ok) throw new Error(t("saveFailed"))
          onMutated()
          onClose()
        }}
      />
    </div>
  )
}
