import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

/**
 * The post-deploy provider check is a shell script inside a workflow, and a
 * verifier is exactly the kind of script that passes on its own failure. So
 * this runs the script itself - cut out of deploy.yml, not retyped - against a
 * trigger that answers what each case needs.
 */
const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")
const TRIGGER = "/usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh"
const STEP = "      - name: Verify Gemini Live accepts the voice assistant setup\n"

function stepSource(): string {
  const [, after] = workflow.split(STEP)
  expect(after, "the provider check step is gone from deploy.yml").toBeDefined()
  return after!.split("\n      - name: ")[0]!
}

/** The remote script as the production shell receives it. */
function remoteScript(): string {
  const step = stepSource()
  const start = step.indexOf("'set -euo pipefail")
  const end = step.lastIndexOf("'")
  expect(start).toBeGreaterThan(-1)
  return step.slice(start + 1, end).replaceAll("'\\''", "'")
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Each line of `answers` is one invocation: "<exit code>|<stdout>". */
function run(answers: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "voice-provider-check-"))
  dirs.push(dir)
  const trigger = join(dir, "cron-trigger.sh")
  const calls = join(dir, "calls")
  const script = join(dir, "answers")
  writeFileSync(script, `${answers.join("\n")}\n`)
  writeFileSync(calls, "")
  writeFileSync(trigger, [
    "#!/usr/bin/env bash",
    `printf '%s lock=%s\\n' "$1" "\${CRON_TRIGGER_LOCK_WAIT_SECONDS:-unset}" >> ${JSON.stringify(calls)}`,
    `n=$(wc -l < ${JSON.stringify(calls)})`,
    `line=$(sed -n "\${n}p" ${JSON.stringify(script)})`,
    `printf '%s\\n' "\${line#*|}"`,
    `exit "\${line%%|*}"`,
    "",
  ].join("\n"))
  chmodSync(trigger, 0o755)
  const source = remoteScript().replaceAll(TRIGGER, trigger).replaceAll("sleep 10", "sleep 0")
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8", timeout: 20_000 })
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean),
  }
}

const OK = '0|[voice-provider-check] HTTP 200 — {"configured":true,"ok":true,"current":true,"model":"gemini-3.8-live","setupComplete":true,"toolFirst":null,"failure":null,"ms":812}'
const REFUSED = '0|[voice-provider-check] HTTP 200 — {"configured":true,"ok":false,"current":true,"model":"gemini-3.8-live","setupComplete":false,"toolFirst":null,"failure":"closed: 1008 models/gemini-3.8-live is not found","ms":230}'
const OFF = '0|[voice-provider-check] HTTP 200 — {"configured":false,"ok":false}'
const DOWN = "1|[voice-provider-check] ERROR - cron failed"

describe("post-deploy Gemini Live provider check", () => {
  it("passes when the provider accepts the setup, after one call", () => {
    const result = run([OK])
    expect(result.status).toBe(0)
    expect(result.calls).toEqual(["/api/cron/voice-provider-check lock=120"])
  })

  it("fails when the provider refuses the setup three times, and shows why", () => {
    const result = run([REFUSED, REFUSED, REFUSED])
    expect(result.status).toBe(1)
    expect(result.calls).toHaveLength(3)
    expect(result.output).toContain("is not found")
    expect(result.output).toContain("FATAL")
  })

  it("does not call one dropped attempt a verdict", () => {
    const result = run([REFUSED, DOWN, OK])
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(3)
  })

  it("fails when the endpoint itself cannot be reached", () => {
    // A trigger that exits non-zero must count as a failed attempt. Under
    // `set -e` the easy mistake is the opposite: the script dies on the first
    // one with the trigger's exit code and never says what it was checking.
    const result = run([DOWN, DOWN, DOWN])
    expect(result.status).toBe(1)
    expect(result.calls).toHaveLength(3)
    expect(result.output).toContain("FATAL")
  })

  it("fails on an answer that is neither a pass nor 'voice is off'", () => {
    const result = run(["0|", "0|<html>502 Bad Gateway</html>", '0|{"ok":"true"}'])
    expect(result.status).toBe(1)
  })

  it("passes a host where voice is switched off, and says that is what it saw", () => {
    const result = run([OFF])
    expect(result.status).toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.output).toContain("not configured")
  })

  it("checks the model sessions actually get, with nothing said and nothing billed", () => {
    // No ?model=: a named model would keep passing after the default moved on.
    // No turn=1: a model's choice of words is not a reason to redden a deploy.
    const call = stepSource().split("\n").find((line) => line.includes("cron-trigger.sh"))
    expect(call).toContain("cron-trigger.sh /api/cron/voice-provider-check ||")
  })

  it("reports for itself, whatever the other post-deploy checks did", () => {
    expect(stepSource()).toContain("if: ${{ !cancelled() && steps.deploy_atomic.outcome == 'success'")
  })
})
