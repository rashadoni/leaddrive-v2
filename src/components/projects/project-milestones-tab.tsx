"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { Plus, Pencil, Trash2, X, Milestone } from "lucide-react"
import { type ProjectTask, type ProjectMilestone, formatDate } from "./project-types"

interface ProjectMilestonesTabProps {
  projectId: string
  milestones: ProjectMilestone[]
  allTasks: ProjectTask[]
  headers: Record<string, string>
  onRefresh: () => void
}

export function ProjectMilestonesTab({ projectId, milestones, allTasks, headers, onRefresh }: ProjectMilestonesTabProps) {
  const t = useTranslations("projects")
  const locale = useLocale()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [color, setColor] = useState("#6366f1")
  const [editingId, setEditingId] = useState<string | null>(null)

  const milestoneStatusLabels: Record<string, string> = {
    pending: t("statusPlanning"), in_progress: t("statusActive"), completed: t("statusCompleted"), overdue: t("kpiOverdue"),
  }

  async function handleSave() {
    if (!name.trim()) return
    const payload: Record<string, unknown> = { name: name.trim(), dueDate: dueDate || null, color }
    if (editingId) {
      payload.milestoneId = editingId
      await fetch(`/api/v1/projects/${projectId}/milestones`, { method: "PUT", headers, body: JSON.stringify(payload) })
    } else {
      await fetch(`/api/v1/projects/${projectId}/milestones`, { method: "POST", headers, body: JSON.stringify(payload) })
    }
    setShowForm(false); setName(""); setDueDate(""); setColor("#6366f1"); setEditingId(null); onRefresh()
  }

  async function deleteMilestone(milestoneId: string) {
    await fetch(`/api/v1/projects/${projectId}/milestones?milestoneId=${milestoneId}`, { method: "DELETE", headers })
    onRefresh()
  }

  function openEdit(m: ProjectMilestone) {
    setEditingId(m.id); setName(m.name); setDueDate(m.dueDate ? m.dueDate.split("T")[0] : ""); setColor(m.color); setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setShowForm(true); setEditingId(null); setName(""); setDueDate(""); setColor("#6366f1") }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t("addMilestone")}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{editingId ? t("edit") : t("addMilestone")}</h3>
            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded transition-colors"><X className="h-4 w-4" /></button>
          </div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t("name")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-10 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer" />
              <span className="text-xs text-muted-foreground font-mono">{color}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
            <Button size="sm" onClick={handleSave} disabled={!name.trim()}>{editingId ? t("save") : t("create")}</Button>
          </div>
        </div>
      )}

      {milestones.length > 0 ? (
        <MotionList className="space-y-3">
          {milestones.map(m => {
            const mTasks = allTasks.filter(t2 => t2.milestoneId === m.id)
            const mDone = mTasks.filter(t2 => t2.status === "done").length
            const mPct = mTasks.length > 0 ? Math.round((mDone / mTasks.length) * 100) : 0
            const isOverdue = m.dueDate && new Date(m.dueDate) < new Date() && m.status !== "completed"
            return (
              <MotionItem key={m.id}>
                <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-4 hover:shadow-md transition-all duration-200 border-l-4"
                  style={{ borderLeftColor: m.color }}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span className={cn(isOverdue && "text-red-500 font-medium")}>{formatDate(m.dueDate, locale)}</span>
                          <span className="text-border">·</span>
                          <span>{mDone}/{mTasks.length} {t("tasks").toLowerCase()}</span>
                          <span className="text-border">·</span>
                          <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full font-medium",
                            m.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                            m.status === "in_progress" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            "bg-muted text-muted-foreground"
                          )}>{milestoneStatusLabels[m.status] || m.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-muted transition-colors"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      <button onClick={() => deleteMilestone(m.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" /></button>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${mPct}%`, backgroundColor: m.color }} />
                    </div>
                    <div className="text-[11px] text-muted-foreground text-right mt-0.5 tabular-nums">{mPct}%</div>
                  </div>
                </div>
              </MotionItem>
            )
          })}
        </MotionList>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Milestone className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t("noMilestones")}</p>
        </div>
      )}
    </div>
  )
}
