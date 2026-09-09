"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  FlaskConical,
  History,
  Link2,
  Plus,
  Scale,
  ShieldCheck,
  SquarePen,
  Stethoscope,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  MtmAssessmentCreateDialog,
  type MtmEligiblePotentialVisit,
  type MtmPotentialAgentOption,
  MtmPotentialCreateDialog,
  MtmPotentialEndDialog,
  type MtmPotentialEndTarget,
} from "@/components/mtm/contact-scoring-entry-dialogs"
import { cn } from "@/lib/utils"
import { createDateFormatter, type DateFormatter } from "@/lib/format-date"

export type MtmScoringAssessment = {
  id: string
  status: string
  office: string | null
  patientsPerMonth: number | null
  bedCount: number | null
  isKol: boolean
  kolLevel: string | null
  profile: string | null
  psychotype: string | null
  granularCategory: string | null
  actualScore: string | number | null
  targetScore: string | number | null
  periodStart: string
  periodEnd: string | null
  source: string
  provenance: unknown
  formulaVersion: string
  reviewComment: string | null
  reviewedAt: string | null
  createdAt: string
  enteredByAgent: { id: string; name: string } | null
  reviewedByAgent: { id: string; name: string } | null
  formula: {
    id?: string
    name: string
    version: string
    status?: string
    signedAt?: string | null
    definition?: unknown
    definitionHash?: string | null
    glossarySchemaVersion?: number | null
    approvalReference?: string | null
    sourceSystem?: string | null
    sourceReference?: string | null
    sourceObservedAt?: string | null
  }
}

type EvidenceVisit = {
  visit: {
    id: string
    checkInAt: string | null
    checkOutAt: string | null
    status: string
    customer: { id: string; name: string }
  }
}

export type MtmBrandPotential = {
  id: string
  brandExternalId: string | null
  brandName: string | null
  productExternalId: string | null
  productName: string | null
  category: string | null
  categoryLabel: string | null
  potentialValue: string | number
  coverageValue: string | number
  periodStart: string | null
  periodEnd: string | null
  source: string
  formulaVersion: string | null
  provenance: unknown
  status: string
  reviewComment: string | null
  reviewedAt: string | null
  closedAt: string | null
  createdAt: string
  agent: { id: string; name: string } | null
  enteredByAgent: { id: string; name: string } | null
  reviewedByAgent: { id: string; name: string } | null
  evidenceVisits: EvidenceVisit[]
}

type ReviewTarget = {
  kind: "assessment" | "potential"
  id: string
  decision: "VERIFIED" | "REJECTED"
  title: string
}

function ToneBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "positive" | "warning" | "negative" | "neutral"
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
      tone === "positive" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
      tone === "warning" && "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
      tone === "negative" && "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
      tone === "neutral" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    )}>
      {children}
    </span>
  )
}

function statusTone(status: string): "positive" | "warning" | "negative" | "neutral" {
  if (status === "VERIFIED") return "positive"
  if (status === "PENDING") return "warning"
  if (status === "REJECTED") return "negative"
  return "neutral"
}

function DataTile({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-1 rounded-xl border border-zinc-200 bg-background p-3 dark:border-zinc-700">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-semibold tabular-nums">{value ?? "—"}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function PanelSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function primitiveProvenance(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value)
    .filter((entry): entry is [string, string | number | boolean] => (
      typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean"
    ))
    .slice(0, 6)
    .map(([key, item]) => [key, String(item)])
}

function professionalGlossarySnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const snapshot = (value as Record<string, unknown>).professionalGlossary
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : null
}

function professionalGlossaryTerms(
  definition: unknown,
  locale: string,
): Array<{ code: string; label: string; definition: string }> {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return []
  const glossary = (definition as Record<string, unknown>).glossary
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary)) return []
  const terms = (glossary as Record<string, unknown>).terms
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) return []
  const language = locale.startsWith("az") ? "az" : locale.startsWith("ru") ? "ru" : "en"
  return Object.entries(terms as Record<string, unknown>).flatMap(([code, term]) => {
    if (!term || typeof term !== "object" || Array.isArray(term)) return []
    const labels = (term as Record<string, unknown>).labels
    const definitions = (term as Record<string, unknown>).definitions
    if (!labels || typeof labels !== "object" || !definitions || typeof definitions !== "object") return []
    const label = (labels as Record<string, unknown>)[language]
    const termDefinition = (definitions as Record<string, unknown>)[language]
    return typeof label === "string" && typeof termDefinition === "string"
      ? [{ code, label, definition: termDefinition }]
      : []
  })
}

