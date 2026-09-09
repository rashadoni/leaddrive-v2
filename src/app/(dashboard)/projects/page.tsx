"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { MotionPage } from "@/components/ui/motion"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { ProjectForm } from "@/components/projects/project-form"
import { ProjectStats } from "@/components/projects/project-stats"
import { HelpButton } from "@/components/help/help-button"
import {
  FolderKanban, Plus, Pencil, Trash2, Building2,
  X, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { statusColors, priorityColors, formatDate } from "@/components/projects/project-types"

interface Project {
  id: string
  name: string
  code?: string
  description?: string
  status: string
  priority: string
  startDate?: string
  endDate?: string
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
  _count?: { tasks: number; members: number; milestones: number }
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

export default function ProjectsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("projects")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [projects, setProjects] = useState<Project[]>([])
  useAutoTour("projects")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Project | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [searchDebounce, setSearchDebounce] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(20)

  const orgId = session?.user?.organizationId

  const statusLabels: Record<string, string> = {
    planning: t("statusPlanning"), active: t("statusActive"), on_hold: t("statusOnHold"),
    completed: t("statusCompleted"), cancelled: t("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"), critical: t("priorityCritical"),
  }

  const fetchProjects = useCallback(async (status?: string, search?: string, page?: number) => {
    try {
      const params = new URLSearchParams({ limit: String(pageSize), page: String(page || currentPage) })
      if (status && status !== "all") params.set("status", status)
      if (search) params.set("search", search)
      const res = await fetch(`/api/v1/projects?${params}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setProjects(json.data.projects)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [orgId, pageSize, currentPage])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounce(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (!loading) { setCurrentPage(1); fetchProjects(activeFilter, searchDebounce, 1) }
  }, [searchDebounce]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/projects/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchProjects(activeFilter, searchDebounce, currentPage)
  }

  // Stats
  const activeCount = projects.filter(p => p.status === "active").length
  const completedCount = projects.filter(p => p.status === "completed").length
  const overdueCount = projects.filter(p => {
    if (!p.endDate || p.status === "completed" || p.status === "cancelled") return false
    return new Date(p.endDate) < new Date()
  }).length

  const statusCounts: Record<string, number> = {}
  for (const p of projects) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function setFilter(filter: string) {
    setActiveFilter(filter)
    setCurrentPage(1)
    fetchProjects(filter, searchDebounce, 1)
  }

  function goToPage(page: number) {
    setCurrentPage(page)
    fetchProjects(activeFilter, searchDebounce, page)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === projects.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(projects.map(p => p.id)))
  }

  async function handleBulkDelete() {
    await fetch("/api/v1/projects/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
      body: JSON.stringify({ ids: Array.from(selectedIds), action: "delete" }),
    })
    setSelectedIds(new Set())
    fetchProjects(activeFilter, searchDebounce, currentPage)
  }

  async function handleBulkStatusChange(newStatus: string) {
    await fetch("/api/v1/projects/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
      body: JSON.stringify({ ids: Array.from(selectedIds), action: "changeStatus", value: newStatus }),
    })
    setSelectedIds(new Set())
    fetchProjects(activeFilter, searchDebounce, currentPage)
  }

  function exportCSV() {
    const csvRows = [
      ["Name", "Code", "Status", "Priority", "Company", "Completion", "Budget", "Currency", "Start Date", "End Date"].join(","),
      ...projects.map(p => [
        `"${p.name.replace(/"/g, '""')}"`,
        p.code || "",
        p.status, p.priority,
        p.company?.name ? `"${p.company.name.replace(/"/g, '""')}"` : "",
        `${p.completionPercentage}%`,
        p.budget, p.currency,
        p.startDate ? p.startDate.split("T")[0] : "",
        p.endDate ? p.endDate.split("T")[0] : "",
      ].join(","))
    ].join("\n")
    const blob = new Blob([csvRows], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `projects-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns = [
    {
      key: "select",
      label: (
        <input type="checkbox" checked={projects.length > 0 && selectedIds.size === projects.length}
          onChange={toggleSelectAll} className="rounded" />
      ) as any,
      className: "w-10",
      render: (item: Project) => (
        <div onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selectedIds.has(item.id)}
            onChange={() => toggleSelect(item.id)} className="rounded" />
        </div>
      ),
    },
    {
      key: "name", label: t("name"), sortable: true,
      render: (item: Project) => (
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          <div>
            <div className="font-medium">{item.name}</div>
            {item.code && <div className="text-xs text-muted-foreground font-mono">{item.code}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "company", label: t("company"), sortable: true,
      render: (item: Project) => (
        <div className="flex items-center gap-1.5">
          {item.company ? (
            <><Building2 className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-sm">{item.company.name}</span></>
          ) : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: "status", label: t("status"), hint: t("hintColStatus"), sortable: true,
      render: (item: Project) => (
        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusColors[item.status])}>
          {statusLabels[item.status] || item.status}
        </span>
      ),
    },
    {
      key: "priority", label: t("priority"), hint: t("hintColPriority"), sortable: true,
      render: (item: Project) => (
        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", priorityColors[item.priority])}>
          {priorityLabels[item.priority] || item.priority}
        </span>
      ),
    },
    {
      key: "completion", label: t("completion"), hint: t("hintColCompletion"), sortable: true,
      render: (item: Project) => (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${item.completionPercentage}%`, backgroundColor: item.completionPercentage === 100 ? "#22c55e" : item.color }} />
          </div>
          <span className="text-xs text-muted-foreground">{item.completionPercentage}%</span>
        </div>
      ),
    },
    {
      key: "tasks", label: t("tasks"),
      render: (item: Project) => <span className="text-sm text-muted-foreground">{item._count?.tasks || 0}</span>,
    },
    {
      key: "endDate", label: t("endDate"), sortable: true,
      render: (item: Project) => {
        const isOverdue = item.endDate && new Date(item.endDate) < new Date() && item.status !== "completed" && item.status !== "cancelled"
        return <span className={cn("text-sm", isOverdue && "text-red-500 font-medium")}>{formatDate(item.endDate, locale)}</span>
      },
    },
    {
      key: "actions", label: "", className: "w-20",
      render: (item: Project) => (
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => { setEditData(item); setShowForm(true) }} className="p-1.5 rounded hover:bg-muted">
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => { setDeleteId(item.id); setDeleteName(item.name) }}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
          </button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <MotionPage>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="projects" /> <HelpButton slug="projects" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> {t("export")}
          </Button>
          <Button onClick={() => { setEditData(undefined); setShowForm(true) }} data-tour-id="projects-new">
            <Plus className="h-4 w-4 mr-1" /> {t("newProject")}
          </Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="projects" className="mb-4" />

      <ProjectStats
        total={total} activeCount={activeCount} completedCount={completedCount} overdueCount={overdueCount}
        onFilter={setFilter}
        labels={{ total: t("kpiTotal"), active: t("kpiActive"), completed: t("kpiCompleted"), overdue: t("kpiOverdue") }}
        hints={{ total: t("hintTotalProjects"), active: t("hintActiveProjects") }}
      />

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn("px-3 py-1.5 text-sm rounded-full border transition-all duration-200",
            activeFilter === "all" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background hover:bg-muted border-zinc-200 dark:border-zinc-700"
          )}>
          {t("allProjects")} ({total})
        </button>
        {(["planning", "active", "on_hold", "completed", "cancelled"] as const).map(key => (
          statusCounts[key] ? (
            <button key={key}
              onClick={() => setFilter(key)}
              className={cn("px-3 py-1.5 text-sm rounded-full border transition-all duration-200",
                activeFilter === key ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background hover:bg-muted border-zinc-200 dark:border-zinc-700"
              )}>
              {statusLabels[key]} ({statusCounts[key]})
            </button>
          ) : null
        ))}
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-card/80 backdrop-blur-xl border border-zinc-200/60 dark:border-zinc-700/60 shadow-lg rounded-xl">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <select onChange={e => { if (e.target.value) handleBulkStatusChange(e.target.value); e.target.value = "" }}
            className="text-xs rounded-lg border border-input bg-background px-2 py-1.5">
            <option value="">Change status...</option>
            {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("delete")}
          </Button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm"
        />
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
        </svg>
      </div>

      {projects.length > 0 ? (
        <div data-tour-id="projects-list">
          <DataTable
            columns={columns as any}
            data={projects as any}
            onRowClick={(item: any) => router.push(`/projects/${item.id}`)}
            pageSize={pageSize}
          />
          {/* Server pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>
                {t("prev")}
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-muted-foreground px-1">...</span>}
                    <Button variant={p === currentPage ? "default" : "outline"} size="sm" className="w-9" onClick={() => goToPage(p)}>
                      {p}
                    </Button>
                  </span>
                ))}
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>
                {t("next")}
              </Button>
              <span className="text-xs text-muted-foreground ml-2">{total} total</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">{t("noProjects")}</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">{t("noProjectsHint")}</p>
          <Button className="mt-4" onClick={() => { setEditData(undefined); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {t("newProject")}
          </Button>
        </div>
      )}

      <ProjectForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => fetchProjects(activeFilter, searchDebounce)}
        editData={editData}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("delete")}
        itemName={deleteName}
      />
    </div>
    </MotionPage>
  )
}
