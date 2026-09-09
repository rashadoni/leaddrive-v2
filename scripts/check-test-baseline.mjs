#!/usr/bin/env node
/**
 * Turns a permanently-red test suite into a gate.
 *
 * `npm test` has ~30 failing files on main and has had for a long time, so CI
 * runs it `continue-on-error`. That means a genuinely broken test lands green:
 * the real signal is buried in noise nobody reads, and the failure gets waved
 * through as "one of the known ones" — the exact trap CLAUDE.md warns about
 * when it says an outdated baseline is worse than no baseline.
 *
 * Fixing ~50 tests first is not a prerequisite for having a gate. This records
 * WHICH files are known-red and fails only on a change to that set:
 *
 *   new failure   → exit 1. A file that was green is now red: that is a
 *                   regression, and it is the whole point of this script.
 *   fixed failure → exit 1, asking you to delete the line. Same idiom as
 *                   `no-session-object-in-effect-deps.test.ts`, which enforces
 *                   its grandfather list only shrinks. Without it the baseline
 *                   rots into a list of files that pass, and the next real
 *                   break hides behind a stale entry.
 *
 * The baseline is FILE-level, not test-level: individual test names churn as
 * people edit describes, and a churning baseline gets ignored.
 *
 * THE BASELINE DESCRIBES CI, NOT YOUR LAPTOP. Some tests are environment-
 * sensitive: `lib-rls-context.test.ts` asserts that AsyncLocalStorage context
 * does not leak across interval ticks, and it fails on the dev box while
 * passing on GitHub runners. A baseline captured locally therefore lists a file
 * CI sees passing, and the gate — correctly — rejects it. That is not a bug in
 * either the test or the gate; it means `--update` has to be run somewhere that
 * matches CI, or its output reconciled against a CI run before committing.
 *
 * Usage:
 *   node scripts/check-test-baseline.mjs            # verify (CI)
 *   node scripts/check-test-baseline.mjs --update   # rewrite the baseline
 *
 * `--update` is for two cases only: adopting a legitimately-new known failure
 * after a human looked at it, and clearing entries you just fixed. It is not a
 * way to make a red PR green — that is what the "new failure" branch catches.
 * After running it locally, check the diff for files that only fail locally
 * (see above) before committing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const BASELINE = "test-baseline.json"

// A vitest failure message is a multi-line block (assertion diff + stack).
// Indent it so it reads as belonging to the test above it, and cap it: a
// snapshot diff can run to hundreds of lines and bury the next regression.
export const MAX_MESSAGE_LINES = 25
export function indent(message) {
  const lines = String(message).split("\n")
  const shown = lines.slice(0, MAX_MESSAGE_LINES).map((l) => `      ${l}`)
  if (lines.length > MAX_MESSAGE_LINES) {
    shown.push(`      … ${lines.length - MAX_MESSAGE_LINES} more line(s)`)
  }
  return shown.join("\n")
}

// What a timed-out test looks like in vitest's JSON report — and nothing else
// does. Verified in the sources this repo pins (vitest 4):
//
//   @vitest/runner  makeTimeoutError(): builds "Test timed out in Nms…" as the
//                   message, then REPLACES the error's stack with the stack of
//                   a placeholder `new Error("STACK_TRACE_ERROR")` captured at
//                   `it()` time, so the trace points at the test's definition.
//   vitest          JSON reporter: failureMessages = errors.map(e => e.stack || e.message)
//
// The stack wins, its first line is the placeholder's, and the words "timed
// out" never reach the report. Everything downstream — this script, the CI
// log, the person reading it — sees `Error: STACK_TRACE_ERROR` with a trace
// into @vitest/runner internals: it reads as a crash inside the framework.
//
// On 2026-09-07 that hid the same failure twice in one afternoon on two
// unrelated files (`no-session-object-in-effect-deps`, ~1 s idle; the voice
// eval, ~3 s idle with its own 15 s limit). Both had simply run ≥5× slower on
// the shared 8-vCPU CI box while a 12 GiB typecheck and other jobs used the
// same cores and disk, and both were "fixed" by re-running. A timeout that
// cannot be recognised as one is re-run instead of understood.
//
// Anchored to the first line and the trace that must follow it. The other
// places vitest uses the same placeholder (waitFor, fixtures) rewrite the
// first line to the real message via copyStackTrace, so they do not match.
const TIMEOUT_SIGNATURE = /^Error: STACK_TRACE_ERROR\n\s+at /

export function isTimeoutSignature(message) {
  return TIMEOUT_SIGNATURE.test(String(message ?? ""))
}

/** Human-readable lines for one failed assertionResult from the JSON report. */
export function describeFailedCase(c) {
  const lines = [`  ✗ ${c.fullName || c.title}`]
  const duration = Number.isFinite(c.duration) ? `${Math.round(c.duration)}ms` : "unknown duration"
  const messages = c.failureMessages || []
  if (messages.some(isTimeoutSignature)) {
    lines.push(`      ⏱ TIMEOUT: vitest stopped this test after ${duration} at its testTimeout/hookTimeout.`)
    lines.push("      The report carries no \"timed out\" text (vitest swaps the error's stack for its")
    lines.push("      definition-site STACK_TRACE_ERROR placeholder), so this is not a crash inside the")
    lines.push("      framework — it is a slow run. On the shared self-hosted box that usually means")
    lines.push("      CPU/disk contention with the typecheck or another job; see docs/ci-cost-policy.md.")
  } else {
    lines.push(`      ran ${duration}`)
  }
  for (const m of messages) lines.push(indent(m))
  return lines
}

