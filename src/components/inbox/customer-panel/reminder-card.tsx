"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Bell, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { formatDate } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { PanelCard } from "./panel-card"

type TaskRow = { id: string; title: string; dueDate: string | null; remindAt?: string | null; status: string }

/** «2026-11-16T10:00» for a datetime-local input: tomorrow at ten, the browser's own time. */
export function defaultReminderInput(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`
}

/**
 * «Xatırlatma» — the nearest open task about this customer, and «+ Напомнить»: a line of text and a
 * time. The task is the customer's (relatedType contact, or the lead when there is no contact yet),
 * assigned to whoever set it, and at that time the bell and a push come (lib/tasks/task-reminders).
 */
export function ReminderCard({ related, headers, userId, refreshKey }: {
  related: { type: "contact" | "lead"; id: string }
  headers: Record<string, string>
  userId: string | null
  refreshKey: number
}) {
  const t = useTranslations("inboxPanel")
  const locale = useLocale()
  const [task, setTask] = useState<TaskRow | null>(null)
  const [denied, setDenied] = useState(false)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState("")
  const [when, setWhen] = useState(defaultReminderInput)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setTask(null)
    setAdding(false)
    ;(async () => {
      try {
        const q = new URLSearchParams({ relatedType: related.type, relatedId: related.id, open: "1", sort: "due", limit: "5" })
        const res = await fetch(`/api/v1/tasks?${q.toString()}`, { headers })
        if (!alive) return
        if (res.status === 403) { setDenied(true); return }
        const json = await readJsonSafely<{ data?: { tasks?: TaskRow[] } }>(res)
        const rows = res.ok && Array.isArray(json?.data?.tasks) ? json!.data!.tasks! : []
        setDenied(false)
        setTask(rows.find((row) => row.dueDate) ?? null)
      } catch {
        if (alive) setTask(null)
      }
    })()
    return () => { alive = false }
  }, [related.type, related.id, headers, refreshKey, reload])

  if (denied) return null

  const save = async () => {
    const title = text.trim()
    const at = new Date(when)
    if (!title || Number.isNaN(at.getTime())) return
    setSaving(true)
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          title: title.slice(0, 200),
          dueDate: at.toISOString(),
          remindAt: at.toISOString(),
          relatedType: related.type,
          relatedId: related.id,
          ...(userId ? { assignedTo: userId } : {}),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t("reminderSaved"))
      setText("")
      setWhen(defaultReminderInput())
      setAdding(false)
      setReload((n) => n + 1)
    } catch {
      toast.error(t("reminderFailed"))
    } finally {
      setSaving(false)
    }
  }

  const due = task?.dueDate ? new Date(task.dueDate) : null
  const overdue = due ? due.getTime() < Date.now() : false

  return (
    <PanelCard testId="inbox-panel-reminder" className="space-y-2">
      {task && due ? (
        <Link href={`/tasks/${task.id}`} className="flex items-center gap-2.5 rounded-lg hover:bg-muted/40">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            <Bell className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <b className={cn("block truncate text-xs font-semibold", overdue && "text-destructive")}>
              {formatDate(due, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}{task.remindAt ? t("reminderWord") : t("taskWord")}{overdue ? ` · ${t("reminderOverdue")}` : ""}
            </b>
            <small className="line-clamp-2 block text-[10.5px] leading-snug text-muted-foreground">{task.title}</small>
          </span>
        </Link>
      ) : null}

      {adding ? (
        <div className="space-y-1.5" data-testid="inbox-panel-reminder-form">
          <Input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save() }}
            placeholder={t("reminderText")}
            aria-label={t("reminderText")}
            className="h-8 text-xs"
            maxLength={200}
          />
          <Input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            aria-label={t("reminderWhen")}
            className="h-8 text-xs"
          />
          <div className="flex gap-1.5">
            <Button type="button" size="sm" className="h-7 flex-1 text-xs" disabled={saving || !text.trim() || !when} onClick={() => void save()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("reminderSave")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>{t("reminderCancel")}</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="inbox-panel-reminder-add"
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-semibold text-primary hover:bg-primary/5"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("reminderAdd")}
        </button>
      )}
    </PanelCard>
  )
}