export function MtmContactScoringPanel({
  contactId,
  contactType,
  productCategory,
  qualificationCategory,
  assessments,
  potentials,
  eligiblePotentialVisits,
  potentialAgents,
  asOf,
  actorAgentId,
  canAssess,
  canRecordPotential,
  canReviewAssessment,
  canReviewPotential,
  perAgentDimension,
  orgId,
  onChanged,
}: {
  contactId: string
  contactType: string
  productCategory: string | null
  qualificationCategory: string | null
  assessments: MtmScoringAssessment[]
  potentials: MtmBrandPotential[]
  eligiblePotentialVisits: MtmEligiblePotentialVisit[]
  potentialAgents: MtmPotentialAgentOption[]
  asOf: string
  actorAgentId: string | null
  canAssess: boolean
  canRecordPotential: boolean
  canReviewAssessment: boolean
  canReviewPotential: boolean
  perAgentDimension: boolean
  orgId?: string
  onChanged: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactScoring")
  const locale = useLocale()
  const dateFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium" }),
    [locale],
  )
  const dateTimeFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  )
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  )
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [comment, setComment] = useState("")
  const [reviewError, setReviewError] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [assessmentCreateOpen, setAssessmentCreateOpen] = useState(false)
  const [potentialCreateOpen, setPotentialCreateOpen] = useState(false)
  const [potentialEndTarget, setPotentialEndTarget] = useState<MtmPotentialEndTarget | null>(null)

  const activeAssessment = assessments.find((assessment) => (
    assessment.status === "VERIFIED"
    && assessment.periodStart <= asOf
    && (!assessment.periodEnd || assessment.periodEnd >= asOf)
  )) ?? null
  const effectiveAssessment = activeAssessment
    ?? assessments.find((assessment) => assessment.status === "VERIFIED")
    ?? null
  const assessmentHistory = effectiveAssessment
    ? assessments.filter((assessment) => assessment.id !== effectiveAssessment.id)
    : assessments
  const activePotentials = potentials.filter((potential) => (
    potential.status === "VERIFIED"
    && (!potential.periodStart || potential.periodStart <= asOf)
    && (!potential.periodEnd || potential.periodEnd >= asOf)
  ))

  const openReview = (target: ReviewTarget) => {
    setReviewTarget(target)
    setComment("")
    setReviewError("")
  }

  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviewTarget || comment.trim().length < 2) {
      setReviewError(t("reviewCommentError"))
      return
    }
    setReviewing(true)
    setReviewError("")
    try {
      const url = reviewTarget.kind === "assessment"
        ? `/api/v1/mtm/doctor-assessments/${reviewTarget.id}/decision`
        : `/api/v1/mtm/field-potentials/${reviewTarget.id}/decision`
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({ decision: reviewTarget.decision, comment: comment.trim() }),
      })
      const result = await response.json() as { error?: string; code?: string }
      if (!response.ok) throw new Error(result.error || t("reviewError"))
      setReviewTarget(null)
      await onChanged()
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : t("reviewError"))
    } finally {
      setReviewing(false)
    }
  }

  if (contactType !== "DOCTOR") {
    return (
      <PanelSection title={t("notDoctorTitle")} description={t("notDoctorDescription")} icon={Stethoscope}>
        <DataTile label={t("productCategory")} value={productCategory} />
      </PanelSection>
    )
  }

  return (
    <div className="grid gap-5">
      {(canAssess || canRecordPotential) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <div className="grid gap-1">
            <h2 className="font-semibold">{t("lifecycleActionsTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("lifecycleActionsDescription")}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canAssess ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setAssessmentCreateOpen(true)}>
                <SquarePen className="h-4 w-4" />
                {t("newAssessment")}
              </Button>
            ) : null}
            {canRecordPotential ? (
              <Button type="button" className="min-h-11" onClick={() => setPotentialCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("newPotential")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <PanelSection title={t("currentAssessmentTitle")} description={t("currentAssessmentDescription")} icon={ShieldCheck}>
          {effectiveAssessment ? (
            <AssessmentCard
              assessment={effectiveAssessment}
              current={activeAssessment?.id === effectiveAssessment.id}
              canReview={canReviewAssessment}
              t={t}
              dateFormatter={dateFormatter}
              dateTimeFormatter={dateTimeFormatter}
              numberFormatter={numberFormatter}
              locale={locale}
              onReview={openReview}
            />
          ) : (
            <EmptyState title={t("noVerifiedAssessment")} description={t("noVerifiedAssessmentHint")} />
          )}
        </PanelSection>

        <PanelSection title={t("profileFactorsTitle")} description={t("profileFactorsDescription")} icon={Users}>
          {effectiveAssessment ? (
            <div className="grid grid-cols-2 gap-3">
              <DataTile label={t("office")} value={effectiveAssessment.office} />
              <DataTile label={t("patientsPerMonth")} value={effectiveAssessment.patientsPerMonth === null ? null : numberFormatter.format(effectiveAssessment.patientsPerMonth)} />
              <DataTile label={t("bedCount")} value={effectiveAssessment.bedCount === null ? null : numberFormatter.format(effectiveAssessment.bedCount)} />
              <DataTile label={t("kol")} value={effectiveAssessment.isKol ? t("yes") : t("no")} hint={effectiveAssessment.kolLevel} />
              <DataTile label={t("profile")} value={effectiveAssessment.profile} />
              <DataTile label={t("psychotype")} value={effectiveAssessment.psychotype} hint={t("psychotypeSnapshot")} />
              <DataTile label={t("granularCategory")} value={effectiveAssessment.granularCategory} />
              <DataTile label={t("qualificationCategory")} value={qualificationCategory} />
              <DataTile label={t("productCategory")} value={productCategory} />
            </div>
          ) : <EmptyState title={t("profileFactorsEmpty")} description={t("profileFactorsEmptyHint")} />}
        </PanelSection>
      </div>

      <PanelSection title={t("assessmentHistoryTitle")} description={t("assessmentHistoryDescription")} icon={History}>
        {assessmentHistory.length ? (
          <div className="grid gap-4">
            {assessmentHistory.map((assessment) => (
              <AssessmentCard
                key={assessment.id}
                assessment={assessment}
                canReview={canReviewAssessment}
                t={t}
                dateFormatter={dateFormatter}
                dateTimeFormatter={dateTimeFormatter}
                numberFormatter={numberFormatter}
                locale={locale}
                onReview={openReview}
              />
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("assessmentHistoryEmpty")}</p>}
      </PanelSection>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 flex-none" />
          <div className="grid gap-1">
            <strong>{t("brandCategoryBoundaryTitle")}</strong>
            <p>{t("brandCategoryBoundaryDescription")}</p>
          </div>
        </div>
      </div>

      <PanelSection title={t("activePotentialsTitle")} description={t("activePotentialsDescription")} icon={Scale}>
        {activePotentials.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {activePotentials.map((potential) => (
              <PotentialCard
                key={potential.id}
                potential={potential}
                current
                canReview={canReviewPotential}
                t={t}
                dateFormatter={dateFormatter}
                dateTimeFormatter={dateTimeFormatter}
                numberFormatter={numberFormatter}
                onReview={openReview}
                canEnd={potential.status !== "ENDED" && (
                  canReviewPotential
                  || (actorAgentId !== null && potential.enteredByAgent?.id === actorAgentId)
                )}
                onEnd={setPotentialEndTarget}
              />
            ))}
          </div>
        ) : <EmptyState title={t("activePotentialsEmpty")} description={t("activePotentialsEmptyHint")} />}
      </PanelSection>

      <PanelSection title={t("potentialHistoryTitle")} description={t("potentialHistoryDescription")} icon={FlaskConical}>
        {potentials.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {potentials.map((potential) => (
              <PotentialCard
                key={potential.id}
                potential={potential}
                current={activePotentials.some((item) => item.id === potential.id)}
                canReview={canReviewPotential}
                t={t}
                dateFormatter={dateFormatter}
                dateTimeFormatter={dateTimeFormatter}
                numberFormatter={numberFormatter}
                onReview={openReview}
                canEnd={potential.status !== "ENDED" && (
                  canReviewPotential
                  || (actorAgentId !== null && potential.enteredByAgent?.id === actorAgentId)
                )}
                onEnd={setPotentialEndTarget}
              />
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("potentialHistoryEmpty")}</p>}
      </PanelSection>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && !reviewing && setReviewTarget(null)}>
        <DialogHeader>
          <DialogTitle>{reviewTarget?.decision === "VERIFIED" ? t("approveTitle") : t("rejectTitle")}</DialogTitle>
          <DialogDescription>{reviewTarget ? t("reviewDescription", { title: reviewTarget.title }) : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitReview}>
          <DialogContent>
            {reviewError ? (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
                {reviewError}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="scoring-review-comment">{t("reviewComment")}</Label>
              <Textarea
                id="scoring-review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                minLength={2}
                maxLength={2000}
                rows={5}
                placeholder={t("reviewCommentPlaceholder")}
                required
              />
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={reviewing} onClick={() => setReviewTarget(null)}>{t("cancel")}</Button>
            <Button type="submit" variant={reviewTarget?.decision === "REJECTED" ? "destructive" : "default"} disabled={reviewing}>
              <ClipboardCheck className="h-4 w-4" />
              {reviewing ? t("reviewing") : reviewTarget?.decision === "VERIFIED" ? t("approve") : t("reject")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <MtmAssessmentCreateDialog
        open={assessmentCreateOpen}
        onOpenChange={setAssessmentCreateOpen}
        contactId={contactId}
        asOf={asOf}
        orgId={orgId}
        onSaved={onChanged}
      />
      <MtmPotentialCreateDialog
        open={potentialCreateOpen}
        onOpenChange={setPotentialCreateOpen}
        contactId={contactId}
        asOf={asOf}
        orgId={orgId}
        agents={potentialAgents}
        eligibleVisits={eligiblePotentialVisits}
        perAgentDimension={perAgentDimension}
        onSaved={onChanged}
      />
      <MtmPotentialEndDialog
        target={potentialEndTarget}
        asOf={asOf}
        onOpenChange={(open) => !open && setPotentialEndTarget(null)}
        orgId={orgId}
        onSaved={onChanged}
      />
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-dashed border-zinc-300 p-5 text-center dark:border-zinc-700">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  )
}

function AssessmentCard({
  assessment,
  current = false,
  canReview,
  t,
  dateFormatter,
  dateTimeFormatter,
  numberFormatter,
  locale,
  onReview,
}: {
  assessment: MtmScoringAssessment
  current?: boolean
  canReview: boolean
  t: ReturnType<typeof useTranslations>
  dateFormatter: DateFormatter
  dateTimeFormatter: DateFormatter
  numberFormatter: Intl.NumberFormat
  locale: string
  onReview: (target: ReviewTarget) => void
}) {
  const actual = assessment.actualScore === null ? null : Number(assessment.actualScore)
  const target = assessment.targetScore === null ? null : Number(assessment.targetScore)
  const delta = actual !== null && target !== null ? actual - target : null
  const provenance = primitiveProvenance(assessment.provenance)
  const glossarySnapshot = professionalGlossarySnapshot(assessment.provenance)
  const glossaryTerms = professionalGlossaryTerms(assessment.formula.definition, locale)
  const title = `${assessment.formula.name} · ${assessment.formulaVersion || assessment.formula.version}`

  return (
    <article className={cn(
      "grid gap-4 rounded-2xl border p-4",
      current ? "border-primary/30 bg-primary/[0.035]" : "border-zinc-200 dark:border-zinc-700",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <ToneBadge tone={statusTone(assessment.status)}>{t(`statuses.${assessment.status}`)}</ToneBadge>
            {current ? <ToneBadge tone="positive">{t("currentlyEffective")}</ToneBadge> : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {dateFormatter.format(new Date(assessment.periodStart))} — {assessment.periodEnd ? dateFormatter.format(new Date(assessment.periodEnd)) : t("openEnded")}
          </span>
        </div>
        {assessment.status === "PENDING" && canReview ? (
          <ReviewButtons
            onApprove={() => onReview({ kind: "assessment", id: assessment.id, decision: "VERIFIED", title })}
            onReject={() => onReview({ kind: "assessment", id: assessment.id, decision: "REJECTED", title })}
            t={t}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DataTile label={t("actualScore")} value={actual === null ? null : numberFormatter.format(actual)} />
        <DataTile label={t("targetScore")} value={target === null ? null : numberFormatter.format(target)} />
        <DataTile
          label={t("scoreDifference")}
          value={delta === null ? null : numberFormatter.format(delta)}
          hint={t("scoreDifferenceHint")}
        />
        <DataTile label={t("granularCategory")} value={assessment.granularCategory} />
      </div>

      <div className="grid gap-2 rounded-xl bg-muted/40 p-3 text-xs sm:grid-cols-2">
        <span><BadgeCheck className="mr-1.5 inline h-4 w-4 text-muted-foreground" />{t("formulaSignature")}: {assessment.formula.signedAt ? dateTimeFormatter.format(new Date(assessment.formula.signedAt)) : t("signatureMissing")}</span>
        <span><CalendarClock className="mr-1.5 inline h-4 w-4 text-muted-foreground" />{t("source")}: {assessment.source}</span>
        <span>{t("enteredBy")}: {assessment.enteredByAgent?.name || t("systemActor")}</span>
        <span>{t("reviewedBy")}: {assessment.reviewedByAgent?.name || "—"}</span>
      </div>

      {glossarySnapshot ? (
        <details className="rounded-xl border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            <ShieldCheck className="mr-1.5 inline h-4 w-4" />
            {t("governedGlossaryTitle")}
          </summary>
          <div className="grid gap-3 border-t border-emerald-200 p-3 text-xs dark:border-emerald-900">
            <div className="grid gap-1 sm:grid-cols-2">
              <span>{t("glossaryHash")}: <code className="break-all">{String(glossarySnapshot.definitionHash ?? "—")}</code></span>
              <span>{t("approvalReference")}: {String(glossarySnapshot.approvalReference ?? "—")}</span>
              <span>{t("authority")}: {String(glossarySnapshot.sourceSystem ?? "—")}</span>
              <span>{t("sourceObservedAt")}: {String(glossarySnapshot.sourceObservedAt ?? "—")}</span>
            </div>
            {glossaryTerms.length ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                {glossaryTerms.map((term) => (
                  <div key={term.code} className="rounded-lg bg-background/80 p-2">
                    <dt className="font-semibold">{term.label}</dt>
                    <dd className="mt-0.5 text-muted-foreground">{term.definition}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          {t("legacyGlossaryWarning")}
        </p>
      )}

      {assessment.reviewComment ? <p className="rounded-xl border-l-4 border-primary/40 bg-muted/30 p-3 text-sm">{assessment.reviewComment}</p> : null}
      {provenance.length ? <ProvenanceRows rows={provenance} t={t} /> : null}
    </article>
  )
}

function PotentialCard({
  potential,
  current = false,
  canReview,
  t,
  dateFormatter,
  dateTimeFormatter,
  numberFormatter,
  onReview,
  canEnd,
  onEnd,
}: {
  potential: MtmBrandPotential
  current?: boolean
  canReview: boolean
  t: ReturnType<typeof useTranslations>
  dateFormatter: DateFormatter
  dateTimeFormatter: DateFormatter
  numberFormatter: Intl.NumberFormat
  onReview: (target: ReviewTarget) => void
  canEnd: boolean
  onEnd: (target: MtmPotentialEndTarget) => void
}) {
  const potentialValue = Number(potential.potentialValue)
  const coverageValue = Number(potential.coverageValue)
  const difference = potentialValue - coverageValue
  const title = [potential.brandName, potential.productName].filter(Boolean).join(" · ") || t("unnamedPotential")
  const provenance = primitiveProvenance(potential.provenance)
  const glossarySnapshot = professionalGlossarySnapshot(potential.provenance)

  return (
    <article className={cn(
      "grid gap-4 rounded-2xl border p-4",
      current ? "border-emerald-300/70 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/10" : "border-zinc-200 dark:border-zinc-700",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <ToneBadge tone={statusTone(potential.status)}>{t(`potentialStatuses.${potential.status}`)}</ToneBadge>
            {current ? <ToneBadge tone="positive">{t("currentlyEffective")}</ToneBadge> : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {potential.periodStart ? dateFormatter.format(new Date(potential.periodStart)) : t("dateMissing")} — {potential.periodEnd ? dateFormatter.format(new Date(potential.periodEnd)) : t("openEnded")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {potential.status === "PENDING" && canReview ? (
            <ReviewButtons
              onApprove={() => onReview({ kind: "potential", id: potential.id, decision: "VERIFIED", title })}
              onReject={() => onReview({ kind: "potential", id: potential.id, decision: "REJECTED", title })}
              t={t}
            />
          ) : null}
          {canEnd ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onEnd({ id: potential.id, title, periodStart: potential.periodStart })}
            >
              <CalendarClock className="h-4 w-4" />
              {t("endPeriod")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DataTile label={t("potentialValue")} value={numberFormatter.format(potentialValue)} />
        <DataTile label={t("coverageValue")} value={numberFormatter.format(coverageValue)} />
        <DataTile label={t("uncoveredDifference")} value={numberFormatter.format(difference)} hint={t("uncoveredDifferenceHint")} />
        <DataTile label={t("measurementCategory")} value={potential.categoryLabel || potential.category} hint={t("measurementCategoryHint")} />
      </div>

      <div className="grid gap-2 rounded-xl bg-muted/40 p-3 text-xs sm:grid-cols-2">
        <span>{t("source")}: {potential.source}</span>
        <span>{t("formulaVersion")}: {potential.formulaVersion || "—"}</span>
        <span>{t("owner")}: {potential.agent?.name || t("sharedDimension")}</span>
        <span>{t("enteredBy")}: {potential.enteredByAgent?.name || t("systemActor")}</span>
        <span>{t("reviewedBy")}: {potential.reviewedByAgent?.name || "—"}</span>
        <span>{t("reviewedAt")}: {potential.reviewedAt ? dateTimeFormatter.format(new Date(potential.reviewedAt)) : "—"}</span>
      </div>

      {glossarySnapshot ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/10 dark:text-emerald-100">
          <p className="font-semibold"><ShieldCheck className="mr-1.5 inline h-4 w-4" />{t("governedGlossaryTitle")}</p>
          <p className="mt-1 break-all">{t("glossaryHash")}: <code>{String(glossarySnapshot.definitionHash ?? "—")}</code></p>
          <p className="mt-1">{t("approvalReference")}: {String(glossarySnapshot.approvalReference ?? "—")}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          {t("legacyGlossaryWarning")}
        </p>
      )}

      {potential.evidenceVisits.length ? (
        <div className="grid gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold"><Link2 className="h-4 w-4" />{t("evidenceVisits", { count: potential.evidenceVisits.length })}</span>
          <div className="grid gap-2">
            {potential.evidenceVisits.map(({ visit }) => (
              <div key={visit.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                <span>{visit.customer.name}</span>
                <span className="text-muted-foreground">{visit.checkInAt ? dateTimeFormatter.format(new Date(visit.checkInAt)) : t("dateMissing")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : <span className="text-xs text-muted-foreground">{t("evidenceMissing")}</span>}

      {potential.reviewComment ? <p className="rounded-xl border-l-4 border-primary/40 bg-muted/30 p-3 text-sm">{potential.reviewComment}</p> : null}
      {provenance.length ? <ProvenanceRows rows={provenance} t={t} /> : null}
    </article>
  )
}

function ReviewButtons({
  onApprove,
  onReject,
  t,
}: {
  onApprove: () => void
  onReject: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onReject}>{t("reject")}</Button>
      <Button type="button" size="sm" onClick={onApprove}>{t("approve")}</Button>
    </div>
  )
}

function ProvenanceRows({
  rows,
  t,
}: {
  rows: Array<[string, string]>
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <details className="rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-700">
      <summary className="cursor-pointer font-semibold">{t("provenance")}</summary>
      <dl className="mt-3 grid gap-2">
        {rows.map(([key, value]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
