
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const check = (ok, code) => { if (!ok) throw new Error(code) }
const e = process.env
check(e.CI === "true" && e.GITHUB_ACTIONS === "true" && e.GITHUB_REPOSITORY === "rashadoni/leaddrive-v2"
  && e.SUPPORT_EVIDENCE_TARGET_MODE === "ephemeral"
  && e.SUPPORT_AUDIT_ACCEPTANCE === "ephemeral-audit-20261004-v1", "AUDIT_UNIT_CONTEXT")
const sha = e.GITHUB_SHA
const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
check(/^[a-f0-9]{40}$/.test(sha || "") && checkoutSha === e.SUPPORT_AUDIT_CHECKOUT_SHA
  && execFileSync("git", ["rev-parse", "HEAD^2"], { encoding: "utf8" }).trim() === sha, "AUDIT_UNIT_SHA")
const tracked = new Set(execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n"))
const directory = mkdtempSync(path.join(tmpdir(), "support-audit-unit-"))
const output = path.join(directory, "results.json")
const summary = { schemaVersion: 1, candidateHead: sha, checkoutSha, status: "UNKNOWN", regressionFiles: [], fixedFiles: [],
  limitation: "Independent Linux reproduction; does not replace the mandatory static-checks gate." }
try {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", "--outputFile=" + output], {
    stdio: "ignore", timeout: 20 * 60 * 1000,
    env: Object.fromEntries(Object.entries({ PATH: e.PATH, HOME: e.HOME, TMPDIR: e.TMPDIR, CI: "true",
      GITHUB_ACTIONS: "true", VITEST_MAX_WORKERS: "4" }).filter(([, value]) => value !== undefined)),
  })
  summary.runnerCompleted = result.status !== null && !result.signal && !result.error
  const report = JSON.parse(readFileSync(output, "utf8"))
  const known = new Set(JSON.parse(readFileSync("test-baseline.json", "utf8")).knownFailingFiles)
  const failing = new Map()
  for (const file of report.testResults || []) {
    const name = path.relative(process.cwd(), file.name || "")
    check(tracked.has(name) && name.startsWith("src/") && name.endsWith(".test.ts"), "AUDIT_UNIT_REPORT_PATH")
    if (file.status === "failed") {
      failing.set(name, { file: name, failedAssertions: (file.assertionResults || []).flatMap((test, index) => test.status === "failed"
        ? [{ index, timeout: (test.failureMessages || []).some(message => /^Error: STACK_TRACE_ERROR\n\s+at /.test(message)) }] : []) })
    }
  }
  summary.untrackedBaselineCount = [...known].filter(name => !tracked.has(name)).length
  summary.failedFileCount = failing.size
  summary.baselineFileCount = known.size
  summary.regressionFiles = [...failing].filter(([name]) => !known.has(name)).map(([, value]) => value)
  summary.fixedFiles = [...known].filter(name => !failing.has(name) && tracked.has(name)).sort()
  summary.status = summary.runnerCompleted && summary.untrackedBaselineCount === 0 && summary.regressionFiles.length === 0 && summary.fixedFiles.length === 0 ? "PASS" : "FAIL"
} catch {
  summary.status = "UNKNOWN"
} finally {
  rmSync(directory, { recursive: true, force: true })
  const target = path.resolve("artifacts", "support-ux-unit", sha)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, "unit-diagnostics.json"), JSON.stringify(summary, null, 2) + "\n")
}
process.exitCode = summary.status === "PASS" ? 0 : 1
