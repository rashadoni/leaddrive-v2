import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const sources = Object.fromEntries([
  ["backup", "scripts/backup/postgres-backup.sh"],
  ["restore", "scripts/backup/postgres-restore-canary.sh"],
  ["commission", "scripts/backup/commission-production-backup.sh"],
  ["deploy", "scripts/server-deploy.sh"],
  ["readiness", "scripts/backup/report-production-readiness.sh"],
].map(([name, path]) => [name, readFileSync(join(root, path), "utf8")]))

// Execute only the actual guard function, never source an operational script:
// its top-level code can install tools, deploy, back up, or restore databases.
function extractFunction(source, name) {
  const matches = [...source.matchAll(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, "gm"))]
  assert.equal(matches.length, 1, `expected exactly one ${name} definition`)
  return matches[0][0]
}

function extractCaLoop(source, variable) {
  const beginning = `for ${variable} in /etc/leaddrive/managed-postgres-ca.crt /etc/leaddrive/restore-postgres-ca.crt; do`
  const start = source.indexOf(beginning)
  assert.notEqual(start, -1, "production CA validation must remain separate from passfiles")
  assert.equal(source.indexOf(beginning, start + beginning.length), -1)
  const end = source.indexOf("\n  done", start)
  assert.notEqual(end, -1)
  // Only redirect the two literal production paths to disposable fixtures.
  // Keep the actual loop body, modes, and root-ownership guard unchanged.
  return source.slice(start, end + "\n  done".length)
    .replace("/etc/leaddrive/managed-postgres-ca.crt", '"$TEST_FILE"')
    .replace("/etc/leaddrive/restore-postgres-ca.crt", '"$TEST_FILE_TWO"')
}

const subjects = [
  ...["backup", "restore"].map((name) => ({
    name,
    code: extractFunction(sources[name], "assert_connection_file"),
    call: 'assert_connection_file fixture "$TEST_FILE" "$TEST_KIND"',
    runner: true,
  })),
  ...["commission", "deploy"].map((name) => ({
    name,
    code: extractFunction(sources[name], "assert_backup_password_file"),
    call: 'assert_backup_password_file "$TEST_FILE"',
  })),
  {
    name: "readiness",
    code: extractFunction(sources.readiness, "check_service_secret_file"),
    call: 'declare -A CONFIG=([PGPASSFILE]="$TEST_FILE"); check_service_secret_file PGPASSFILE; [ "$FAILURES" -eq 0 ] || exit 78',
  },
]

const fixtureContents = "synthetic-pgpass-contract-fixture-only\n"
const shellPrelude = String.raw`
set -euo pipefail
TEST_FILE="$1"
TEST_FILE_TWO="$2"
FAILURES=0
fatal() { printf 'guard: %s\n' "$*" >&2; exit 78; }
fatal_after_standalone_replacement() { fatal "$@"; }
fail() { printf 'guard: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { :; }

# Do not require root, real service accounts, or chown. Only ownership and
# account lookup are simulated; file existence, chmod, symlinks and stat mode
# checks use real temporary files and the real operating-system commands.
id() {
  case "$*" in
    '-u') printf '%s\n' "$CURRENT_UID" ;;
    '-g') printf '%s\n' "$CURRENT_GID" ;;
    '-u leaddrive-backup')
      [ "$ACCOUNT_PRESENT" = yes ] || return 1
      printf '%s\n' "$SERVICE_UID" ;;
    '-g leaddrive-backup')
      [ "$ACCOUNT_PRESENT" = yes ] || return 1
      printf '%s\n' "$SERVICE_GID" ;;
    *) printf 'unexpected id invocation\n' >&2; return 79 ;;
  esac
}
stat() {
  if [ "$#" -eq 3 ] && [ "$1" = -c ] && \
      { [ "$3" = "$TEST_FILE" ] || [ "$3" = "$TEST_FILE_TWO" ]; }; then
    case "$2" in
      '%u') printf '%s\n' "$FILE_UID"; return 0 ;;
      '%g') printf '%s\n' "$FILE_GID"; return 0 ;;
    esac
  fi
  command stat "$@"
}
runuser() {
  [ "$#" -ge 4 ] && [ "$1" = -u ] && [ "$2" = leaddrive-backup ] && [ "$3" = -- ] \
    || { printf 'unexpected runuser invocation\n' >&2; return 79; }
  shift 3
  "$@"
}
`

