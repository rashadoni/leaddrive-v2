/**
 * A browser call's state must not outlive the lead it belongs to.
 *
 * Moving to another lead's card does NOT remount this component: it keeps its
 * place in the tree and only `leadId` changes. Cleanup keyed to unmount
 * therefore never runs, and the previous lead's call state arrives on the next
 * card — the button reads "end call", pressing it hangs up instead of dialling,
 * and no call is placed at all.
 *
 * Reported from production on 2026-08-25: a second lead "was still talking"
 * while neither the relay nor the call log had ever heard of a second call.
 *
 * These assertions are structural — they read the source rather than render it.
 * A behavioural test would have to mock the microphone, the audio path and two
 * fetches, and is worth writing; this exists so the invariant is not lost in
 * the meantime, because the defect is invisible in every unit that passes.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const source = readFileSync(
  "src/components/leads/lead-browser-call-action.tsx",
  "utf8",
)

describe("browser call state is scoped to its lead", () => {
  it("tears the call down when the card moves to another lead", () => {
    // The cleanup must be keyed on leadId, not on mount.
    const leadScopedEffect = source.match(/useEffect\(\(\) => \(\) => \{([\s\S]*?)\}, \[leadId(?:, [^\]]+)?\]\)/)
    expect(leadScopedEffect).toBeTruthy()

    // …and that cleanup must actually end the call and clear the flags, not
    // merely run. Checked inside the effect that precedes the dependency list.
    const body = leadScopedEffect![1]
    expect(body).toContain("callRef.current?.hangUp()")
    expect(body).toContain("setOnCall(false)")
    expect(body).toContain("setConnected(false)")
    expect(body).toContain("setBusy(false)")
  })

  it("runs that cleanup before the unmount one", () => {
    // Cleanups run in declaration order. The unmount effect sets
    // mountedRef.current = false; if it ran first, the lead-scoped cleanup
    // would be updating state the component no longer considers itself to own.
    const leadScoped = source.indexOf("}, [leadId")
    const unmount = source.indexOf("mountedRef.current = false")
    expect(leadScoped).toBeGreaterThan(-1)
    expect(unmount).toBeGreaterThan(-1)
    expect(leadScoped).toBeLessThan(unmount)
  })

  it("clears the connected flag when hanging up by hand", () => {
    // connectedRef decides whether a later failure has to cancel the call. A
    // value left over from the previous call answers for the wrong one.
    const hangUp = source.slice(
      source.indexOf("const hangUp = useCallback"),
      source.indexOf("const start = useCallback"),
    )
    expect(hangUp).toContain("setOnCall(false)")
    expect(hangUp).toContain("setConnected(false)")
  })
})
