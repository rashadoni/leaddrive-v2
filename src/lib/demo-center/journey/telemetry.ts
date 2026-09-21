import { activeSections, type DemoJourneySnapshot } from "./snapshot"
import type { DemoJourneyManifest, DemoJourneySection, DemoJourneyState } from "./types"

/**
 * What a granted session tells the server about its progress.
 *
 * The story runs in the prospect's browser; until this existed the server
 * knew that a session had started and nothing else, so a salesperson could
 * not tell a prospect who stopped at the first screen from one who closed
 * the deal. A session now reports what moved the story and which clips it
 * played. Views are not reported: they are not worth a request each.
 *
 * Every name a report carries must exist in the grant's own scenario — the
 * browser cannot write an arbitrary step or state into the admin's timeline.
 */
export const REPORTED_JOURNEY_EVENTS = [
  "journey.section_opened",
  "journey.step_completed",
  "journey.step_skipped",
  "journey.transition",
  "journey.completed",
  "video.started",
  "video.completed",
  "video.error",
] as const
export type ReportedJourneyEvent = (typeof REPORTED_JOURNEY_EVENTS)[number]

/**
 * «Still here», sent at most once a minute while the prospect clicks, reads
 * or scrolls. Never stored: it only keeps the session's idle clock honest.
 * Before it, nothing in the story touched the server, so an active prospect
 * was locked out after the grant's inactivity window (30 minutes by
 * default) — shorter than the story itself.
 */
export const JOURNEY_ACTIVITY_EVENT = "journey.step_viewed"
export const JOURNEY_ACTIVITY_EVERY_MS = 60_000
export const JOURNEY_REPORT_NAMES = [...REPORTED_JOURNEY_EVENTS, JOURNEY_ACTIVITY_EVENT] as const
export type JourneyReportName = (typeof JOURNEY_REPORT_NAMES)[number]

/** One report as the browser sends it; the route validates it with
 *  `demoJourneyReportSchema` (../validation.ts) before anything here runs. */
export interface DemoJourneyReport {
  readonly eventType: "JOURNEY"
  readonly name: JourneyReportName
  readonly sectionId: string
  readonly stepId?: string
  readonly to?: DemoJourneyState
}

/** A session reports tens of events, never hundreds; past this the rest are dropped. */
export const JOURNEY_EVENTS_PER_GRANT = 400

/** States a section's own steps can move the story to. */
function sectionTargets(section: DemoJourneySection): Set<DemoJourneyState> {
  const targets = new Set<DemoJourneyState>(section.exitStates)
  for (const step of section.steps) {
    if (step.completion.kind === "transition") targets.add(step.completion.to)
    if (step.completion.kind === "outcome") for (const state of step.completion.to) targets.add(state)
  }
  return targets
}

export type AcceptedJourneyReport =
  | { readonly ok: true; readonly stepId: string | null; readonly metadata: Record<string, string> }
  | { readonly ok: false; readonly reason: string }

/** Checks a report against the scenario the grant was issued with. */
export function acceptJourneyReport(manifest: DemoJourneyManifest, report: DemoJourneyReport): AcceptedJourneyReport {
  const sections = activeSections(manifest)
  const section = sections.find((candidate) => candidate.id === report.sectionId)
  if (!section) return { ok: false, reason: "unknown section" }
  const metadata: Record<string, string> = { sectionId: section.id }

  switch (report.name) {
    case "journey.step_completed":
    case "journey.step_skipped": {
      const step = section.steps.find((candidate) => candidate.id === report.stepId)
      if (!step) return { ok: false, reason: "unknown step" }
      if (report.name === "journey.step_skipped" && step.required) return { ok: false, reason: "a required step is never skipped" }
      return { ok: true, stepId: step.id, metadata }
    }
    case "journey.transition": {
      if (!report.to || !sectionTargets(section).has(report.to)) return { ok: false, reason: "state not reachable from this section" }
      return { ok: true, stepId: null, metadata: { ...metadata, to: report.to } }
    }
    case "journey.completed": {
      if (section.id !== sections[sections.length - 1]?.id) return { ok: false, reason: "the story ends in its last section" }
      return { ok: true, stepId: null, metadata }
    }
    case "video.started":
    case "video.completed":
    case "video.error": {
      if (section.intro?.status !== "available") return { ok: false, reason: "no clip in this section" }
      return { ok: true, stepId: null, metadata: { ...metadata, slug: section.intro.slug } }
    }
    case "journey.section_opened":
    case JOURNEY_ACTIVITY_EVENT:
      return { ok: true, stepId: null, metadata }
  }
}

