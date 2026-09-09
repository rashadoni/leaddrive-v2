import { formatDate as formatDateLib } from "@/lib/format-date"

export interface ProjectMember {
  id: string
  userId: string
  role: string
  hourlyRate?: number
  hoursLogged: number
  joinedAt: string
}

export interface ProjectMilestone {
  id: string
  name: string
  description?: string
  dueDate?: string
  completedAt?: string
  status: string
  color: string
  sortOrder: number
  _count?: { tasks: number }
  _taskBreakdown?: Record<string, number>
}

export interface ProjectTask {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  milestoneId?: string
  parentId?: string
  assignedTo?: string
  dueDate?: string
  estimatedHours?: number
  actualHours: number
  completedAt?: string
  sortOrder: number
  tags: string[]
  milestone?: { id: string; name: string; color: string } | null
  children?: { id: string; title: string; status: string }[]
}

export interface ProjectDetail {
  id: string
  name: string
  code?: string
  description?: string
  status: string
  priority: string
  startDate?: string
  endDate?: string
  actualStartDate?: string
  actualEndDate?: string
  budget: number
  actualCost: number
  currency: string
  completionPercentage: number
  managerId?: string
  companyId?: string
  dealId?: string
  company?: { id: string; name: string } | null
  color: string
  tags: string[]
  createdAt: string
  updatedAt: string
  members: ProjectMember[]
  milestones: ProjectMilestone[]
  tasks: ProjectTask[]
}

export const statusColors: Record<string, string> = {
  planning: "bg-muted text-foreground/70",
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
}

export const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
}

export const taskStatusColors: Record<string, string> = {
  todo: "bg-muted text-foreground/70",
  in_progress: "bg-amber-100 text-amber-700",
  review: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
}

export function formatDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return "—"
  return formatDateLib(dateStr, locale, { day: "2-digit", month: "short", year: "numeric" })
}
