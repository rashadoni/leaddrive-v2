import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8",
)

describe("production unit-test baseline gate", () => {
  it("blocks artifact staging when the full-suite baseline changes", () => {
    const checksStart = deployWorkflow.indexOf("\n  checks:")
    const buildStart = deployWorkflow.indexOf("\n  build:", checksStart)

    expect(checksStart).toBeGreaterThan(-1)
    expect(buildStart).toBeGreaterThan(checksStart)

    const checksJob = deployWorkflow.slice(checksStart, buildStart)
    expect(checksJob).toContain("- name: Unit tests vs baseline (BLOCKING)")
    expect(checksJob).toContain("run: node scripts/check-test-baseline.mjs")
  })
})