/** The reports one move of the story produced: what differs between two snapshots. */
export function journeyReportsBetween(before: DemoJourneySnapshot, after: DemoJourneySnapshot): DemoJourneyReport[] {
  const reports: DemoJourneyReport[] = []
  const done = new Set(before.completedSteps)
  for (const stepId of after.completedSteps) {
    if (!done.has(stepId)) reports.push({ eventType: "JOURNEY", name: "journey.step_completed", sectionId: before.sectionId, stepId })
  }
  const skipped = new Set(before.skippedSteps)
  for (const stepId of after.skippedSteps) {
    if (!skipped.has(stepId)) reports.push({ eventType: "JOURNEY", name: "journey.step_skipped", sectionId: before.sectionId, stepId })
  }
  if (after.state !== before.state) {
    reports.push({ eventType: "JOURNEY", name: "journey.transition", sectionId: before.sectionId, to: after.state })
  }
  if (after.sectionId !== before.sectionId) {
    reports.push({ eventType: "JOURNEY", name: "journey.section_opened", sectionId: after.sectionId })
  }
  if (after.completedAt && !before.completedAt) {
    reports.push({ eventType: "JOURNEY", name: "journey.completed", sectionId: after.sectionId })
  }
  return reports
}

export interface JourneyEventRow {
  readonly eventType: string
  readonly stepId: string | null
  readonly metadata: unknown
  readonly occurredAt: Date
}

export interface JourneySummary {
  readonly sectionsTotal: number
  readonly sectionsReached: number
  readonly furthestSectionId: string | null
  readonly stepsRequired: number
  readonly stepsDone: number
  readonly lastState: string | null
  readonly completed: boolean
  readonly clipsStarted: readonly string[]
  readonly clipsCompleted: readonly string[]
  readonly lastActivityAt: Date | null
}

function metadataField(metadata: unknown, field: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[field]
  return typeof value === "string" ? value : null
}

/** How far a session got, for the admin's view of one grant. */
export function summarizeJourney(manifest: DemoJourneyManifest, rows: readonly JourneyEventRow[]): JourneySummary {
  const sections = activeSections(manifest)
  const order = new Map(sections.map((section, index) => [section.id, index]))
  const required = new Set(sections.flatMap((section) => section.steps.filter((step) => step.required).map((step) => step.id)))
  const sorted = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  let furthest = -1
  let lastState: string | null = null
  let completed = false
  const done = new Set<string>()
  const started: string[] = []
  const finished: string[] = []
  for (const row of sorted) {
    const sectionIndex = order.get(metadataField(row.metadata, "sectionId") ?? "")
    if (sectionIndex !== undefined && row.eventType.startsWith("journey.")) furthest = Math.max(furthest, sectionIndex)
    if (row.eventType === "journey.step_completed" && row.stepId && required.has(row.stepId)) done.add(row.stepId)
    if (row.eventType === "journey.transition") lastState = metadataField(row.metadata, "to") ?? lastState
    if (row.eventType === "journey.completed") completed = true
    const slug = metadataField(row.metadata, "slug")
    if (slug && row.eventType === "video.started" && !started.includes(slug)) started.push(slug)
    if (slug && row.eventType === "video.completed" && !finished.includes(slug)) finished.push(slug)
  }

  return {
    sectionsTotal: sections.length,
    sectionsReached: completed ? sections.length : furthest + 1,
    furthestSectionId: furthest >= 0 ? sections[furthest].id : null,
    stepsRequired: required.size,
    stepsDone: done.size,
    lastState,
    completed,
    clipsStarted: started,
    clipsCompleted: finished,
    lastActivityAt: sorted.length ? sorted[sorted.length - 1].occurredAt : null,
  }
}
