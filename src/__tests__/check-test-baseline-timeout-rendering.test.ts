import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { describeFailedCase, isTimeoutSignature } from "../../scripts/check-test-baseline.mjs"

// Captured verbatim from a local reproduction (`--testTimeout=200`) on
// 2026-09-07; identical in shape to both CI failures that day.
const TIMEOUT_REPORT_HEAD = [
  "Error: STACK_TRACE_ERROR",
  "    at task (file:///home/rashad/projects/leaddrive-v2/node_modules/@vitest/runner/dist/chunk-artifact.js:1774:27)",
  "    at Object.<anonymous> (file:///home/rashad/projects/leaddrive-v2/node_modules/@vitest/runner/dist/chunk-artifact.js:1807:16)",
  "    at Object.<anonymous> (file:///home/rashad/projects/leaddrive-v2/node_modules/@vitest/runner/dist/chunk-artifact.js:1553:28)",
].join("\n")

const ASSERTION_REPORT = [
  "AssertionError: expected 2 to be 3 // Object.is equality",
  "    at /home/rashad/projects/leaddrive-v2/src/__tests__/example.test.ts:12:20",
].join("\n")

/**
 * Two things are pinned here.
 *
 * 1. How the gate renders a timed-out test. vitest's JSON report drops the
 *    words "timed out" (the runner swaps the error's stack for its definition-
 *    site STACK_TRACE_ERROR placeholder; the reporter emits stack||message), so
 *    the gate has to recognise the shape and say "timeout" itself. Twice on
 *    2026-09-07 it did not, and two slow-under-load tests were read as
 *    framework crashes and re-run instead of understood.
 *
 * 2. That vitest still produces that shape. The recognition is a contract with
 *    a dependency's internals; if a vitest upgrade starts carrying the message
 *    through, the probe below tells us, and the detection can be retired
 *    rather than silently stop matching.
 */
describe("check-test-baseline: rendering a timed-out test", () => {
  it("recognises the timeout signature and nothing else", () => {
    expect(isTimeoutSignature(TIMEOUT_REPORT_HEAD)).toBe(true)
    expect(isTimeoutSignature(ASSERTION_REPORT)).toBe(false)
    // waitFor/fixture errors reuse the placeholder but rewrite the first line
    // to the real message — they must not be labelled as test timeouts.
    expect(isTimeoutSignature("Error: expected value to be truthy\n    at task (chunk.js:1:1)")).toBe(false)
    expect(isTimeoutSignature("Error: STACK_TRACE_ERROR")).toBe(false)
    expect(isTimeoutSignature(undefined)).toBe(false)
  })

  it("says TIMEOUT and how long the test ran, instead of the raw placeholder", () => {
    const out = describeFailedCase({
      fullName: "voice section static eval harness runs every RU/AZ case",
      duration: 15012.4,
      failureMessages: [TIMEOUT_REPORT_HEAD],
    }).join("\n")

    expect(out).toContain("⏱ TIMEOUT")
    expect(out).toContain("15012ms")
    expect(out).toContain("docs/ci-cost-policy.md")
    // The raw message is still shown below the explanation for whoever wants it.
    expect(out).toContain("Error: STACK_TRACE_ERROR")
    expect(out.indexOf("⏱ TIMEOUT")).toBeLessThan(out.indexOf("Error: STACK_TRACE_ERROR"))
  })

  it("keeps an ordinary assertion failure ordinary, with its duration", () => {
    const out = describeFailedCase({
      title: "adds two numbers",
      duration: 3.2,
      failureMessages: [ASSERTION_REPORT],
    }).join("\n")

    expect(out).not.toContain("TIMEOUT")
    expect(out).toContain("ran 3ms")
    expect(out).toContain("AssertionError: expected 2 to be 3")
  })
})

describe("check-test-baseline: vitest still reports a timeout as STACK_TRACE_ERROR", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "timeout-signature-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("produces exactly the shape the gate recognises", () => {
    const out = join(dir, "report.json")
    try {
      execFileSync(
        "npx",
        [
          "vitest", "run",
          "src/__tests__/fixtures/timeout-signature-probe.test.ts",
          "--testTimeout=1",
          "--reporter=json", `--outputFile=${out}`,
        ],
        { stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, CI: "true", VITEST_MAX_WORKERS: "1" } },
      )
    } catch {
      // Non-zero exit is the point: the probe must fail.
    }
    expect(existsSync(out), "child vitest wrote no JSON report").toBe(true)

    const report = JSON.parse(readFileSync(out, "utf8"))
    const cases = (report.testResults ?? []).flatMap((f: { assertionResults?: unknown[] }) => f.assertionResults ?? [])
    const failed = cases.filter((c: { status: string }) => c.status === "failed") as Array<{
      failureMessages?: string[]
      duration?: number
    }>

    expect(failed.length, "the probe must time out under --testTimeout=1").toBeGreaterThan(0)
    const message = failed[0].failureMessages?.[0] ?? ""
    expect(message.startsWith("Error: STACK_TRACE_ERROR\n")).toBe(true)
    expect(message).not.toMatch(/timed out/i)
    expect(isTimeoutSignature(message)).toBe(true)
    // The gate's explanation is built from the report alone, as CI would see it.
    expect(describeFailedCase(failed[0]).join("\n")).toContain("⏱ TIMEOUT")
  }, 120_000)
})
