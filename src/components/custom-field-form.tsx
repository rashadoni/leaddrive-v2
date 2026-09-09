"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

interface CustomFieldFormData {
  fieldName: string
  fieldLabel: string
  entityType: string
  fieldType: string
  options: string
  isRequired: boolean
  defaultValue: string
}

interface CustomFieldFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<CustomFieldFormData> & { id?: string; options?: unknown }
  orgId?: string
}

export function CustomFieldForm({ open, onOpenChange, onSaved, initialData, orgId }: CustomFieldFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState<CustomFieldFormData>({
    fieldName: "",
    fieldLabel: "",
    entityType: "contact",
    fieldType: "text",
    options: "",
    isRequired: false,
    defaultValue: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      const opts = initialData?.options
      const optionsStr = Array.isArray(opts) ? opts.join(", ") : (typeof opts === "string" ? opts : "")
      setForm({
        fieldName: initialData?.fieldName || "",
        fieldLabel: initialData?.fieldLabel || "",
        entityType: initialData?.entityType || "contact",
        fieldType: initialData?.fieldType || "text",
        options: optionsStr,
        isRequired: initialData?.isRequired ?? false,
        defaultValue: initialData?.defaultValue || "",
      })
      setError("")
    }
  }, [open, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    const optionsArray = form.options
      ? form.options.split(",").map((s) => s.trim()).filter(Boolean)
      : []

    try {
      const url = isEdit ? `/api/v1/custom-fields/${initialData!.id}` : "/api/v1/custom-fields"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          fieldName: form.fieldName,
          fieldLabel: form.fieldLabel,
          entityType: form.entityType,
          fieldType: form.fieldType,
          options: optionsArray,
          isRequired: form.isRequired,
          defaultValue: form.defaultValue || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("error"))
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof CustomFieldFormData>(key: K, value: CustomFieldFormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editCustomField") : tf("newCustomField")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fieldName">{tf("fieldName")} *</Label>
                <Input id="fieldName" value={form.fieldName} onChange={(e) => update("fieldName", e.target.value)} placeholder="custom_source" required />
                <p className="mt-1 text-xs text-muted-foreground">{tf("fieldNameHint")}</p>
              </div>
              <div>
                <Label htmlFor="fieldLabel">{tf("displayLabel")} *</Label>
                <Input id="fieldLabel" value={form.fieldLabel} onChange={(e) => update("fieldLabel", e.target.value)} placeholder="Lead Source" required />
                <p className="mt-1 text-xs text-muted-foreground">{tf("displayLabelHint")}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="entityType">{tf("entityType")}</Label>
                <Select value={form.entityType} onChange={(e) => update("entityType", e.target.value)}>
                  <option value="contact">{tf("entityContact")}</option>
                  <option value="deal">{tf("entityDeal")}</option>
                  <option value="lead">{tf("entityLead")}</option>
                  <option value="company">{tf("entityCompany")}</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{tf("entityTypeHint")}</p>
              </div>
              <div>
                <Label htmlFor="fieldType">{tf("fieldType")}</Label>
                <Select value={form.fieldType} onChange={(e) => update("fieldType", e.target.value)}>
                  <option value="text">{tf("fieldTypeText")}</option>
                  <option value="number">{tf("fieldTypeNumber")}</option>
                  <option value="date">{tf("fieldTypeDate")}</option>
                  <option value="select">{tf("fieldTypeSelect")}</option>
                  <option value="boolean">{tf("fieldTypeBoolean")}</option>
                  <option value="textarea">{tf("fieldTypeTextarea")}</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{tf("fieldTypeHint")}</p>
              </div>
            </div>
            {form.fieldType === "select" && (
              <div>
                <Label htmlFor="options">{tf("optionsCommaSeparated")}</Label>
                <Textarea
                  id="options"
                  value={form.options}
                  onChange={(e) => update("options", e.target.value)}
                  rows={3}
                  placeholder="Option 1, Option 2, Option 3"
                />
                <p className="mt-1 text-xs text-muted-foreground">{tf("optionsHint")}</p>
              </div>
            )}
            <div>
              <Label htmlFor="defaultValue">{tf("defaultValue")}</Label>
              <Input id="defaultValue" value={form.defaultValue} onChange={(e) => update("defaultValue", e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">{tf("defaultValueHint")}</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isRequired} onChange={(e) => update("isRequired", e.target.checked)} className="rounded" />
              <span className="text-sm">{tc("required")}</span>
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">{tf("requiredFieldHint")}</p>
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
