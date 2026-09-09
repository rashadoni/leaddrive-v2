"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Loader2, Target, Zap, Mail, UserPlus, Handshake, Clock, Filter, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface JourneyFormData {
  name: string
  description: string
  status: string
  triggerType: string
  segmentId: string
  goalType: string
  goalConditions: { field?: string; value?: string }
  goalTarget: number | ""
  exitOnGoal: boolean
  maxEnrollmentDays: number | ""
}

interface Segment {
  id: string
  name: string
  contactCount?: number
}

interface JourneyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<JourneyFormData> & { id?: string }
  orgId?: string
}

interface Template {
  id: string
  icon: React.ElementType
  color: string
  tKey: string
  defaults: Partial<JourneyFormData>
}

const TEMPLATES: Template[] = [
  {
    id: "welcome",
    icon: UserPlus,
    color: "text-blue-500 bg-blue-50 dark:bg-blue-950/30",
    tKey: "templateWelcome",
    defaults: {
      name: "",
      triggerType: "lead_created",
      status: "draft",
      maxEnrollmentDays: 30 as any,
      goalType: "status_change",
      goalConditions: { field: "status", value: "qualified" },
      exitOnGoal: true,
    },
  },
  {
    id: "nurture",
    icon: Mail,
    color: "text-purple-500 bg-purple-50 dark:bg-purple-950/30",
    tKey: "templateNurture",
    defaults: {
      name: "",
      triggerType: "manual",
      status: "draft",
      maxEnrollmentDays: 90 as any,
      goalType: "deal_created",
      exitOnGoal: true,
    },
  },
  {
    id: "deal_follow",
    icon: Handshake,
    color: "text-green-500 bg-green-50 dark:bg-green-950/30",
    tKey: "templateDealFollow",
    defaults: {
      name: "",
      triggerType: "deal_stage_change",
      status: "draft",
      maxEnrollmentDays: 60 as any,
    },
  },
  {
    id: "blank",
    icon: Sparkles,
    color: "text-gray-500 bg-gray-50 dark:bg-gray-800/30",
    tKey: "templateBlank",
    defaults: {
      name: "",
      triggerType: "manual",
      status: "draft",
    },
  },
]

