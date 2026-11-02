/**
 * An older commit must not reach production after a newer one.
 *
 * On 2026-11-02 run 41433109030 (20b932824) had 30 minutes of checks, so its
 * descendant 6934a7a9b — pushed eight minutes later — became ready first and
 * took the production-deploy lock. The older run queued behind it with nobody
 * newer to replace it and deployed at 11:54: production served older code
 * (without #1249) until the next deploy at 12:10. The lock orders runs by
 * readiness, not by commit age, so deploy.yml asks production what it serves
 * once the deploy job holds the lock (scripts/ci/deploy-ancestry-guard.sh).
 *
 * The first half runs that script against real git history and a real
 * build-info answer (curl on a file:// URL): no mocked decision table. The
 * second half reads deploy.yml and checks that a "skip" really leaves the
 * server untouched — including any step added later.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const SCRIPT = join(process.cwd(), "scripts/ci/deploy-ancestry-guard.sh")
const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim()
}

/**
 * main: A ── B ── C, plus D on a side branch off A that main never merged.
 * Like GitHub, the repository serves any commit reachable from a ref.
 */
function history() {
  const dir = mkdtempSync(join(tmpdir(), "deploy-ancestry-guard-"))
  dirs.push(dir)
  const repo = join(dir, "repo")
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", repo])
  git(repo, "config", "uploadpack.allowReachableSHA1InWant", "true")
  git(repo, "config", "uploadpack.allowFilter", "true")
  const commit = (message: string) => {
    git(repo, "commit", "--quiet", "--allow-empty", "-m", message)
    return git(repo, "rev-parse", "HEAD")
  }
  const A = commit("A")
  const B = commit("B")
  const C = commit("C")
  git(repo, "checkout", "--quiet", "-b", "side", A)
  const D = commit("D")
  git(repo, "checkout", "--quiet", "main")
  return { dir, repo, A, B, C, D }
}

function guard(h: ReturnType<typeof history>, target: string, buildInfo: string | null) {
  const info = join(h.dir, "build-info.json")
  if (buildInfo !== null) writeFileSync(info, buildInfo)
  const output = join(h.dir, `output-${Math.random()}`)
  writeFileSync(output, "")
  const result = spawnSync("bash", [SCRIPT, target, `file://${info}`, h.repo], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
    timeout: 30_000,
  })
  return {
    status: result.status,
    log: `${result.stdout}${result.stderr}`,
    skip: readFileSync(output, "utf8").trim(),
  }
}

const serving = (sha: string) => JSON.stringify({ sha: sha.slice(0, 12), artifactSha: sha, builtAt: "2026-11-02T11:44:00Z" })

describe("deploy-ancestry-guard.sh", () => {
  it("skips, green, a target production has already moved past — the 2026-11-02 rollback", () => {
    const h = history()
    const r = guard(h, h.B, serving(h.C))
    expect(r.status).toBe(0)
    expect(r.skip).toBe("skip=true")
    expect(r.log).toContain(`deploy-ancestry-guard: skip ${h.B}: production already serves ${h.C}`)
    expect(r.log).toContain("::notice title=Deploy skipped::")
  })

  it("skips a target several commits behind, not only the parent", () => {
    const h = history()
    expect(guard(h, h.A, serving(h.C)).skip).toBe("skip=true")
  })

  it("deploys a target that moves production forward", () => {
    const h = history()
    const r = guard(h, h.C, serving(h.A))
    expect(r.status).toBe(0)
    expect(r.skip).toBe("skip=false")
    expect(r.log).toContain(`deploy ${h.C}: it moves production forward from ${h.A}`)
  })

  it("keeps redeploying the revision production already serves", () => {
    const h = history()
    const r = guard(h, h.C, serving(h.C))
    expect(r.skip).toBe("skip=false")
    expect(r.log).toContain("redeploying the same revision")
  })

  it("deploys, with a warning, when target and live have diverged", () => {
    const h = history()
    const r = guard(h, h.C, serving(h.D))
    expect(r.skip).toBe("skip=false")
    expect(r.log).toContain("have diverged")
  })

  it.each([
    ["production does not answer", null],
    ["build-info has no artifactSha", JSON.stringify({ sha: "abc", builtAt: "x" })],
    ["production answers HTML", "<!doctype html><html></html>"],
    ["production serves a revision the repository does not have", serving("f".repeat(40))],
  ])("deploys, with a warning, when it cannot decide: %s", (_case, buildInfo) => {
    const h = history()
    const r = guard(h, h.B, buildInfo)
    expect(r.status).toBe(0)
    expect(r.skip).toBe("skip=false")
    expect(r.log).toContain("::warning::deploy-ancestry-guard:")
    expect(r.log).toContain("ancestry not checked")
  })

  it("fails red on a target that is not a full SHA — a workflow bug, not a decision", () => {
    const h = history()
    const r = guard(h, h.B.slice(0, 12), serving(h.C))
    expect(r.status).toBe(1)
    expect(r.skip).toBe("")
  })
})

