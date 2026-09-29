"use client"

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  createWorkforceShiftSegmentDraft,
  nextWorkforceShiftSegmentWindow,
  WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES,
  type WorkforceShiftSegmentDraft,
  type WorkforceShiftSegmentStoredMode,
  type WorkforceShiftSegmentValidationIssue,
} from "@/lib/workforce/shift-segment-draft"

export type WorkforceShiftSegmentSite = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "ARCHIVED"
}

export type WorkforceShiftSegmentRecord = {
  id: string
  sequence: number
  mode: WorkforceShiftSegmentStoredMode
  siteId: string | null
  startTime: string
  endTime: string
  lateGraceSeconds: number
  proofPolicyReference: string | null
}

function moveSegment(
  segments: readonly WorkforceShiftSegmentDraft[],
  index: number,
  direction: -1 | 1,
): WorkforceShiftSegmentDraft[] {
  const destination = index + direction
  if (destination < 0 || destination >= segments.length) return [...segments]
  const next = [...segments]
  const [segment] = next.splice(index, 1)
  if (!segment) return next
  next.splice(destination, 0, segment)
  return next
}

function siteLabel(site: WorkforceShiftSegmentSite | undefined, unavailable: string): string {
  if (!site) return unavailable
  return site.name + (site.code ? ` · ${site.code}` : "")
}

