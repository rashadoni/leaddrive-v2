"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { formatSlaHours } from "@/lib/format-sla"

interface CompanyFormData {
  name: string
  industry: string
  website: string
  phone: string
  email: string
  address: string
  city: string
  country: string
  status: string
  description: string
  slaPolicyId: string | null
  creditLimit: string
  creditCurrency: string
}

interface SlaPolicyOption {
  id: string
  name: string
  priority: string
  resolutionHours: number
}

interface CompanyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<CompanyFormData> & { id?: string }
  orgId?: string
}

export function CompanyForm({ open, onOpenChange, onSaved, initialData, orgId }: CompanyFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState<CompanyFormData>({
    name: initialData?.name || "",
    industry: initialData?.industry || "",
    website: initialData?.website || "",
    phone: initialData?.phone || "",
    email: initialData?.email || "",
    address: initialData?.address || "",
    city: initialData?.city || "",
    country: initialData?.country || "",
    status: initialData?.status || "prospect",
    description: initialData?.description || "",
    slaPolicyId: (initialData as any)?.slaPolicyId || null,
    creditLimit: (initialData as any)?.creditLimit != null ? String((initialData as any).creditLimit) : "",
    creditCurrency: (initialData as any)?.creditCurrency || "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyOption[]>([])

  useEffect(() => {
    if (open) {
      setForm({
        name: initialData?.name || "",
        industry: initialData?.industry || "",
        website: initialData?.website || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
        address: initialData?.address || "",
        city: initialData?.city || "",
        country: initialData?.country || "",
        status: initialData?.status || "prospect",
        description: initialData?.description || "",
        slaPolicyId: (initialData as any)?.slaPolicyId || null,
        creditLimit: (initialData as any)?.creditLimit != null ? String((initialData as any).creditLimit) : "",
        creditCurrency: (initialData as any)?.creditCurrency || "",
      })
      setError("")
      // Fetch SLA policies
      fetch("/api/v1/sla-policies", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => {
          if (json.success) setSlaPolicies(json.data || [])
        })
        .catch(() => {})
    }
  }, [open, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/companies/${initialData!.id}` : "/api/v1/companies"
      const payload: any = { ...form }
      payload.creditLimit = form.creditLimit.trim() === "" ? null : Number(form.creditLimit)
      payload.creditCurrency = form.creditCurrency.trim() === "" ? null : form.creditCurrency.trim().toUpperCase()
      if (payload.creditLimit !== null && (isNaN(payload.creditLimit) || payload.creditLimit < 0)) {
        throw new Error(tc("invalidNumber") || "Invalid credit limit")
      }
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof CompanyFormData, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("editCompany") : t("addCompany")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{`${tc("name")} *`}</Label>
              <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="industry">{tc("industry")}</Label>
                <Input id="industry" value={form.industry} onChange={(e) => update("industry", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={(e) => update("status", e.target.value)}>
                  <option value="prospect">Prospect</option>
                  <option value="active">{tc("active")}</option>
                  <option value="inactive">{tc("inactive")}</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">{tc("email")}</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="phone">{tc("phone")}</Label>
                <Input id="phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="website">{tc("website")}</Label>
              <Input id="website" value={form.website} onChange={(e) => update("website", e.target.value)} placeholder="https://" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="city">{tc("city")}</Label>
                <Input id="city" value={form.city} onChange={(e) => update("city", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="country">{tc("country")}</Label>
                <Input id="country" value={form.country} onChange={(e) => update("country", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="address">{tc("address")}</Label>
              <Input id="address" value={form.address} onChange={(e) => update("address", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="slaPolicy">{t("slaPolicy")}</Label>
              <Select
                value={form.slaPolicyId || ""}
                onChange={(e) => setForm(f => ({ ...f, slaPolicyId: e.target.value || null }))}
              >
                <option value="">{t("defaultSla")}</option>
                {slaPolicies.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.priority} ({formatSlaHours(p.resolutionHours)})
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div>
                <Label htmlFor="creditLimit">{tc("creditLimit") || "Credit limit"}</Label>
                <Input
                  id="creditLimit" type="number" step="100" min="0"
                  value={form.creditLimit}
                  onChange={(e) => update("creditLimit", e.target.value)}
                  placeholder={tc("creditLimitPlaceholder") || "10000"}
                />
              </div>
              <div>
                <Label htmlFor="creditCurrency">{tc("currency") || "Currency"}</Label>
                <Select
                  value={form.creditCurrency}
                  onChange={(e) => update("creditCurrency", e.target.value)}
                >
                  <option value="">—</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="AZN">AZN</option>
                  <option value="RUB">RUB</option>
                  <option value="GBP">GBP</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="description">{tc("description")}</Label>
              <Textarea id="description" value={form.description} onChange={(e) => update("description", e.target.value)} rows={3} />
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