/** Steps of the deploy job as { name, if } in file order. */
function deploySteps(): Array<{ name: string; cond: string; body: string }> {
  const lines = workflow.split("\n")
  const start = lines.indexOf("  deploy:")
  expect(start, "deploy.yml has no deploy job").toBeGreaterThan(-1)
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line))
  const job = lines.slice(start, end).join("\n")
  return job.split("\n      - name: ").slice(1).map((chunk) => {
    const name = chunk.split("\n")[0]!
    const cond = chunk.match(/^ {8}if: (.*)$/m)?.[1] ?? ""
    return { name, cond, body: chunk }
  })
}

const GUARD = "Skip a commit production has already moved past"
const SKIPPED = "steps.ancestry_guard.outputs.skip != 'true'"
const AFTER_DEPLOY = "steps.deploy_atomic.outcome == 'success'"

describe("deploy.yml wiring", () => {
  it("runs the guard in normal mode only, from the target's own checkout", () => {
    const steps = deploySteps()
    const g = steps.find((s) => s.name === GUARD)
    expect(g, "the ancestry guard step is gone from the deploy job").toBeDefined()
    expect(g!.body).toContain("id: ancestry_guard")
    // Recovery bootstraps deploy older artifacts on purpose.
    expect(g!.cond).toBe("${{ env.DEPLOYMENT_MODE == 'normal' }}")
    expect(g!.body).toContain('bash scripts/ci/deploy-ancestry-guard.sh "$DEPLOY_TARGET_SHA"')
    expect(g!.body).toContain("/api/v1/public/build-info")
    expect(steps.findIndex((s) => s.name === "Checkout code")).toBeLessThan(steps.indexOf(g!))
  })

  it("does not run for recovery_sha promotions, which roll back on purpose", () => {
    const deployIf = workflow.split("\n  deploy:\n")[1]!.match(/^ {4}if: (.*)$/m)![1]
    expect(deployIf).toContain("!(github.event_name == 'workflow_dispatch' && inputs.recovery_sha != '')")
  })

  it("nothing before the guard reaches the server", () => {
    const steps = deploySteps()
    const at = steps.findIndex((s) => s.name === GUARD)
    for (const step of steps.slice(0, at)) {
      expect(step.body, `"${step.name}" runs before the guard and talks to production`).not.toMatch(/\bssh\b|\bscp\b|SERVER_HOST|SSH_PRIVATE_KEY/)
    }
  })

  it("a skip leaves every later step that could touch production unrun", () => {
    const steps = deploySteps()
    const at = steps.findIndex((s) => s.name === GUARD)
    const later = steps.slice(at + 1)
    expect(later.find((s) => s.name === "Deploy atomically on production")?.cond).toContain(SKIPPED)
    for (const step of later) {
      if (step.name === "Cleanup SSH key") continue // only deletes the runner's own key file
      const gated = step.cond.includes(SKIPPED) || step.cond.includes(AFTER_DEPLOY)
      expect(gated, `"${step.name}" would still run after the guard said skip`).toBe(true)
      // `always()` would override a skipped deploy_atomic; `!cancelled()` does not.
      expect(step.cond, `"${step.name}" uses always()`).not.toContain("always()")
    }
  })
})
