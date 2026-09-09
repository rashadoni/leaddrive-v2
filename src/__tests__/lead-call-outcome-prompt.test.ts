/**
 * Every browser call must end with a question the salesperson can answer.
 *
 * Until now a browser call went into the log unlabelled — always. The only
 * outcome selector in the product lives in `call-widget.tsx`, which this path
 * never mounts, so `call_logs.disposition` stayed null for every call placed
 * from the softphone. Nothing downstream can recover from that: a manager
 * counting outcomes counts nothing, and "call back" is not a thing anyone can
 * search for.
 *
 * Asserted at the source rather than by rendering. A render test here would
 * need the microphone, the audio path, two fetches and a relay; the invariants
 * that actually matter are structural — that the prompt is raised where the
 * call ends, that it is scoped to the call it belongs to, and that a failed
 * save is not silently swallowed.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CALL_DISPOSITIONS,
  QUICK_CALL_DISPOSITIONS,
} from "@/lib/calls/disposition"

const source = readFileSync(
  join(process.cwd(), "src/components/leads/lead-browser-call-action.tsx"),
  "utf8",
)

describe("labelling a call the moment it ends", () => {
  it("raises the prompt from the end of the call, not from a button elsewhere", () => {
    // `onEnded` is the only place that knows a call finished, including the
    // calls that ended badly — and those are the ones a manager most needs
    // counted ("no answer", "wrong number").
    const onEnded = source.slice(source.indexOf("onEnded:"), source.indexOf("})\n      setOnCall(true)"))
    expect(onEnded).toContain("setLabelling(startedFor)")
  })

  it("labels the call that just ended, never a later one", () => {
    // `startedFor`, not the mutable `callLogId`: by the time the call ends the
    // variable may already belong to the next call.
    expect(source).toMatch(/const startedFor = callLogId/)
    expect(source).toContain("setLabelling(startedFor)")
    expect(source).not.toContain("setLabelling(callLogId)")
  })

  it("drops the prompt when the card moves to another lead", () => {
    // The outcome belongs to a person the salesperson has now left. Carrying it
    // across would attach it to whoever is on screen.
    const cleanup = source.match(/useEffect\(\(\) => \(\) => \{([\s\S]*?)\}, \[leadId(?:, [^\]]+)?\]\)/)?.[1] || ""
    expect(cleanup).toContain("setLabelling(null)")
  })

  it("says so out loud when the outcome does not save", () => {
    // The neighbouring notes panel closes on failure exactly as it does on
    // success, so a lost note looks like a saved one. This must not repeat it.
    const save = source.slice(source.indexOf("const saveOutcome"), source.indexOf("const start = useCallback"))
    expect(save).toContain("outcomePicker.failed")
    expect(save).not.toMatch(/catch\s*\{\s*\}/)
  })

  it("offers few enough outcomes to be used sixty times a day", () => {
    expect(QUICK_CALL_DISPOSITIONS.length).toBeGreaterThanOrEqual(4)
    expect(QUICK_CALL_DISPOSITIONS.length).toBeLessThanOrEqual(6)
  })

  it("sends an outcome the API actually accepts", () => {
    for (const outcome of QUICK_CALL_DISPOSITIONS) {
      expect(CALL_DISPOSITIONS).toContain(outcome)
    }
  })
})
