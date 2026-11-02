import { afterEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { verifyGithubCandidate } from "../../scripts/ci/verify-github-candidate.mjs"

const owned: string[] = []
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(kind = "advanced") {
  const root = mkdtempSync(join(tmpdir(), "github-candidate-proof-")); owned.push(root)
  const source = join(root, "origin"), cwd = join(root, "checkout"); mkdirSync(source)
  const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: source, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
  git(["init", "--initial-branch=main"])
  git(["config", "user.name", "Synthetic candidate fixture"]); git(["config", "user.email", "fixture@example.invalid"])
  const tree = git(["mktree"], "")
  const commit = (message: string, parents: string[] = []) => git(["commit-tree", tree, ...parents.flatMap(p => ["-p", p])], message)
  const base = commit("event base"), head = commit("PR head", [base])
  const next = commit("main next", [base]), advanced = commit("main advanced", [next])
  const latest = commit("main after candidate", [advanced]), unrelated = commit("unrelated root")
  const divergent = commit("not on main", [base])
  const parent = kind === "exact" ? base : kind === "unrelated" ? unrelated : kind === "divergent" ? divergent : advanced
  const candidate = commit("GitHub merge candidate", kind === "single" ? [parent] : [parent, head])
  git(["update-ref", "refs/heads/main", latest]); git(["update-ref", "refs/heads/candidate", candidate])
  git(["clone", "--depth=2", "--branch=candidate", pathToFileURL(source).href, cwd])
  const event = { pull_request: { head: { sha: head }, base: { sha: base, ref: "main", repo: { full_name: "rashadoni/leaddrive-v2" } } } }
  return { cwd, githubSha: candidate, headSha: head, event, repository: "rashadoni/leaddrive-v2", latest, parent, unrelated }
}

describe("GitHub candidate provenance against actual shallow Git history", () => {
  it("accepts the exact event base and head without fetching or replacing the checkout", () => {
    const f = fixture("exact"), result = verifyGithubCandidate(f)
    expect(result.checkoutSha).toBe(f.githubSha)
    expect(result.candidateBaseSha).toBe(f.event.pull_request.base.sha)
    expect(result.verifiedMainSha).toBeNull()
  })
  it("accepts a verified main advance and records both bases and the fetched main SHA", () => {
    const f = fixture(), result = verifyGithubCandidate(f)
    expect(result.eventBaseSha).toBe(f.event.pull_request.base.sha)
    expect(result.candidateBaseSha).toBe(f.parent)
    expect(result.verifiedMainSha).toBe(f.latest)
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.cwd, encoding: "utf8" }).trim()).toBe(f.githubSha)
  })
  it.each(["unrelated", "divergent", "single"])("refuses a %s candidate base or parent shape", kind => {
    expect(() => verifyGithubCandidate(fixture(kind))).toThrow()
  })
  it("refuses an event base from another lineage even if the actual base is on main", () => {
    const f = fixture(); f.event.pull_request.base.sha = f.unrelated
    expect(() => verifyGithubCandidate(f)).toThrow()
  })
  it("refuses a different PR head even when its object exists", () => {
    const f = fixture(); f.headSha = f.parent; f.event.pull_request.head.sha = f.parent
    expect(() => verifyGithubCandidate(f)).toThrow(/second parent/)
  })
  it("refuses an unverified checkout revision", () => {
    const f = fixture(); f.githubSha = f.headSha
    expect(() => verifyGithubCandidate(f)).toThrow(/GitHub-supplied/)
  })
  it.each(["repo", "branch"])("refuses a different base %s", kind => {
    const f = fixture()
    if (kind === "repo") f.event.pull_request.base.repo.full_name = "unrelated/repository"
    else f.event.pull_request.base.ref = "another-branch"
    expect(() => verifyGithubCandidate(f)).toThrow()
  })
  it("refuses a PR head-only checkout; explicit non-PR dispatch remains valid", () => {
    const f = fixture()
    execFileSync("git", ["checkout", "--detach", f.headSha], { cwd: f.cwd, stdio: "pipe" })
    f.githubSha = f.headSha
    expect(() => verifyGithubCandidate(f)).toThrow(/merge candidate/)
    expect(verifyGithubCandidate({ ...f, event: {} }).checkoutSha).toBe(f.headSha)
  })
})
