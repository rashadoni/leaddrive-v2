"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Shield, Save, Loader2, RotateCcw, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

const ENTITY_TYPES = [
  { value: "company", labelKey: "reportBuilder.entityCompanies" },
  { value: "contact", labelKey: "reportBuilder.entityContacts" },
  { value: "deal", labelKey: "reportBuilder.entityDeals" },
  { value: "lead", labelKey: "reportBuilder.entityLeads" },
  { value: "ticket", labelKey: "reportBuilder.entityTickets" },
]

const ENTITY_LABEL_KEY: Record<string, string> = {
  company: "reportBuilder.entityCompanies",
  contact: "reportBuilder.entityContacts",
  deal: "reportBuilder.entityDeals",
  lead: "reportBuilder.entityLeads",
  ticket: "reportBuilder.entityTickets",
}

const ROLES = ["admin", "manager", "sales", "support", "viewer"]

const ACCESS_OPTIONS = [
  { value: "editable", labelKey: "fieldPermissions.accessEditable", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
  { value: "visible", labelKey: "fieldPermissions.accessVisible", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
  { value: "hidden", labelKey: "fieldPermissions.accessHidden", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
]

interface SharingRule {
  id: string
  entityType: string
  name: string
  description?: string
  ruleType: string
  sourceRole?: string
  targetRole?: string
  accessLevel: string
  isActive: boolean
}

export default function FieldPermissionsPage() {
  const t = useTranslations()
  useAutoTour("fieldPermissions")

  const [entityType, setEntityType] = useState("company")
  const [matrix, setMatrix] = useState<Record<string, Record<string, string>>>({})
  const [fields, setFields] = useState<{ name: string; label: string; labelKey?: string; sensitive?: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changes, setChanges] = useState<Record<string, Record<string, string>>>({})

  // Sharing rules state
  const [rules, setRules] = useState<SharingRule[]>([])
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<SharingRule | null>(null)
  const [ruleForm, setRuleForm] = useState({
    entityType: "deal", name: "", description: "", ruleType: "role",
    sourceRole: "", targetRole: "", accessLevel: "read",
  })
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null)

  const loadPermissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/settings/field-permissions?entityType=${entityType}`)
      const data = await res.json()
      if (data.success) {
        setMatrix(data.data[entityType] || {})
        // Get field definitions from response keys or fetch entity-fields
        const fieldNames = Object.keys(data.data[entityType] || {})
        if (fieldNames.length > 0) {
          setFields(fieldNames.map(n => ({ name: n, label: n })))
        }
      }
      // Also load field definitions
      const fieldsModule = await import("@/lib/entity-fields")
      setFields(fieldsModule.ENTITY_FIELDS[entityType] || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [entityType])

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/sharing-rules")
      const data = await res.json()
      if (data.success) setRules(data.data)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => { loadPermissions() }, [loadPermissions])
  useEffect(() => { loadRules() }, [loadRules])

  const getAccess = (fieldName: string, roleId: string) => {
    return changes[fieldName]?.[roleId] ?? matrix[fieldName]?.[roleId] ?? "editable"
  }

  const setAccess = (fieldName: string, roleId: string, access: string) => {
    if (roleId === "admin") return // Admin always editable
    setChanges(prev => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], [roleId]: access },
    }))
  }

  const cycleAccess = (fieldName: string, roleId: string) => {
    const current = getAccess(fieldName, roleId)
    const cycle = ["editable", "visible", "hidden"]
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length]
    setAccess(fieldName, roleId, next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updates: { roleId: string; entityType: string; fieldName: string; access: string }[] = []
      for (const [fieldName, roles] of Object.entries(changes)) {
        for (const [roleId, access] of Object.entries(roles)) {
          updates.push({ roleId, entityType, fieldName, access })
        }
      }
      if (updates.length === 0) return

      const res = await fetch("/api/v1/settings/field-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (data.success) {
        setChanges({})
        loadPermissions()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRule = async () => {
    try {
      const url = editingRule
        ? `/api/v1/settings/sharing-rules/${editingRule.id}`
        : "/api/v1/settings/sharing-rules"
      const method = editingRule ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleForm),
      })
      if (res.ok) {
        setRuleDialogOpen(false)
        setEditingRule(null)
        loadRules()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleDeleteRule = async () => {
    if (!deleteRuleId) return
    try {
      await fetch(`/api/v1/settings/sharing-rules/${deleteRuleId}`, { method: "DELETE" })
      setDeleteRuleId(null)
      loadRules()
    } catch (e) {
      console.error(e)
    }
  }

  const toggleRuleActive = async (rule: SharingRule) => {
    try {
      await fetch(`/api/v1/settings/sharing-rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      })
      loadRules()
    } catch (e) {
      console.error(e)
    }
  }

  const getAccessBadge = (access: string) => {
    const opt = ACCESS_OPTIONS.find(o => o.value === access)
    return opt || ACCESS_OPTIONS[0]
  }

  const roleLabel = (role: string) =>
    t.has(`fieldPermissions.role.${role}`) ? t(`fieldPermissions.role.${role}`) : role
  const entityLabel = (et: string) =>
    ENTITY_LABEL_KEY[et] ? t(ENTITY_LABEL_KEY[et]) : et
  const accessLevelLabel = (level: string) =>
    level === "readwrite"
      ? t("fieldPermissions.accessReadWrite")
      : level === "read"
        ? t("fieldPermissions.accessRead")
        : level

  const hasChanges = Object.keys(changes).length > 0

  return (
    <div className="space-y-6">
      <div data-tour-id="perms-header" className="flex items-center gap-2">
        <div className="flex-1">
          <PageDescription
            title={t("fieldPermissions.title")}
            description={t("fieldPermissions.description")}
          />
        </div>
        <TourReplayButton tourId="fieldPermissions" />
        <HelpButton slug="field-permissions" variant="label" />
      </div>

      {/* Permission Matrix */}
      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t("fieldPermissions.matrixTitle")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("fieldPermissions.matrixHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={entityType} onChange={e => { setEntityType(e.target.value); setChanges({}) }} className="w-[180px]">
                {ENTITY_TYPES.map(et => (
                  <option key={et.value} value={et.value}>{t(et.labelKey)}</option>
                ))}
            </Select>
            {hasChanges && (
              <>
                <Button variant="outline" size="sm" onClick={() => setChanges({})}>
                  <RotateCcw className="h-4 w-4 mr-1" /> {t("fieldPermissions.resetDefaults")}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  {t("fieldPermissions.save")}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">{t("fieldPermissions.field")}</th>
                    {ROLES.map(role => (
                      <th key={role} className="text-center py-2 px-2 font-medium capitalize">{roleLabel(role)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map(field => (
                    <tr key={field.name} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3">
                        <span>{field.labelKey && t.has(field.labelKey) ? t(field.labelKey) : field.label}</span>
                        {field.sensitive && (
                          <Badge variant="outline" className="ml-2 text-xs">{t("fieldPermissions.sensitive")}</Badge>
                        )}
                      </td>
                      {ROLES.map(role => {
                        const access = getAccess(field.name, role)
                        const badge = getAccessBadge(access)
                        const isAdmin = role === "admin"
                        const isChanged = changes[field.name]?.[role] !== undefined
                        return (
                          <td key={role} className="text-center py-2 px-2">
                            <button
                              onClick={() => cycleAccess(field.name, role)}
                              disabled={isAdmin}
                              className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-colors ${badge.color} ${isAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-80"} ${isChanged ? "ring-2 ring-primary" : ""}`}
                            >
                              {t(badge.labelKey)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sharing Rules */}
      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{t("fieldPermissions.sharingRules")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("fieldPermissions.sharingRulesHint")}</p>
          </div>
          <Button size="sm" onClick={() => {
            setEditingRule(null)
            setRuleForm({ entityType: "deal", name: "", description: "", ruleType: "role", sourceRole: "", targetRole: "", accessLevel: "read" })
            setRuleDialogOpen(true)
          }}>
            <Plus className="h-4 w-4 mr-1" /> {t("fieldPermissions.newRule")}
          </Button>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Shield className="mb-3 h-9 w-9 text-muted-foreground/40" />
              <p className="font-medium">{t("fieldPermissions.noRules")}</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t("fieldPermissions.noRulesHint")}</p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => {
                  setEditingRule(null)
                  setRuleForm({ entityType: "deal", name: "", description: "", ruleType: "role", sourceRole: "", targetRole: "", accessLevel: "read" })
                  setRuleDialogOpen(true)
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> {t("fieldPermissions.newRule")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                  <div>
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {entityLabel(rule.entityType)} | {rule.ruleType === "all" ? t("fieldPermissions.allUsers") : `${rule.sourceRole ? roleLabel(rule.sourceRole) : "—"} → ${rule.targetRole ? roleLabel(rule.targetRole) : "—"}`} | {accessLevelLabel(rule.accessLevel)}
                    </div>
                    {rule.description && <div className="text-xs text-muted-foreground mt-1">{rule.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleRuleActive(rule)} className="text-muted-foreground hover:text-foreground">
                      {rule.isActive ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5" />}
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => {
                      setEditingRule(rule)
                      setRuleForm({
                        entityType: rule.entityType, name: rule.name, description: rule.description || "",
                        ruleType: rule.ruleType, sourceRole: rule.sourceRole || "", targetRole: rule.targetRole || "",
                        accessLevel: rule.accessLevel,
                      })
                      setRuleDialogOpen(true)
                    }}>
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteRuleId(rule.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRule ? t("fieldPermissions.editRule") : t("fieldPermissions.newSharingRule")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>{t("fieldPermissions.ruleName")}</Label>
              <Input value={ruleForm.name} onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))} placeholder={t("fieldPermissions.ruleNamePlaceholder")} />
              <p className="text-xs text-muted-foreground">{t("fieldPermissions.ruleNameHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fieldPermissions.entityType")}</Label>
              <Select value={ruleForm.entityType} onChange={e => setRuleForm(p => ({ ...p, entityType: e.target.value }))}>
                  {ENTITY_TYPES.map(et => (
                    <option key={et.value} value={et.value}>{t(et.labelKey)}</option>
                  ))}
              </Select>
              <p className="text-xs text-muted-foreground">{t("fieldPermissions.entityTypeHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fieldPermissions.ruleType")}</Label>
              <Select value={ruleForm.ruleType} onChange={e => setRuleForm(p => ({ ...p, ruleType: e.target.value }))}>
                  <option value="owner">{t("fieldPermissions.ruleTypeOwner")}</option>
                  <option value="role">{t("fieldPermissions.ruleTypeRole")}</option>
                  <option value="all">{t("fieldPermissions.ruleTypeAll")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t("fieldPermissions.ruleTypeHint")}</p>
            </div>
            {ruleForm.ruleType === "role" && (
              <>
                <div className="grid gap-1.5">
                  <Label>{t("fieldPermissions.sourceRole")}</Label>
                  <p className="text-xs text-muted-foreground -mt-1">{t("fieldPermissions.sourceRoleDesc")}</p>
                  <Select value={ruleForm.sourceRole} onChange={e => setRuleForm(p => ({ ...p, sourceRole: e.target.value }))}>
                      <option value="">{t("fieldPermissions.selectRole")}</option>
                      {ROLES.filter(r => r !== "admin").map(r => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("fieldPermissions.sourceRoleHint")}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("fieldPermissions.targetRole")}</Label>
                  <p className="text-xs text-muted-foreground -mt-1">{t("fieldPermissions.targetRoleDesc")}</p>
                  <Select value={ruleForm.targetRole} onChange={e => setRuleForm(p => ({ ...p, targetRole: e.target.value }))}>
                      <option value="">{t("fieldPermissions.selectRole")}</option>
                      {ROLES.filter(r => r !== "admin").map(r => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("fieldPermissions.targetRoleHint")}</p>
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label>{t("fieldPermissions.accessLevel")}</Label>
              <Select value={ruleForm.accessLevel} onChange={e => setRuleForm(p => ({ ...p, accessLevel: e.target.value }))}>
                  <option value="read">{t("fieldPermissions.accessRead")}</option>
                  <option value="readwrite">{t("fieldPermissions.accessReadWrite")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t("fieldPermissions.accessLevelHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fieldPermissions.ruleDescription")}</Label>
              <Input value={ruleForm.description} onChange={e => setRuleForm(p => ({ ...p, description: e.target.value }))} placeholder={t("fieldPermissions.ruleDescriptionPlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>{t("fieldPermissions.cancel")}</Button>
            <Button onClick={handleSaveRule} disabled={!ruleForm.name}>{t("fieldPermissions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteRuleId}
        onOpenChange={() => setDeleteRuleId(null)}
        onConfirm={handleDeleteRule}
        title={t("fieldPermissions.deleteRule")}
        description={t("fieldPermissions.deleteRuleConfirm")}
      />
    </div>
  )
}
