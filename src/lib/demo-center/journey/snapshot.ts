/**
 * Journey snapshot and reducer — the durable, reconstructable state of one
 * prospect's guided session.
 *
 * Pure: the renderer dispatches actions, the reducer returns a new snapshot
 * (or the same one with an error). Phase B keeps the snapshot in the
 * browser; Phase C persists it server-side under the capability session.
 * Either way the rules are these, so refresh restores the same step and
 * back/forward can never repeat an effect.
 */
import { applyTransitionEffects, createJourneyRecords, type DemoJourneyRecords, type DemoProspectIdentity } from "./records"
import { canTransition, isTerminalJourneyState, journeyPath } from "./state"
import type { DemoJourneyManifest, DemoJourneySection, DemoJourneyState, DemoJourneyStep } from "./types"
import { DEMO_JOURNEY_STATES } from "./types"

export const DEMO_SNAPSHOT_VERSION = 1

export type DemoUiValue = string | number | boolean

export interface DemoJourneySnapshot {
  readonly version: typeof DEMO_SNAPSHOT_VERSION
  readonly scenarioId: string
  readonly scenarioVersion: number
  readonly identity: DemoProspectIdentity
  readonly state: DemoJourneyState
  /** The frontier: the step waiting to be completed. */
  readonly sectionId: string
  readonly stepId: string
  readonly completedSteps: readonly string[]
  readonly skippedSteps: readonly string[]
  readonly visitedSections: readonly string[]
  readonly ui: Readonly<Record<string, DemoUiValue>>
  readonly records: DemoJourneyRecords
  readonly startedAt: string
  readonly updatedAt: string
  readonly completedAt: string | null
}

export type DemoJourneyAction =
  | { readonly type: "complete-step"; readonly stepId: string }
  | { readonly type: "skip-step"; readonly stepId: string }
  | { readonly type: "ui"; readonly path: string; readonly value: DemoUiValue }
  | { readonly type: "transition"; readonly stepId: string; readonly to: DemoJourneyState }
  | { readonly type: "outcome"; readonly stepId: string; readonly to: DemoJourneyState }
  | { readonly type: "expire" }
  | { readonly type: "revoke" }

export interface DemoJourneyReduceResult {
  readonly ok: boolean
  readonly snapshot: DemoJourneySnapshot
  readonly error?: string
  /** Step that was closed by this action, if any. */
  readonly completedStep?: string
  /** Journey state entered by this action, if any. */
  readonly transitioned?: DemoJourneyState
}

/** Sections the granted capabilities allow. A section that requires an
 *  ungranted capability is dropped only when the story can continue without
 *  it (its entry states include an exit state); otherwise it stays and the
 *  renderer shows its `skippedNotice`. */
export function activeSections(manifest: DemoJourneyManifest): readonly DemoJourneySection[] {
  return manifest.sections.filter((section) => {
    const unmet = section.requires.some((capability) => !manifest.capabilities[capability])
    if (!unmet) return true
    const passThrough = section.entryStates.some((state) => section.exitStates.includes(state))
    return !passThrough
  })
}

export function findSection(manifest: DemoJourneyManifest, sectionId: string): DemoJourneySection | undefined {
  return manifest.sections.find((section) => section.id === sectionId)
}

export function findStep(manifest: DemoJourneyManifest, stepId: string): { section: DemoJourneySection; step: DemoJourneyStep; index: number } | undefined {
  for (const section of manifest.sections) {
    const index = section.steps.findIndex((step) => step.id === stepId)
    if (index >= 0) return { section, step: section.steps[index], index }
  }
  return undefined
}

export function createJourneySnapshot(
  manifest: DemoJourneyManifest,
  identity: DemoProspectIdentity,
  now: Date,
): DemoJourneySnapshot {
  const sections = activeSections(manifest)
  const first = sections[0]
  if (!first) throw new Error("Scenario has no active sections")
  const at = now.toISOString()
  return {
    version: DEMO_SNAPSHOT_VERSION,
    scenarioId: manifest.scenarioId,
    scenarioVersion: manifest.version,
    identity,
    state: "STARTED",
    sectionId: first.id,
    stepId: first.steps[0].id,
    completedSteps: [],
    skippedSteps: [],
    visitedSections: [first.id],
    ui: {},
    records: createJourneyRecords(identity, now),
    startedAt: at,
    updatedAt: at,
    completedAt: null,
  }
}

