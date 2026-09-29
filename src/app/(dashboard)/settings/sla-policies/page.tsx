"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { SlaPolicyForm } from "@/components/sla-policy-form"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { checkPermission, type Role } from "@/lib/permissions"
import {
  SLA_POLICY_PRIORITIES,
  splitSlaDuration,
  summarizeSlaPolicyCoverage,
  type SlaPolicyPriority,
} from "@/lib/ticketing/sla-policy"

export interface SlaPolicy {
  id: string
  name: string
  priority: SlaPolicyPriority
  firstResponseHours: number
  resolutionHours: number
  businessHoursOnly: boolean
  isActive: boolean
  _count?: { companies: number; entitlements: number }
}

async function localizedError(response: Response, fallback: string, inUse: string): Promise<Error> {
  const payload = await response.json().catch(() => null)
  return new Error(payload?.code === "POLICY_IN_USE" ? inUse : fallback)
}

export default function SlaPoliciesPage() {
  const { data: session } = useSession()
  const t = useTranslations("slaPolicyUi")
  const orgId = session?.user?.organizationId
  const role = (session?.user?.role || "viewer") as Role
  const canWrite = checkPermission(role, "settings", "write")
  const canDelete = checkPermission(role, "settings", "delete")
  useAutoTour("slaPolicies")

  const [policies, setPolicies] = useState<SlaPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [loadErrorRetryable, setLoadErrorRetryable] = useState(true)
  const [actionError, setActionError] = useState("")
  const [actionErrorRetryable, setActionErrorRetryable] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<SlaPolicy>()
  const [deleteTarget, setDeleteTarget] = useState<SlaPolicy>()

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : {}) as Record<string, string>,
    [orgId],
  )

  const fetchPolicies = useCallback(async (background = false) => {
    if (background) {
      setActionError("")
      setActionErrorRetryable(true)
    }
    else {
      setLoading(true)
      setLoadError("")
      setLoadErrorRetryable(true)
    }
    try {
      const response = await fetch("/api/v1/sla-policies", { headers })
      if (!response.ok) {
        if (background) setActionErrorRetryable(response.status !== 403)
        else setLoadErrorRetryable(response.status !== 403)
        throw new Error(response.status === 403 ? t("permissionDenied") : t("loadFailedDescription"))
      }
      const payload = await response.json()
      setPolicies(payload.data || [])
    } catch (error) {
      const message = error instanceof Error ? error.message : t("loadFailedDescription")
      if (background) setActionError(message)
      else setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [headers, t])

  useEffect(() => {
    void fetchPolicies()
  }, [fetchPolicies])

  const coverage = useMemo(() => summarizeSlaPolicyCoverage(policies), [policies])
  const policiesByPriority = useMemo(() => new Map(SLA_POLICY_PRIORITIES.map((priority) => [
    priority,
    policies
      .filter((policy) => policy.priority === priority)
      .sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name)),
  ])), [policies])

  const priorityLabel = (priority: SlaPolicyPriority) => t(`priority.${priority}`)
  const formatDuration = (value: number) => {
    const { hours, minutes } = splitSlaDuration(value)
    if (hours > 0 && minutes > 0) return t("durationHoursMinutes", { hours, minutes })
    if (hours > 0) return t("durationHours", { hours })
    return t("durationMinutes", { minutes })
  }

  const startCreate = () => {
    setEditData(undefined)
    setActionError("")
    setShowForm(true)
  }

  const startEdit = (policy: SlaPolicy) => {
    setEditData(policy)
    setActionError("")
    setShowForm(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const response = await fetch(`/api/v1/sla-policies/${deleteTarget.id}`, { method: "DELETE", headers })
    if (!response.ok) throw await localizedError(response, t("deleteFailed"), t("policyInUseError"))
    await fetchPolicies(true)
    toast.success(t("deletedToast"))
  }

  const missingLabels = coverage.missing.map(priorityLabel).join(", ")
  const conflictLabels = coverage.conflicts.map(priorityLabel).join(", ")

  const workspaceState = loading ? "loading" : loadError ? "error" : "ready"

  return (
    <SupportPageShell
      data-testid="sla-policies-workspace"
      data-state={workspaceState}
      title={<span data-tour-id="sla-header">{t("title")}</span>}
      description={<>{t("description")}{!canWrite && <span className="mt-1 block text-xs">{t("readOnlyHint")}</span>}</>}
      leading={<Clock className="h-5 w-5" aria-hidden="true" />}
      utilities={<><TourReplayButton tourId="slaPolicies" /><HelpButton slug="sla-policies" /></>}
      actions={canWrite ? <Button data-testid="sla-policies-create" className="min-h-11 bg-orange-700 px-4 text-white hover:bg-orange-800 sm:shrink-0" onClick={startCreate}><Plus />{t("addPolicy")}</Button> : undefined}
    >

      <section aria-label={t("summaryLabel")} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y py-2 text-xs text-muted-foreground">
        <span><strong className="font-semibold text-foreground">{policies.length}</strong> {t("totalPolicies")}</span>
        <span><strong className="font-semibold text-foreground">{coverage.active}</strong> {t("activePolicies")}</span>
        <span><strong className="font-semibold text-foreground">{coverage.covered.length}/4</strong> {t("prioritiesCovered")}</span>
        {coverage.missing.length > 0 && <span><strong className="font-semibold text-foreground">{coverage.missing.length}</strong> {t("coverageGaps")}</span>}
        {coverage.conflicts.length > 0 && <span><strong className="font-semibold text-destructive">{coverage.conflicts.length}</strong> {t("activeConflicts")}</span>}
      </section>

      {coverage.conflicts.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div><p className="font-medium">{t("conflictTitle")}</p><p className="mt-0.5 text-muted-foreground">{t("conflictDescription", { priorities: conflictLabels })}</p></div>
        </div>
      )}
      {coverage.missing.length > 0 && policies.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div><p className="font-medium">{t("gapTitle")}</p><p className="mt-0.5 text-muted-foreground">{t("gapDescription", { priorities: missingLabels })}</p></div>
        </div>
      )}
      {actionError && (
        <div data-testid="sla-policies-refresh-error" role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{actionError}</span>
          {actionErrorRetryable && <Button data-testid="sla-policies-refresh-retry" variant="outline" className="min-h-11" onClick={() => void fetchPolicies(true)}><RotateCcw />{t("retry")}</Button>}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border bg-card" aria-label={t("matrixLabel")}>
        {loading ? (
          <div data-testid="sla-policies-loading" aria-busy="true" className="divide-y">
            {[0, 1, 2, 3].map((index) => <div key={index} className="h-20 animate-pulse bg-muted/30 motion-reduce:animate-none" />)}
          </div>
        ) : loadError ? (
          <div data-testid="sla-policies-load-error" role="alert" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
            <CircleAlert className="h-8 w-8 text-destructive" />
            <h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
            {loadErrorRetryable && <Button data-testid="sla-policies-load-retry" variant="outline" className="mt-4 min-h-11" onClick={() => void fetchPolicies()}><RotateCcw />{t("retry")}</Button>}
          </div>
        ) : policies.length === 0 ? (
          <div data-testid="sla-policies-empty-state" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">{t("emptyTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("emptyDescription")}</p>
            {canWrite && <Button data-testid="sla-policies-empty-create" className="mt-4 min-h-11 bg-orange-700 text-white hover:bg-orange-800" onClick={startCreate}><Plus />{t("addPolicy")}</Button>}
          </div>
        ) : (
          <>
            <div data-testid="sla-policies-matrix" className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("priorityLabel")}</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("policyLabel")}</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("firstResponseLabel")}</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("resolutionLabel")}</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("scheduleLabel")}</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">{t("assignmentsLabel")}</th>
                    <th scope="col" className="w-14 px-3 py-2"><span className="sr-only">{t("actionsLabel")}</span></th>
                  </tr>
                </thead>
                {SLA_POLICY_PRIORITIES.map((priority) => (
                  <PolicyTableGroup
                    key={priority}
                    policies={policiesByPriority.get(priority) || []}
                    priorityLabel={priorityLabel(priority)}
                    formatDuration={formatDuration}
                    canWrite={canWrite}
                    canDelete={canDelete}
                    onEdit={startEdit}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </table>
            </div>
            <div data-testid="sla-policies-mobile-list" className="divide-y md:hidden">
              {SLA_POLICY_PRIORITIES.map((priority) => (
                <PolicyMobileGroup
                  key={priority}
                  policies={policiesByPriority.get(priority) || []}
                  priorityLabel={priorityLabel(priority)}
                  formatDuration={formatDuration}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onEdit={startEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <SlaPolicyForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={() => { toast.success(t("savedToast")); void fetchPolicies(true) }}
        initialData={editData}
        existingPolicies={policies}
        orgId={orgId}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(undefined) }}
        onConfirm={handleDelete}
        title={t("deleteTitle")}
        description={deleteTarget ? t("deleteDescription", {
          name: deleteTarget.name,
          companies: deleteTarget._count?.companies || 0,
          entitlements: deleteTarget._count?.entitlements || 0,
        }) : undefined}
      />
    </SupportPageShell>
  )
}

interface PolicyViewProps {
  policy: SlaPolicy
  formatDuration: (value: number) => string
  canWrite: boolean
  canDelete: boolean
  onEdit: (policy: SlaPolicy) => void
  onDelete: (policy: SlaPolicy) => void
}

function PolicyActions({ policy, canWrite, canDelete, onEdit, onDelete }: Omit<PolicyViewProps, "formatDuration">) {
  const t = useTranslations("slaPolicyUi")
  if (!canWrite && !canDelete) return null
  const blocked = (policy._count?.entitlements || 0) > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid={`sla-policy-actions-${policy.id}`} variant="ghost" size="icon" className="h-11 w-11" aria-label={t("actionsNamed", { name: policy.name })}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canWrite && <DropdownMenuItem data-testid={`sla-policy-edit-${policy.id}`} className="min-h-11" onSelect={() => onEdit(policy)}><Pencil />{t("editAction")}</DropdownMenuItem>}
        {canWrite && canDelete && <DropdownMenuSeparator />}
        {canDelete && (
          <DropdownMenuItem
            className="min-h-11 text-destructive focus:text-destructive"
            disabled={blocked}
            data-testid={`sla-policy-delete-${policy.id}`}
            onSelect={() => onDelete(policy)}
          >
            <Trash2 />{blocked ? t("deleteBlockedAction") : t("deleteAction")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  const t = useTranslations("slaPolicyUi")
  return (
    <Badge variant={active ? "outline" : "secondary"} className="gap-1">
      {active ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {active ? t("activeStatus") : t("inactiveStatus")}
    </Badge>
  )
}

type PolicyGroupProps = Omit<PolicyViewProps, "policy"> & { policies: SlaPolicy[]; priorityLabel: string }

function PolicyTableGroup({ policies, priorityLabel, formatDuration, canWrite, canDelete, onEdit, onDelete }: PolicyGroupProps) {
  const t = useTranslations("slaPolicyUi")
  if (policies.length === 0) {
    return (
      <tbody className="border-b last:border-b-0">
        <tr>
          <th scope="row" className="px-3 py-4 text-left font-medium">{priorityLabel}</th>
          <td colSpan={6} className="px-3 py-4 text-muted-foreground">{t("unconfiguredPriority")}</td>
        </tr>
      </tbody>
    )
  }
  return (
    <tbody className="border-b last:border-b-0">
      {policies.map((policy, index) => (
        <tr key={policy.id} data-testid="sla-policy-row" data-policy-id={policy.id} data-active={policy.isActive ? "true" : "false"} className={!policy.isActive ? "bg-muted/20 text-muted-foreground" : undefined}>
          {index === 0 && <th scope="rowgroup" rowSpan={policies.length} className="px-3 py-3 text-left align-top font-medium">{priorityLabel}</th>}
          <td className="px-3 py-3"><div className="font-medium">{policy.name}</div><div className="mt-1"><StatusBadge active={policy.isActive} /></div></td>
          <td className="px-3 py-3 font-medium tabular-nums">{formatDuration(policy.firstResponseHours)}</td>
          <td className="px-3 py-3 font-medium tabular-nums">{formatDuration(policy.resolutionHours)}</td>
          <td className="px-3 py-3 text-xs">{policy.businessHoursOnly ? t("businessSchedule") : t("continuousSchedule")}</td>
          <td className="px-3 py-3 text-xs text-muted-foreground">{t("assignmentCounts", { companies: policy._count?.companies || 0, entitlements: policy._count?.entitlements || 0 })}</td>
          <td className="px-2 py-2"><PolicyActions policy={policy} canWrite={canWrite} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} /></td>
        </tr>
      ))}
    </tbody>
  )
}

function PolicyMobileGroup({ policies, priorityLabel, formatDuration, canWrite, canDelete, onEdit, onDelete }: PolicyGroupProps) {
  const t = useTranslations("slaPolicyUi")
  return (
    <section aria-label={priorityLabel} className="p-3">
      <h2 className="text-sm font-semibold">{priorityLabel}</h2>
      {policies.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("unconfiguredPriority")}</p> : (
        <div className="mt-2 space-y-2">
          {policies.map((policy) => (
            <article key={policy.id} data-testid="sla-policy-row" data-policy-id={policy.id} data-active={policy.isActive ? "true" : "false"} className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{policy.name}</p><div className="mt-1"><StatusBadge active={policy.isActive} /></div></div>
                <PolicyActions policy={policy} canWrite={canWrite} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-muted-foreground">{t("firstResponseLabel")}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatDuration(policy.firstResponseHours)}</dd></div>
                <div><dt className="text-muted-foreground">{t("resolutionLabel")}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatDuration(policy.resolutionHours)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{policy.businessHoursOnly ? t("businessSchedule") : t("continuousSchedule")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("assignmentCounts", { companies: policy._count?.companies || 0, entitlements: policy._count?.entitlements || 0 })}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
