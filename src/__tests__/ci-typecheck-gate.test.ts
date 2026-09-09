import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "child_process"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

/**
 * The gate that decides whether a PR may merge, driven against real logs.
 *
 * It was added on 2026-08-11 to stop `TS2304: Cannot find name` reaching
 * production — an undefined variable had white-screened the inbox for twelve
 * days while this very job printed the error and reported pass. It then shipped
 * with the same shape of hole it was built to close: it grepped the log, and a
 * typecheck that CRASHES leaves a log with no error lines, so an out-of-memory
 * kill read as "clean". This project's type graph needs a 12 GB heap; running
 * out of memory is not hypothetical, it happened the same afternoon.
 *
 * Hence these fixtures. A gate is only worth what its failing cases prove.
 */

const SCRIPT = join(process.cwd(), "scripts", "ci", "check-typecheck-gate.sh")

let dir: string
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "tsc-gate-")) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function runGate(log: string | null, code: string | null) {
  const logPath = join(dir, "tsc-output.log")
  const codePath = join(dir, "tsc-exit-code")
  rmSync(logPath, { force: true })
  rmSync(codePath, { force: true })
  if (log !== null) writeFileSync(logPath, log)
  if (code !== null) writeFileSync(codePath, code)
  try {
    const stdout = execFileSync("bash", [SCRIPT, logPath, codePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    return { status: 0, output: stdout }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

const OOM_LOG = `<--- Last few GCs --->

[2063142:0x1299e000]   159226 ms: Mark-Compact (reduce) 6106.0 (6149.2) -> 6022.0 (6059.3) MB
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----
`

describe("typecheck gate", () => {
  it("passes a clean run", () => {
    const r = runGate("", "0")
    expect(r.status).toBe(0)
    expect(r.output).toContain("No syntax, missing-module or undefined-name errors")
  })

  it("passes a run whose only errors are in the tolerated baseline", () => {
    const r = runGate("src/x.ts(3,5): error TS7006: Parameter implicitly has an 'any' type.\n", "2")
    expect(r.status).toBe(0)
  })

  it("blocks an undefined name", () => {
    const r = runGate("src/app/inbox/page.tsx(2827,26): error TS2304: Cannot find name 'tc'.\n", "2")
    expect(r.status).toBe(1)
    expect(r.output).toContain("TS2304")
  })

  it("blocks a missing module and a syntax error", () => {
    expect(runGate("src/a.ts(1,1): error TS2307: Cannot find module './nope'.\n", "2").status).toBe(1)
    expect(runGate("src/a.ts(9,3): error TS1308: 'await' expressions are only allowed within async functions.\n", "1").status).toBe(1)
  })

  // The four cases the gate used to wave through.
  it("refuses to pass a typecheck that ran out of memory", () => {
    const r = runGate(OOM_LOG, "134")
    expect(r.status).toBe(1)
    expect(r.output).toContain("NOT a pass")
  })

  it("refuses to pass a typecheck that was never installed", () => {
    expect(runGate("bash: npx: command not found\n", "127").status).toBe(1)
  })

  it("refuses to pass when the runner killed the process", () => {
    expect(runGate("", "137").status).toBe(1)
  })

  it("refuses to pass when the exit code was never recorded", () => {
    expect(runGate("", null).status).toBe(1)
    expect(runGate("", "").status).toBe(1)
    expect(runGate(null, "0").status).toBe(1)
  })

  it("refuses to pass when tsc claims failure but printed nothing", () => {
    // A truncated or wrongly redirected log: grepping it proves nothing.
    expect(runGate("", "2").status).toBe(1)
  })

  it("is the script the workflow actually runs", () => {
    // A tested script wired to nothing is decoration.
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "pr-checks.yml"), "utf8")
    expect(workflow).toContain("scripts/ci/check-typecheck-gate.sh tsc-output.log tsc-exit-code")
    expect(workflow).toContain('echo "${PIPESTATUS[0]}" > tsc-exit-code')
  })
})
