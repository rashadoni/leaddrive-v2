/**
 * The visit as a road, for the office card.
 *
 * The review panel answered "did the agent do everything?" in prose: a step
 * list, a photo count, a presentation list, a result block. A supervisor had
 * to read all four and hold the answer in their head. This turns the same
 * facts into checkpoints — green where there is evidence, red where the visit
 * policy asked for a step and nothing was recorded.
 *
 * The third state is the one that keeps it honest: a step this visit never
 * required is pale, not red. Marking it red would accuse an agent of skipping
 * something that was never on their road — the same mistake the old step list
 * made when it printed five optional rows as "Не сделано".
 *
 * The field app builds the same road from the same rules
 * (`MTMobileApp/src/services/visit-roadmap.ts`); the two must agree, because
 * an agent and their manager looking at one visit must see one answer.
 */

export type VisitRoadmapState = "done" | "missing" | "skipped"

export type VisitRoadmapKey =
  | "checkIn"
  | "presentation"
  | "photo"
  | "signature"
  | "tasks"
  | "result"
  | "checkOut"

export interface VisitRoadmapStep {
  key: VisitRoadmapKey
  state: VisitRoadmapState
  /** Filled by the caller from its own message catalogue. */
  detailKey?: "openedCount" | "photoCount" | "taskCount" | "visitOpen" | "required" | "notRequired"
  count?: number
  total?: number
}

export interface VisitRoadmapInput {
  status: string
  checkInAt?: string | null
  checkOutAt?: string | null
  outcome?: string | null
  resultNotes?: string | null
  notes?: string | null
  photoCount: number
  presentationCount: number
  tasksDone?: number
  tasksTotal?: number
  requirements: ReadonlyArray<{ actionKey: string; mode: string }>
  actionResults: ReadonlyArray<{ actionKey: string; status: string }>
}

function isRequired(input: VisitRoadmapInput, actionKey: string): boolean {
  return input.requirements.some((requirement) => requirement.actionKey === actionKey && requirement.mode === "REQUIRED")
}

/**
 * `WAIVED` counts as done: a supervisor who waived the signature decided the
 * step was not needed here, and that decision must not read as the agent's
 * failure.
 */
function hasResultFor(input: VisitRoadmapInput, actionKey: string): boolean {
  return input.actionResults.some((result) => (
    result.actionKey === actionKey && (result.status === "COMPLETED" || result.status === "WAIVED")
  ))
}

function state(done: boolean, required: boolean): VisitRoadmapState {
  if (done) return "done"
  return required ? "missing" : "skipped"
}

export function visitRoadmap(input: VisitRoadmapInput): VisitRoadmapStep[] {
  const open = input.status === "CHECKED_IN"
  const tasksTotal = Math.max(0, input.tasksTotal ?? 0)
  const tasksDone = Math.min(tasksTotal, Math.max(0, input.tasksDone ?? 0))
  const hasResult = Boolean(input.outcome || input.resultNotes?.trim() || input.notes?.trim())

  return [
    {
      key: "checkIn",
      state: input.checkInAt ? "done" : "missing",
    },
    {
      key: "presentation",
      state: state(input.presentationCount > 0, isRequired(input, "PRESENTATION")),
      detailKey: input.presentationCount > 0 ? "openedCount" : undefined,
      count: input.presentationCount || undefined,
    },
    {
      key: "photo",
      state: state(input.photoCount > 0, isRequired(input, "PHOTO")),
      detailKey: input.photoCount > 0 ? "photoCount" : undefined,
      count: input.photoCount || undefined,
    },
    {
      key: "signature",
      state: state(hasResultFor(input, "SIGNATURE"), isRequired(input, "SIGNATURE")),
    },
    {
      key: "tasks",
      state: tasksTotal === 0 ? "skipped" : state(tasksDone === tasksTotal, true),
      detailKey: tasksTotal > 0 ? "taskCount" : undefined,
      count: tasksTotal > 0 ? tasksDone : undefined,
      total: tasksTotal > 0 ? tasksTotal : undefined,
    },
    {
      // An open visit has not reached its result: that is the road ahead.
      key: "result",
      state: hasResult ? "done" : open ? "skipped" : state(false, isRequired(input, "VISIT_NOTE")),
    },
    {
      key: "checkOut",
      state: input.checkOutAt ? "done" : "skipped",
      detailKey: input.checkOutAt ? undefined : open ? "visitOpen" : undefined,
    },
  ].map((step) => ({
    ...step,
    detailKey: step.detailKey ?? (step.state === "missing" ? "required" : step.state === "skipped" ? "notRequired" : undefined),
  })) as VisitRoadmapStep[]
}

/** Progress over the steps this visit actually asked for. */
export function visitRoadmapProgress(steps: readonly VisitRoadmapStep[]): { done: number; total: number } {
  const counted = steps.filter((step) => step.state !== "skipped")
  return { done: counted.filter((step) => step.state === "done").length, total: counted.length }
}