function advance(snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest): DemoJourneySnapshot {
  const sections = activeSections(manifest)
  const sectionIndex = sections.findIndex((section) => section.id === snapshot.sectionId)
  const section = sections[sectionIndex]
  if (!section) return snapshot
  const stepIndex = section.steps.findIndex((step) => step.id === snapshot.stepId)
  const nextStep = section.steps[stepIndex + 1]
  if (nextStep) return { ...snapshot, stepId: nextStep.id }
  const nextSection = sections[sectionIndex + 1]
  if (!nextSection) return snapshot
  return {
    ...snapshot,
    sectionId: nextSection.id,
    stepId: nextSection.steps[0].id,
    visitedSections: snapshot.visitedSections.includes(nextSection.id)
      ? snapshot.visitedSections
      : [...snapshot.visitedSections, nextSection.id],
  }
}

function closeStep(snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest, stepId: string, now: Date): DemoJourneySnapshot {
  const closed = {
    ...snapshot,
    completedSteps: snapshot.completedSteps.includes(stepId) ? snapshot.completedSteps : [...snapshot.completedSteps, stepId],
    updatedAt: now.toISOString(),
  }
  return advance(closed, manifest)
}

export function reduceJourney(
  snapshot: DemoJourneySnapshot,
  action: DemoJourneyAction,
  manifest: DemoJourneyManifest,
  now: Date,
): DemoJourneyReduceResult {
  const fail = (error: string): DemoJourneyReduceResult => ({ ok: false, snapshot, error })

  if (action.type === "expire" || action.type === "revoke") {
    const to: DemoJourneyState = action.type === "expire" ? "EXPIRED" : "REVOKED"
    if (isTerminalJourneyState(snapshot.state)) return fail(`journey is already ${snapshot.state}`)
    return { ok: true, snapshot: { ...snapshot, state: to, updatedAt: now.toISOString() }, transitioned: to }
  }

  if (isTerminalJourneyState(snapshot.state)) return fail(`journey is ${snapshot.state}; no further actions`)

  const located = findStep(manifest, snapshot.stepId)
  if (!located) return fail(`current step "${snapshot.stepId}" is not in the scenario`)
  const { step } = located

  switch (action.type) {
    case "complete-step": {
      if (action.stepId !== step.id) return fail(`"${action.stepId}" is not the current step ("${step.id}")`)
      if (step.completion.kind !== "viewed") return fail(`"${step.id}" needs a real action, it cannot be completed by viewing`)
      return { ok: true, snapshot: closeStep(snapshot, manifest, step.id, now), completedStep: step.id }
    }

    case "skip-step": {
      if (action.stepId !== step.id) return fail(`"${action.stepId}" is not the current step ("${step.id}")`)
      if (step.required) return fail(`"${step.id}" is required and cannot be skipped`)
      const skipped = { ...snapshot, skippedSteps: [...snapshot.skippedSteps, step.id], updatedAt: now.toISOString() }
      return { ok: true, snapshot: advance(skipped, manifest) }
    }

    case "ui": {
      const next = { ...snapshot, ui: { ...snapshot.ui, [action.path]: action.value }, updatedAt: now.toISOString() }
      const rule = step.completion
      if (rule.kind === "snapshot" && rule.path === action.path && rule.equals === action.value) {
        return { ok: true, snapshot: closeStep(next, manifest, step.id, now), completedStep: step.id }
      }
      return { ok: true, snapshot: next }
    }

    case "transition": {
      if (action.stepId !== step.id) return fail(`"${action.stepId}" is not the current step ("${step.id}")`)
      const rule = step.completion
      if (rule.kind !== "transition") return fail(`"${step.id}" does not transition the journey`)
      if (rule.to !== action.to) return fail(`"${step.id}" moves to ${rule.to}, not ${action.to}`)
      if (!canTransition(snapshot.state, action.to)) return fail(`transition ${snapshot.state} → ${action.to} is not allowed`)
      const moved: DemoJourneySnapshot = {
        ...snapshot,
        state: action.to,
        records: applyTransitionEffects(snapshot.records, action.to, snapshot.identity, now),
        completedAt: action.to === "COMPLETED" ? now.toISOString() : snapshot.completedAt,
      }
      return { ok: true, snapshot: closeStep(moved, manifest, step.id, now), completedStep: step.id, transitioned: action.to }
    }

    case "outcome": {
      if (action.stepId !== step.id) return fail(`"${action.stepId}" is not the current step ("${step.id}")`)
      const rule = step.completion
      if (rule.kind !== "outcome") return fail(`"${step.id}" does not wait for an outcome`)
      if (!rule.to.includes(action.to)) return fail(`"${step.id}" cannot end in ${action.to}`)
      const path = journeyPath(snapshot.state, action.to)
      if (!path) return fail(`no legal path ${snapshot.state} → ${action.to}`)
      let records = snapshot.records
      for (const state of path) records = applyTransitionEffects(records, state, snapshot.identity, now)
      const moved: DemoJourneySnapshot = { ...snapshot, state: action.to, records }
      return { ok: true, snapshot: closeStep(moved, manifest, step.id, now), completedStep: step.id, transitioned: action.to }
    }

    default:
      return fail("unknown action")
  }
}

