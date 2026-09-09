"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MotionPage, MotionTab } from "@/components/ui/motion"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { ProjectForm } from "@/components/projects/project-form"
import { cn } from "@/lib/utils"
import { ArrowLeft, Pencil, Trash2, AlertCircle } from "lucide-react"


import { type ProjectDetail, statusColors, priorityColors } from "@/components/projects/project-types"
import { ProjectSidebar } from "@/components/projects/project-sidebar"
import { ProjectOverviewTab } from "@/components/projects/project-overview-tab"
import { ProjectTasksTab } from "@/components/projects/project-tasks-tab"
import { ProjectMembersTab } from "@/components/projects/project-members-tab"
import { ProjectMilestonesTab } from "@/components/projects/project-milestones-tab"
import { ProjectBudgetTab } from "@/components/projects/project-budget-tab"
import { ProjectCrmActivityTab } from "@/components/projects/project-crm-activity-tab"

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("projects")
  const orgId = session?.user?.organizationId

  const [project, setProject] = useState<ProjectDetail | null>(null)
  useAutoTour("projectDetail")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])

  const [showEditForm, setShowEditForm] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (orgId) headers["x-organization-id"] = String(orgId)

  const statusLabels: Record<string, string> = {
    planning: t("statusPlanning"), active: t("statusActive"), on_hold: t("statusOnHold"),
    completed: t("statusCompleted"), cancelled: t("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"), critical: t("priorityCritical"),
  }

  // ── Fetch ────────────────────────────────────────────────

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${id}`, { headers })
      const json = await res.json()
      if (json.success) setProject(json.data)
      else setProject(null)
    } catch { setProject(null) } finally { setLoading(false) }
  }, [id, orgId])

  useEffect(() => { if (session) fetchProject() }, [session, fetchProject])

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/users", { headers: { "x-organization-id": String(orgId) } })
      .then(r => r.json())
      .then(j => { if (j.success) setUsers((j.data?.users || j.data || []).map((u: any) => ({ id: u.id, name: u.name || u.email }))) })
      .catch(() => {})
  }, [orgId])

  const getUserName = (userId?: string) => {
    if (!userId) return "—"
    return users.find(u => u.id === userId)?.name || userId.slice(0, 8)
  }

  async function handleDeleteProject() {
    await fetch(`/api/v1/projects/${id}`, { method: "DELETE", headers })
    router.push("/projects")
  }

  // ── Loading / Not found ──────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-4 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Project not found</h3>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/projects")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Projects
        </Button>
      </div>
    )
  }

  const allTasks = project.tasks || []
  const members = project.members || []
  const milestones = project.milestones || []

  return (
    <MotionPage>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push("/projects")} className="mt-0.5">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{project.name} <TourReplayButton tourId="projectDetail" /><HelpButton slug="project-detail" variant="label" /></h1>
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusColors[project.status])}>
                  {statusLabels[project.status]}
                </span>
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", priorityColors[project.priority])}>
                  {priorityLabels[project.priority]}
                </span>
              </div>
              {project.code && <div className="text-xs font-mono text-muted-foreground mt-0.5 ml-5">{project.code}</div>}
              {project.description && <p className="text-sm text-muted-foreground mt-1 ml-5 max-w-2xl">{project.description}</p>}
              {project.tags.length > 0 && (
                <div className="flex gap-1.5 mt-2 ml-5">
                  {project.tags.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> {t("edit")}
            </Button>
            <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:border-red-300" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("delete")}
            </Button>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          <div className="space-y-4">
            <ProjectSidebar project={project} getUserName={getUserName} />
          </div>

          <div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList data-tour-id="project-tabs">
                <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
                <TabsTrigger value="tasks">{t("tasks")} ({allTasks.length})</TabsTrigger>
                <TabsTrigger value="crmActivity">{t("crmActivity")}</TabsTrigger>
                <TabsTrigger value="members">{t("members")} ({members.length})</TabsTrigger>
                <TabsTrigger value="milestones">{t("milestones")} ({milestones.length})</TabsTrigger>
                <TabsTrigger value="budget">{t("budget")}</TabsTrigger>
              </TabsList>

              <MotionTab activeKey={activeTab}>
                <TabsContent value="overview" className="mt-4">
                  <ProjectOverviewTab project={project} allTasks={allTasks} milestones={milestones} membersCount={members.length} />
                </TabsContent>

                <TabsContent value="tasks" className="mt-4">
                  <ProjectTasksTab projectId={id} tasks={allTasks} allTasks={allTasks} milestones={milestones}
                    users={users} headers={headers} onRefresh={fetchProject} getUserName={getUserName} />
                </TabsContent>

                <TabsContent value="crmActivity" className="mt-4">
                  <ProjectCrmActivityTab projectId={id} headers={headers} />
                </TabsContent>

                <TabsContent value="members" className="mt-4">
                  <ProjectMembersTab projectId={id} members={members} users={users} currency={project.currency}
                    headers={headers} onRefresh={fetchProject} getUserName={getUserName} />
                </TabsContent>

                <TabsContent value="milestones" className="mt-4">
                  <ProjectMilestonesTab projectId={id} milestones={milestones} allTasks={allTasks}
                    headers={headers} onRefresh={fetchProject} />
                </TabsContent>

                <TabsContent value="budget" className="mt-4">
                  <ProjectBudgetTab project={project} members={members} getUserName={getUserName} />
                </TabsContent>
              </MotionTab>
            </Tabs>
          </div>
        </div>

        <ProjectForm
          open={showEditForm}
          onClose={() => setShowEditForm(false)}
          onSaved={fetchProject}
          editData={project}
        />

        <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDeleteProject} title={t("delete")} itemName={project.name} />
      </div>
    </MotionPage>
  )
}
