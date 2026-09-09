"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ArrowLeft, Plus, Trash2, GitMerge, Loader2, Settings2, X, ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

// ─── Types ────────────────────────────────────────────────────────────────────

type ConditionField = "value" | "type" | "currency"
type ConditionOperator = "gte" | "lte" | "gt" | "lt" | "eq" | "neq" | "in"

type ConditionForm = {
  field: ConditionField
  operator: ConditionOperator
  value: string
}

type ActionForm = {
  actionType: "add_stage" | "skip_stage"
  stageLabel: string
  assigneeUserId: string
  assigneeRole: string
  atPosition: string
  sortOrder: number
}

type RuleAction = {
  id: string
  actionType: string
  stageLabel: string | null
  assigneeUserId: string | null
  assigneeRole: string | null
  atPosition: number | null
  sortOrder: number
}

type Rule = {
  id: string
  name: string
  templateId: string | null
  matchLogic: string
  isActive: boolean
  conditions: unknown[]
  actions: RuleAction[]
  createdAt: string
  template: { id: string; name: string; slug: string } | null
}

type Template = { id: string; name: string; slug: string }

const BLANK_CONDITION: ConditionForm = { field: "value", operator: "gte", value: "" }
const BLANK_ACTION: ActionForm = {
  actionType: "add_stage",
  stageLabel: "",
  assigneeUserId: "",
  assigneeRole: "",
  atPosition: "",
  sortOrder: 0,
}