export interface DemoJourneyProgress {
  readonly requiredTotal: number
  readonly requiredDone: number
  readonly sectionsTotal: number
  readonly sectionsDone: number
}

export function journeyProgress(snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest): DemoJourneyProgress {
  const sections = activeSections(manifest)
  const required = sections.flatMap((section) => section.steps.filter((step) => step.required).map((step) => step.id))
  const done = new Set(snapshot.completedSteps)
  const currentIndex = sections.findIndex((section) => section.id === snapshot.sectionId)
  const sectionsDone = snapshot.state === "COMPLETED" ? sections.length : Math.max(0, currentIndex)
  return {
    requiredTotal: required.length,
    requiredDone: required.filter((id) => done.has(id)).length,
    sectionsTotal: sections.length,
    sectionsDone,
  }
}

export function sectionStatus(
  snapshot: DemoJourneySnapshot,
  manifest: DemoJourneyManifest,
  sectionId: string,
): "done" | "current" | "upcoming" {
  if (snapshot.state === "COMPLETED") return "done"
  const sections = activeSections(manifest)
  const currentIndex = sections.findIndex((section) => section.id === snapshot.sectionId)
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index < 0) return "upcoming"
  if (index < currentIndex) return "done"
  if (index === currentIndex) return "current"
  return "upcoming"
}

/** Sidebar routes the prospect may open: every route whose section has been
 *  reached. Nothing ahead of the story is clickable. */
export function reachableRoutes(snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest): readonly string[] {
  const routes = new Set<string>()
  for (const section of manifest.sections) {
    if (section.navGroup === "demo") continue
    if (snapshot.visitedSections.includes(section.id) || snapshot.state === "COMPLETED") {
      routes.add(section.route.replace(/\/\[[a-zA-Z]+\]$/, ""))
    }
  }
  return [...routes]
}

export function serializeSnapshot(snapshot: DemoJourneySnapshot): string {
  return JSON.stringify(snapshot)
}

/** Parses a stored snapshot; anything from another scenario/version or with
 *  an unknown state is discarded so a stale browser never resumes a story
 *  the server no longer issues. */
export function parseSnapshot(raw: string | null | undefined, manifest: DemoJourneyManifest): DemoJourneySnapshot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<DemoJourneySnapshot> | null
    if (!value || typeof value !== "object") return null
    if (value.version !== DEMO_SNAPSHOT_VERSION) return null
    if (value.scenarioId !== manifest.scenarioId || value.scenarioVersion !== manifest.version) return null
    if (typeof value.state !== "string" || !(DEMO_JOURNEY_STATES as readonly string[]).includes(value.state)) return null
    if (typeof value.sectionId !== "string" || typeof value.stepId !== "string") return null
    if (!findStep(manifest, value.stepId) || !findSection(manifest, value.sectionId)) return null
    if (!value.records || !value.identity || !Array.isArray(value.completedSteps)) return null
    return value as DemoJourneySnapshot
  } catch {
    return null
  }
}
