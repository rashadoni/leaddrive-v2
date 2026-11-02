import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

/** Verify the actual GitHub checkout, including a base branch advanced since
 * the PR payload was recorded. Fetch only bounded history from checkout's
 * origin; never synthesize a replacement candidate or change the worktree. */
export function verifyGithubCandidate({ cwd = process.cwd(), githubSha, headSha, event, repository }) {
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim()
  for (const sha of [githubSha, headSha]) assert.match(sha || "", /^[0-9a-f]{40}$/, "Exact candidate SHA required")
  const checkoutSha = git(["rev-parse", "HEAD"])
  assert.equal(checkoutSha, githubSha, "Checkout must be the GitHub-supplied revision")
  const parents = git(["show", "-s", "--format=%P", "HEAD"]).split(" ").filter(Boolean)
  if (checkoutSha === headSha) {
    assert.ok(!event.pull_request, "A PR requires its merge candidate")
    return { checkoutSha, parents, eventBaseSha: null, candidateBaseSha: null, verifiedMainSha: null }
  }
  const pr = event.pull_request
  assert.equal(pr?.head?.sha, headSha, "Exact PR head required")
  assert.equal(repository, "rashadoni/leaddrive-v2", "Registered repository required")
  assert.equal(pr?.base?.repo?.full_name, repository, "Same registered base repository required")
  assert.equal(pr?.base?.ref, "main", "Reviewed main base required")
  const eventBaseSha = pr?.base?.sha
  assert.match(eventBaseSha || "", /^[0-9a-f]{40}$/, "Exact event base required")
  assert.equal(parents.length, 2, "Exactly two candidate parents required")
  assert.equal(parents[1], headSha, "Candidate second parent must be the exact PR head")
  const candidateBaseSha = parents[0]
  let verifiedMainSha = null
  if (candidateBaseSha !== eventBaseSha) {
    git(["fetch", "--no-tags", "--depth=256", "origin", "refs/heads/main"])
    verifiedMainSha = git(["rev-parse", "FETCH_HEAD"])
    git(["merge-base", "--is-ancestor", eventBaseSha, candidateBaseSha])
    git(["merge-base", "--is-ancestor", candidateBaseSha, verifiedMainSha])
  }
  return { checkoutSha, parents, eventBaseSha, candidateBaseSha, verifiedMainSha }
}
