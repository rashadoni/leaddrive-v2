"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

interface VisitFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: any
  orgId?: string
}

export function MtmVisitForm({ open, onOpenChange, onSaved, initialData, orgId }: VisitFormProps) {
  const tc = useTranslations("common")
  const tf = useTranslations("mtmForms")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({ agentId: "", customerId: "", status: "CHECKED_IN", notes: "", latitude: "", longitude: "" })
  const [agents, setAgents] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        agentId: initialData?.agentId || "", customerId: initialData?.customerId || "",
        status: initialData?.status || "CHECKED_IN", notes: initialData?.notes || "",
        latitude: initialData?.checkInLat?.toString() || "", longitude: initialData?.checkInLng?.toString() || "",
      })
      setError("")
      const headers = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
      Promise.all([
        fetch("/api/v1/mtm/agents?limit=200", { headers }).then(r => r.json()),
        fetch("/api/v1/mtm/customers?limit=200", { headers }).then(r => r.json()),
      ]).then(([a, c]) => {
        if (a.success) setAgents(a.data.agents || [])
        if (c.success) setCustomers(c.data.customers || [])
      }).catch(() => {})
    }
  }, [open, initialData])

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/mtm/visits/${initialData!.id}` : "/api/v1/mtm/visits"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader><DialogTitle>{isEdit ? tf("editVisit") : tf("logVisit")}</DialogTitle></DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="agentId">{`${tf("agent")} *`}</Label>
                <Select value={form.agentId} onChange={e => update("agentId", e.target.value)} required>
                  <option value="">{tf("selectAgent")}</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="customerId">{`${tf("customer")} *`}</Label>
                <Select value={form.customerId} onChange={e => update("customerId", e.target.value)} required>
                  <option value="">{tf("selectCustomer")}</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            </div>
            {isEdit && (
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={e => update("status", e.target.value)}>
                  <option value="CHECKED_IN">{tf("checkedIn")}</option>
                  <option value="CHECKED_OUT">{tf("checkedOut")}</option>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="latitude">{tf("latitude")}</Label><Input id="latitude" type="number" step="any" value={form.latitude} onChange={e => update("latitude", e.target.value)} /></div>
              <div><Label htmlFor="longitude">{tf("longitude")}</Label><Input id="longitude" type="number" step="any" value={form.longitude} onChange={e => update("longitude", e.target.value)} /></div>
            </div>
            <div><Label htmlFor="notes">{tc("notes")}</Label><Textarea id="notes" value={form.notes} onChange={e => update("notes", e.target.value)} rows={2} /></div>
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
