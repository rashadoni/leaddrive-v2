"use client"

import { ColorStatCard } from "@/components/color-stat-card"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { FolderKanban, Clock, CheckCircle2, CalendarDays } from "lucide-react"

interface ProjectStatsProps {
  total: number
  activeCount: number
  completedCount: number
  overdueCount: number
  onFilter: (filter: string) => void
  labels: { total: string; active: string; completed: string; overdue: string }
  hints?: { total?: string; active?: string }
}

export function ProjectStats({ total, activeCount, completedCount, overdueCount, onFilter, labels, hints }: ProjectStatsProps) {
  return (
    <MotionList staggerDelay={0.06} className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
      <MotionItem>
        <div className="cursor-pointer" onClick={() => onFilter("all")}>
          <ColorStatCard label={labels.total} value={total} icon={<FolderKanban className="h-4 w-4" />} hint={hints?.total} animate />
        </div>
      </MotionItem>
      <MotionItem>
        <div className="cursor-pointer" onClick={() => onFilter("active")}>
          <ColorStatCard label={labels.active} value={activeCount} icon={<Clock className="h-4 w-4" />} hint={hints?.active} animate />
        </div>
      </MotionItem>
      <MotionItem>
        <div className="cursor-pointer" onClick={() => onFilter("completed")}>
          <ColorStatCard label={labels.completed} value={completedCount} icon={<CheckCircle2 className="h-4 w-4" />} animate />
        </div>
      </MotionItem>
      <MotionItem>
        <div className="cursor-pointer" onClick={() => onFilter("overdue")}>
          <ColorStatCard label={labels.overdue} value={overdueCount} icon={<CalendarDays className="h-4 w-4" />} animate />
        </div>
      </MotionItem>
    </MotionList>
  )
}
