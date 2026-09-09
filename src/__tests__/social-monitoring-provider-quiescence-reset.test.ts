import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const resetScript = readFileSync(
  join(process.cwd(), "scripts/reset-brandprotection-scenario-monitoring.mjs"),
  "utf8",
)

function section(start: string, end: string) {
  const startIndex = resetScript.indexOf(start)
  const endIndex = resetScript.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return resetScript.slice(startIndex, endIndex)
}

describe("Brand Protection provider quiescence", () => {
  it("never calls a provider API for locally succeeded or importing runs", () => {
    const implementation = section(
      "async function quiesceProviderRun(run)",
      "async function materializeScope",
    )

    expect(resetScript).toContain(
      'const REMOTE_ACTIVE_LOCAL_PROVIDER_STATUSES = new Set(["QUEUED", "RUNNING"])',
    )
    expect(implementation).toContain('if (status === "SUCCEEDED")')
    expect(implementation).toContain('"local_succeeded_remote_terminal"')
    expect(implementation).toContain('if (status === "IMPORTING")')
    expect(implementation).toContain('"local_importing_import_stage"')
    expect(implementation.indexOf('if (status === "SUCCEEDED")')).toBeLessThan(
      implementation.indexOf("quiesceApifyRun(run)"),
    )
    expect(implementation.indexOf('if (status === "IMPORTING")')).toBeLessThan(
      implementation.indexOf("quiesceBrightDataRun(run)"),
    )
  })

  it("puts an independent timeout signal on every provider inspection and cancellation", () => {
    const wrapper = section(
      "async function fetchProvider",
      "async function mapWithBoundedConcurrency",
    )
    const providerCalls = section(
      "async function quiesceApifyRun",
      "async function quiesceProviderRun",
    )

    expect(wrapper).toContain("signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)")
    expect(providerCalls.match(/\bfetchProvider\(/g)).toHaveLength(4)
    expect(providerCalls).not.toMatch(/\bfetch\(/)
  })

  it("uses bounded batches and waits for every started call before failing closed", () => {
    const boundedMap = section(
      "async function mapWithBoundedConcurrency",
      "async function quiesceApifyRun",
    )
    const quiescence = section(
      "async function quiesceActiveProviderRuns",
      "async function main",
    )

    expect(resetScript).toContain("const PROVIDER_QUIESCE_CONCURRENCY = 8")
    expect(boundedMap).toContain("Promise.allSettled")
    expect(boundedMap).toContain("throw new AggregateError")
    expect(quiescence).toContain("await mapWithBoundedConcurrency(")
    expect(quiescence.indexOf("await mapWithBoundedConcurrency(")).toBeLessThan(
      quiescence.indexOf("await prisma.$transaction"),
    )
  })

  it("keeps local, provider and remote-status validation fail closed", () => {
    const dispatcher = section(
      "async function quiesceProviderRun",
      "async function materializeScope",
    )
    const apify = section(
      "async function quiesceApifyRun",
      "async function quiesceBrightDataRun",
    )
    const brightData = section(
      "async function quiesceBrightDataRun",
      "async function quiesceProviderRun",
    )

    expect(dispatcher).toContain("has unknown local status")
    expect(dispatcher).toContain("uses unsupported provider")
    expect(dispatcher).toContain('if (status === "RUNNING")')
    expect(dispatcher).toContain("is RUNNING without an external id")
    expect(apify).toContain("returned unknown status")
    expect(brightData).toContain("returned unknown status")
  })
})
