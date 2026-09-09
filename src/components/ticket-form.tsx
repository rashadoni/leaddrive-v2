"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { MessageSquareWarning } from "lucide-react"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"

interface TicketFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Record<string, any>
  orgId?: string
}

interface OptionItem {
  id: string
  label: string
}

export function TicketForm({ open, onOpenChange, onSaved, initialData, orgId }: TicketFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const tt = useTranslations("tickets")
  const ta = useTranslations("aiSettings")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    subject: initialData?.subject || "",
    description: initialData?.description || "",
    priority: initialData?.priority || "medium",
    category: initialData?.category || "general",
    status: initialData?.status || "new",
    contactId: initialData?.contactId || "",
    companyId: initialData?.companyId || "",
    assignedTo: initialData?.assignedTo || "",
  })
  const [asComplaint, setAsComplaint] = useState(false)
  const [complaintMeta, setComplaintMeta] = useState({
    complaintType: "complaint" as "complaint" | "suggestion",
    brand: "",
    productionArea: "",
    productCategory: "",
    complaintObject: "",
    complaintObjectDetail: "",
    responsibleDepartment: "",
    riskLevel: "medium" as "low" | "medium" | "high",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [companies, setCompanies] = useState<OptionItem[]>([])
  const [contacts, setContacts] = useState<OptionItem[]>([])
  const [users, setUsers] = useState<OptionItem[]>([])
  const [aiCategorizing, setAiCategorizing] = useState(false)
  const aiCategorizedRef = useRef(false)
  const {
    enabled: supportAiDisabled,
    loading: supportAiLoading,
    error: supportAiStateError,
  } = useOrganizationFeature(SUPPORT_AI_DISABLED_FEATURE, orgId)
  const supportAiEnabled = !supportAiLoading && !supportAiStateError && !supportAiDisabled

  // AI auto-categorization: fires once when subject has 5+ chars (on blur)
  const tryAiCategorize = useCallback(async () => {
    if (isEdit || aiCategorizedRef.current || !supportAiEnabled) return
    const subjectVal = form.subject.trim()
    if (subjectVal.length < 5) return

    aiCategorizedRef.current = true
    setAiCategorizing(true)
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = orgId
      const res = await fetch("/api/v1/tickets/ai-categorize", {
        method: "POST",
        headers,
        body: JSON.stringify({ subject: subjectVal, description: form.description.trim() }),
      })
      if (res.ok) {
        const { data } = await res.json()
        if (data?.category) setForm(f => ({ ...f, category: data.category }))
        if (data?.priority) setForm(f => ({ ...f, priority: data.priority }))
      }
    } catch {
      // Non-critical — user can always set manually
    } finally {
      setAiCategorizing(false)
    }
  }, [form.subject, form.description, isEdit, orgId, supportAiEnabled])

  useEffect(() => {
    if (open) {
      setForm({
        subject: initialData?.subject || "",
        description: initialData?.description || "",
        priority: initialData?.priority || "medium",
        category: initialData?.category || "general",
        status: initialData?.status || "new",
        contactId: initialData?.contactId || "",
        companyId: initialData?.companyId || "",
        assignedTo: initialData?.assignedTo || "",
      })
      setError("")
      aiCategorizedRef.current = false
      setAsComplaint(initialData?.category === "complaint")
      setComplaintMeta({
        complaintType: "complaint",
        brand: "",
        productionArea: "",
        productCategory: "",
        complaintObject: "",
        complaintObjectDetail: "",
        responsibleDepartment: "",
        riskLevel: "medium",
      })
      loadOptions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData])

  const loadOptions = async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (orgId) headers["x-organization-id"] = orgId

    try {
      const [companiesRes, contactsRes, usersRes] = await Promise.all([
        fetch("/api/v1/companies?limit=200", { headers }).then(r => r.json()).catch(() => ({ data: { companies: [] } })),
        fetch("/api/v1/contacts?limit=200", { headers }).then(r => r.json()).catch(() => ({ data: { contacts: [] } })),
        fetch("/api/v1/users", { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      ])

      setCompanies(
        (companiesRes.data?.companies || companiesRes.data || []).map((c: any) => ({ id: c.id, label: c.name }))
      )
      setContacts(
        (contactsRes.data?.contacts || contactsRes.data || []).map((c: any) => ({ id: c.id, label: c.fullName || c.email }))
      )
      setUsers(
        (usersRes.data || []).map((u: any) => ({ id: u.id, label: u.name || u.fullName || u.email }))
      )
    } catch {
      // Ignore — dropdowns will just be empty
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/tickets/${initialData!.id}` : "/api/v1/tickets"
      const payload: Record<string, any> = {
        subject: form.subject,
        description: form.description,
        priority: form.priority,
        category: form.category,
      }
      if (isEdit) payload.status = form.status
      if (form.contactId) payload.contactId = form.contactId
      if (form.companyId) payload.companyId = form.companyId
      if (form.assignedTo) payload.assignedTo = form.assignedTo

      if (!isEdit && asComplaint) payload.category = "complaint"

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")

      // If user toggled "This is a complaint" on creation, attach ComplaintMeta via the convert endpoint.
      if (!isEdit && asComplaint) {
        const created = await res.json()
        const newId = created?.data?.id
        if (newId) {
          await fetch(`/api/v1/tickets/${newId}/convert-to-complaint`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
            body: JSON.stringify({
              complaintType: complaintMeta.complaintType,
              brand: complaintMeta.brand || null,
              productionArea: complaintMeta.productionArea || null,
              productCategory: complaintMeta.productCategory || null,
              complaintObject: complaintMeta.complaintObject || null,
              complaintObjectDetail: complaintMeta.complaintObjectDetail || null,
              responsibleDepartment: complaintMeta.responsibleDepartment || null,
              riskLevel: complaintMeta.riskLevel,
            }),
          }).catch(() => {})
        }
      }

      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader><DialogTitle>{isEdit ? t("editTicket") : t("newTicket")}</DialogTitle></DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div><Label>{tc("subject")} *</Label><Input value={form.subject} onChange={e => u("subject", e.target.value)} onBlur={tryAiCategorize} required />{aiCategorizing && <p className="text-[10px] text-muted-foreground mt-1 animate-pulse">{ta("aiClassifying")}</p>}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{tc("priority")}</Label><Select value={form.priority} onChange={e => u("priority", e.target.value)}><option value="low">{tc("priorityLow")}</option><option value="medium">{tc("priorityMedium")}</option><option value="high">{tc("priorityHigh")}</option><option value="critical">{tc("priorityCritical")}</option></Select></div>
              <div><Label>{tc("category")}</Label><Select value={form.category} onChange={e => u("category", e.target.value)} disabled={asComplaint || !!initialData?.complaintMeta}><option value="general">{tt("categoryGeneral")}</option><option value="technical">{tt("categoryTechnical")}</option><option value="billing">{tt("categoryBilling")}</option><option value="feature_request">{tt("categoryFeatureRequest")}</option>{(asComplaint || initialData?.category === "complaint") && <option value="complaint">{tt("categoryComplaint")}</option>}</Select></div>
            </div>
            {!isEdit && (
              <label className="flex items-start gap-2 text-sm cursor-pointer p-2 -mx-2 rounded hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={asComplaint}
                  onChange={(e) => setAsComplaint(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <MessageSquareWarning className="h-3.5 w-3.5 text-amber-600" />
                    {t("complaintCheckboxLabel")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("complaintCheckboxDesc")}
                  </span>
                </span>
              </label>
            )}
            {!isEdit && asComplaint && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("complaintType")}</Label>
                    <Select
                      value={complaintMeta.complaintType}
                      onChange={(e) => setComplaintMeta((m) => ({ ...m, complaintType: e.target.value as "complaint" | "suggestion" }))}
                    >
                      <option value="complaint">{t("complaintTypeComplaint")}</option>
                      <option value="suggestion">{t("complaintTypeSuggestion")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("riskLevel")}</Label>
                    <Select
                      value={complaintMeta.riskLevel}
                      onChange={(e) => setComplaintMeta((m) => ({ ...m, riskLevel: e.target.value as "low" | "medium" | "high" }))}
                    >
                      <option value="low">{t("riskLow")}</option>
                      <option value="medium">{t("riskMedium")}</option>
                      <option value="high">{t("riskHigh")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("complaintBrand")}</Label>
                    <Input value={complaintMeta.brand} onChange={(e) => setComplaintMeta((m) => ({ ...m, brand: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{t("productCategory")}</Label>
                    <Input value={complaintMeta.productCategory} onChange={(e) => setComplaintMeta((m) => ({ ...m, productCategory: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{t("complaintObject")}</Label>
                    <Input value={complaintMeta.complaintObject} onChange={(e) => setComplaintMeta((m) => ({ ...m, complaintObject: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{t("responsibleDepartment")}</Label>
                    <Input
                      value={complaintMeta.responsibleDepartment}
                      onChange={(e) => setComplaintMeta((m) => ({ ...m, responsibleDepartment: e.target.value }))}
                      placeholder={t("responsibleDepartmentPlaceholder")}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("complaintExtraHint")}
                </p>
              </div>
            )}
            {isEdit && (
              <div><Label>{tc("status")}</Label><Select value={form.status} onChange={e => u("status", e.target.value)}><option value="new">{tt("statusNew")}</option><option value="in_progress">{tt("statusInProgress")}</option><option value="waiting">{tt("statusWaiting")}</option><option value="resolved">{tt("statusResolved")}</option><option value="closed">{tt("statusClosed")}</option></Select></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tc("company")}</Label>
                <Select value={form.companyId} onChange={e => u("companyId", e.target.value)}>
                  <option value="">— None —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </div>
              <div>
                <Label>Contact</Label>
                <Select value={form.contactId} onChange={e => u("contactId", e.target.value)}>
                  <option value="">— None —</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>{tc("assigned")}</Label>
              <Select value={form.assignedTo} onChange={e => u("assignedTo", e.target.value)}>
                <option value="">— Unassigned —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
              </Select>
            </div>
            <div><Label>{tc("description")}</Label><Textarea value={form.description} onChange={e => u("description", e.target.value)} rows={4} /></div>
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
