
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
const check = (ok, code) => { if (!ok) throw new Error(code) }
const e = process.env
check(e.CI === "true" && e.GITHUB_ACTIONS === "true" && e.GITHUB_REPOSITORY === "rashadoni/leaddrive-v2"
  && e.SUPPORT_EVIDENCE_TARGET_MODE === "ephemeral"
  && e.SUPPORT_AUDIT_ACCEPTANCE === "ephemeral-audit-20261004-v1", "AUDIT_TYPE_CONTEXT")
const sha = e.GITHUB_SHA
const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
check(/^[a-f0-9]{40}$/.test(sha || "") && checkoutSha === e.SUPPORT_AUDIT_CHECKOUT_SHA
  && execFileSync("git", ["rev-parse", "HEAD^2"], { encoding: "utf8" }).trim() === sha, "AUDIT_TYPE_SHA")
const tracked = new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n"))
const directory = mkdtempSync(path.join(tmpdir(), "support-audit-type-"))
const output = path.join(directory, "diagnostics.txt")
const summary = { schemaVersion: 1, candidateHead: sha, checkoutSha, status: "UNKNOWN", regressions: [], improvements: [],
  limitation: "Independent merge-tree reproduction; does not replace the mandatory typecheck gate." }
let descriptor
try {
  descriptor = openSync(output, "wx", 0o600)
  const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"], {
    stdio: ["ignore", descriptor, descriptor], timeout: 25 * 60 * 1000,
    env: Object.fromEntries(Object.entries({ PATH: e.PATH, HOME: e.HOME, TMPDIR: e.TMPDIR,
      CI: "true", NODE_OPTIONS: "--max-old-space-size=14336" }).filter(([, value]) => value !== undefined)),
  })
  closeSync(descriptor); descriptor = undefined
  summary.runnerCompleted = [0, 1, 2].includes(result.status) && !result.signal && !result.error
  const gated = new Set(["TS2339", "TS2345", "TS2353", "TS2322", "TS2554", "TS2551"])
  const counts = new Map(), locations = new Map()
  let parsed = 0
  for (const line of readFileSync(output, "utf8").split("\n")) {
    const match = /^\s*(\S+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+)/.exec(line)
    if (!match) continue
    parsed += 1
    const [, file, row, , code] = match
    check(tracked.has(file), "AUDIT_TYPE_UNTRACKED_PATH")
    if (!gated.has(code)) continue
    const key = file + " " + code
    counts.set(key, (counts.get(key) || 0) + 1)
    locations.set(key, [...(locations.get(key) || []), Number(row)])
  }
  check(parsed > 0, "AUDIT_TYPE_EMPTY_REPORT")
  summary.parsedErrorCount = parsed
  const known = JSON.parse(readFileSync("typecheck-baseline.json", "utf8")).gated
  for (const key of new Set([...counts.keys(), ...Object.keys(known)])) {
    const split = key.lastIndexOf(" "), file = key.slice(0, split), code = key.slice(split + 1)
    check(tracked.has(file) && /^TS\d+$/.test(code), "AUDIT_TYPE_BASELINE_PATH")
    const baselineCount = known[key] || 0, currentCount = counts.get(key) || 0
    if (currentCount === baselineCount) continue
    const item = { file, code, baselineCount, currentCount, lines: locations.get(key) || [] }
    ;(currentCount > baselineCount ? summary.regressions : summary.improvements).push(item)
  }
  summary.status = summary.runnerCompleted && summary.regressions.length === 0 && summary.improvements.length === 0 ? "PASS" : "FAIL"
} catch {
  summary.status = "UNKNOWN"
} finally {
  if (descriptor !== undefined) closeSync(descriptor)
  rmSync(directory, { recursive: true, force: true })
  const target = path.resolve("artifacts", "support-ux-unit", sha)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, "type-diagnostics.json"), JSON.stringify(summary, null, 2) + "\n")
}
process.exitCode = summary.status === "PASS" ? 0 : 1
