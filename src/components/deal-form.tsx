"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useStageLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS, DEFAULT_PIPELINE_STAGES } from "@/lib/constants"

interface PipelineStage {
  id: string
  name: string
  displayName: string
  probability: number
  isWon: boolean
  isLost: boolean
  sortOrder: number
}

interface DealPipeline {
  id: string
  name: string
  isDefault: boolean
  stages: PipelineStage[]
}

interface DealFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Record<string, any>
  orgId?: string
  pipelineId?: string
}

export function DealForm({ open, onOpenChange, onSaved, initialData, orgId, pipelineId }: DealFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const stageLabel = useStageLabel()
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    name: initialData?.name || "",
    pipelineId: initialData?.pipelineId || pipelineId || "",
    companyId: initialData?.companyId || "",
    contactId: initialData?.contactId || "",
    campaignId: initialData?.campaignId || "",
    stage: initialData?.stage || "LEAD",
    valueAmount: String(initialData?.valueAmount || "0"),
    currency: initialData?.currency || DEFAULT_CURRENCY,
    probability: String(initialData?.probability || "10"),
    expectedClose: initialData?.expectedClose?.slice(0, 10) || "",
    notes: initialData?.notes || "",
  })
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([])
  const [contacts, setContacts] = useState<Array<{ id: string; name: string }>>([])
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([])
  const [pipelines, setPipelines] = useState<DealPipeline[]>([])
  // Pipeline stages — derived from the category selected in this form.
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        name: initialData?.name || "",
        pipelineId: initialData?.pipelineId || pipelineId || "",
        companyId: initialData?.companyId || "",
        contactId: initialData?.contactId || "",
        campaignId: initialData?.campaignId || "",
        stage: initialData?.stage || "LEAD",
        valueAmount: String(initialData?.valueAmount || "0"),
        currency: initialData?.currency || DEFAULT_CURRENCY,
        probability: String(initialData?.probability || "10"),
        expectedClose: initialData?.expectedClose?.slice(0, 10) || "",
        notes: initialData?.notes || "",
      })
      setError("")
    }
  }, [open, initialData, pipelineId])

  useEffect(() => {
    if (open && orgId) {
      fetch("/api/v1/companies?limit=500", {
        headers: { "x-organization-id": orgId },
      }).then(r => r.json()).then(j => {
        if (j.success) setCompanies(j.data.companies.map((c: any) => ({ id: c.id, name: c.name })))
      }).catch(() => {})
      fetch("/api/v1/campaigns?limit=500", {
        headers: { "x-organization-id": orgId },
      }).then(r => r.json()).then(j => {
        if (j.success) setCampaigns(j.data.campaigns.map((c: any) => ({ id: c.id, name: c.name })))
      }).catch(() => {})
      fetch("/api/v1/contacts?limit=500", {
        headers: { "x-organization-id": orgId },
      }).then(r => r.json()).then(j => {
        if (j.success) setContacts(j.data.contacts.map((c: any) => ({ id: c.id, name: c.fullName })))
      }).catch(() => {})
    }
  }, [open, orgId])

  // Load every category/pipeline so a deal can be moved without leaving the
  // edit dialog. AbortController prevents stale responses after closing.
  useEffect(() => {
    if (!open || !orgId) return
    const controller = new AbortController()
    fetch("/api/v1/pipelines", {
      headers: { "x-organization-id": orgId },
      signal: controller.signal,
    }).then(r => r.json()).then(j => {
      if (!j.success || !Array.isArray(j.data)) return
      const available: DealPipeline[] = j.data
      setPipelines(available)
      // Existing deal category wins; new deals inherit the category currently
      // open on the Kanban board, then fall back to the default.
      const requestedId = initialData?.pipelineId || pipelineId
      const match = (requestedId
        ? available.find(p => p.id === requestedId)
        : undefined) ?? available.find(p => p.isDefault) ?? available[0]
      if (!match?.stages?.length) return
      const sorted: PipelineStage[] = [...match.stages].sort(
        (a: PipelineStage, b: PipelineStage) => a.sortOrder - b.sortOrder
      )
      setPipelineStages(sorted)
      setForm(prev => {
        const valid = sorted.some(s => s.name === prev.stage)
        if (valid) return { ...prev, pipelineId: match.id }
        const first = sorted[0]
        return {
          ...prev,
          pipelineId: match.id,
          stage: first.name,
          probability: String(first.probability),
        }
      })
    }).catch(() => { /* keep fallback */ })
    return () => controller.abort()
  }, [open, orgId, pipelineId, initialData?.pipelineId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const payload = {
        name: form.name,
        companyId: form.companyId || undefined,
        contactId: form.contactId || undefined,
        campaignId: form.campaignId || undefined,
        pipelineId: form.pipelineId || undefined,
        stage: form.stage,
        valueAmount: parseFloat(form.valueAmount) || 0,
        currency: form.currency,
        probability: parseInt(form.probability) || 0,
        expectedClose: form.expectedClose || undefined,
        notes: form.notes || undefined,
      }
      const url = isEdit ? `/api/v1/deals/${initialData!.id}` : "/api/v1/deals"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("errorUpdateFailed"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) }
    finally { setSaving(false) }
  }

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  // Stages shown in the dropdown — prefer dynamic pipeline data; fall back to defaults.
  const stageOptions: PipelineStage[] = pipelineStages.length > 0
    ? pipelineStages
    : DEFAULT_PIPELINE_STAGES.map((s, i) => ({
        id: s.name,
        name: s.name,
        displayName: s.displayName,
        probability: s.probability,
        isWon: "isWon" in s ? Boolean(s.isWon) : false,
        isLost: "isLost" in s ? Boolean(s.isLost) : false,
        sortOrder: i,
      }))

  // When stage changes, auto-populate probability from the selected stage.
  const handleStageChange = (stageName: string) => {
    const found = stageOptions.find(s => s.name === stageName)
    update("stage", stageName)
    if (found) update("probability", String(found.probability))
  }

  const handlePipelineChange = (nextPipelineId: string) => {
    const nextPipeline = pipelines.find(p => p.id === nextPipelineId)
    const sorted = [...(nextPipeline?.stages || [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )
    setPipelineStages(sorted)
    setForm(prev => {
      const currentStage = sorted.find(stage => stage.name === prev.stage)
      const nextStage = currentStage ?? sorted[0]
      return {
        ...prev,
        pipelineId: nextPipelineId,
        ...(nextStage
          ? {
              stage: nextStage.name,
              probability: String(nextStage.probability),
            }
          : {}),
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader><DialogTitle>{isEdit ? t("editDeal") : t("newDeal")}</DialogTitle></DialogHeader>
      <DialogContent>
        <form id="deal-form" onSubmit={handleSubmit}>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            {isEdit && (
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-muted/30 px-3 py-2 text-sm dark:border-zinc-700">
                <span className="text-muted-foreground">{t("dealOfferStatus")}</span>
                {(initialData?._count?.offers ?? 0) > 0 ? (
                  <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                    {t("dealHasOffers", { count: initialData?._count?.offers ?? 0 })}
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {t("dealHasNoOffers")}
                  </span>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="name">{tc("name")} *</Label>
              <Input id="name" value={form.name} onChange={e => update("name", e.target.value)} required />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {t("dealCategoryPipeline")} *
              </legend>
              {pipelines.length > 0 ? (
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {pipelines.map(category => (
                    <label key={category.id} className="cursor-pointer">
                      <input
                        className="peer sr-only"
                        type="radio"
                        name="pipelineId"
                        value={category.id}
                        checked={form.pipelineId === category.id}
                        onChange={() => handlePipelineChange(category.id)}
                        required
                      />
                      <span className="inline-flex min-h-10 items-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2">
                        {category.name}
                        {category.isDefault && (
                          <span className="ml-1.5" aria-label={t("defaultPipeline")}>★</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="h-10 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {t("dealCategoryPipelineHelp")}
              </p>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="companyId">{tc("company")}</Label>
                <Select value={form.companyId} onChange={e => update("companyId", e.target.value)}>
                  <option value="">{tc("select")}</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="campaignId">{t("campaignForRoi")}</Label>
                <Select value={form.campaignId} onChange={e => update("campaignId", e.target.value)}>
                  <option value="">{t("noCampaign")}</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="contactId">{tc("contact")}</Label>
              <Select value={form.contactId} onChange={e => update("contactId", e.target.value)}>
                <option value="">{tc("select")}</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="stage">{tc("status")}</Label>
                <Select value={form.stage} onChange={e => handleStageChange(e.target.value)}>
                  {stageOptions.map(s => (
                    <option key={s.name} value={s.name}>
                      {stageLabel(s.name, s.displayName)}{s.probability > 0 && s.probability < 100 ? ` (${s.probability}%)` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="probability">{tc("probability")} %</Label>
                <Input id="probability" type="number" min="0" max="100" value={form.probability} onChange={e => update("probability", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="valueAmount">{tc("amount")}</Label>
                <Input id="valueAmount" type="number" min="0" step="0.01" value={form.valueAmount} onChange={e => update("valueAmount", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="currency">{tc("currency")}</Label>
                <Select value={form.currency} onChange={e => update("currency", e.target.value)}>
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <option key={code} value={code}>{code} {sym}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="expectedClose">{tc("dueDate")}</Label>
              <Input id="expectedClose" type="date" value={form.expectedClose} onChange={e => update("expectedClose", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="notes">{tc("notes")}</Label>
              <Textarea id="notes" value={form.notes} onChange={e => update("notes", e.target.value)} rows={3} />
            </div>
          </div>
        </form>
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
        <Button type="submit" form="deal-form" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
      </DialogFooter>
    </Dialog>
  )
}
