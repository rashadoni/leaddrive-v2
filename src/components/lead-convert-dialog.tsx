"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { useStageLabel } from "@/lib/status-labels"

interface PipelineStage {
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

const OMNICHANNEL_LEAD_SOURCES = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "telegram",
  "vkontakte",
  "vk",
  "whatsapp",
  "web-chat",
  "webchat",
])

function isOmnichannelLeadSource(source: string | undefined): boolean {
  return OMNICHANNEL_LEAD_SOURCES.has(
    (source || "").trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-"),
  )
}

// Fallback if pipeline data can't be loaded.
const FALLBACK_STAGES: PipelineStage[] = [
  { name: "LEAD",        displayName: "Lead",        probability: 10, isWon: false, isLost: false, sortOrder: 0 },
  { name: "QUALIFIED",   displayName: "Qualified",   probability: 25, isWon: false, isLost: false, sortOrder: 1 },
  { name: "PROPOSAL",    displayName: "Proposal",    probability: 50, isWon: false, isLost: false, sortOrder: 2 },
  { name: "NEGOTIATION", displayName: "Negotiation", probability: 75, isWon: false, isLost: false, sortOrder: 3 },
]

interface LeadConvertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: () => void
  lead: {
    id: string
    contactName: string
    companyName?: string
    email?: string
    phone?: string
    estimatedValue?: number
    source?: string
    pipelineId?: string
  }
  orgId?: string
}

export function LeadConvertDialog({ open, onOpenChange, onConverted, lead, orgId }: LeadConvertDialogProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const stageLabel = useStageLabel()
  const [dealTitle, setDealTitle] = useState(`Deal from ${lead.contactName}`)
  const [dealStage, setDealStage] = useState("QUALIFIED")
  const [dealValue, setDealValue] = useState(String(lead.estimatedValue || ""))
  const [createCompany, setCreateCompany] = useState(!!lead.companyName)
  const [pipelines, setPipelines] = useState<DealPipeline[]>([])
  const [pipelineId, setPipelineId] = useState("")
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>(FALLBACK_STAGES)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const isOmnichannelLead = isOmnichannelLeadSource(lead.source)

  const selectPipeline = useCallback((nextPipelineId: string, availablePipelines: DealPipeline[]) => {
    const selected = availablePipelines.find((pipeline) => pipeline.id === nextPipelineId)
    if (!selected) return
    const active = (selected.stages ?? [])
      .filter((stage) => !stage.isWon && !stage.isLost)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    setPipelineId(selected.id)
    if (active.length > 0) {
      setPipelineStages(active)
      setDealStage(active[Math.min(1, active.length - 1)].name)
    }
  }, [])

  // Load every active pipeline. Omni-channel leads default to SMM and the API
  // enforces the same rule; other leads keep the tenant's normal default.
  // AbortController prevents stale-fetch overwrites on rapid open/close.
  useEffect(() => {
    if (!open || !orgId) return
    const controller = new AbortController()
    fetch("/api/v1/pipelines", {
      headers: { "x-organization-id": orgId },
      signal: controller.signal,
    }).then(r => r.json()).then(j => {
      if (!j.success || !Array.isArray(j.data) || j.data.length === 0) return
      const available = j.data as DealPipeline[]
      setPipelines(available)
      const preferred = (
        isOmnichannelLead
          ? available.find((pipeline) => pipeline.name.trim().toLowerCase() === "smm")
          : available.find((pipeline) => pipeline.id === lead.pipelineId)
      ) ?? available.find((pipeline) => pipeline.isDefault) ?? available[0]
      if (preferred) selectPipeline(preferred.id, available)
    }).catch(() => { /* keep fallback */ })
    return () => controller.abort()
  }, [open, orgId, isOmnichannelLead, lead.pipelineId, selectPipeline])

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/convert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          dealTitle,
          dealStage,
          dealValue: dealValue ? parseFloat(dealValue) : undefined,
          createCompany,
          pipelineId: pipelineId || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to convert")
      onConverted()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to convert")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ArrowRight className="h-5 w-5" /> {t("convertLead")}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleConvert}>
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}

          <div className="bg-muted/50 p-3 rounded-lg mb-4">
            <p className="text-sm font-medium">{t("convertingLead")}:</p>
            <p className="text-sm">{lead.contactName} {lead.companyName ? `(${lead.companyName})` : ""}</p>
            {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
          </div>

          <div className="grid gap-4">
            <div className="text-sm font-medium text-muted-foreground">{t("thisWillCreate")}</div>

            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-3">
              <p className="text-sm font-medium">1. {t("contactFrom")} {lead.contactName}</p>
              {lead.companyName && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={createCompany} onChange={(e) => setCreateCompany(e.target.checked)} className="rounded" />
                  <span className="text-sm">2. {t("companyFrom")} {lead.companyName}</span>
                </label>
              )}
            </div>

            <div>
              <Label htmlFor="dealTitle">{t("dealTitle")}</Label>
              <Input id="dealTitle" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="pipelineId">{t("dealCategoryPipeline")}</Label>
              <Select
                id="pipelineId"
                value={pipelineId}
                onChange={(event) => selectPipeline(event.target.value, pipelines)}
                disabled={isOmnichannelLead}
                required
              >
                <option value="">{tc("select")}</option>
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {isOmnichannelLead
                  ? t("omnichannelDealPipelineHelp")
                  : t("dealCategoryPipelineHelp")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dealStage">{t("dealStage")}</Label>
                <Select value={dealStage} onChange={(e) => setDealStage(e.target.value)}>
                  {pipelineStages.map(s => (
                    <option key={s.name} value={s.name}>
                      {stageLabel(s.name, s.displayName)} ({s.probability}%)
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="dealValue">{t("dealValue")}</Label>
                <Input id="dealValue" type="number" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? t("converting") : t("convertBtn")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
