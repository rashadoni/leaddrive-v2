"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { useTranslations } from "next-intl"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"

interface ContractFormData {
  contractNumber: string
  title: string
  companyId: string
  dealId: string
  contactId: string
  type: string
  status: string
  startDate: string
  endDate: string
  valueAmount: string
  currency: string
  notes: string
}

interface Company {
  id: string
  name: string
}

interface DealOption {
  id: string
  name: string
}

interface ContactOption {
  id: string
  fullName: string
}

interface ContractFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<ContractFormData> & { id?: string }
  orgId?: string
}

export function ContractForm({ open, onOpenChange, onSaved, initialData, orgId }: ContractFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const tct = useTranslations("contracts")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState<ContractFormData>({
    contractNumber: "",
    title: "",
    companyId: "",
    dealId: "",
    contactId: "",
    type: "service_agreement",
    status: "draft",
    startDate: "",
    endDate: "",
    valueAmount: "",
    currency: DEFAULT_CURRENCY,
    notes: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [companies, setCompanies] = useState<Company[]>([])
  const [deals, setDeals] = useState<DealOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const statusLabels: Record<string, string> = {
    draft: tct("statusDraft"),
    pending_approval: tct("statusPendingApproval"),
    approved: tct("statusApproved"),
    active: tct("statusActive"),
    renewing: tct("statusRenewing"),
    renewed: tct("statusRenewed"),
    expired: tct("statusExpired"),
    terminated: tct("statusTerminated"),
    rejected: tct("statusRejected"),
    cancelled: tct("statusCancelled"),
  }

  useEffect(() => {
    if (open && orgId) {
      const headers = { "x-organization-id": String(orgId) }
      fetch("/api/v1/companies?limit=500&category=all", { headers })
        .then(r => r.json()).then(j => {
          if (j.success) setCompanies(j.data.companies || [])
        }).catch(() => {})
      fetch("/api/v1/deals?limit=500", { headers })
        .then(r => r.json()).then(j => {
          if (j.success) setDeals(j.data.deals || [])
        }).catch(() => {})
      fetch("/api/v1/contacts?limit=500", { headers })
        .then(r => r.json()).then(j => {
          if (j.success) setContacts(j.data.contacts || [])
        }).catch(() => {})
    }
  }, [open, orgId])

  useEffect(() => {
    if (open) {
      const sd = initialData?.startDate ? new Date(initialData.startDate).toISOString().split("T")[0] : ""
      const ed = initialData?.endDate ? new Date(initialData.endDate).toISOString().split("T")[0] : ""
      setForm({
        contractNumber: initialData?.contractNumber || "",
        title: initialData?.title || "",
        companyId: initialData?.companyId || "",
        dealId: initialData?.dealId || "",
        contactId: initialData?.contactId || "",
        type: initialData?.type || "service_agreement",
        status: initialData?.status || "draft",
        startDate: sd,
        endDate: ed,
        valueAmount: initialData?.valueAmount || "",
        currency: initialData?.currency || DEFAULT_CURRENCY,
        notes: initialData?.notes || "",
      })
      setError("")
    }
  }, [open, initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/contracts/${initialData!.id}` : "/api/v1/contracts"
      const payload = {
        contractNumber: form.contractNumber,
        title: form.title,
        companyId: form.companyId || undefined,
        dealId: form.dealId || undefined,
        contactId: form.contactId || undefined,
        type: form.type,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        valueAmount: form.valueAmount ? parseFloat(String(form.valueAmount)) : undefined,
        currency: form.currency,
        notes: form.notes,
        ...(isEdit ? {} : { status: "draft" }),
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
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof ContractFormData, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("editContract") : t("newContract")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="contractNumber">{t("contractNumber")}</Label>
                <Input id="contractNumber" value={form.contractNumber} onChange={(e) => update("contractNumber", e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="title">{tc("name")} *</Label>
                <Input id="title" value={form.title} onChange={(e) => update("title", e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="companyId">{tc("company")}</Label>
              <SearchableSelect
                id="companyId"
                value={form.companyId}
                onValueChange={(v) => update("companyId", v)}
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={tc("notSelected")}
                searchPlaceholder={tc("searchEntity")}
                noResultsLabel={tc("noResults")}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dealId">{tc("deal")}</Label>
                <SearchableSelect
                  id="dealId"
                  value={form.dealId}
                  onValueChange={(v) => update("dealId", v)}
                  options={deals.map((d) => ({ value: d.id, label: d.name }))}
                  placeholder={tc("notSelected")}
                  searchPlaceholder={tc("searchEntity")}
                  noResultsLabel={tc("noResults")}
                />
              </div>
              <div>
                <Label htmlFor="contactId">{tc("contact")}</Label>
                <SearchableSelect
                  id="contactId"
                  value={form.contactId}
                  onValueChange={(v) => update("contactId", v)}
                  options={contacts.map((c) => ({ value: c.id, label: c.fullName }))}
                  placeholder={tc("notSelected")}
                  searchPlaceholder={tc("searchEntity")}
                  noResultsLabel={tc("noResults")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="type">{tc("type")}</Label>
                <Select value={form.type} onChange={(e) => update("type", e.target.value)}>
                  <option value="service_agreement">{tct("typeService")}</option>
                  <option value="nda">{tct("typeNda")}</option>
                  <option value="maintenance">{tct("typeMaintenance")}</option>
                  <option value="license">{tct("typeLicense")}</option>
                  <option value="sla">{tct("typeSla")}</option>
                  <option value="other">{tc("other")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Input id="status" value={statusLabels[form.status] ?? form.status} readOnly />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="startDate">{tc("startDate")}</Label>
                <Input id="startDate" type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="endDate">{tc("endDate")}</Label>
                <Input id="endDate" type="date" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="valueAmount">{tc("amount")}</Label>
                <Input id="valueAmount" type="number" step="0.01" value={form.valueAmount} onChange={(e) => update("valueAmount", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="currency">{tc("currency")}</Label>
                <Select value={form.currency} onChange={(e) => update("currency", e.target.value)}>
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <option key={code} value={code}>{code} ({sym})</option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="notes">{tc("notes")}</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} />
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
