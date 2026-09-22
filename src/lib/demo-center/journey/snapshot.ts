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
  | { readonly type: "open-section"; readonly sectionId: string }
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

/** Staged records are spaced up to this far apart, so a lead's timeline still reads in order. */
const STAGED_STEP_MS = 60_000

/**
 * The story is on a step that waits for something real to end — the live AI
 * call: before it is asked for, while it rings, until its outcome comes
 * back. The snapshot's state does not show a call on the line (the browser
 * keeps «queued / ringing» itself and records only the outcome), so the
 * frontier step is what tells.
 */
export function awaitingOutcome(snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest): boolean {
  const section = findSection(manifest, snapshot.sectionId)
  return Boolean(section?.steps.some((step) => step.completion.kind === "outcome" && !snapshot.completedSteps.includes(step.id)))
}

/**
 * Where a jump to `sectionId` really lands, or why it cannot: sections ahead
 * of the story only (behind it, the player shows them read-only), never the
 * story's own shell (orientation, summary), never away from the live AI call
 * while it waits for its outcome (the prospect leaves it with «Zəngsiz davam
 * et» or by calling), and never past it: a jump stops there, so the one real
 * call is not skipped without the prospect seeing it.
 */
export function sectionJumpTarget(
  snapshot: DemoJourneySnapshot,
  manifest: DemoJourneyManifest,
  sectionId: string,
): { ok: true; section: DemoJourneySection } | { ok: false; error: string } {
  const sections = activeSections(manifest)
  const targetIndex = sections.findIndex((section) => section.id === sectionId)
  const frontierIndex = sections.findIndex((section) => section.id === snapshot.sectionId)
  const target = sections[targetIndex]
  if (!target) return { ok: false, error: `section "${sectionId}" is not in this story` }
  if (target.navGroup === "demo") return { ok: false, error: `"${target.id}" is reached by the story, not opened directly` }
  if (targetIndex <= frontierIndex) return { ok: false, error: `"${target.id}" is not ahead of the story` }
  if (awaitingOutcome(snapshot, manifest)) return { ok: false, error: "the live call waits for its outcome" }
  const waitsForOutcome = sections
    .slice(frontierIndex + 1, targetIndex)
    .find((section) => section.steps.some((step) => step.completion.kind === "outcome"))
  return { ok: true, section: waitsForOutcome ?? target }
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

    case "open-section": {
      // Owner, 2026-09-22: «если клиент сразу интересуется, например,
      // омни-каналом, зачем ему обязательно переходить по всем разделам?»
      // The story jumps to the section and stages what the sections in
      // between would have produced — the same record effects, in the same
      // order — so the section opens on the data it expects, never empty.
      const jump = sectionJumpTarget(snapshot, manifest, action.sectionId)
      if (!jump.ok) return fail(jump.error)
      const target = jump.section
      let path: readonly DemoJourneyState[] | null = null
      let entry: DemoJourneyState | null = null
      for (const candidate of target.entryStates) {
        const walk = candidate === snapshot.state ? [] : journeyPath(snapshot.state, candidate)
        if (walk) {
          path = walk
          entry = candidate
          break
        }
      }
      if (!path || !entry) return fail(`no legal path from ${snapshot.state} to "${target.id}"`)
      // Staged between the story's last move and now — never before what the
      // prospect already did, never in the future.
      const room = Math.max(0, now.getTime() - Date.parse(snapshot.updatedAt))
      const spacing = path.length > 1 ? Math.min(STAGED_STEP_MS, room / (path.length - 1)) : 0
      let records = snapshot.records
      path.forEach((state, index) => {
        const at = new Date(now.getTime() - (path!.length - 1 - index) * spacing)
        records = applyTransitionEffects(records, state, snapshot.identity, at)
      })
      const jumped: DemoJourneySnapshot = {
        ...snapshot,
        state: entry,
        records,
        sectionId: target.id,
        stepId: target.steps[0].id,
        visitedSections: snapshot.visitedSections.includes(target.id) ? snapshot.visitedSections : [...snapshot.visitedSections, target.id],
        updatedAt: now.toISOString(),
      }
      return { ok: true, snapshot: jumped, ...(entry !== snapshot.state ? { transitioned: entry } : {}) }
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
  // A section counts when its own steps were done — not because the story
  // jumped past it.
  const sectionsDone = sections.filter((section) => sectionStatus(snapshot, manifest, section.id) === "done").length
  return {
    requiredTotal: required.length,
    requiredDone: required.filter((id) => done.has(id)).length,
    sectionsTotal: sections.length,
    sectionsDone,
  }
}

/** "passed": behind the story because the prospect jumped over it; its
 *  records are staged and it opens read-only, but it was not walked. */
export function sectionStatus(
  snapshot: DemoJourneySnapshot,
  manifest: DemoJourneyManifest,
  sectionId: string,
): "done" | "current" | "passed" | "upcoming" {
  const sections = activeSections(manifest)
  const currentIndex = sections.findIndex((section) => section.id === snapshot.sectionId)
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index < 0) return "upcoming"
  const walked = sections[index].steps.every((step) => !step.required || snapshot.completedSteps.includes(step.id))
  if (index === currentIndex && snapshot.state !== "COMPLETED") return "current"
  if (index <= currentIndex) return walked ? "done" : "passed"
  return "upcoming"
}

/** Sidebar routes the prospect may open: all of them (owner, 2026-09-22).
 *  Behind the story a route opens read-only; ahead of it, it jumps. */
export function reachableRoutes(_snapshot: DemoJourneySnapshot, manifest: DemoJourneyManifest): readonly string[] {
  const routes = new Set<string>()
  for (const section of activeSections(manifest)) {
    if (section.navGroup === "demo") continue
    routes.add(section.route.replace(/\/\[[a-zA-Z]+\]$/, ""))
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
