"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

interface ContactFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Record<string, any>
  orgId?: string
}

export function ContactForm({ open, onOpenChange, onSaved, initialData, orgId }: ContactFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    fullName: initialData?.fullName || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    position: initialData?.position || "",
    companyId: initialData?.companyId || "",
    source: initialData?.source || "",
    brand: initialData?.brand || "",
    category: initialData?.category || "",
    portalAccessEnabled: initialData?.portalAccessEnabled || false,
    preferredLanguage: initialData?.preferredLanguage || "",
  })
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        fullName: initialData?.fullName || "",
        email: initialData?.email || "",
        phone: initialData?.phone || "",
        position: initialData?.position || "",
        companyId: initialData?.companyId || "",
        source: initialData?.source || "",
        brand: initialData?.brand || "",
        category: initialData?.category || "",
        portalAccessEnabled: initialData?.portalAccessEnabled || false,
        preferredLanguage: initialData?.preferredLanguage || "",
      })
      setError("")
    }
  }, [open, initialData])

  useEffect(() => {
    if (open && orgId) {
      fetch("/api/v1/companies?limit=500", {
        headers: { "x-organization-id": orgId },
      }).then(r => r.json()).then(j => {
        if (j.success) setCompanies(j.data.companies.map((c: any) => ({ id: c.id, name: c.name })))
      }).catch(() => {})
    }
  }, [open, orgId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/contacts/${initialData!.id}` : "/api/v1/contacts"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({
          ...form,
          companyId: form.companyId || undefined,
          preferredLanguage: form.preferredLanguage || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) }
    finally { setSaving(false) }
  }

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader><DialogTitle>{isEdit ? t("editContact") : t("addContact")}</DialogTitle></DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="fullName">{`${tc("fullName")} *`}</Label>
              <Input id="fullName" value={form.fullName} onChange={e => update("fullName", e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="email">{tc("email")}</Label><Input id="email" type="email" value={form.email} onChange={e => update("email", e.target.value)} /></div>
              <div><Label htmlFor="phone">{tc("phone")}</Label><Input id="phone" value={form.phone} onChange={e => update("phone", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="position">{tc("position")}</Label><Input id="position" value={form.position} onChange={e => update("position", e.target.value)} /></div>
              <div>
                <Label htmlFor="source">{tc("source")}</Label>
                <Select value={form.source} onChange={e => update("source", e.target.value)}>
                  <option value="">{tc("select")}</option>
                  <option value="website">Website</option>
                  <option value="referral">{tc("referral")}</option>
                  <option value="cold_call">{tc("coldCall")}</option>
                  <option value="linkedin">{tc("linkedin")}</option>
                  <option value="event">{tc("event")}</option>
                  <option value="sms">SMS</option>
                  <option value="social">Social</option>
                  <option value="other">{tc("other")}</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="companyId">{tc("company")}</Label>
              <Select value={form.companyId} onChange={e => update("companyId", e.target.value)}>
                <option value="">{tc("noCompany")}</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brand">Brand</Label>
                <Input id="brand" value={form.brand} onChange={e => update("brand", e.target.value)} placeholder="Product brand" />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={form.category} onChange={e => update("category", e.target.value)}>
                  <option value="">{tc("select")}</option>
                  <option value="vip">VIP</option>
                  <option value="regular">Regular</option>
                  <option value="partner">Partner</option>
                  <option value="prospect">Prospect</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="preferredLanguage">{tc("preferredLanguage") || "Preferred language"}</Label>
              <Select
                value={form.preferredLanguage}
                onChange={e => setForm(f => ({ ...f, preferredLanguage: e.target.value }))}
              >
                <option value="">{tc("useOrgDefault") || "Use org default"}</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
                <option value="az">Azərbaycan</option>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t">
              <input
                type="checkbox"
                id="portalAccess"
                checked={form.portalAccessEnabled}
                onChange={e => setForm(f => ({ ...f, portalAccessEnabled: e.target.checked }))}
                className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700"
              />
              <Label htmlFor="portalAccess" className="text-sm font-normal cursor-pointer">
                {tc("portalAccess")}
              </Label>
            </div>
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
