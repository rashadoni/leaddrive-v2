"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ColorStatCard } from "@/components/color-stat-card"
import { WorkflowForm } from "@/components/workflow-form"
import { WorkflowActionsModal } from "@/components/workflow-actions-modal"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import Link from "next/link"
import {
  Plus, Workflow, CheckCircle, XCircle, Pencil, Trash2,
  Play, Pause, Eye, Briefcase, Target, Ticket, CheckSquare,
  User, Building2, Mail, Bell, Globe, Edit3, Search, Zap,
  UserPlus, ArrowRight, Sparkles, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface WorkflowAction {
  id: string
  actionType: string
  actionConfig: any
  actionOrder: number
}

interface WorkflowRule {
  id: string
  name: string
  entityType: string
  triggerEvent: string
  conditions?: any
  isActive: boolean
  actions: WorkflowAction[]
}

const entityIcons: Record<string, any> = {
  deal: Briefcase, deals: Briefcase,
  lead: Target, leads: Target,
  ticket: Ticket, tickets: Ticket,
  task: CheckSquare, tasks: CheckSquare,
  contact: User, contacts: User,
  company: Building2, companies: Building2,
  social_mention: Bell, social_mentions: Bell,
}

const actionIcons: Record<string, any> = {
  send_email: Mail,
  create_task: CheckSquare,
  update_field: Edit3,
  send_notification: Bell, notify: Bell,
  webhook: Globe,
  auto_assign: UserPlus, assign_to: UserPlus,
}

const actionColors: Record<string, string> = {
  send_email: "text-blue-500",
  create_task: "text-teal-500",
  update_field: "text-purple-500",
  send_notification: "text-orange-500", notify: "text-orange-500",
  webhook: "text-muted-foreground",
  auto_assign: "text-indigo-500", assign_to: "text-indigo-500",
}

const actionBgColors: Record<string, string> = {
  send_email: "bg-blue-50 text-blue-700 border-blue-200",
  create_task: "bg-teal-50 text-teal-700 border-teal-200",
  update_field: "bg-purple-50 text-purple-700 border-purple-200",
  send_notification: "bg-orange-50 text-orange-700 border-orange-200", notify: "bg-orange-50 text-orange-700 border-orange-200",
  webhook: "bg-muted/50 text-foreground/70 border-zinc-200 dark:border-zinc-700",
  auto_assign: "bg-indigo-50 text-indigo-700 border-indigo-200", assign_to: "bg-indigo-50 text-indigo-700 border-indigo-200",
}

export default function WorkflowsPage() {
  const { data: session } = useSession()
  const t = useTranslations("workflows")
  const tc = useTranslations("common")
  const ts = useTranslations("settings")
  useAutoTour("workflows")
  const [workflows, setWorkflows] = useState<WorkflowRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<WorkflowRule | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [actionsWorkflow, setActionsWorkflow] = useState<WorkflowRule | null>(null)
  const [search, setSearch] = useState("")
  const [showOnboarding, setShowOnboarding] = useState(false)
  const orgId = session?.user?.organizationId

  // One-shot onboarding hint — persists "seen" in localStorage per browser/user.
  useEffect(() => {
    try {
      const seen = typeof window !== "undefined" && window.localStorage.getItem("leaddrive.workflows.onboarded")
      if (!seen) setShowOnboarding(true)
    } catch { /* private mode / SSR — ignore */ }
  }, [])

  const dismissOnboarding = () => {
    setShowOnboarding(false)
    try { window.localStorage.setItem("leaddrive.workflows.onboarded", "1") } catch {}
  }

  const entityLabels: Record<string, string> = {
    deal: t("entityDeal"),
    deals: t("entityDeal"),
    lead: t("entityLead"),
    leads: t("entityLead"),
    ticket: t("entityTicket"),
    tickets: t("entityTicket"),
    task: t("entityTask"),
    tasks: t("entityTask"),
    contact: t("entityContact"),
    contacts: t("entityContact"),
    company: t("entityCompany"),
    companies: t("entityCompany"),
    social_mention: "Social mention",
    social_mentions: "Social mention",
  }

  const triggerLabels: Record<string, string> = {
    created: t("triggerCreated"),
    updated: t("triggerUpdated"),
    status_changed: t("triggerStatusChanged"),
    stage_changed: t("triggerStageChanged"),
    assigned: t("triggerAssigned"),
    replied: t("triggerReplied"),
    web_activity: t("triggerWebActivity"),
  }

  const actionLabels: Record<string, string> = {
    send_email: t("actionSendEmail"),
    create_task: t("actionCreateTask"),
    update_field: t("actionUpdateField"),
    send_notification: t("actionNotification"),
    notify: t("actionNotification"),
    webhook: t("actionWebhook"),
    auto_assign: t("actionAutoAssign"),
    assign_to: t("actionAutoAssign"),
  }

  const fetchWorkflows = async () => {
    try {
      const res = await fetch("/api/v1/workflows", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (res.ok) {
        const result = await res.json()
        setWorkflows(result.data || [])
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchWorkflows() }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/workflows/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchWorkflows()
  }

  const toggleActive = async (wf: WorkflowRule) => {
    await fetch(`/api/v1/workflows/${wf.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
      },
      body: JSON.stringify({ isActive: !wf.isActive }),
    })
    fetchWorkflows()
  }

  function getActionSummary(action: WorkflowAction): string {
    const c = action.actionConfig || {}
    switch (action.actionType) {
      case "send_email": return c.subject || c.template || ""
      case "create_task": return c.title || ""
      case "update_field": return c.field ? `${c.field} = ${c.value || "..."}` : ""
      case "send_notification": return c.message ? c.message.slice(0, 60) : ""
      case "webhook": return c.url ? `${c.method || "POST"} ${c.url.slice(0, 40)}` : ""
      case "auto_assign":
      case "assign_to": return c.assignTo || c.assign_to || ""
      default: return ""
    }
  }

  function getConditionsSummary(conditions: any): string {
    if (!conditions) return ""
    const rules = conditions.rules
    if (!Array.isArray(rules) || rules.length === 0) return ""
    return rules.map((r: any) => `${r.field} ${r.operator} ${r.value || ""}`).join(", ")
  }

  const totalCount = workflows.length
  const activeCount = workflows.filter(w => w.isActive).length
  const inactiveCount = totalCount - activeCount

  const filtered = workflows.filter(w =>
    !search.trim() || w.name.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-28 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            {t("title")} <TourReplayButton tourId="workflows" /> <HelpButton slug="settings-workflows" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{ts("hintWorkflows")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings/workflows/templates">
            <Button variant="outline" className="gap-1.5">
              <Sparkles className="h-4 w-4" /> {t("browseTemplates")}
            </Button>
          </Link>
          <Button data-tour-id="workflows-new" onClick={() => { setEditData(undefined); setShowForm(true) }} className="gap-1.5">
            <Plus className="h-4 w-4" /> {t("newWorkflow")}
          </Button>
        </div>
      </div>

      {/* First-visit onboarding — points users at the templates gallery */}
      {showOnboarding && (
        <div className="relative rounded-lg border border-violet-200 bg-gradient-to-r from-violet-50 to-purple-50 p-4 dark:border-violet-900 dark:from-violet-950/40 dark:to-purple-950/40">
          <button
            onClick={dismissOnboarding}
            className="absolute top-3 right-3 text-violet-600/60 hover:text-violet-700 dark:text-violet-300/60 dark:hover:text-violet-200"
            aria-label={t("onboardingDismiss")}
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="rounded-md bg-gradient-to-br from-violet-500 to-purple-600 p-2 text-white shadow-sm shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-sm text-violet-900 dark:text-violet-100">
                {t("onboardingTitle")}
              </h3>
              <p className="text-xs text-violet-800/80 dark:text-violet-200/70 mt-1 leading-relaxed">
                {t("onboardingBody")}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link href="/settings/workflows/templates">
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("onboardingCta")}
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={dismissOnboarding}>
                  {t("onboardingDismiss")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <ColorStatCard label={t("statTotal")} value={totalCount} icon={<Workflow className="h-4 w-4" />} />
        <ColorStatCard label={t("statActive")} value={activeCount} icon={<CheckCircle className="h-4 w-4" />} />
        <ColorStatCard label={t("statInactive")} value={inactiveCount} icon={<XCircle className="h-4 w-4" />} />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Workflow cards */}
      <div data-tour-id="workflows-list" className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed bg-muted/20 py-16 text-center">
            <Workflow className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">{t("noWorkflows")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("noWorkflowsHint")}</p>
            <Button className="mt-4 gap-1.5" onClick={() => { setEditData(undefined); setShowForm(true) }}>
              <Plus className="h-4 w-4" /> {t("newWorkflow")}
            </Button>
          </div>
        ) : filtered.map(wf => {
          const EntityIcon = entityIcons[wf.entityType] || Workflow
          const conditionsSummary = getConditionsSummary(wf.conditions)
          return (
            <div key={wf.id} className={cn(
              "border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card hover:shadow-md transition-shadow",
              !wf.isActive && "opacity-60"
            )}>
              <div className="p-4">
                {/* Top row: status + name + buttons */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "text-xs px-2.5 py-0.5 rounded-full font-medium border border-zinc-200 dark:border-zinc-700",
                        wf.isActive
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700"
                      )}>
                        {wf.isActive ? t("statActive") : t("statInactive")}
                      </span>
                      <h3 className="font-semibold truncate">{wf.name}</h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-8"
                      onClick={() => setActionsWorkflow(wf)}
                      title={t("tooltipActions")}
                    >
                      <Eye className="h-3 w-3" /> {t("actions")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-8"
                      onClick={() => { setEditData(wf); setShowForm(true) }}
                      title={t("tooltipEditTrigger")}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn("gap-1 text-xs h-8", wf.isActive ? "text-yellow-600" : "text-green-600")}
                      onClick={() => toggleActive(wf)}
                      title={t("tooltipToggleActive")}
                    >
                      {wf.isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                      onClick={() => { setDeleteId(wf.id); setDeleteName(wf.name) }}
                      title={t("tooltipDelete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Human-readable description: "Когда лид создан → ..." */}
                <div className="flex items-center gap-2 text-sm mb-3 bg-muted/40 rounded-md px-3 py-2">
                  <EntityIcon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-muted-foreground">{t("whenPrefix")}</span>
                  <span className="font-medium">{entityLabels[wf.entityType] || wf.entityType}</span>
                  <span className="font-medium text-orange-600">{triggerLabels[wf.triggerEvent] || wf.triggerEvent}</span>
                  {conditionsSummary && (
                    <>
                      <span className="text-muted-foreground">({t("withCondition")}: {conditionsSummary})</span>
                    </>
                  )}
                  {wf.actions.length > 0 && (
                    <>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-teal-600">
                        {wf.actions.length === 1
                          ? (actionLabels[wf.actions[0].actionType] || wf.actions[0].actionType)
                          : `${wf.actions.length} ${t("actions").toLowerCase()}`
                        }
                      </span>
                    </>
                  )}
                </div>

                {/* Action chips */}
                {wf.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {wf.actions.map((action, i) => {
                      const AIcon = actionIcons[action.actionType] || Zap
                      const summary = getActionSummary(action)
                      return (
                        <div
                          key={i}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700",
                            actionBgColors[action.actionType] || "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700"
                          )}
                        >
                          <AIcon className="h-3 w-3 shrink-0" />
                          <span className="font-medium">{actionLabels[action.actionType] || action.actionType}</span>
                          {summary && (
                            <span className="opacity-70 truncate max-w-[200px]">: {summary}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Form modal */}
      <WorkflowForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchWorkflows}
        initialData={editData}
        orgId={orgId}
      />

      {/* Actions modal */}
      <WorkflowActionsModal
        workflow={actionsWorkflow}
        onClose={() => setActionsWorkflow(null)}
        onSaved={fetchWorkflows}
        orgId={orgId}
      />

      {/* Delete dialog */}
      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteWorkflow")}
        itemName={deleteName}
      />
    </div>
  )
}
