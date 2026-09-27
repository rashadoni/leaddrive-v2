import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const configurator = path.join(repoRoot, "scripts/ci/configure-main-protection.sh")
const tempDir = await mkdtemp(path.join(os.tmpdir(), "leaddrive-main-protection-test-"))
const mockGhPath = path.join(tempDir, "gh")
const payloadPath = path.join(tempDir, "put-payload.json")

const mockGh = `#!/usr/bin/env bash
set -euo pipefail

is_put=false
for argument in "$@"; do
  if [[ "$argument" == "PUT" ]]; then
    is_put=true
  fi
done

if [[ "$is_put" == "true" ]]; then
  cat >"$MOCK_PUT_PAYLOAD"
  exit 0
fi

printf '%s\\n' "$MOCK_PROTECTION_JSON"
`

await writeFile(mockGhPath, mockGh, "utf8")
await chmod(mockGhPath, 0o755)

const expectedChecks = [
  { context: "pr-scope", app_id: 15368 },
  { context: "static-checks", app_id: 15368 },
  { context: "typecheck", app_id: 15368 },
  { context: "runner-policy", app_id: 15368 },
  { context: "scan", app_id: 15368 },
]

const validReadback = {
  required_status_checks: { strict: false, checks: expectedChecks },
  enforce_admins: { enabled: true },
  required_pull_request_reviews: {
    dismiss_stale_reviews: false,
    require_code_owner_reviews: false,
    require_last_push_approval: false,
    required_approving_review_count: 0,
  },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
}

function runConfigurator(readback) {
  return spawnSync("bash", [configurator, "rashadoni/leaddrive-v2"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      MOCK_PUT_PAYLOAD: payloadPath,
      MOCK_PROTECTION_JSON: JSON.stringify(readback),
    },
  })
}

try {
  const success = runConfigurator(validReadback)
  assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`)

  const requestedPayload = JSON.parse(await readFile(payloadPath, "utf8"))
  assert.deepEqual(
    requestedPayload.required_status_checks.checks,
    expectedChecks,
    "the write request must require exactly the five GitHub Actions checks",
  )

  // Owner 2026-09-26: the AI review gate must not come back for any session.
  for (const [label, mutate] of [
    ["agent-review required again", (value) => value.required_status_checks.checks.push({ context: "agent-review", app_id: null })],
    ["missing scan", (value) => value.required_status_checks.checks.pop()],
    ["unbound machine check", (value) => { delete value.required_status_checks.checks.at(-1).app_id }],
    ["wrong machine app", (value) => { value.required_status_checks.checks[0].app_id = null }],
    ["admin bypass", (value) => { value.enforce_admins.enabled = false }],
    ["missing PR-only rule", (value) => { value.required_pull_request_reviews = null }],
    ["force push enabled", (value) => { value.allow_force_pushes.enabled = true }],
    ["deletion enabled", (value) => { value.allow_deletions.enabled = true }],
  ]) {
    const readback = structuredClone(validReadback)
    mutate(readback)
    const rejected = runConfigurator(readback)
    assert.notEqual(rejected.status, 0, `${label} must fail closed`)
    assert.match(rejected.stderr, /readback does not match the fail-closed contract/u)
  }
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

console.log("main protection configurator tests passed")
