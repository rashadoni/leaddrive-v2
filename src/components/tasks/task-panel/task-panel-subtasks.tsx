"use client"

import { useState } from "react"
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
  const done = items.filter((item) => item.completed).length

  const send = async (method: "POST" | "PATCH" | "DELETE", body?: unknown, query = "") => {
    await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/checklist${query}`, {
      method, credentials: "include",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }).catch(() => null)
    onChanged()
  }

  return (
    <section className="border-t pt-4" data-testid="task-panel-subtasks">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <CheckSquare className="h-4 w-4" /> {t("subtasks")}
        <span className="rounded-full bg-muted px-2 text-xs font-medium">{done}/{items.length}</span>
      </h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
            <button
              type="button"
              disabled={!canEdit}
              aria-label={item.completed ? t("reopen") : t("complete")}
              onClick={() => send("PATCH", { id: item.id, completed: !item.completed })}
              className="flex-shrink-0"
            >
              {item.completed ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
            </button>
            {editing?.id === item.id ? (
              <input
                autoFocus
                value={editing.title}
                onChange={(e) => setEditing({ id: item.id, title: e.target.value })}
                onBlur={() => { if (editing.title.trim() && editing.title.trim() !== item.title) void send("PATCH", { id: item.id, title: editing.title.trim() }); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null) }}
                className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing({ id: item.id, title: item.title })}
                className={`min-w-0 flex-1 truncate text-left ${item.completed ? "text-muted-foreground line-through" : ""}`}
              >
                {item.title}
              </button>
            )}
            <input
              type="date"
              disabled={!canEdit}
              aria-label={t("dueDate")}
              value={dayInput(item.dueDate)}
              title={item.dueDate ? formatDate(item.dueDate, locale, { day: "numeric", month: "short" }) : t("noDate")}
              onChange={(e) => send("PATCH", { id: item.id, dueDate: endOfDayIso(e.target.value) })}
              className="w-[8.5rem] flex-shrink-0 rounded border bg-background px-1 py-0.5 text-xs text-muted-foreground"
            />
            <select
              disabled={!canEdit}
              aria-label={t("assignee")}
              value={item.assignedTo ?? ""}
              onChange={(e) => send("PATCH", { id: item.id, assignedTo: e.target.value || null })}
              className="w-[9rem] flex-shrink-0 truncate rounded border bg-background px-1 py-0.5 text-xs"
            >
              <option value="">{t("nobody")}</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            {canEdit && (
              <button type="button" aria-label={t("remove")} onClick={() => send("DELETE", undefined, `?itemId=${encodeURIComponent(item.id)}`)} className="invisible flex-shrink-0 text-muted-foreground hover:text-destructive group-hover:visible">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) { void send("POST", { title: draft.trim() }); setDraft("") }
          }}
          placeholder={t("addSubtask")}
          className="mt-2 w-full rounded border border-dashed bg-background px-2 py-1.5 text-sm"
        />
      )}
    </section>
  )
}
