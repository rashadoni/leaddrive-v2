"use client"

import { useTranslations, useLocale } from "next-intl"
import { ColorStatCard } from "@/components/color-stat-card"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"
import { CheckCircle2, Users, Target, Milestone } from "lucide-react"
import { type ProjectDetail, type ProjectTask, type ProjectMilestone, formatDate } from "./project-types"

const taskCellColors: Record<string, string> = {
  todo: "bg-muted/40",
  in_progress: "bg-amber-50 dark:bg-amber-950/20",
  review: "bg-purple-50 dark:bg-purple-950/20",
  done: "bg-green-50 dark:bg-green-950/20",
}

interface ProjectOverviewTabProps {
  project: ProjectDetail
  allTasks: ProjectTask[]
  milestones: ProjectMilestone[]
  membersCount: number
}

export function ProjectOverviewTab({ project, allTasks, milestones, membersCount }: ProjectOverviewTabProps) {
  const t = useTranslations("projects")
  const locale = useLocale()
  const sym = getCurrencySymbol(project.currency)
  const budgetUsedPct = project.budget > 0 ? Math.min(100, Math.round((project.actualCost / project.budget) * 100)) : 0
  const budgetRemaining = project.budget - project.actualCost

  const taskStatusLabels: Record<string, string> = {
    todo: t("taskTodo"), in_progress: t("taskInProgress"), review: t("taskReview"), done: t("taskDone"),
  }

  return (
    <MotionList staggerDelay={0.06} className="space-y-4">
      <MotionItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ColorStatCard label={t("tasks")} value={allTasks.length} icon={<CheckCircle2 className="h-4 w-4" />} animate />
          <ColorStatCard label={t("members")} value={membersCount} icon={<Users className="h-4 w-4" />} animate />
          <ColorStatCard label={t("milestones")} value={milestones.length} icon={<Milestone className="h-4 w-4" />} animate />
          <ColorStatCard label={t("completion")} value={`${project.completionPercentage}%`} icon={<Target className="h-4 w-4" />} />
        </div>
      </MotionItem>

      {/* Task breakdown */}
      <MotionItem>
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-5 hover:shadow-md transition-all duration-200">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("tasks")}</h3>
          <div className="grid grid-cols-4 gap-3">
            {(["todo", "in_progress", "review", "done"] as const).map(st => (
              <div key={st} className={cn("text-center p-3 rounded-lg transition-colors", taskCellColors[st])}>
                <div className="text-xl font-bold tabular-nums">{allTasks.filter(t2 => t2.status === st).length}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{taskStatusLabels[st]}</div>
              </div>
            ))}
          </div>
        </div>
      </MotionItem>

      {/* Budget summary */}
      <MotionItem>
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-5 hover:shadow-md transition-all duration-200">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("budget")}</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-muted-foreground">{t("budget")}</div>
              <div className="font-bold text-lg tabular-nums">{sym}{project.budget.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">{t("actualCost")}</div>
              <div className="font-bold text-lg tabular-nums">{sym}{project.actualCost.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">{t("hintBudgetRemaining")}</div>
              <div className={cn("font-bold text-lg tabular-nums", budgetRemaining < 0 ? "text-red-500" : "text-green-600")}>
                {sym}{budgetRemaining.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-700 ease-out", budgetUsedPct > 90 ? "bg-red-500" : budgetUsedPct > 70 ? "bg-amber-500" : "bg-green-500")}
              style={{ width: `${budgetUsedPct}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">{budgetUsedPct}% used</div>
        </div>
      </MotionItem>

      {/* Milestones timeline */}
      {milestones.length > 0 && (
        <MotionItem>
          <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-5 hover:shadow-md transition-all duration-200">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("milestones")}</h3>
            <div className="space-y-1.5">
              {milestones.map(m => {
                const mTasks = allTasks.filter(t2 => t2.milestoneId === m.id)
                const mDone = mTasks.filter(t2 => t2.status === "done").length
                const mPct = mTasks.length > 0 ? Math.round((mDone / mTasks.length) * 100) : 0
                return (
                  <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.name}</div>
                      <div className="text-[11px] text-muted-foreground">{formatDate(m.dueDate, locale)} · {mDone}/{mTasks.length} {t("tasks").toLowerCase()}</div>
                    </div>
                    <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${mPct}%`, backgroundColor: m.color }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">{mPct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </MotionItem>
      )}
    </MotionList>
  )
}
