import { describe, expect, it } from "vitest"
import { visitRoadmap, visitRoadmapProgress } from "@/lib/mtm/visit-roadmap"

/**
 * Owner on the office card, 2026-09-20: «чтобы понять, сделал ли он всё, надо
 * читать… сделай как дорожная карта, сделанный шаг зелёной иконкой, а что
 * нет — красной». The rules below are what keeps that map honest.
 */
function states(steps: ReturnType<typeof visitRoadmap>) {
  return Object.fromEntries(steps.map((step) => [step.key, step.state]))
}

const base = {
  status: "CHECKED_OUT",
  checkInAt: "2026-09-20T13:37:00.000Z",
  checkOutAt: "2026-09-20T14:16:00.000Z",
  photoCount: 0,
  presentationCount: 0,
  requirements: [] as Array<{ actionKey: string; mode: string }>,
  actionResults: [] as Array<{ actionKey: string; status: string }>,
}

describe("visit roadmap", () => {
  it("is green on evidence, red on a missed required step and pale on one never asked for", () => {
    const steps = visitRoadmap({
      ...base,
      presentationCount: 2,
      requirements: [
        { actionKey: "PHOTO", mode: "REQUIRED" },
        { actionKey: "SIGNATURE", mode: "OPTIONAL" },
      ],
      outcome: "SUCCESS",
    })
    expect(states(steps)).toMatchObject({
      checkIn: "done",
      presentation: "done",
      photo: "missing",
      signature: "skipped",
      tasks: "skipped",
      result: "done",
      checkOut: "done",
    })
  })

  it("treats a waived requirement as done, not as the agent's failure", () => {
    const steps = visitRoadmap({
      ...base,
      requirements: [{ actionKey: "SIGNATURE", mode: "REQUIRED" }],
      actionResults: [{ actionKey: "SIGNATURE", status: "WAIVED" }],
    })
    expect(states(steps).signature).toBe("done")
  })

  it("does not mark an open visit red for the result and the departure ahead of it", () => {
    const steps = visitRoadmap({ ...base, status: "CHECKED_IN", checkOutAt: null })
    expect(states(steps)).toMatchObject({ result: "skipped", checkOut: "skipped" })
    expect(steps.find((step) => step.key === "checkOut")?.detailKey).toBe("visitOpen")
  })

  it("goes green on tasks only when all of them are closed", () => {
    expect(states(visitRoadmap({ ...base, tasksDone: 1, tasksTotal: 2 })).tasks).toBe("missing")
    expect(states(visitRoadmap({ ...base, tasksDone: 2, tasksTotal: 2 })).tasks).toBe("done")
    expect(states(visitRoadmap({ ...base, tasksDone: 0, tasksTotal: 0 })).tasks).toBe("skipped")
  })

  it("counts progress over the steps that mattered", () => {
    const steps = visitRoadmap({
      ...base,
      photoCount: 3,
      presentationCount: 1,
      outcome: "SUCCESS",
      requirements: [{ actionKey: "PHOTO", mode: "REQUIRED" }],
    })
    expect(visitRoadmapProgress(steps)).toEqual({ done: 5, total: 5 })
  })

  it("says a visit with nothing recorded has not arrived", () => {
    const steps = visitRoadmap({ ...base, checkInAt: null, checkOutAt: null })
    expect(states(steps).checkIn).toBe("missing")
    expect(visitRoadmapProgress(steps).done).toBe(0)
  })

  /**
   * The agent's phone builds the same road from the same rules; a manager and
   * the agent looking at one visit must not see two answers.
   */
  it("keeps the same step order as the field app", () => {
    expect(visitRoadmap(base).map((step) => step.key)).toEqual([
      "checkIn", "presentation", "photo", "signature", "tasks", "result", "checkOut",
    ])
  })
})