export function JourneyForm({ open, onOpenChange, onSaved, initialData, orgId }: JourneyFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const t = useTranslations("journeys")
  const isEdit = !!initialData?.id

  const [step, setStep] = useState<"template" | "form">(isEdit ? "form" : "template")
  const [form, setForm] = useState<JourneyFormData>({
    name: "",
    description: "",
    status: "draft",
    triggerType: "manual",
    segmentId: "",
    goalType: "",
    goalConditions: {},
    goalTarget: "",
    exitOnGoal: true,
    maxEnrollmentDays: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [showGoals, setShowGoals] = useState(false)
  const [segments, setSegments] = useState<Segment[]>([])

  // Fetch segments
  useEffect(() => {
    if (!open) return
    fetch("/api/v1/segments?limit=100", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setSegments(json.data?.segments || json.data || [])
      })
      .catch(() => {})
  }, [open, orgId])

  useEffect(() => {
    if (open) {
      if (isEdit) {
        const gc = (initialData as any)?.goalConditions || {}
        setForm({
          name: initialData?.name || "",
          description: initialData?.description || "",
          status: initialData?.status || "draft",
          triggerType: initialData?.triggerType || "manual",
          segmentId: (initialData as any)?.segmentId || "",
          goalType: (initialData as any)?.goalType || "",
          goalConditions: typeof gc === "object" ? gc : {},
          goalTarget: (initialData as any)?.goalTarget || "",
          exitOnGoal: (initialData as any)?.exitOnGoal !== false,
          maxEnrollmentDays: (initialData as any)?.maxEnrollmentDays || "",
        })
        setShowGoals(!!(initialData as any)?.goalType)
        setStep("form")
      } else {
        setStep("template")
        setForm({
          name: "",
          description: "",
          status: "draft",
          triggerType: "manual",
          segmentId: "",
          goalType: "",
          goalConditions: {},
          goalTarget: "",
          exitOnGoal: true,
          maxEnrollmentDays: "",
        })
        setShowGoals(false)
      }
      setError("")
    }
  }, [open, initialData, isEdit])

  const selectTemplate = (tmpl: Template) => {
    setForm((f) => ({
      ...f,
      ...tmpl.defaults,
      goalConditions: tmpl.defaults.goalConditions || {},
      goalTarget: (tmpl.defaults as any)?.goalTarget || "",
      exitOnGoal: tmpl.defaults.exitOnGoal !== false,
      maxEnrollmentDays: (tmpl.defaults.maxEnrollmentDays as any) || "",
    }))
    setShowGoals(!!tmpl.defaults.goalType)
    setStep("form")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError(tc("required"))
      return
    }
    setSaving(true)
    setError("")

    try {
      const payload: any = {
        name: form.name,
        description: form.description,
        status: form.status,
        triggerType: form.triggerType,
        segmentId: form.segmentId || null,
      }

      if (showGoals && form.goalType) {
        payload.goalType = form.goalType
        payload.goalConditions = form.goalConditions
        payload.goalTarget = form.goalTarget ? Number(form.goalTarget) : null
        payload.exitOnGoal = form.exitOnGoal
      } else {
        payload.goalType = null
        payload.goalConditions = null
        payload.goalTarget = null
      }

      payload.maxEnrollmentDays = form.maxEnrollmentDays ? Number(form.maxEnrollmentDays) : null

      const url = isEdit ? `/api/v1/journeys/${initialData!.id}` : "/api/v1/journeys"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof JourneyFormData, value: any) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <div className="flex items-center justify-between">
          <DialogTitle>
            {isEdit ? tf("editJourney") : step === "template" ? t("chooseTemplate") : tf("newJourney")}
          </DialogTitle>
        </div>
      </DialogHeader>

      {/* Step 1: Template selection */}
      {step === "template" && !isEdit ? (
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-4">{t("templateHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            {TEMPLATES.map((tmpl) => {
              const Icon = tmpl.icon
              return (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => selectTemplate(tmpl)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-primary/50 hover:shadow-sm transition-all text-center group"
                >
                  <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110", tmpl.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">{t(tmpl.tKey as any)}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{t(`${tmpl.tKey}Desc` as any)}</span>
                </button>
              )
            })}
          </div>
          <div className="flex justify-end mt-4 pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          </div>
        </DialogContent>
      ) : (
        /* Step 2: Form */
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <DialogContent>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            {!isEdit && (
              <button
                type="button"
                onClick={() => setStep("template")}
                className="text-xs text-primary hover:underline mb-3 flex items-center gap-1"
              >
                &larr; {t("backToTemplates")}
              </button>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <Label htmlFor="name" className="text-sm font-medium">{tc("name")} *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="mt-1.5"
                />
              </div>

              {/* Status + Trigger */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">{tc("status")}</Label>
                  <Select value={form.status} onChange={(e) => update("status", e.target.value)} className="mt-1.5">
                    <option value="draft">{t("statusDraft")}</option>
                    <option value="active">{t("statusActive")}</option>
                    <option value="paused">{t("statusPaused")}</option>
                    <option value="completed">{t("statusCompleted")}</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" /> {t("trigger")}
                  </Label>
                  <Select value={form.triggerType} onChange={(e) => update("triggerType", e.target.value)} className="mt-1.5">
                    <option value="manual">{t("triggerManual")}</option>
                    <option value="lead_created">{t("triggerLeadCreated")}</option>
                    <option value="contact_created">{t("triggerContactCreated")}</option>
                    <option value="deal_stage_change">{t("triggerDealStageChange")}</option>
                  </Select>
                </div>
              </div>

              {/* Segment filter */}
              <div>
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Filter className="h-3.5 w-3.5" /> {t("audienceSegment")}
                </Label>
                <Select
                  value={form.segmentId}
                  onChange={(e) => update("segmentId", e.target.value)}
                  className="mt-1.5"
                >
                  <option value="">{t("allContacts")}</option>
                  {segments.map((seg) => (
                    <option key={seg.id} value={seg.id}>
                      {seg.name} {seg.contactCount !== undefined ? `(${seg.contactCount})` : ""}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">{t("segmentHint")}</p>
              </div>

              {/* Description */}
              <div>
                <Label className="text-sm font-medium">{tc("description")}</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  rows={2}
                  className="mt-1.5"
                />
              </div>

              {/* Max enrollment days */}
              <div>
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {t("maxEnrollmentDays")}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={form.maxEnrollmentDays}
                  onChange={(e) => update("maxEnrollmentDays", e.target.value)}
                  placeholder={t("maxEnrollmentDaysPlaceholder")}
                  className="mt-1.5"
                />
              </div>

              {/* Goal configuration toggle */}
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium w-full text-left"
                  onClick={() => setShowGoals(!showGoals)}
                >
                  <Target className="h-4 w-4" />
                  {t("goalTracking")}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {showGoals ? "▾" : "▸"}
                  </span>
                </button>

                {showGoals && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label className="text-sm font-medium">{t("goalType")}</Label>
                      <Select
                        value={form.goalType}
                        onChange={(e) => update("goalType", e.target.value)}
                        className="mt-1.5"
                      >
                        <option value="">{t("noGoal")}</option>
                        <option value="deal_created">{t("goalDealCreated")}</option>
                        <option value="status_change">{t("goalStatusChange")}</option>
                        <option value="ticket_resolved">{t("goalTicketResolved")}</option>
                      </Select>
                    </div>

                    {form.goalType === "status_change" && (
                      <div>
                        <Label className="text-sm font-medium">{t("targetStatusValue")}</Label>
                        <Input
                          value={form.goalConditions.value || ""}
                          onChange={(e) => update("goalConditions", { ...form.goalConditions, value: e.target.value })}
                          placeholder={t("targetStatusPlaceholder")}
                          className="mt-1.5"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm font-medium">{t("goalTarget")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={form.goalTarget}
                          onChange={(e) => update("goalTarget", e.target.value)}
                          placeholder={t("goalTargetPlaceholder")}
                          className="mt-1.5"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.exitOnGoal}
                            onChange={(e) => update("exitOnGoal", e.target.checked)}
                            className="rounded"
                          />
                          {t("exitOnGoal")}
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? tc("saving") : isEdit ? tc("save") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