function runVitest() {
  // JSON reporter to a file: vitest writes progress to stdout as well, so
  // parsing stdout directly is unreliable.
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "vitest-baseline-"))
  const out = join(dir, "results.json")
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "--reporter=json", `--outputFile=${out}`],
      { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "true" } },
    )
  } catch {
    // Non-zero exit is expected while any test fails — the report is what matters.
  }
  if (!existsSync(out)) {
    console.error("check-test-baseline: vitest produced no JSON report — cannot judge the run.")
    console.error("Refusing to pass: a missing report is an unknown state, not a green one.")
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(out, "utf8"))
  rmSync(dir, { recursive: true, force: true })
  return report
}

function main() {
  const update = process.argv.includes("--update")
  const report = runVitest()

  // testResults[].name is an absolute path; make it repo-relative and stable.
  const cwd = process.cwd()
  const failing = new Set(
    (report.testResults || [])
      .filter((r) => r.status === "failed")
      .map((r) => (r.name || "").replace(`${cwd}/`, ""))
      .filter(Boolean),
  )

  if (update) {
    const next = { knownFailingFiles: [...failing].sort() }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`check-test-baseline: baseline rewritten — ${next.knownFailingFiles.length} known-failing file(s).`)
    process.exit(0)
  }

  if (!existsSync(BASELINE)) {
    console.error(`check-test-baseline: ${BASELINE} is missing. Create it with --update.`)
    process.exit(1)
  }

  const known = new Set(JSON.parse(readFileSync(BASELINE, "utf8")).knownFailingFiles || [])
  const regressions = [...failing].filter((f) => !known.has(f)).sort()
  const fixed = [...known].filter((f) => !failing.has(f)).sort()

  console.log(`check-test-baseline: ${failing.size} failing file(s), ${known.size} in baseline.`)

  if (regressions.length) {
    console.error(`\n✖ ${regressions.length} file(s) newly failing — these passed at the baseline:\n`)
    for (const f of regressions) console.error(`    ${f}`)
    // Print WHY, not just WHICH. The JSON reporter writes to a temporary file
    // that no longer exists once CI uploads the log, so a regression used to
    // arrive as a bare filename: whoever picked it up had to re-run the suite
    // and hope the failure reproduced. For a load-sensitive test on a shared
    // runner it often does not, and a red that cannot be read is the failure
    // mode this whole script exists to prevent.
    for (const f of regressions) {
      const file = (report.testResults || []).find((r) => (r.name || "").replace(`${cwd}/`, "") === f)
      const cases = (file?.assertionResults || []).filter((c) => c.status === "failed")
      console.error(`\n  ── ${f}`)
      if (!cases.length && file?.message) {
        // The file failed to load at all: no per-test results, one module error.
        console.error(indent(file.message))
        continue
      }
      for (const c of cases) {
        for (const line of describeFailedCase(c)) console.error(line)
      }
    }
    console.error("\nFix them, or — only if the failure is understood and accepted —")
    console.error("run `node scripts/check-test-baseline.mjs --update` and say why in the commit.")
  }

  if (fixed.length) {
    console.error(`\n✖ ${fixed.length} baseline file(s) now pass — delete them from ${BASELINE}:\n`)
    for (const f of fixed) console.error(`    ${f}`)
    console.error("\nA baseline that lists passing files is how the next real break hides.")
    console.error("Run `node scripts/check-test-baseline.mjs --update`.")
  }

  if (regressions.length || fixed.length) process.exit(1)

  console.log("✅ No new failures, and every baseline entry still fails. Gate passed.")
}

// Importable for tests (the rendering above is unit-tested); runs the gate
// only when invoked directly, never as a side effect of an import.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
