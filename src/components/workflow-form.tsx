"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Plus, X } from "lucide-react"

interface Condition {
  field: string
  operator: string
  value: string
}

interface WorkflowFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: {
    id?: string
    name?: string
    entityType?: string
    triggerEvent?: string
    conditions?: any
    isActive?: boolean
  }
  orgId?: string
}

function parseConditions(raw: any): Condition[] {
  if (!raw) return []
  // New format: { rules: [...] }
  if (raw.rules && Array.isArray(raw.rules)) return raw.rules
  // Legacy format: { "field": "value" } → convert
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw).filter(([k]) => k !== "rules")
    if (entries.length > 0) {
      return entries.map(([field, value]) => ({
        field,
        operator: "equals",
        value: String(value),
      }))
    }
  }
  return []
}

export function WorkflowForm({ open, onOpenChange, onSaved, initialData, orgId }: WorkflowFormProps) {
  const t = useTranslations("workflows")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id

  const [name, setName] = useState("")
  const [entityType, setEntityType] = useState("deal")
  const [triggerEvent, setTriggerEvent] = useState("created")
  const [conditions, setConditions] = useState<Condition[]>([])
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setName(initialData?.name || "")
      setEntityType(initialData?.entityType || "deal")
      setTriggerEvent(initialData?.triggerEvent || "created")
      setConditions(parseConditions(initialData?.conditions))
      setIsActive(initialData?.isActive ?? true)
      setError("")
    }
  }, [open, initialData])

  const addCondition = () => {
    setConditions(prev => [...prev, { field: "status", operator: "equals", value: "" }])
  }

  const removeCondition = (index: number) => {
    setConditions(prev => prev.filter((_, i) => i !== index))
  }

  const updateCondition = (index: number, key: keyof Condition, value: string) => {
    setConditions(prev => prev.map((c, i) => i === index ? { ...c, [key]: value } : c))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    const conditionsPayload = conditions.length > 0 ? { rules: conditions } : {}

    try {
      const url = isEdit ? `/api/v1/workflows/${initialData!.id}` : "/api/v1/workflows"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          name,
          entityType,
          triggerEvent,
          conditions: conditionsPayload,
          isActive,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const entityTypes = [
    { value: "deal", label: t("entityDeal") },
    { value: "lead", label: t("entityLead") },
    { value: "ticket", label: t("entityTicket") },
    { value: "task", label: t("entityTask") },
    { value: "contact", label: t("entityContact") },
    { value: "company", label: t("entityCompany") },
  ]

  const triggerEvents = [
    { value: "created", label: t("triggerCreated") },
    { value: "updated", label: t("triggerUpdated") },
    { value: "status_changed", label: t("triggerStatusChanged") },
    { value: "stage_changed", label: t("triggerStageChanged") },
    { value: "assigned", label: t("triggerAssigned") },
    { value: "replied", label: t("triggerReplied") },
  ]

  const conditionFields = [
    { value: "status", label: t("fieldStatus") },
    { value: "stage", label: t("fieldStage") },
    { value: "source", label: t("fieldSource") },
    { value: "assignee", label: t("fieldAssignee") },
    { value: "priority", label: t("fieldPriority") },
    { value: "amount", label: t("fieldAmount") },
  ]

  const operators = [
    { value: "equals", label: t("operatorEquals") },
    { value: "not_equals", label: t("operatorNotEquals") },
    { value: "contains", label: t("operatorContains") },
    { value: "not_empty", label: t("operatorNotEmpty") },
    { value: "greater_than", label: t("operatorGreaterThan") },
    { value: "less_than", label: t("operatorLessThan") },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("editWorkflow") : t("newWorkflow")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            {/* Name */}
            <div>
              <Label className="text-xs text-muted-foreground">{t("ruleName")} *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            {/* Entity Type + Trigger */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("entityType")}</Label>
                <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                  {entityTypes.map(et => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("triggerEvent")}</Label>
                <Select value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
                  {triggerEvents.map(te => (
                    <option key={te.value} value={te.value}>{te.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Conditions Builder */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">{t("conditions")}</Label>
              {conditions.length > 0 && (
                <div className="space-y-2 mb-2">
                  {conditions.map((cond, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        value={cond.field}
                        onChange={(e) => updateCondition(i, "field", e.target.value)}
                        className="flex-1"
                      >
                        {conditionFields.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </Select>
                      <Select
                        value={cond.operator}
                        onChange={(e) => updateCondition(i, "operator", e.target.value)}
                        className="flex-1"
                      >
                        {operators.map(op => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </Select>
                      {cond.operator !== "not_empty" && (
                        <Input
                          value={cond.value}
                          onChange={(e) => updateCondition(i, "value", e.target.value)}
                          placeholder={t("conditionValue")}
                          className="flex-1"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeCondition(i)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={addCondition}>
                <Plus className="h-3 w-3" /> {t("addCondition")}
              </Button>
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
              <span className="text-sm">{t("activeToggle")}</span>
            </label>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