const SELECT_CLASS =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApprovalRulesPage() {
  const { data: session } = useSession()
  const t = useTranslations("approvalRules")
  useAutoTour("approvalRules")
  const orgId = session?.user?.organizationId
  const userRole = (session?.user as { role?: string })?.role

  const canWrite = userRole === "admin" || userRole === "manager" || userRole === "superadmin"

  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState("")
  const [formTemplateId, setFormTemplateId] = useState<string>("")
  const [formMatchLogic, setFormMatchLogic] = useState<"all" | "any">("all")
  const [formIsActive, setFormIsActive] = useState(true)
  const [formConditions, setFormConditions] = useState<ConditionForm[]>([{ ...BLANK_CONDITION }])
  const [formActions, setFormActions] = useState<ActionForm[]>([{ ...BLANK_ACTION }])

  const headers: Record<string, string> = orgId
    ? { "x-organization-id": String(orgId) }
    : {}

  const fetchRules = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const res = await fetch("/api/v1/contract-approval-rules", { headers })
      const json = await res.json()
      if (json.success) setRules(json.data)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const fetchTemplates = useCallback(async () => {
    if (!orgId) return
    const res = await fetch("/api/v1/contract-templates?limit=100", { headers })
    const json = await res.json()
    if (json.success) setTemplates(json.data.templates ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    fetchRules()
    fetchTemplates()
  }, [fetchRules, fetchTemplates])

  function openCreate() {
    setEditingRule(null)
    setFormName("")
    setFormTemplateId("")
    setFormMatchLogic("all")
    setFormIsActive(true)
    setFormConditions([{ ...BLANK_CONDITION }])
    setFormActions([{ ...BLANK_ACTION }])
    setSaveError(null)
    setEditorOpen(true)
  }

  function openEdit(rule: Rule) {
    setEditingRule(rule)
    setFormName(rule.name)
    setFormTemplateId(rule.templateId ?? "")
    setFormMatchLogic((rule.matchLogic as "all" | "any") || "all")
    setFormIsActive(rule.isActive)
    setFormConditions(
      Array.isArray(rule.conditions) && rule.conditions.length > 0
        ? rule.conditions.map((c) => {
            const cond = c as Record<string, unknown>
            return {
              field: (cond.field ?? "value") as ConditionField,
              operator: (cond.operator ?? "gte") as ConditionOperator,
              value: Array.isArray(cond.value) ? (cond.value as string[]).join(", ") : String(cond.value ?? ""),
            }
          })
        : [{ ...BLANK_CONDITION }],
    )
    setFormActions(
      rule.actions.map((a) => ({
        actionType: a.actionType as "add_stage" | "skip_stage",
        stageLabel: a.stageLabel ?? "",
        assigneeUserId: a.assigneeUserId ?? "",
        assigneeRole: a.assigneeRole ?? "",
        atPosition: a.atPosition != null ? String(a.atPosition) : "",
        sortOrder: a.sortOrder,
      })),
    )
    setSaveError(null)
    setEditorOpen(true)
  }

  function parseConditionValue(cond: ConditionForm): number | string | string[] {
    const NUMERIC_OPERATORS: ConditionOperator[] = ["gte", "lte", "gt", "lt"]
    if (cond.operator === "in") {
      return cond.value.split(",").map((s) => s.trim()).filter(Boolean)
    }
    if (NUMERIC_OPERATORS.includes(cond.operator)) {
      const n = parseFloat(cond.value)
      return isNaN(n) ? cond.value : n
    }
    return cond.value
  }

  async function handleSave() {
    if (!formName.trim()) {
      setSaveError(t("errorNameRequired"))
      return
    }
    const hasBlankAction = formActions.some((a) => !a.stageLabel.trim())
    if (hasBlankAction) {
      setSaveError(t("errorActionLabelRequired"))
      return
    }

    setSaving(true)
    setSaveError(null)

    const payload = {
      name: formName.trim(),
      templateId: formTemplateId || null,
      matchLogic: formMatchLogic,
      isActive: formIsActive,
      conditions: formConditions
        .filter((c) => c.value.trim() !== "")
        .map((c) => ({
          field: c.field,
          operator: c.operator,
          value: parseConditionValue(c),
        })),
      actions: formActions.map((a, i) => ({
        actionType: a.actionType,
        stageLabel: a.stageLabel.trim() || null,
        assigneeUserId: a.assigneeUserId.trim() || null,
        assigneeRole: a.assigneeRole.trim() || null,
        atPosition: a.atPosition.trim() ? parseInt(a.atPosition) : null,
        sortOrder: i,
      })),
    }

    try {
      const url = editingRule
        ? `/api/v1/contract-approval-rules/${editingRule.id}`
        : "/api/v1/contract-approval-rules"
      const method = editingRule ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? t("errorSave"))
        return
      }
      setEditorOpen(false)
      await fetchRules()
    } catch {
      setSaveError(t("errorSave"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(rule: Rule) {
    if (!canWrite) return
    await fetch(`/api/v1/contract-approval-rules/${rule.id}`, {
      method: "DELETE",
      headers,
    })
    await fetchRules()
  }

  function updateCondition(i: number, patch: Partial<ConditionForm>) {
    setFormConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function removeCondition(i: number) {
    setFormConditions((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateAction(i: number, patch: Partial<ActionForm>) {
    setFormActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  function removeAction(i: number) {
    setFormActions((prev) => prev.filter((_, idx) => idx !== i))
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div data-tour-id="approval-rules-header">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="h-6 w-6 text-primary" />
            {t("title")}
            <TourReplayButton tourId="approvalRules" />
            <HelpButton slug="approval-rules" variant="label" />
          </h1>
        </div>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        <PageDescription text={t("pageDescription")} />
      </div>

      {canWrite && (
        <div className="flex justify-end">
          <Button data-tour-id="approval-rules-new" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addRule")}
          </Button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <Card data-tour-id="approval-rules-list">
          <CardContent className="py-10 text-center text-muted-foreground">
            <GitMerge className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{t("empty")}</p>
            <p className="text-sm mt-1">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div data-tour-id="approval-rules-list" className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="border">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{rule.name}</span>
                      <Badge variant={rule.isActive ? "default" : "secondary"}>
                        {rule.isActive ? t("active") : t("inactive")}
                      </Badge>
                      {rule.template && (
                        <Badge variant="outline" className="text-xs">
                          {rule.template.name}
                        </Badge>
                      )}
                      {!rule.templateId && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t("orgWide")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t("matchLogicLabel")}:{" "}
                      <strong>{rule.matchLogic === "any" ? t("matchAny") : t("matchAll")}</strong>
                      {" · "}
                      {t("conditionsCount", { count: Array.isArray(rule.conditions) ? rule.conditions.length : 0 })}
                      {" · "}
                      {t("actionsCount", { count: rule.actions?.length ?? 0 })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                    >
                      {expandedId === rule.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        {rule.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeactivate(rule)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {expandedId === rule.id && (
                  <div className="mt-4 space-y-3 border-t pt-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                        {t("conditions")} ({rule.matchLogic === "any" ? t("matchAny") : t("matchAll")})
                      </p>
                      {!Array.isArray(rule.conditions) || rule.conditions.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">{t("noConditions")}</p>
                      ) : (
                        <ul className="space-y-1">
                          {rule.conditions.map((c, i) => {
                            const cond = c as Record<string, unknown>
                            return (
                              <li key={i} className="text-sm font-mono bg-muted/40 rounded px-2 py-0.5">
                                {String(cond.field)} {String(cond.operator)}{" "}
                                {Array.isArray(cond.value) ? (cond.value as string[]).join(", ") : String(cond.value)}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                        {t("actions")}
                      </p>
                      <ul className="space-y-1">
                        {rule.actions.map((a) => (
                          <li key={a.id} className="text-sm flex items-center gap-2">
                            <Badge
                              variant={a.actionType === "add_stage" ? "default" : "destructive"}
                              className="text-xs"
                            >
                              {a.actionType === "add_stage" ? t("actionAdd") : t("actionSkip")}
                            </Badge>
                            <span>{a.stageLabel ?? "—"}</span>
                            {a.atPosition != null && (
                              <span className="text-muted-foreground text-xs">
                                @ {t("position")} {a.atPosition}
                              </span>
                            )}
                            {a.assigneeRole && (
                              <span className="text-muted-foreground text-xs">({a.assigneeRole})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? t("editRule") : t("createRule")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>{t("nameLabel")} *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>

            {/* Template scope */}
            <div className="space-y-1.5">
              <Label>{t("templateScope")}</Label>
              <select
                className={`${SELECT_CLASS} w-full`}
                value={formTemplateId}
                onChange={(e) => setFormTemplateId(e.target.value)}
              >
                <option value="">{t("orgWide")}</option>
                {templates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                ))}
              </select>
            </div>

            {/* Match logic */}
            <div className="space-y-1.5">
              <Label>{t("matchLogicLabel")}</Label>
              <select
                className={`${SELECT_CLASS} w-full`}
                value={formMatchLogic}
                onChange={(e) => setFormMatchLogic(e.target.value as "all" | "any")}
              >
                <option value="all">{t("matchAll")} (AND)</option>
                <option value="any">{t("matchAny")} (OR)</option>
              </select>
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formIsActive}
                onChange={(e) => setFormIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="isActive" className="cursor-pointer">{t("isActiveLabel")}</Label>
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("conditions")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFormConditions((prev) => [...prev, { ...BLANK_CONDITION }])}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("addCondition")}
                </Button>
              </div>
              {formConditions.length === 0 && (
                <p className="text-sm text-muted-foreground italic">{t("noConditionsHint")}</p>
              )}
              {formConditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <select
                    className={`${SELECT_CLASS} w-32`}
                    value={cond.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value as ConditionField })}
                  >
                    <option value="value">{t("fieldValue")}</option>
                    <option value="type">{t("fieldType")}</option>
                    <option value="currency">{t("fieldCurrency")}</option>
                  </select>

                  <select
                    className={`${SELECT_CLASS} w-24`}
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOperator })}
                  >
                    <option value="gte">gte (&gt;=)</option>
                    <option value="lte">lte (&lt;=)</option>
                    <option value="gt">gt (&gt;)</option>
                    <option value="lt">lt (&lt;)</option>
                    <option value="eq">eq (=)</option>
                    <option value="neq">neq (≠)</option>
                    <option value="in">in</option>
                  </select>

                  <Input
                    className="flex-1 min-w-[100px]"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder={cond.operator === "in" ? "val1, val2, ..." : t("conditionValuePlaceholder")}
                  />

                  <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("actions")} *</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormActions((prev) => [...prev, { ...BLANK_ACTION, sortOrder: prev.length }])
                  }
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("addAction")}
                </Button>
              </div>
              {formActions.map((action, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <select
                      className={`${SELECT_CLASS} w-36`}
                      value={action.actionType}
                      onChange={(e) =>
                        updateAction(i, { actionType: e.target.value as "add_stage" | "skip_stage" })
                      }
                    >
                      <option value="add_stage">{t("actionAdd")}</option>
                      <option value="skip_stage">{t("actionSkip")}</option>
                    </select>
                    {formActions.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAction(i)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("stageLabelLabel")} *</Label>
                      <Input
                        value={action.stageLabel}
                        onChange={(e) => updateAction(i, { stageLabel: e.target.value })}
                        placeholder={t("stageLabelPlaceholder")}
                      />
                    </div>
                    {action.actionType === "add_stage" && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("atPositionLabel")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={action.atPosition}
                          onChange={(e) => updateAction(i, { atPosition: e.target.value })}
                          placeholder={t("atPositionPlaceholder")}
                        />
                      </div>
                    )}
                  </div>

                  {action.actionType === "add_stage" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("assigneeRole")}</Label>
                        <Input
                          value={action.assigneeRole}
                          onChange={(e) => updateAction(i, { assigneeRole: e.target.value })}
                          placeholder="manager, director..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
