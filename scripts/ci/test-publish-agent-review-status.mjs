import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const publisher = path.join(repoRoot, "scripts/ci/publish-agent-review-status.sh")
const tempDir = await mkdtemp(path.join(os.tmpdir(), "leaddrive-agent-review-test-"))
const callsPath = path.join(tempDir, "gh-calls.tsv")
const mockGhPath = path.join(tempDir, "gh")
const exactSha = "a".repeat(40)

const mockGh = `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'CALL'
  for argument in "$@"; do
    printf '\\t%s' "$argument"
  done
  printf '\\n'
} >>"$MOCK_GH_CALLS"

if [[ "$#" -ge 2 && "$1" == "api" && "$2" == repos/*/pulls/* ]]; then
  if [[ "\${MOCK_PR_API_FAIL:-0}" == "1" ]]; then
    echo "mock pull request API failure" >&2
    exit 55
  fi
  printf '%s\\t%s\\t%s\\n' "$MOCK_PR_HEAD" "$MOCK_PR_BASE" "$MOCK_PR_STATE"
  exit 0
fi

for argument in "$@"; do
  if [[ "$argument" == repos/*/statuses/* ]]; then
    exit 0
  fi
done

echo "unexpected gh invocation" >&2
exit 97
`

await writeFile(mockGhPath, mockGh, "utf8")
await chmod(mockGhPath, 0o755)

async function runPublisher(args, overrides = {}) {
  await writeFile(callsPath, "", "utf8")
  const result = spawnSync("bash", [publisher, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      MOCK_GH_CALLS: callsPath,
      MOCK_PR_HEAD: exactSha,
      MOCK_PR_BASE: "main",
      MOCK_PR_STATE: "open",
      ...overrides,
    },
  })
  return { ...result, calls: await readFile(callsPath, "utf8") }
}

function assertRejected(result, messagePattern) {
  assert.notEqual(result.status, 0, `expected rejection, got stdout: ${result.stdout}`)
  assert.match(result.stderr, messagePattern)
  assert.doesNotMatch(result.calls, /repos\/[^\s]+\/statuses\//u)
}

try {
  assertRejected(
    await runPublisher(["198", exactSha.slice(0, 12), "success", "Independent review GREEN"]),
    /full lowercase 40-character commit SHA/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "passed", "Independent review GREEN"]),
    /state must be pending, success, failure, or error/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "success", "Independent review GREEN"], {
      MOCK_PR_API_FAIL: "1",
    }),
    /could not query the pull request/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "success", "Independent review GREEN"], {
      MOCK_PR_HEAD: "",
    }),
    /could not read the pull request head, base, and state/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "success", "Independent review GREEN"], {
      MOCK_PR_HEAD: "b".repeat(40),
    }),
    /refusing stale review/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "success", "Independent review GREEN"], {
      MOCK_PR_BASE: "release",
    }),
    /targeting release, not main/u,
  )
  assertRejected(
    await runPublisher(["198", exactSha, "success", "Independent review GREEN"], {
      MOCK_PR_STATE: "closed",
    }),
    /non-open PR/u,
  )

  const pending = await runPublisher(["198", exactSha, "pending", "Independent review in progress"])
  assert.equal(pending.status, 0, pending.stderr)
  assert.match(pending.calls, new RegExp(`repos/rashadoni/leaddrive-v2/statuses/${exactSha}`, "u"))
  assert.match(pending.calls, /\tstate=pending(?:\t|\n)/u)
  assert.match(pending.calls, /\tcontext=agent-review(?:\t|\n)/u)

  const success = await runPublisher(["198", exactSha, "success", "Independent review GREEN"])
  assert.equal(success.status, 0, success.stderr)
  assert.match(success.calls, new RegExp(`repos/rashadoni/leaddrive-v2/statuses/${exactSha}`, "u"))
  assert.match(success.calls, /\tstate=success(?:\t|\n)/u)
  assert.match(success.calls, /\tcontext=agent-review(?:\t|\n)/u)
  assert.match(success.stdout, /Published agent-review=success/u)
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

console.log("agent-review status publisher tests passed")
