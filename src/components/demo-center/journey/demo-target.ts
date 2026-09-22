/**
 * Marks the real control a step asks the prospect to use, so the on-screen
 * arrow can point at it (src/components/demo-center/journey/demo-coach-mark.tsx)
 * and the story walk test can press it. A control may serve several steps;
 * a step whose control opens a second one (a dialog's «Create») marks both,
 * and the arrow follows the last one on screen.
 */
export const DEMO_TARGET_ATTRIBUTE = "data-demo-target"

export function demoTarget(...stepIds: ReadonlyArray<string | false | null | undefined>): { "data-demo-target"?: string } {
  const ids = stepIds.filter((id): id is string => typeof id === "string" && id.length > 0)
  return ids.length ? { "data-demo-target": ids.join(" ") } : {}
}

/** The control to point at for a step: the last visible element marked with it. */
export function findDemoTarget(stepId: string, root: ParentNode = document): HTMLElement | null {
  if (!/^[a-z0-9-]+$/.test(stepId)) return null
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(`[${DEMO_TARGET_ATTRIBUTE}~="${stepId}"]`))
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate.isConnected || candidate.closest("[hidden],[aria-hidden='true']")) continue
    // jsdom has no layout; a real browser reports no boxes for display:none.
    const laidOut = typeof candidate.checkVisibility === "function" ? candidate.checkVisibility() : true
    if (laidOut) return candidate
  }
  return null
}
