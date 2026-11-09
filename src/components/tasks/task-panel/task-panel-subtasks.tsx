"use client"

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckSquare, Square, Trash2 } from "lucide-react"
import { formatDate } from "@/lib/format-date"

export interface Subtask {
  id: string
  title: string
  completed: boolean
  sortOrder: number
  assignedTo?: string | null
  assignee?: { id: string; name: string } | null
  dueDate?: string | null
}

const dayInput = (iso: string | null | undefined) => {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
/** A day picked in the browser → the end of that day there (a deadline is the whole day). */
export const endOfDayIso = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null)

/**
 * Bordio's subtasks: each with its own assignee and deadline, ticked off in
 * place, renamed by clicking the name, added on the last line.
 *
 * Every change shows at once (owner, 2026-11-09: «Да, делай»): the row is
 * changed on screen, then sent. Refused or unreachable — that row goes back
 * to how it was and the panel says so. The card is loaded again only when
 * the last change has come back, so a load that started earlier never paints
 * a tick back off while the next one is on its way.
 */
export function TaskPanelSubtasks({ taskId, items, people, canEdit, onChanged }: {
  taskId: string
  items: readonly Subtask[]
  people: readonly { id: string; name: string }[]
  canEdit: boolean
  onChanged: () => void
}) {
  const t = useTranslations("taskPanel")
  const locale = useLocale()
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [rows, setRows] = useState<readonly Subtask[]>(items)
  const [failed, setFailed] = useState(false)
  // Rows from the server are taken when they arrive — unless a change is
  // still out: those rows left before it landed and would undo it on screen.
  const [busy, setBusy] = useState(false)
  const [received, setReceived] = useState(items)
  if (items !== received) {
    setReceived(items)
    if (!busy) setRows(items)
  }
  const inFlight = useRef(0)
  const nextDraftId = useRef(0)
  const done = rows.filter((item) => item.completed).length

  /**
   * `show` changes the rows on screen now; `undo` puts them back if the
   * server does not take the change.
   */
  const send = async (
    request: { method: "POST" | "PATCH" | "DELETE"; body?: unknown; query?: string },
    show: (rows: readonly Subtask[]) => readonly Subtask[],
    undo: (rows: readonly Subtask[]) => readonly Subtask[],
  ) => {
    setFailed(false)
    setRows(show)
    inFlight.current += 1
    setBusy(true)
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/checklist${request.query ?? ""}`, {
      method: request.method, credentials: "include",
      ...(request.body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) }),
    }).catch(() => null)
    inFlight.current -= 1
    if (!res?.ok) {
      setRows(undo)
      setFailed(true)
    }
    if (inFlight.current === 0) {
      setBusy(false)
      onChanged()
    }
  }

  /** Change one row on screen and on the server; refused — the row is as it was. */
  const change = (item: Subtask, fields: Partial<Subtask>, extra: Partial<Subtask> = {}) => {
    void send(
      { method: "PATCH", body: { id: item.id, ...fields } },
      (list) => list.map((row) => (row.id === item.id ? { ...row, ...fields, ...extra } : row)),
      (list) => list.map((row) => (row.id === item.id ? { ...row, ...Object.fromEntries(Object.keys({ ...fields, ...extra }).map((key) => [key, item[key as keyof Subtask]])) } : row)),
    )
  }
  const remove = (item: Subtask) => {
    const at = rows.findIndex((row) => row.id === item.id)
    void send(
      { method: "DELETE", query: `?itemId=${encodeURIComponent(item.id)}` },
      (list) => list.filter((row) => row.id !== item.id),
      (list) => (list.some((row) => row.id === item.id) ? list : [...list.slice(0, at), item, ...list.slice(at)]),
    )
  }
  const add = (title: string) => {
    nextDraftId.current += 1
    const draftRow: Subtask = { id: `draft:${nextDraftId.current}`, title, completed: false, sortOrder: rows.length, assignedTo: null, assignee: null, dueDate: null }
    void send(
      { method: "POST", body: { title } },
      (list) => [...list, draftRow],
      (list) => list.filter((row) => row.id !== draftRow.id),
    )
  }
  const isDraft = (item: Subtask) => item.id.startsWith("draft:")

  return (
    <section className="border-t pt-4" data-testid="task-panel-subtasks">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <CheckSquare className="h-4 w-4" /> {t("subtasks")}
        <span className="rounded-full bg-muted px-2 text-xs font-medium">{done}/{rows.length}</span>
      </h3>
      <ul className="flex flex-col">
        {rows.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
            <button
              type="button"
              disabled={!canEdit || isDraft(item)}
              aria-label={item.completed ? t("reopen") : t("complete")}
              onClick={() => change(item, { completed: !item.completed })}
              className="flex-shrink-0"
            >
              {item.completed ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
            </button>
            {editing?.id === item.id ? (
              <input
                autoFocus
                value={editing.title}
                onChange={(e) => setEditing({ id: item.id, title: e.target.value })}
                onBlur={() => { if (editing.title.trim() && editing.title.trim() !== item.title) change(item, { title: editing.title.trim() }); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null) }}
                className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit || isDraft(item)}
                onClick={() => setEditing({ id: item.id, title: item.title })}
                className={`min-w-0 flex-1 truncate text-left ${item.completed ? "text-muted-foreground line-through" : ""}`}
              >
                {item.title}
              </button>
            )}
            <input
              type="date"
              disabled={!canEdit || isDraft(item)}
              aria-label={t("dueDate")}
              value={dayInput(item.dueDate)}
              title={item.dueDate ? formatDate(item.dueDate, locale, { day: "numeric", month: "short" }) : t("noDate")}
              onChange={(e) => change(item, { dueDate: endOfDayIso(e.target.value) })}
              className="w-[8.5rem] flex-shrink-0 rounded border bg-background px-1 py-0.5 text-xs text-muted-foreground"
            />
            <select
              disabled={!canEdit || isDraft(item)}
              aria-label={t("assignee")}
              value={item.assignedTo ?? ""}
              onChange={(e) => {
                const id = e.target.value || null
                const named = id ? people.find((person) => person.id === id) : null
                change(item, { assignedTo: id }, { assignee: named ? { id: named.id, name: named.name } : null })
              }}
              className="w-[9rem] flex-shrink-0 truncate rounded border bg-background px-1 py-0.5 text-xs"
            >
              <option value="">{t("nobody")}</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            {canEdit && !isDraft(item) && (
              <button type="button" aria-label={t("remove")} onClick={() => remove(item)} className="invisible flex-shrink-0 text-muted-foreground hover:text-destructive group-hover:visible">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="mt-1 text-xs text-destructive">{t("saveFailed")}</p>}
      {canEdit && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) { add(draft.trim()); setDraft("") }
          }}
          placeholder={t("addSubtask")}
          className="mt-2 w-full rounded border border-dashed bg-background px-2 py-1.5 text-sm"
        />
      )}
    </section>
  )
}
