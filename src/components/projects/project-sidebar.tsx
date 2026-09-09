"use client"

import { useTranslations, useLocale } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"
import { AlertTriangle } from "lucide-react"
import { type ProjectDetail, statusColors, priorityColors, formatDate } from "./project-types"

interface ProjectSidebarProps {
  project: ProjectDetail
  getUserName: (id?: string) => string
}

export function ProjectSidebar({ project, getUserName }: ProjectSidebarProps) {
  const t = useTranslations("projects")
  const locale = useLocale()
  const sym = getCurrencySymbol(project.currency)

  const statusLabels: Record<string, string> = {
    planning: t("statusPlanning"), active: t("statusActive"), on_hold: t("statusOnHold"),
    completed: t("statusCompleted"), cancelled: t("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"), critical: t("priorityCritical"),
  }

  const isOverdue = project.endDate && new Date(project.endDate) < new Date() && project.status !== "completed" && project.status !== "cancelled"

  return (
    <MotionCard>
      <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-md transition-all duration-200 p-5 space-y-4">
        {/* Completion */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("completion")}</span>
            <span className="font-bold tabular-nums">{project.completionPercentage}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${project.completionPercentage}%`, backgroundColor: project.completionPercentage === 100 ? "#22c55e" : project.color }} />
          </div>
        </div>

        {/* Overdue warning */}
        {isOverdue && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Overdue</span>
          </div>
        )}

        {/* Status + Priority */}
        <div className="space-y-2.5 text-sm pb-3 border-b border-zinc-200/30 dark:border-zinc-700/30">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("status")}</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusColors[project.status])}>{statusLabels[project.status]}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("priority")}</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", priorityColors[project.priority])}>{priorityLabels[project.priority]}</span>
          </div>
        </div>

        {/* Manager + Company */}
        <div className="space-y-2.5 text-sm pb-3 border-b border-zinc-200/30 dark:border-zinc-700/30">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("manager")}</span>
            <span className="font-medium">{getUserName(project.managerId)}</span>
          </div>
          {project.company && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("company")}</span>
              <span className="font-medium">{project.company.name}</span>
            </div>
          )}
        </div>

        {/* Dates */}
        <div className="space-y-2.5 text-sm pb-3 border-b border-zinc-200/30 dark:border-zinc-700/30">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("startDate")}</span>
            <span className="text-sm">{formatDate(project.startDate, locale)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("endDate")}</span>
            <span className={cn("text-sm", isOverdue && "text-red-500 font-medium")}>{formatDate(project.endDate, locale)}</span>
          </div>
        </div>

        {/* Budget */}
        <div className="space-y-2.5 text-sm pb-3 border-b border-zinc-200/30 dark:border-zinc-700/30">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("budget")}</span>
            <span className="font-medium tabular-nums">{sym}{project.budget.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("actualCost")}</span>
            <span className="font-medium tabular-nums">{sym}{project.actualCost.toLocaleString()}</span>
          </div>
        </div>

        {/* Created */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">{t("created")}</span>
          <span className="text-sm">{formatDate(project.createdAt, locale)}</span>
        </div>
      </div>
    </MotionCard>
  )
}
