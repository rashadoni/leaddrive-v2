"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, CircleAlert, FileCheck2, Link2, Plus, SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { createDateFormatter } from "@/lib/format-date"

export type MtmPotentialAgentOption = {
  id: string
  name: string
  role: string
}

export type MtmEligiblePotentialVisit = {
  id: string
  checkInAt: string | null
  checkOutAt: string | null
  status: string
  agentId: string
  customer: { id: string; name: string }
}

export type MtmPotentialEndTarget = {
  id: string
  title: string
  periodStart: string | null
}

type Formula = {
  id: string
  name: string
  version: string
  status: string
  signedAt: string | null
  definitionHash: string | null
  glossarySchemaVersion: number | null
}

type SharedDialogProps = {
  contactId: string
  orgId?: string
  onSaved: () => Promise<void> | void
}

function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value)
}

function requestHeaders(orgId?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(orgId ? { "x-organization-id": orgId } : {}),
  }
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
      <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
      <span>{message}</span>
    </div>
  )
}

function FormField({
  id,
  label,
  required = false,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}{required ? " *" : ""}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function MtmAssessmentCreateDialog({
  open,
  onOpenChange,
  contactId,
  asOf,
  orgId,
  onSaved,
}: SharedDialogProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  asOf: string
}) {
  const t = useTranslations("mtmContactScoring")
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [loadingFormulas, setLoadingFormulas] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const operationId = useRef("")
  const [form, setForm] = useState({
    formulaId: "",
    office: "",
    patientsPerMonth: "",
    bedCount: "",
    isKol: false,
    kolLevel: "",
    profile: "",
    psychotype: "",
    granularCategory: "",
    actualScore: "",
    targetScore: "",
    periodStart: asOf,
    periodEnd: "",
    source: "MANAGER_INTERVIEW",
    evidenceNote: "",
  })

  useEffect(() => {
    if (!open) return
    operationId.current = crypto.randomUUID()
    setError("")
    setForm({
      formulaId: "",
      office: "",
      patientsPerMonth: "",
      bedCount: "",
      isKol: false,
      kolLevel: "",
      profile: "",
      psychotype: "",
      granularCategory: "",
      actualScore: "",
      targetScore: "",
      periodStart: asOf,
      periodEnd: "",
      source: "MANAGER_INTERVIEW",
      evidenceNote: "",
    })
    setLoadingFormulas(true)
    void fetch("/api/v1/mtm/doctor-scoring/formulas", {
      headers: orgId ? { "x-organization-id": orgId } : {},
    })
      .then(async (response) => {
        const result = await response.json() as {
          success?: boolean
          error?: string
          data?: { formulas?: Formula[] }
        }
        if (!response.ok || !result.success) throw new Error(result.error || t("formulaLoadError"))
        const active = (result.data?.formulas ?? []).filter((formula) => (
          formula.status === "ACTIVE"
          && Boolean(formula.signedAt)
          && formula.glossarySchemaVersion === 1
          && Boolean(formula.definitionHash)
        ))
        setFormulas(active)
        setForm((current) => ({ ...current, formulaId: active[0]?.id ?? "" }))
      })
      .catch((loadError) => {
        setFormulas([])
        setError(loadError instanceof Error ? loadError.message : t("formulaLoadError"))
      })
      .finally(() => setLoadingFormulas(false))
  }, [asOf, open, orgId, t])

  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.formulaId) {
      setError(t("activeFormulaRequired"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts/${contactId}/assessments`, {
        method: "POST",
        headers: requestHeaders(orgId),
        body: JSON.stringify({
          clientAssessmentId: operationId.current,
          formulaId: form.formulaId,
          office: form.office.trim() || null,
          patientsPerMonth: optionalNumber(form.patientsPerMonth),
          bedCount: optionalNumber(form.bedCount),
          isKol: form.isKol,
          kolLevel: form.isKol ? (form.kolLevel.trim() || null) : null,
          profile: form.profile.trim() || null,
          psychotype: form.psychotype.trim() || null,
          granularCategory: form.granularCategory.trim() || null,
          actualScore: optionalNumber(form.actualScore),
          targetScore: optionalNumber(form.targetScore),
          periodStart: form.periodStart,
          periodEnd: form.periodEnd || null,
          source: form.source,
          provenance: {
            entryChannel: "web_contact_card",
            method: form.source,
            ...(form.evidenceNote.trim() ? { evidenceNote: form.evidenceNote.trim() } : {}),
          },
        }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || t("assessmentCreateError"))
      onOpenChange(false)
      await onSaved()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("assessmentCreateError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)} widthClassName="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{t("assessmentCreateTitle")}</DialogTitle>
        <DialogDescription>{t("assessmentCreateDescription")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent>
          <div className="grid gap-5">
            <ErrorNotice message={error} />
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
              <FileCheck2 className="mr-2 inline h-4 w-4" />
              {t("appendOnlyAssessmentHint")}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField id="assessment-formula" label={t("scoringFormula")} required hint={t("activeFormulaHint")}>
                <Select
                  id="assessment-formula"
                  value={form.formulaId}
                  onChange={(event) => update("formulaId", event.target.value)}
                  disabled={loadingFormulas || formulas.length === 0}
                  required
                >
                  <option value="">{loadingFormulas ? t("loadingFormulas") : t("selectFormula")}</option>
                  {formulas.map((formula) => (
                    <option key={formula.id} value={formula.id}>{formula.name} · {formula.version}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="assessment-source" label={t("source")} required>
                <Select id="assessment-source" value={form.source} onChange={(event) => update("source", event.target.value)}>
                  <option value="MANAGER_INTERVIEW">{t("sourceOptions.managerInterview")}</option>
                  <option value="CLINIC_REGISTRY">{t("sourceOptions.clinicRegistry")}</option>
                  <option value="VALIDATED_DOCUMENT">{t("sourceOptions.validatedDocument")}</option>
                </Select>
              </FormField>
              <FormField id="assessment-period-start" label={t("periodStart")} required>
                <Input id="assessment-period-start" type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} required />
              </FormField>
              <FormField id="assessment-period-end" label={t("periodEnd")}>
                <Input id="assessment-period-end" type="date" min={form.periodStart} value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} />
              </FormField>
            </div>
            <div className="grid gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700 sm:grid-cols-2 lg:grid-cols-3">
              <FormField id="assessment-office" label={t("office")}>
                <Input id="assessment-office" value={form.office} maxLength={500} onChange={(event) => update("office", event.target.value)} />
              </FormField>
              <FormField id="assessment-patients" label={t("patientsPerMonth")}>
                <Input id="assessment-patients" type="number" min="0" max="1000000" inputMode="numeric" value={form.patientsPerMonth} onChange={(event) => update("patientsPerMonth", event.target.value)} />
              </FormField>
              <FormField id="assessment-beds" label={t("bedCount")}>
                <Input id="assessment-beds" type="number" min="0" max="1000000" inputMode="numeric" value={form.bedCount} onChange={(event) => update("bedCount", event.target.value)} />
              </FormField>
              <FormField id="assessment-profile" label={t("profile")}>
                <Input id="assessment-profile" value={form.profile} maxLength={500} onChange={(event) => update("profile", event.target.value)} />
              </FormField>
              <FormField id="assessment-psychotype" label={t("psychotype")} hint={t("psychotypeEntryHint")}>
                <Input id="assessment-psychotype" value={form.psychotype} maxLength={500} onChange={(event) => update("psychotype", event.target.value)} />
              </FormField>
              <FormField id="assessment-category" label={t("granularCategory")}>
                <Input id="assessment-category" value={form.granularCategory} maxLength={500} onChange={(event) => update("granularCategory", event.target.value)} />
              </FormField>
              <FormField id="assessment-actual" label={t("actualScore")}>
                <Input id="assessment-actual" type="number" min="0" max="1000000000" step="any" inputMode="decimal" value={form.actualScore} onChange={(event) => update("actualScore", event.target.value)} />
              </FormField>
              <FormField id="assessment-target" label={t("targetScore")}>
                <Input id="assessment-target" type="number" min="0" max="1000000000" step="any" inputMode="decimal" value={form.targetScore} onChange={(event) => update("targetScore", event.target.value)} />
              </FormField>
              <div className="grid content-start gap-3">
                <Label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-3 dark:border-zinc-700">
                  <input type="checkbox" checked={form.isKol} onChange={(event) => update("isKol", event.target.checked)} className="h-4 w-4 accent-primary" />
                  <span>{t("kol")}</span>
                </Label>
                {form.isKol ? (
                  <Input aria-label={t("kolLevel")} placeholder={t("kolLevel")} value={form.kolLevel} maxLength={500} onChange={(event) => update("kolLevel", event.target.value)} />
                ) : null}
              </div>
            </div>
            <FormField id="assessment-evidence" label={t("evidenceNote")} hint={t("evidenceNoteHint")}>
              <Textarea id="assessment-evidence" value={form.evidenceNote} maxLength={1000} rows={3} onChange={(event) => update("evidenceNote", event.target.value)} />
            </FormField>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving || loadingFormulas || formulas.length === 0}>
            <SquarePen className="h-4 w-4" />
            {saving ? t("savingRecord") : t("createAssessment")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function MtmPotentialCreateDialog({
  open,
  onOpenChange,
  contactId,
  asOf,
  orgId,
  agents,
  eligibleVisits,
  perAgentDimension,
  onSaved,
}: SharedDialogProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  asOf: string
  agents: MtmPotentialAgentOption[]
  eligibleVisits: MtmEligiblePotentialVisit[]
  perAgentDimension: boolean
}) {
  const t = useTranslations("mtmContactScoring")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const dateTimeFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const operationId = useRef("")
  const [form, setForm] = useState({
    agentId: "",
    brandExternalId: "",
    brandName: "",
    productExternalId: "",
    productName: "",
    category: "",
    categoryLabel: "",
    potentialValue: "",
    coverageValue: "",
    periodStart: asOf,
    periodEnd: "",
    source: "FIELD_INTERVIEW",
    evidenceNote: "",
    evidenceVisitIds: [] as string[],
  })

  useEffect(() => {
    if (!open) return
    operationId.current = crypto.randomUUID()
    setError("")
    setForm({
      agentId: agents.length === 1 ? agents[0].id : "",
      brandExternalId: "",
      brandName: "",
      productExternalId: "",
      productName: "",
      category: "",
      categoryLabel: "",
      potentialValue: "",
      coverageValue: "",
      periodStart: asOf,
      periodEnd: "",
      source: "FIELD_INTERVIEW",
      evidenceNote: "",
      evidenceVisitIds: [],
    })
  }, [agents, asOf, open])

  const update = (key: keyof typeof form, value: string | string[]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const visibleEligibleVisits = perAgentDimension
    ? eligibleVisits.filter((visit) => visit.agentId === form.agentId)
    : eligibleVisits

  const toggleVisit = (visitId: string) => {
    update(
      "evidenceVisitIds",
      form.evidenceVisitIds.includes(visitId)
        ? form.evidenceVisitIds.filter((id) => id !== visitId)
        : [...form.evidenceVisitIds, visitId],
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (perAgentDimension && !form.agentId) {
      setError(t("potentialAgentRequired"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts/${contactId}/brand-potentials`, {
        method: "POST",
        headers: requestHeaders(orgId),
        body: JSON.stringify({
          clientPotentialId: operationId.current,
          agentId: perAgentDimension ? form.agentId : null,
          brandExternalId: form.brandExternalId.trim(),
          brandName: form.brandName.trim(),
          productExternalId: form.productExternalId.trim() || null,
          productName: form.productName.trim() || null,
          category: form.category || null,
          categoryLabel: form.categoryLabel.trim() || null,
          potentialValue: Number(form.potentialValue),
          coverageValue: Number(form.coverageValue),
          periodStart: form.periodStart,
          periodEnd: form.periodEnd || null,
          source: form.source,
          provenance: {
            entryChannel: "web_contact_card",
            method: form.source,
            ...(form.evidenceNote.trim() ? { evidenceNote: form.evidenceNote.trim() } : {}),
          },
          evidenceVisitIds: form.evidenceVisitIds,
        }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || t("potentialCreateError"))
      onOpenChange(false)
      await onSaved()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("potentialCreateError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)} widthClassName="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{t("potentialCreateTitle")}</DialogTitle>
        <DialogDescription>{t("potentialCreateDescription")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent>
          <div className="grid gap-5">
            <ErrorNotice message={error} />
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
              <Link2 className="mr-2 inline h-4 w-4" />
              {t("appendOnlyPotentialHint")}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {perAgentDimension ? (
                <FormField id="potential-agent" label={t("owner")} required hint={t("potentialAgentHint")}>
                  <Select
                    id="potential-agent"
                    value={form.agentId}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      agentId: event.target.value,
                      evidenceVisitIds: [],
                    }))}
                    required
                  >
                    <option value="">{t("selectAgent")}</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {mtmStatusLabel(statusT, "role", agent.role)}</option>)}
                  </Select>
                </FormField>
              ) : null}
              <FormField id="potential-source" label={t("source")} required>
                <Select id="potential-source" value={form.source} onChange={(event) => update("source", event.target.value)}>
                  <option value="FIELD_INTERVIEW">{t("sourceOptions.fieldInterview")}</option>
                  <option value="VISIT_OBSERVATION">{t("sourceOptions.visitObservation")}</option>
                  <option value="MANAGER_REVIEW">{t("sourceOptions.managerReview")}</option>
                </Select>
              </FormField>
              <FormField id="potential-brand-code" label={t("brandExternalId")} required>
                <Input id="potential-brand-code" value={form.brandExternalId} maxLength={200} onChange={(event) => update("brandExternalId", event.target.value)} required />
              </FormField>
              <FormField id="potential-brand-name" label={t("brandName")} required>
                <Input id="potential-brand-name" value={form.brandName} maxLength={200} onChange={(event) => update("brandName", event.target.value)} required />
              </FormField>
              <FormField id="potential-product-code" label={t("productExternalId")}>
                <Input id="potential-product-code" value={form.productExternalId} maxLength={500} onChange={(event) => update("productExternalId", event.target.value)} />
              </FormField>
              <FormField id="potential-product-name" label={t("productName")}>
                <Input id="potential-product-name" value={form.productName} maxLength={500} onChange={(event) => update("productName", event.target.value)} />
              </FormField>
            </div>
            <div className="grid gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700 sm:grid-cols-2 lg:grid-cols-3">
              <FormField id="potential-value" label={t("potentialValue")} required>
                <Input id="potential-value" type="number" min="0" max="1000000000" step="any" inputMode="decimal" value={form.potentialValue} onChange={(event) => update("potentialValue", event.target.value)} required />
              </FormField>
              <FormField id="potential-coverage" label={t("coverageValue")} required>
                <Input id="potential-coverage" type="number" min="0" max="1000000000" step="any" inputMode="decimal" value={form.coverageValue} onChange={(event) => update("coverageValue", event.target.value)} required />
              </FormField>
              <FormField id="potential-category" label={t("measurementCategory")}>
                <Select id="potential-category" value={form.category} onChange={(event) => update("category", event.target.value)}>
                  <option value="">{t("categoryNotSet")}</option>
                  {["A", "B", "C", "D"].map((category) => <option key={category} value={category}>{category}</option>)}
                </Select>
              </FormField>
              <FormField id="potential-category-label" label={t("categoryLabel")} hint={t("measurementCategoryHint")}>
                <Input id="potential-category-label" value={form.categoryLabel} maxLength={500} onChange={(event) => update("categoryLabel", event.target.value)} />
              </FormField>
              <FormField id="potential-period-start" label={t("periodStart")} required>
                <Input id="potential-period-start" type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} required />
              </FormField>
              <FormField id="potential-period-end" label={t("periodEnd")}>
                <Input id="potential-period-end" type="date" min={form.periodStart} value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} />
              </FormField>
            </div>
            <div className="grid gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t("evidenceVisitSelection")}</h3>
                <p className="text-xs text-muted-foreground">{t("evidenceVisitSelectionHint")}</p>
              </div>
              {visibleEligibleVisits.length ? (
                <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
                  {visibleEligibleVisits.map((visit) => (
                    <Label key={visit.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={form.evidenceVisitIds.includes(visit.id)}
                        onChange={() => toggleVisit(visit.id)}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{visit.customer.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {visit.checkInAt ? dateTimeFormatter.format(new Date(visit.checkInAt)) : t("dateMissing")}
                        </span>
                      </span>
                    </Label>
                  ))}
                </div>
              ) : <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-muted-foreground dark:border-zinc-700">{t("eligibleVisitsEmpty")}</p>}
            </div>
            <FormField id="potential-evidence-note" label={t("evidenceNote")} hint={t("evidenceNoteHint")}>
              <Textarea id="potential-evidence-note" value={form.evidenceNote} maxLength={1000} rows={3} onChange={(event) => update("evidenceNote", event.target.value)} />
            </FormField>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving || (perAgentDimension && agents.length === 0)}>
            <Plus className="h-4 w-4" />
            {saving ? t("savingRecord") : t("createPotential")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function MtmPotentialEndDialog({
  target,
  asOf,
  onOpenChange,
  orgId,
  onSaved,
}: {
  target: MtmPotentialEndTarget | null
  asOf: string
  onOpenChange: (open: boolean) => void
  orgId?: string
  onSaved: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactScoring")
  const [periodEnd, setPeriodEnd] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!target) return
    setPeriodEnd(target.periodStart && target.periodStart.slice(0, 10) > asOf
      ? target.periodStart.slice(0, 10)
      : asOf)
    setReason("")
    setError("")
  }, [asOf, target])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/field-potentials/${target.id}/end`, {
        method: "POST",
        headers: requestHeaders(orgId),
        body: JSON.stringify({ periodEnd, reason: reason.trim() }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || t("potentialEndError"))
      onOpenChange(false)
      await onSaved()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("potentialEndError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{t("potentialEndTitle")}</DialogTitle>
        <DialogDescription>{target ? t("potentialEndDescription", { title: target.title }) : ""}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent>
          <div className="grid gap-4">
            <ErrorNotice message={error} />
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
              <CalendarClock className="mr-2 inline h-4 w-4" />
              {t("potentialEndAppendOnlyHint")}
            </div>
            <FormField id="potential-end-date" label={t("periodEnd")} required>
              <Input id="potential-end-date" type="date" min={target?.periodStart?.slice(0, 10)} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required />
            </FormField>
            <FormField id="potential-end-reason" label={t("endReason")} required hint={t("endReasonHint")}>
              <Textarea id="potential-end-reason" value={reason} minLength={2} maxLength={2000} rows={4} onChange={(event) => setReason(event.target.value)} required />
            </FormField>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving || reason.trim().length < 2}>
            <CalendarClock className="h-4 w-4" />
            {saving ? t("savingRecord") : t("endPotential")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
