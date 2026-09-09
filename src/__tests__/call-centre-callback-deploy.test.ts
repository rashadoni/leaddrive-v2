import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8",
)

describe("callback commitment production gate", () => {
  it("verifies one installed schedule with an authenticated side-effect-free smoke", () => {
    const start = workflow.indexOf("- name: Verify callback commitment scheduler")
    expect(start).toBeGreaterThan(-1)

    const nextStep = workflow.indexOf("\n      - name:", start + 1)
    const step = workflow.slice(start, nextStep === -1 ? undefined : nextStep)

    expect(step).toContain("/api/cron/commitment-escalation")
    expect(step).toContain("ACTIVE_COUNT")
    expect(step).toContain('if [ "$ACTIVE_COUNT" -ne 1 ]')
    expect(step).toContain("/api/cron/commitment-escalation?smoke=1")
    expect(step).toContain("grep -Fq")
    expect(step).toContain('"smoke":true')
  })
})
