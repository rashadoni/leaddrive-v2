"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { explainMtmApiErrorOr, useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import { Button } from "@/components/ui/button"
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
  const explainError = useMtmApiError()
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({ agentId: "", customerId: "", notes: "" })
  const [agents, setAgents] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        agentId: initialData?.agentId || "", customerId: initialData?.customerId || "",
        notes: initialData?.notes || "",
      })
      setError("")
      const headers = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
      Promise.all([
        fetch("/api/v1/mtm/agents?limit=200", { headers }).then(r => r.json()),
        fetch("/api/v1/mtm/customers?limit=200", { headers }).then(r => r.json()),
      ]).then(([a, c]) => {
        // Without a field card the agent list is refused; say so instead of
        // leaving the dropdown silently empty.
        if (a.success) setAgents(a.data.agents || [])
        else setError(explainError(a))
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
      if (!res.ok) throw new Error(explainMtmApiErrorOr(explainError, json, res.status, json.error || tc("failedToSave")))
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
            {/* Owner 2026-09-25: the agent opens and closes a visit himself, and
                its GPS comes only from his device. The office corrects who,
                where and the note — no status, no coordinates. */}
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
