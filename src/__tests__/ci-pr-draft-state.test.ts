import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { execFileSync } from "child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

/**
 * Whether the heavy pull-request gate may be skipped as "draft", driven through
 * the real script with a stand-in for `gh`.
 *
 * On 2026-10-09 (PR #639) a commit was pushed to a draft and the pull request
 * was marked ready for review straight away. The run for the new commit carried
 * `draft: true` in its event, the `ready_for_review` run carried the PREVIOUS
 * commit and was cancelled — so static-checks and typecheck were skipped on a
 * ready pull request, GitHub counted the skips as passes, and the pull request
 * showed CLEAN on a commit nothing had tested.
 *
 * The first case below is that event. A doubt must run the gate, never skip it.
 */

const SCRIPT = join(process.cwd(), "scripts", "ci", "pr-draft-state.sh")

// Stands in for `gh api repos/<repo>/pulls/<n> --jq .draft`. Every call is
// appended to FAKE_GH_CALLS, so a test can also say that the API was NOT asked.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_CALLS"
calls="$(wc -l < "$FAKE_GH_CALLS")"
case "$FAKE_GH_MODE" in
  draft) echo true ;;
  ready) echo false ;;
  unreachable) echo "HTTP 502: Bad Gateway" >&2; exit 1 ;;
  unreachable-once-then-draft) if [ "$calls" -le 1 ]; then exit 1; fi; echo true ;;
  nonsense) echo null ;;
esac
`

let dir: string
let outputPath: string
let callsPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pr-draft-state-"))
  outputPath = join(dir, "github-output")
  callsPath = join(dir, "gh-calls")
  writeFileSync(join(dir, "gh"), FAKE_GH)
  chmodSync(join(dir, "gh"), 0o755)
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
beforeEach(() => {
  rmSync(outputPath, { force: true })
  rmSync(callsPath, { force: true })
})

type Event = { name?: string; action?: string; draft?: string }
type LivePullRequest = "draft" | "ready" | "unreachable" | "unreachable-once-then-draft" | "nonsense"

function decide(event: Event, live: LivePullRequest) {
  let status = 0
  let log = ""
  try {
    log = execFileSync("bash", [SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: "rashadoni/leaddrive-v2",
        EVENT_NAME: event.name ?? "pull_request",
        EVENT_ACTION: event.action ?? "",
        EVENT_DRAFT: event.draft ?? "",
        PR_NUMBER: event.name === "push" ? "" : "639",
        PR_DRAFT_RETRY_SLEEP_SECONDS: "0",
        FAKE_GH_MODE: live,
        FAKE_GH_CALLS: callsPath,
      },
    })
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    status = e.status ?? -1
    log = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  return {
    status,
    log,
    output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
    apiCalls: existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n") : [],
  }
}

describe("pr-scope: is the pull request a draft right now", () => {
  it("runs the gate when the event says draft but the pull request is already ready (#639)", () => {
    const result = decide({ action: "synchronize", draft: "true" }, "ready")

    expect(result.status).toBe(0)
    expect(result.output).toBe("draft=false\n")
    expect(result.apiCalls).toEqual(["api repos/rashadoni/leaddrive-v2/pulls/639 --jq .draft"])
  })

  it("skips the gate for a pull request that is a draft in the event and still a draft now", () => {
    const result = decide({ action: "synchronize", draft: "true" }, "draft")

    expect(result.status).toBe(0)
    expect(result.output).toBe("draft=true\n")
  })

  it("takes the event's word that the pull request is ready without asking the API", () => {
    const result = decide({ action: "ready_for_review", draft: "false" }, "draft")

    expect(result.output).toBe("draft=false\n")
    expect(result.apiCalls).toEqual([])
  })

  it("runs the gate when the pull request cannot be read at all", () => {
    const result = decide({ action: "synchronize", draft: "true" }, "unreachable")

    expect(result.status).toBe(0)
    expect(result.output).toBe("draft=false\n")
    expect(result.apiCalls).toHaveLength(3)
    expect(result.log).toContain("::warning")
  })

  it("asks again after one failed read instead of running every draft push in full", () => {
    const result = decide({ action: "synchronize", draft: "true" }, "unreachable-once-then-draft")

    expect(result.output).toBe("draft=true\n")
    expect(result.apiCalls).toHaveLength(2)
  })

  it("runs the gate when the API answers something that is neither true nor false", () => {
    const result = decide({ action: "opened", draft: "true" }, "nonsense")

    expect(result.output).toBe("draft=false\n")
    expect(result.log).toContain("::warning")
  })

  it("is never a draft on a push to main", () => {
    const result = decide({ name: "push" }, "draft")

    expect(result.output).toBe("draft=false\n")
    expect(result.apiCalls).toEqual([])
  })
})