export function WorkforceShiftSegmentEditor(props: {
  segments: readonly WorkforceShiftSegmentDraft[]
  sites: readonly WorkforceShiftSegmentSite[]
  shiftStartTime: string
  shiftEndTime: string
  plannedBreaks: ReadonlyArray<{ startTime: string; endTime: string }>
  validationIssue: WorkforceShiftSegmentValidationIssue | null
  onChange: (segments: WorkforceShiftSegmentDraft[]) => void
}) {
  const t = useTranslations("workforceConfigurationPage")
  const activeSites = props.sites.filter((site) => site.status === "ACTIVE")

  function updateSegment(index: number, update: Partial<WorkforceShiftSegmentDraft>) {
    props.onChange(props.segments.map((segment, itemIndex) => (
      itemIndex === index ? { ...segment, ...update } : segment
    )))
  }

  function addSegment() {
    const window = nextWorkforceShiftSegmentWindow({
      segments: props.segments,
      shiftStartTime: props.shiftStartTime,
      shiftEndTime: props.shiftEndTime,
      plannedBreaks: props.plannedBreaks,
    })
    props.onChange([
      ...props.segments,
      createWorkforceShiftSegmentDraft({
        editorKey: crypto.randomUUID(),
        startTime: window.startTime,
        endTime: window.endTime,
      }),
    ])
  }

  return (
    <fieldset className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700" data-testid="workforce-shift-segment-editor">
      <legend className="text-sm font-medium">{t("shiftSegments")}</legend>
      <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <p id="workforce-shift-segments-hint" className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("shiftSegmentsHint")}</p>
        <p role="status" aria-live="polite" aria-atomic="true" className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {t("shiftSegmentCount", { count: props.segments.length, maximum: 24 })}
        </p>
      </div>

      {props.segments.length === 0 ? (
        <div className="mt-4 border-y border-dashed border-zinc-200 py-5 dark:border-zinc-700">
          <p className="text-sm font-medium">{t("shiftSegmentsEmptyTitle")}</p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("shiftSegmentsEmptyHint")}</p>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700" aria-describedby={props.validationIssue ? "workforce-shift-segments-hint workforce-shift-segments-error" : "workforce-shift-segments-hint"}>
          {props.segments.map((segment, index) => {
            const currentSite = segment.siteId == null
              ? undefined
              : props.sites.find((site) => site.id === segment.siteId)
            const currentSiteIsSelectable = currentSite?.status === "ACTIVE"
            const releasedMode = WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES.some((mode) => mode === segment.mode)

            return (
              <li key={segment.editorKey} className="py-5" data-testid={`workforce-shift-segment-${index + 1}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold tabular-nums dark:bg-zinc-800" aria-hidden="true">{index + 1}</span>
                    <p className="font-medium">{t("shiftSegmentTitle", { value: index + 1 })}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="icon" className="size-11" disabled={index === 0} aria-label={t("moveShiftSegmentUp", { value: index + 1 })} title={t("moveShiftSegmentUp", { value: index + 1 })} onClick={() => props.onChange(moveSegment(props.segments, index, -1))}><ArrowUp aria-hidden="true" /></Button>
                    <Button type="button" variant="outline" size="icon" className="size-11" disabled={index === props.segments.length - 1} aria-label={t("moveShiftSegmentDown", { value: index + 1 })} title={t("moveShiftSegmentDown", { value: index + 1 })} onClick={() => props.onChange(moveSegment(props.segments, index, 1))}><ArrowDown aria-hidden="true" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="size-11" disabled={props.segments.length === 1} aria-label={t("removeShiftSegment", { value: index + 1 })} title={t("removeShiftSegment", { value: index + 1 })} onClick={() => props.onChange(props.segments.filter((_, itemIndex) => itemIndex !== index))}><X aria-hidden="true" /></Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Select id={`workforce-shift-segment-${index}-mode`} label={t("shiftSegmentMode")} value={segment.mode} onChange={(event) => {
                    const mode = WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES.find((candidate) => candidate === event.target.value)
                    if (!mode) return
                    updateSegment(index, {
                      mode,
                      siteId: mode === "SITE" ? segment.siteId : null,
                    })
                  }} required>
                    {!releasedMode ? <option value={segment.mode} disabled>{t("shiftSegmentModeUnavailable")}</option> : null}
                    {WORKFORCE_SHIFT_SEGMENT_EDITOR_MODES.map((mode) => <option key={mode} value={mode}>{t(`shiftSegmentModes.${mode}`)}</option>)}
                  </Select>
                  {segment.mode === "SITE" ? (
                    <Select id={`workforce-shift-segment-${index}-site`} label={t("shiftSegmentSite")} value={segment.siteId ?? ""} onChange={(event) => updateSegment(index, { siteId: event.target.value || null })} required>
                      <option value="">{t("selectActiveSite")}</option>
                      {segment.siteId && !currentSiteIsSelectable ? <option value={segment.siteId} disabled>{currentSite ? `${siteLabel(currentSite, t("unavailableSite"))} · ${t("directoryStatus.ARCHIVED")}` : t("unavailableSite")}</option> : null}
                      {activeSites.map((site) => <option key={site.id} value={site.id}>{siteLabel(site, t("unavailableSite"))}</option>)}
                    </Select>
                  ) : (
                    <div className="hidden xl:block" aria-hidden="true" />
                  )}
                  <div className="space-y-1.5"><label htmlFor={`workforce-shift-segment-${index}-start`} className="text-sm font-medium">{t("shiftSegmentStart")}</label><Input id={`workforce-shift-segment-${index}-start`} type="time" value={segment.startTime} onChange={(event) => updateSegment(index, { startTime: event.target.value })} required /></div>
                  <div className="space-y-1.5"><label htmlFor={`workforce-shift-segment-${index}-end`} className="text-sm font-medium">{t("shiftSegmentEnd")}</label><Input id={`workforce-shift-segment-${index}-end`} type="time" value={segment.endTime} onChange={(event) => updateSegment(index, { endTime: event.target.value })} required /></div>
                  <div className="space-y-1.5"><label htmlFor={`workforce-shift-segment-${index}-grace`} className="text-sm font-medium">{t("shiftSegmentGrace")}</label><Input id={`workforce-shift-segment-${index}-grace`} type="number" min={0} max={7200} step={1} inputMode="numeric" value={segment.lateGraceSeconds} onChange={(event) => updateSegment(index, { lateGraceSeconds: event.target.value })} required /></div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {props.validationIssue ? (
        <p id="workforce-shift-segments-error" role="alert" className="mt-3 text-sm font-medium text-destructive">
          {t(`shiftSegmentValidation.${props.validationIssue}`)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" disabled={props.segments.length >= 24} onClick={addSegment}><Plus aria-hidden="true" />{t("addShiftSegment")}</Button>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{t("shiftSegmentProofPolicyHint")}</p>
      </div>
    </fieldset>
  )
}

export function WorkforceShiftSegmentSummary(props: {
  segments: readonly WorkforceShiftSegmentRecord[]
  sites: readonly WorkforceShiftSegmentSite[]
}) {
  const t = useTranslations("workforceConfigurationPage")

  if (props.segments.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{t("shiftSegmentsSingleWindowSummary")}</p>
  }

  return (
    <ol className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
      {props.segments.map((segment, index) => {
        const site = segment.siteId == null ? undefined : props.sites.find((candidate) => candidate.id === segment.siteId)
        return (
          <li key={segment.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
            <span className="font-medium tabular-nums">{index + 1}.</span>
            <span>{t(`shiftSegmentModes.${segment.mode}`)}</span>
            {segment.mode === "SITE" ? <span>· {siteLabel(site, t("unavailableSite"))}</span> : null}
            <span className="tabular-nums text-muted-foreground">· {segment.startTime}–{segment.endTime}</span>
            <span className="text-muted-foreground">· {t("shiftSegmentGraceSummary", { value: segment.lateGraceSeconds })}</span>
          </li>
        )
      })}
    </ol>
  )
}
