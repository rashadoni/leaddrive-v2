"use client"

import { useTranslations } from "next-intl"
import { ColorStatCard } from "@/components/color-stat-card"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { cn } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"
import { DollarSign, BarChart3, Target } from "lucide-react"
import { type ProjectDetail, type ProjectMember } from "./project-types"

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
]

interface ProjectBudgetTabProps {
  project: ProjectDetail
  members: ProjectMember[]
  getUserName: (id?: string) => string
}

export function ProjectBudgetTab({ project, members, getUserName }: ProjectBudgetTabProps) {
  const t = useTranslations("projects")
  const sym = getCurrencySymbol(project.currency)
  const budgetUsedPct = project.budget > 0 ? Math.min(100, Math.round((project.actualCost / project.budget) * 100)) : 0
  const budgetRemaining = project.budget - project.actualCost
  const membersWithCost = members.filter(m => m.hourlyRate)
  const totalCost = membersWithCost.reduce((sum, m) => sum + (m.hourlyRate || 0) * m.hoursLogged, 0)

  return (
    <MotionList staggerDelay={0.06} className="space-y-4">
      <MotionItem>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <ColorStatCard label={t("budget")} value={`${sym}${project.budget.toLocaleString()}`} icon={<DollarSign className="h-4 w-4" />} />
          <ColorStatCard label={t("actualCost")} value={`${sym}${project.actualCost.toLocaleString()}`} icon={<BarChart3 className="h-4 w-4" />} />
          <ColorStatCard label={t("hintBudgetRemaining")} value={`${sym}${budgetRemaining.toLocaleString()}`} icon={<Target className="h-4 w-4" />} />
        </div>
      </MotionItem>

      <MotionItem>
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-5 hover:shadow-md transition-all duration-200">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("budgetProgress")}</h3>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-700 ease-out", budgetUsedPct > 90 ? "bg-red-500" : budgetUsedPct > 70 ? "bg-amber-500" : "bg-green-500")}
              style={{ width: `${budgetUsedPct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 tabular-nums">
            <span>{budgetUsedPct}% used</span>
            <span>{sym}{project.actualCost.toLocaleString()} / {sym}{project.budget.toLocaleString()}</span>
          </div>
        </div>
      </MotionItem>

      {membersWithCost.length > 0 && (
        <MotionItem>
          <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-5 hover:shadow-md transition-all duration-200">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("members")} Cost</h3>
            <div className="space-y-2">
              {membersWithCost.map(m => {
                const cost = (m.hourlyRate || 0) * m.hoursLogged
                const userName = getUserName(m.userId)
                const avatarColor = AVATAR_COLORS[userName.charCodeAt(0) % AVATAR_COLORS.length]
                return (
                  <div key={m.id} className="flex items-center justify-between text-sm py-2 border-b border-zinc-200 dark:border-zinc-700/20 last:border-0">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor}`}>
                        {userName.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{userName}</span>
                    </div>
                    <div className="text-right text-muted-foreground tabular-nums">
                      <span>{m.hoursLogged}h × {sym}{m.hourlyRate} = </span>
                      <span className="font-medium text-foreground">{sym}{cost.toLocaleString()}</span>
                    </div>
                  </div>
                )
              })}
              {/* Total row */}
              <div className="flex items-center justify-between text-sm pt-2 font-semibold">
                <span>{t("total")}</span>
                <span className="tabular-nums">{sym}{totalCost.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </MotionItem>
      )}
    </MotionList>
  )
}
