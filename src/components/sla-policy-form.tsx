"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

interface SlaPolicyInitial {
  id?: string
  name?: string
  priority?: string
  firstResponseHours?: number
  resolutionHours?: number
  businessHoursOnly?: boolean
  isActive?: boolean
}

interface SlaPolicyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: SlaPolicyInitial
  orgId?: string
}

/** Split decimal hours (e.g. 2.5) into whole hours + minutes (2h 30m), carrying a 60-min round-up. */
function splitHM(decimalHours: number): { h: number; m: number } {
  const h = Math.floor(decimalHours)
  const m = Math.round((decimalHours - h) * 60)
  return m === 60 ? { h: h + 1, m: 0 } : { h, m }
}

const clampInt = (v: string, max?: number) => {
  let n = parseInt(v) || 0
  if (n < 0) n = 0
  if (max !== undefined && n > max) n = max
  return n
}

export function SlaPolicyForm({ open, onOpenChange, onSaved, initialData, orgId }: SlaPolicyFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    name: "",
    priority: "medium",
    frHours: 4, frMinutes: 0,
    resHours: 24, resMinutes: 0,
    businessHoursOnly: true,
    isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      const fr = splitHM(initialData?.firstResponseHours ?? 4)
      const res = splitHM(initialData?.resolutionHours ?? 24)
      setForm({
        name: initialData?.name || "",
        priority: initialData?.priority || "medium",
        frHours: fr.h, frMinutes: fr.m,
        resHours: res.h, resMinutes: res.m,
        businessHoursOnly: initialData?.businessHoursOnly ?? true,
        isActive: initialData?.isActive ?? true,
      })
      setError("")
    }
  }, [open, initialData])

  const update = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    const frTotal = form.frHours * 60 + form.frMinutes
    const resTotal = form.resHours * 60 + form.resMinutes
    if (frTotal < 1 || resTotal < 1) {
      setError("Minimum 1 minute — set hours and/or minutes.")
      return
    }
    setSaving(true)
    try {
      const url = isEdit ? `/api/v1/sla-policies/${initialData!.id}` : "/api/v1/sla-policies"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          name: form.name,
          priority: form.priority,
          firstResponseHours: frTotal / 60, // stored as decimal hours (the resolver multiplies by 3600000ms)
          resolutionHours: resTotal / 60,
          businessHoursOnly: form.businessHoursOnly,
          isActive: form.isActive,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editSlaPolicy") : tf("newSlaPolicy")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{tf("policyName")} *</Label>
              <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Critical SLA" required />
            </div>
            <div>
              <Label htmlFor="priority">{tc("priority")}</Label>
              <Select value={form.priority} onChange={(e) => update("priority", e.target.value)}>
                <option value="critical">{tc("critical")}</option>
                <option value="high">{tc("high")}</option>
                <option value="medium">{tc("medium")}</option>
                <option value="low">{tc("low")}</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tf("responseTimeHours")} *</Label>
                <div className="flex items-center gap-1.5">
                  <Input aria-label="hours" type="number" min="0" step="1" value={form.frHours} onChange={(e) => update("frHours", clampInt(e.target.value))} className="w-16" />
                  <span className="text-sm text-muted-foreground">h</span>
                  <Input aria-label="minutes" type="number" min="0" max="59" step="1" value={form.frMinutes} onChange={(e) => update("frMinutes", clampInt(e.target.value, 59))} className="w-16" />
                  <span className="text-sm text-muted-foreground">m</span>
                </div>
              </div>
              <div>
                <Label>{tf("resolutionTimeHours")} *</Label>
                <div className="flex items-center gap-1.5">
                  <Input aria-label="hours" type="number" min="0" step="1" value={form.resHours} onChange={(e) => update("resHours", clampInt(e.target.value))} className="w-16" />
                  <span className="text-sm text-muted-foreground">h</span>
                  <Input aria-label="minutes" type="number" min="0" max="59" step="1" value={form.resMinutes} onChange={(e) => update("resMinutes", clampInt(e.target.value, 59))} className="w-16" />
                  <span className="text-sm text-muted-foreground">m</span>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.businessHoursOnly} onChange={(e) => update("businessHoursOnly", e.target.checked)} className="rounded" />
              <span className="text-sm">{tf("businessHoursOnly")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => update("isActive", e.target.checked)} className="rounded" />
              <span className="text-sm">{tc("active")}</span>
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
