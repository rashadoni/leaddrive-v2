"use client"

import { useLocale, useTranslations } from "next-intl"
import type { WorkforceExceptionRecordedOutcomes } from "@/lib/workforce/exception-case-report-recorded-outcomes"

/** Use elapsed units rather than clock formatting, which wraps at 24 hours. */
export function formatRecordedResolutionDuration(milliseconds: number | null, locale: string): string | null {
  if (milliseconds === null || !Number.isSafeInteger(milliseconds) || milliseconds < 0) return null
  const [divisor, unit] = milliseconds >= 86_400_000 ? [86_400_000, "day"]
    : milliseconds >= 3_600_000 ? [3_600_000, "hour"]
      : milliseconds >= 60_000 ? [60_000, "minute"] : [1_000, "second"]
  return new Intl.NumberFormat(locale, {
    style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 3,
  }).format(milliseconds / divisor)
}

export function WorkforceExceptionRecordedOutcomesSummary({ outcomes }: { outcomes: WorkforceExceptionRecordedOutcomes }) {
  const t = useTranslations("workforceExceptionReport.recordedOutcomes")
  const locale = useLocale()
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 })
  const correction = outcomes.linkedCorrection
  const resolution = outcomes.firstResolution
  const final = outcomes.finalClassification
  const share = (value: number | null) => value === null ? t("noClassifiedSamples") : percent.format(value)
  const duration = (value: number | null) => formatRecordedResolutionDuration(value, locale) ?? t("unavailable")

  return <section data-testid="workforce-exception-recorded-outcomes" aria-labelledby="workforce-exception-recorded-outcomes-title" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
    <h2 id="workforce-exception-recorded-outcomes-title" className="font-semibold">{t("title")}</h2>
    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("cohortHint")}</p>
    <dl className="mt-4 grid gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-sm font-medium">{t("linkedCorrection")}</dt>
        <dd data-testid="workforce-exception-recorded-link-share" className="mt-1 text-xl font-semibold tabular-nums">{correction.share === null ? t("noCases") : percent.format(correction.share)}</dd>
        <dd className="mt-1 text-sm tabular-nums">{t("linkedCount", { linked: number.format(correction.recordedLinkedCorrectionCases), cases: number.format(correction.cohortCases) })}</dd>
        <dd className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{t("linkedHint")}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-sm font-medium">{t("firstResolution")}</dt>
        <dd data-testid="workforce-exception-recorded-resolution-mean" className="mt-1 text-xl font-semibold tabular-nums">{resolution.meanMs === null ? t("noSamples") : duration(resolution.meanMs)}</dd>
        <dd className="mt-1 text-sm tabular-nums">{t("durationRange", { min: duration(resolution.minMs), max: duration(resolution.maxMs) })}</dd>
        <dd className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{t("resolutionHint")}</dd>
      </div>
    </dl>
    <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-700">
      <Count label={t("samples")} value={resolution.sampleCount} number={number} />
      <Count label={t("unresolved")} value={resolution.unresolvedCases} number={number} />
      <Count label={t("integrityExcluded")} value={resolution.integrityExcludedCases} number={number} />
    </dl>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{t("sampleHint")}</p>
    <h3 className="mt-6 font-semibold">{t("classificationTitle")}</h3>
    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("classificationHint")}</p>
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
      <div><dt>{t("falsePositive")}</dt><dd data-testid="workforce-exception-false-positive-share" className="mt-1 font-semibold tabular-nums">{share(final.falsePositive.share)}</dd>
        <dd className="mt-1 text-sm">{t("classifiedCount", { count: final.falsePositive.falsePositiveCases, sample: final.falsePositive.sampleCount })}</dd></div>
      <div><dt>{t("appealFull")}</dt><dd data-testid="workforce-exception-appeal-full-share" className="mt-1 font-semibold tabular-nums">{share(final.appeal.fullyUpheldShare)}</dd>
        <dd className="mt-1 text-sm">{t("classifiedCount", { count: final.appeal.fullyUpheldCases, sample: final.appeal.sampleCount })}</dd></div>
      <div><dt>{t("appealPartial")}</dt><dd data-testid="workforce-exception-appeal-partial-share" className="mt-1 font-semibold tabular-nums">{share(final.appeal.partiallyUpheldShare)}</dd>
        <dd className="mt-1 text-sm">{t("classifiedCount", { count: final.appeal.partiallyUpheldCases, sample: final.appeal.sampleCount })}</dd></div>
      <div><dt>{t("appealRejected")}</dt><dd data-testid="workforce-exception-appeal-rejected-share" className="mt-1 font-semibold tabular-nums">{share(final.appeal.rejectedShare)}</dd>
        <dd className="mt-1 text-sm">{t("classifiedCount", { count: final.appeal.rejectedCases, sample: final.appeal.sampleCount })}</dd></div>
    </dl>
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
      <Count label={t("classificationSamples")} value={final.falsePositive.sampleCount} number={number} />
      <Count label={t("appealSamples")} value={final.appeal.sampleCount} number={number} />
      <Count label={t("unfinishedCases")} value={final.unfinishedCases} number={number} />
      <Count label={t("unclassifiedResolved")} value={final.falsePositive.unclassifiedResolvedCases} number={number} />
      <Count label={t("unclassifiedAppeal")} value={final.appeal.unclassifiedResolvedCases} number={number} />
      <Count label={t("finalIntegrityExcluded")} value={final.integrityExcludedCases} number={number} />
    </dl>
  </section>
}

function Count({ label, value, number }: { label: string; value: number; number: Intl.NumberFormat }) {
  return <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{number.format(value)}</dd></div>
}