function executeGuard(subject, overrides = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "leaddrive-pgpass-contract-"))
  try {
    const file = join(fixtureRoot, "connection-file")
    const second = join(fixtureRoot, "second-ca")
    for (const path of [file, second]) {
      writeFileSync(path, fixtureContents, { mode: 0o600, flag: "wx" })
      chmodSync(path, overrides.mode ?? 0o600)
    }
    let target = file
    if (overrides.pathKind === "symlink") {
      target = join(fixtureRoot, "connection-link")
      symlinkSync(file, target)
    } else if (overrides.pathKind === "missing") {
      target = join(fixtureRoot, "missing-file")
    } else if (overrides.pathKind === "directory") {
      target = join(fixtureRoot, "directory")
      mkdirSync(target, { mode: 0o700 })
    } else if (overrides.pathKind === "relative") {
      target = "connection-file"
    }
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
      `${shellPrelude}\n${subject.code}\n${subject.call}\n`,
      "pgpass-contract", target, second], {
      cwd: fixtureRoot,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 32_768,
      // In particular, do not inherit BASH_ENV or production PG* variables.
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        CURRENT_UID: String(overrides.currentUid ?? 7311),
        CURRENT_GID: String(overrides.currentGid ?? 7312),
        FILE_UID: String(overrides.owner ?? 7311),
        FILE_GID: String(overrides.group ?? 7312),
        SERVICE_UID: String(overrides.serviceUid ?? 7311),
        SERVICE_GID: String(overrides.serviceGid ?? 7312),
        ACCOUNT_PRESENT: overrides.accountPresent === false ? "no" : "yes",
        TEST_KIND: overrides.kind ?? "password",
      },
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null, "guard must terminate without a signal")
    assert.equal(result.stdout.includes(fixtureContents.trim()), false, "must not disclose file contents")
    assert.equal(result.stderr.includes(fixtureContents.trim()), false, "must not disclose file contents")
    return result
  } finally {
    // This exact temporary directory was created above and contains only our fixtures.
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function expectAllowed(subject, options) {
  const result = executeGuard(subject, options)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "", "valid authority must not produce a hidden failure")
}

function expectRejected(subject, options) {
  const result = executeGuard(subject, options)
  assert.equal(result.status, 78, `must fail through the guard, not a missing command:\n${result.stderr}`)
  assert.match(result.stderr, /guard:/)
}

for (const subject of subjects) {
  test(`${subject.name}: accepts private 0400/0600 without exposing contents`, () => {
    for (const mode of [0o400, 0o600]) expectAllowed(subject, { mode })
  })
  test(`${subject.name}: rejects group/world permissions including legacy root-owned modes`, () => {
    for (const mode of [0o440, 0o640, 0o644, 0o666]) expectRejected(subject, { mode })
    for (const mode of [0o440, 0o640]) expectRejected(subject, { mode, owner: 0 })
  })
  test(`${subject.name}: rejects another owner, including root-owned private files`, () => {
    for (const owner of [0, 9411]) expectRejected(subject, { owner })
  })
  test(`${subject.name}: rejects symlink, missing, directory, and relative paths`, () => {
    for (const pathKind of ["symlink", "missing", "directory", "relative"]) {
      expectRejected(subject, { pathKind })
    }
  })
  if (subject.runner) {
    test(`${subject.name}: uses invoking user identity, allowing an independent offline account`, () => {
      for (const mode of [0o400, 0o600]) {
        expectAllowed(subject, { mode, currentUid: 8411, owner: 8411, group: 9412 })
        expectRejected(subject, { mode, currentUid: 8411 })
      }
    })
  } else {
    test(`${subject.name}: requires exact service group and an existing service account`, () => {
      expectRejected(subject, { group: 9412 })
      expectRejected(subject, { accountPresent: false })
      expectRejected(subject, { serviceUid: 0, owner: 0 })
      expectRejected(subject, { serviceGid: 0, group: 0 })
      // Commissioning runs as root but must still require the service-owned authority.
      expectAllowed(subject, { currentUid: 0, currentGid: 0 })
    })
  }
}

for (const subject of subjects.filter((entry) => entry.runner)) {
  test(`${subject.name}: CA files retain separate ownership and public-read permissions`, () => {
    for (const mode of [0o444, 0o644]) expectAllowed(subject, { kind: "ca", owner: 0, mode })
    expectRejected(subject, { kind: "ca", owner: 9411, mode: 0o644 })
    expectRejected(subject, { kind: "ca", owner: 0, mode: 0o666 })
    expectRejected(subject, { kind: "ca", owner: 0, mode: 0o644, pathKind: "symlink" })
    if (subject.name === "backup") {
      expectRejected(subject, { kind: "ca", mode: 0o644 })
    } else {
      expectAllowed(subject, { kind: "ca", currentUid: 8411, owner: 8411, mode: 0o644 })
    }
  })
}

for (const [name, variable, rootGuard] of [
  ["commission", "file", "assert_root_file"],
  ["deploy", "policy_value", "assert_root_owned_nonwritable_file"],
]) {
  test(`${name}: actual CA loop still requires root while the passfile loop uses its own guard`, () => {
    const loop = extractCaLoop(sources[name], variable)
    assert.ok(loop.includes(rootGuard))
    assert.ok(!loop.includes("assert_backup_password_file"))
    const passwordLoop = `for ${variable} in /etc/leaddrive/backup.pgpass /etc/leaddrive/restore-verifier.pgpass; do\n    assert_backup_password_file "$${variable}"\n  done`
    assert.ok(sources[name].includes(passwordLoop), "canonical passfiles must reach the password guard")
    const subject = {
      code: extractFunction(sources[name], rootGuard),
      call: loop,
    }
    for (const mode of [0o444, 0o644]) expectAllowed(subject, { owner: 0, mode })
    expectRejected(subject, { owner: 7311, mode: 0o644 })
    expectRejected(subject, { owner: 0, mode: 0o666 })
    expectRejected(subject, { owner: 0, mode: 0o644, pathKind: "symlink" })
  })
}
