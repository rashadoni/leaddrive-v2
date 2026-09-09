"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Plus, X } from "lucide-react"

interface RouteFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: any
  orgId?: string
}

export function MtmRouteForm({ open, onOpenChange, onSaved, initialData, orgId }: RouteFormProps) {
  const tc = useTranslations("common")
  const tf = useTranslations("mtmForms")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({ name: "", agentId: "", date: "", status: "PLANNED", notes: "" })
  const [points, setPoints] = useState<{ customerId: string }[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        name: initialData?.name || "", agentId: initialData?.agentId || "",
        date: initialData?.date ? new Date(initialData.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        status: initialData?.status || "PLANNED", notes: initialData?.notes || "",
      })
      setPoints(initialData?.points?.map((p: any) => ({ customerId: p.customerId || p.customer?.id || "" })) || [])
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
    // Past-date guard. HTML5 date input shows local locale format
    // (DD.MM.YYYY in az/ru, MM/DD/YYYY in en) but submits the same ISO
    // YYYY-MM-DD value to the server. Real-world bug: an admin in az
    // locale typed "14.04.2026" intending today (May 14) but the date
    // input read it as April 14, the route landed in the past, and the
    // mobile (which filters out past-dated routes) showed nothing new.
    // One confirm prompt costs less than the debugging session this
    // mistake just caused.
    const todayIso = new Date().toISOString().split("T")[0]
    if (form.date && form.date < todayIso) {
      const ok = window.confirm(
        `${tf("dateInPastWarning") || "This date is in the past"}: ${form.date}.\n\n${tf("dateInPastContinue") || "Continue anyway? Mobile will not display a route with a past date."}`,
      )
      if (!ok) { setSaving(false); return }
    }
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/mtm/routes/${initialData!.id}` : "/api/v1/mtm/routes"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({
          ...form,
          points: points.filter(p => p.customerId),
          ...(isEdit ? { expectedVersion: initialData?.version } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editRoute") : tf("addRoute")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div><Label htmlFor="name">{tf("routeName")}</Label><Input id="name" value={form.name} onChange={e => update("name", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="agentId">{`${tf("agent")} *`}</Label>
                <Select value={form.agentId} onChange={e => update("agentId", e.target.value)} required>
                  <option value="">{tf("selectAgent")}</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </div>
              <div><Label htmlFor="date">{`${tc("date")} *`}</Label><Input id="date" type="date" value={form.date} onChange={e => update("date", e.target.value)} required /></div>
            </div>
            {isEdit && (
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={e => update("status", e.target.value)}>
                  <option value="PLANNED">{tf("planned")}</option>
                  <option value="IN_PROGRESS">{tf("inProgress")}</option>
                  <option value="COMPLETED">{tf("completed")}</option>
                  <option value="CANCELLED">{tf("cancelled")}</option>
                </Select>
              </div>
            )}
            <div>
              <Label>{tf("routePoints")}</Label>
              <div className="space-y-2 mt-1">
                {points.map((point, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                    <Select value={point.customerId} onChange={e => { const np = [...points]; np[idx] = { customerId: e.target.value }; setPoints(np) }} className="flex-1">
                      <option value="">{tf("selectCustomer")}</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.code ? `(${c.code})` : ""}</option>)}
                    </Select>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setPoints(points.filter((_, i) => i !== idx))}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setPoints([...points, { customerId: "" }])}><Plus className="h-3.5 w-3.5 mr-1" /> {tf("addPoint")}</Button>
              </div>
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
