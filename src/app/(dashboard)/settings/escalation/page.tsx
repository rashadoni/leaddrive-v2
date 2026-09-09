"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DataTable } from "@/components/data-table"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2, Loader2, AlertTriangle } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface EscalationRule extends Record<string, unknown> {
  id: string
  name: string
  triggerType: string
  triggerMinutes: number
  level: number
  actions: { type: string; target?: string }[]
  isActive: boolean
  createdAt: string
}

interface RuleFormData {
  name: string
  triggerType: string
  triggerMinutes: number
  level: number
  actionType: string
  actionTarget: string
  isActive: boolean
}

const TRIGGER_KEYS: Record<string, string> = {
  first_response_breach: "firstResponseBreach",
  resolution_breach: "resolutionBreach",
  resolution_warning: "resolutionWarning",
}

const ACTION_KEYS: Record<string, string> = {
  notify: "notify",
  increase_priority: "increasePriority",
  reassign: "reassignTicket",
}

const LEVEL_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  3: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  4: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300",
  5: "bg-red-300 text-red-950 dark:bg-red-900/70 dark:text-red-200",
}

function RuleFormDialog({
  open,
  onOpenChange,
  onSaved,
  orgId,
  t,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  orgId?: string
  t: (key: string) => string
}) {
  const tc = useTranslations("common")
  const [form, setForm] = useState<RuleFormData>({
    name: "",
    triggerType: "first_response_breach",
    triggerMinutes: 0,
    level: 1,
    actionType: "notify",
    actionTarget: "manager",
    isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        name: "",
        triggerType: "first_response_breach",
        triggerMinutes: 0,
        level: 1,
        actionType: "notify",
        actionTarget: "manager",
        isActive: true,
      })
      setError("")
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const actions = [
        {
          type: form.actionType,
          ...(form.actionType === "notify" ? { target: form.actionTarget } : {}),
        },
      ]

      const res = await fetch("/api/v1/escalation-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          name: form.name,
          triggerType: form.triggerType,
          triggerMinutes: form.triggerMinutes,
          level: form.level,
          actions,
          isActive: form.isActive,
        }),
      })
      const json = await res.json().catch((): { error?: string } => ({}))
      if (!res.ok) throw new Error(json.error || tc("errorGeneric"))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("errorGeneric"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{t("createEscalationRule")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">
              {error}
            </div>
          )}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{t("ruleName")} *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("ruleNamePlaceholder")}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("ruleNameHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="triggerType">{t("triggerType")}</Label>
                <Select
                  value={form.triggerType}
                  onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}
                >
                  <option value="first_response_breach">{t("firstResponseBreach")}</option>
                  <option value="resolution_breach">{t("resolutionBreach")}</option>
                  <option value="resolution_warning">{t("resolutionWarning")}</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{t("triggerTypeHint")}</p>
              </div>
              <div>
                <Label htmlFor="level">{t("escalationLevel")}</Label>
                <Input
                  id="level"
                  type="number"
                  min={1}
                  max={5}
                  value={form.level}
                  onChange={(e) => setForm((f) => ({ ...f, level: parseInt(e.target.value) || 1 }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("levelHint")}</p>
              </div>
            </div>
            <div>
              <Label htmlFor="triggerMinutes">
                {form.triggerType === "resolution_warning"
                  ? t("minutesBeforeBreach")
                  : t("minutesAfterBreach")}
              </Label>
              <Input
                id="triggerMinutes"
                type="number"
                min={0}
                value={form.triggerMinutes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, triggerMinutes: parseInt(e.target.value) || 0 }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                {form.triggerType === "resolution_warning"
                  ? t("minutesBeforeHint")
                  : t("minutesAfterHint")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="actionType">{t("action")}</Label>
                <Select
                  value={form.actionType}
                  onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
                >
                  <option value="notify">{t("notify")}</option>
                  <option value="increase_priority">{t("increasePriority")}</option>
                  <option value="reassign">{t("reassignTicket")}</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{t("actionHint")}</p>
              </div>
              {form.actionType === "notify" && (
                <div>
                  <Label htmlFor="actionTarget">{t("notifyTarget")}</Label>
                  <Select
                    value={form.actionTarget}
                    onChange={(e) => setForm((f) => ({ ...f, actionTarget: e.target.value }))}
                  >
                    <option value="manager">{t("managers")}</option>
                    <option value="admin">{t("adminsOnly")}</option>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">{t("notifyTargetHint")}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("creating")}
              </>
            ) : (
              t("createRule")
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export default function EscalationSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("escalationRules")
  const tc = useTranslations("common")
  useAutoTour("escalationSettings")
  const [rules, setRules] = useState<EscalationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<EscalationRule | null>(null)
  const orgId = session?.user?.organizationId

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/escalation-rules", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json().catch(() => ({}))
      if (json.success) setRules(json.data)
    } catch {
      // keep empty
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const handleToggleActive = useCallback(async (rule: EscalationRule) => {
    await fetch(`/api/v1/escalation-rules/${rule.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
      },
      body: JSON.stringify({ isActive: !rule.isActive }),
    })
    fetchRules()
  }, [fetchRules, orgId])

  const confirmDelete = useCallback(async () => {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/escalation-rules/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    const json = await res.json().catch((): { error?: string } => ({}))
    if (!res.ok) throw new Error(json.error || tc("errorDeleteFailed"))
    fetchRules()
  }, [deleteItem, fetchRules, orgId, tc])

  const columns = [
    {
      key: "level",
      label: t("colLevel"),
      sortable: true,
      render: (item: EscalationRule) => (
        <Badge className={LEVEL_COLORS[item.level] || LEVEL_COLORS[3]}>L{item.level}</Badge>
      ),
    },
    {
      key: "name",
      label: t("colRuleName"),
      sortable: true,
      render: (item: EscalationRule) => <span className="font-medium">{item.name}</span>,
    },
    {
      key: "triggerType",
      label: t("colTrigger"),
      render: (item: EscalationRule) => (
        <div>
          <span className="text-sm">{t(TRIGGER_KEYS[item.triggerType] || "firstResponseBreach")}</span>
          {item.triggerMinutes > 0 && (
            <span className="text-xs text-muted-foreground ml-1">
              ({item.triggerMinutes}min)
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      label: t("colActions"),
      render: (item: EscalationRule) => (
        <div className="flex flex-wrap gap-1">
          {item.actions.map((a, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {t(ACTION_KEYS[a.type] || "notify")}
              {a.target ? ` (${a.target})` : ""}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "isActive",
      label: t("colStatus"),
      render: (item: EscalationRule) => (
        <Badge
          className={`cursor-pointer ${
            item.isActive
              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
          onClick={() => handleToggleActive(item)}
        >
          {item.isActive ? t("active") : t("inactive")}
        </Badge>
      ),
    },
    {
      key: "delete",
      label: "",
      render: (item: EscalationRule) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setDeleteItem(item)
            setDeleteOpen(true)
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between" data-tour-id="escalation-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="escalation" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3" data-tour-id="escalation-new">
          <TourReplayButton tourId="escalationSettings" />
          <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> {t("newRule")}
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-tour-id="escalation-list">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">{t("noRules")}</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            {t("noRulesDesc")}
          </p>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("createFirstRule")}
          </Button>
        </div>
      ) : (
        <div data-tour-id="escalation-list">
          <DataTable
            data={rules}
            columns={columns}
            searchKey="name"
            searchPlaceholder={t("searchRules")}
          />
        </div>
      )}

      <RuleFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={fetchRules} orgId={orgId} t={t} />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
        title={t("deleteTitle")}
        itemName={deleteItem?.name}
      />
    </div>
  )
}
