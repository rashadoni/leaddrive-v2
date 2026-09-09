"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { findSalesPipeline } from "@/lib/pipeline-routing"

interface SalesAssignee {
  id: string
  name: string
  email?: string
}

interface LeadPipeline {
  id: string
  name: string
  isDefault: boolean
  isActive: boolean
}

interface LeadFormInitialData {
  id?: string
  contactName?: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
  phoneWhatsApp?: string | null
  telegramHandle?: string | null
  source?: string | null
  sourceDetail?: string | null
  sourceProfileUrl?: string | null
  interest?: string | null
  brand?: string | null
  category?: string | null
  status?: string
  priority?: string
  estimatedValue?: number | null
  assignedTo?: string | null
  pipelineId?: string | null
  notes?: string | null
}

interface LeadFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: LeadFormInitialData
  orgId?: string
  /**
   * Override the default POST/PUT to /api/v1/leads. Receives the assembled lead
   * payload and must throw on failure (its message is surfaced inline). Used by
   * social-monitoring to route creation through the mention→lead converter so the
   * mention stays atomically linked to the new lead.
   */
  onSubmit?: (payload: Record<string, unknown>) => Promise<void>
}

export function LeadForm({ open, onOpenChange, onSaved, initialData, orgId, onSubmit }: LeadFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    contactName: initialData?.contactName || "",
    companyName: initialData?.companyName || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    phoneWhatsApp: initialData?.phoneWhatsApp || "",
    telegramHandle: initialData?.telegramHandle || "",
    source: initialData?.source || "",
    sourceDetail: initialData?.sourceDetail || "",
    sourceProfileUrl: initialData?.sourceProfileUrl || "",
    interest: initialData?.interest || "",
    brand: initialData?.brand || "",
    category: initialData?.category || "",
    status: initialData?.status || "new",
    priority: initialData?.priority || "medium",
    estimatedValue: String(initialData?.estimatedValue || ""),
    assignedTo: initialData?.assignedTo || "",
    pipelineId: initialData?.pipelineId || "",
    notes: initialData?.notes || "",
  })
  const [salesAssignees, setSalesAssignees] = useState<SalesAssignee[]>([])
  const [pipelines, setPipelines] = useState<LeadPipeline[]>([])
  const [loadingPipelines, setLoadingPipelines] = useState(false)
  const [loadingAssignees, setLoadingAssignees] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        contactName: initialData?.contactName || "",
        companyName: initialData?.companyName || "",
        email: initialData?.email || "",
        phone: initialData?.phone || "",
        phoneWhatsApp: initialData?.phoneWhatsApp || "",
        telegramHandle: initialData?.telegramHandle || "",
        source: initialData?.source || "",
        sourceDetail: initialData?.sourceDetail || "",
        sourceProfileUrl: initialData?.sourceProfileUrl || "",
        interest: initialData?.interest || "",
        brand: initialData?.brand || "",
        category: initialData?.category || "",
        status: initialData?.status || "new",
        priority: initialData?.priority || "medium",
        estimatedValue: String(initialData?.estimatedValue || ""),
        assignedTo: initialData?.assignedTo || "",
        pipelineId: initialData?.pipelineId || "",
        notes: initialData?.notes || "",
      })
      setError("")
    }
  }, [open, initialData])

  useEffect(() => {
    if (!open || isEdit) return

    const controller = new AbortController()
    setLoadingAssignees(true)
    fetch("/api/v1/users/assignable?role=sales", {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok || !body?.success) throw new Error(body?.error || "Failed to load sellers")
        return Array.isArray(body.data) ? body.data : []
      })
      .then((users: SalesAssignee[]) => setSalesAssignees(users))
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return
        setSalesAssignees([])
      })
      .finally(() => setLoadingAssignees(false))

    return () => controller.abort()
  }, [open, isEdit, orgId])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    setLoadingPipelines(true)
    fetch("/api/v1/pipelines", {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok || !body?.success) throw new Error(body?.error || "Failed to load pipelines")
        return Array.isArray(body.data)
          ? (body.data as LeadPipeline[]).filter((pipeline) => pipeline.isActive !== false)
          : []
      })
      .then((available) => {
        setPipelines(available)
        setForm((current) => {
          if (current.pipelineId) return current
          const preferred = findSalesPipeline(available)
            ?? available.find((pipeline) => pipeline.isDefault)
            ?? available[0]
          return preferred ? { ...current, pipelineId: preferred.id } : current
        })
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return
        setPipelines([])
      })
      .finally(() => setLoadingPipelines(false))

    return () => controller.abort()
  }, [open, orgId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const payload = {
        ...form,
        estimatedValue: parseFloat(form.estimatedValue) || undefined,
        assignedTo: isEdit ? undefined : form.assignedTo || undefined,
      }
      if (onSubmit) {
        await onSubmit(payload)
      } else {
        const url = isEdit ? `/api/v1/leads/${initialData!.id}` : "/api/v1/leads"
        const res = await fetch(url, {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || "Failed")
      }
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save lead")
    } finally {
      setSaving(false)
    }
  }

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader><DialogTitle>{isEdit ? t("editLead") : t("newLead")}</DialogTitle></DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{tc("name")} *</Label><Input value={form.contactName} onChange={e => u("contactName", e.target.value)} required /></div>
              <div><Label>{tc("company")}</Label><Input value={form.companyName} onChange={e => u("companyName", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{tc("email")}</Label><Input type="email" value={form.email} onChange={e => u("email", e.target.value)} /></div>
              <div>
                <Label>{tc("phone")} <span className="text-muted-foreground text-[11px]">(SMS / voice)</span></Label>
                <Input value={form.phone} onChange={e => u("phone", e.target.value)} placeholder="+994 ..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>WhatsApp <span className="text-muted-foreground text-[11px]">{t("whatsappAltHint")}</span></Label>
                <Input value={form.phoneWhatsApp} onChange={e => u("phoneWhatsApp", e.target.value)} placeholder="+994 ..." />
              </div>
              <div>
                <Label>Telegram</Label>
                <Input value={form.telegramHandle} onChange={e => u("telegramHandle", e.target.value)} placeholder={t("telegramPlaceholder")} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>{tc("source")}</Label><Select value={form.source} onChange={e => u("source", e.target.value)}><option value="">{tc("select")}...</option><option value="website">Website</option><option value="referral">Referral</option><option value="cold_call">Cold Call</option><option value="linkedin">LinkedIn</option><option value="tiktok">TikTok</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="vkontakte">VKontakte</option><option value="sms">SMS</option><option value="social">Social</option><option value="email">Email</option><option value="event">{t("sourceEvent")}</option><option value="other">{t("sourceOther")}</option></Select></div>
              <div><Label>{tc("priority")}</Label><Select value={form.priority} onChange={e => u("priority", e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></div>
              <div><Label>{t("estValue")}</Label><Input type="number" value={form.estimatedValue} onChange={e => u("estimatedValue", e.target.value)} placeholder="0" /></div>
            </div>
            <div>
              <Label>{t("leadPipeline")}</Label>
              <Select
                value={form.pipelineId}
                onChange={e => u("pipelineId", e.target.value)}
                disabled={loadingPipelines}
              >
                <option value="">
                  {loadingPipelines ? tc("loading") : tc("select")}
                </option>
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t("leadPipelineHelp")}</p>
            </div>
            {!isEdit && (
              <div>
                <Label>{t("assignSeller")}</Label>
                <Select
                  value={form.assignedTo}
                  onChange={e => u("assignedTo", e.target.value)}
                  disabled={loadingAssignees}
                >
                  <option value="">
                    {loadingAssignees ? t("loadingSellers") : t("automaticSellerAssignment")}
                  </option>
                  {salesAssignees.map(seller => (
                    <option key={seller.id} value={seller.id}>
                      {seller.name}{seller.email ? ` — ${seller.email}` : ""}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{t("assignSellerHelp")}</p>
              </div>
            )}
            {(form.source === "event" || form.source === "other") && (
              <div>
                <Label>{form.source === "event" ? t("eventName") : t("sourceDetail")}</Label>
                <Input value={form.sourceDetail} onChange={e => u("sourceDetail", e.target.value)} />
              </div>
            )}
            <div>
              <Label>{t("sourceProfileUrl")}</Label>
              <Input
                type="url"
                value={form.sourceProfileUrl}
                onChange={e => u("sourceProfileUrl", e.target.value)}
                placeholder="https://www.instagram.com/username"
              />
            </div>
            <div>
              <Label>{t("leadInterest")}</Label>
              <Textarea value={form.interest} onChange={e => u("interest", e.target.value)} rows={2} placeholder={t("leadInterestPlaceholder")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Brand</Label><Input value={form.brand} onChange={e => u("brand", e.target.value)} placeholder="Product brand" /></div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onChange={e => u("category", e.target.value)}>
                  <option value="">{tc("select")}...</option>
                  <option value="vip">VIP</option>
                  <option value="regular">Regular</option>
                  <option value="partner">Partner</option>
                  <option value="prospect">Prospect</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
            {isEdit && (
              <div><Label>{tc("status")}</Label><Select value={form.status} onChange={e => u("status", e.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="converted">Converted</option><option value="lost">Lost</option></Select></div>
            )}
            <div><Label>{tc("notes")}</Label><Textarea value={form.notes} onChange={e => u("notes", e.target.value)} rows={2} /></div>
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
