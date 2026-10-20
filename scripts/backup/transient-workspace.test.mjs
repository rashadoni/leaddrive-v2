import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statfsSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const source = readFileSync(new URL("./commission-production-backup.sh", import.meta.url), "utf8")
const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C" }
function extract(name) {
  const found = [...source.matchAll(new RegExp("^" + name + "\\(\\) \\{\\n[\\s\\S]*?^\\}", "gm"))]
  assert.equal(found.length, 1, name)
  return found[0][0]
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "leaddrive-workspace-unit-"))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function execute(root, options = {}) {
  const script = `set -Eeuo pipefail
${["fatal", "assert_transient_database_memory_budget", "run_transient_backup_unit"].map(extract).join("\n")}
log() { printf '[fixture] %s\\n' "$*"; }
assert_empty_transient_workspace() {
  printf '%s\\n' "$@" >"$TEST_ROOT/host-admission"
  [ "$TEST_DENY_WORKSPACE" = 0 ] || fatal "synthetic workspace refusal"
}
awk() {
  if [ "${"$"}{2:-}" = /proc/meminfo ]; then
    case "$1" in *MemAvailable*) printf '%s\\n' "$TEST_AVAILABLE";; *SwapTotal*) printf '%s\\n' "$TEST_SWAP";; *) exit 97;; esac
  else command awk "$@"; fi
}
systemctl() {
  case "$*" in
    *LoadState*) printf '%s\\n' "$TEST_LOAD";;
    *InvocationID*) printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n';;
    *ActiveState*) printf 'active\\n';;
    *SubState*) printf 'exited\\n';;
    *ExecMainStatus*) printf '0\\n';;
    *Result*) printf 'success\\n';;
    stop*|reset-failed*) :;;
    *) exit 98;;
  esac
}
systemd-run() { printf '%s\\n' "$@" >"$TEST_ROOT/argv"; }
journalctl() { :; }
WORKFLOW_RUN_ID=123456789
BACKUP_ENV_FILE="$TEST_ROOT/public.env"
OPERATION=run-owner-backup
OWNER_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ACTIVE_TRANSIENT_UNIT=""
run_transient_backup_unit "$TEST_LABEL" "$TEST_USER" "$TEST_GROUP" /reviewed/public-helper.sh 5 "$TEST_ROOT/journal"
`
  return spawnSync("bash", ["-c", script, "workspace-test"], {
    env: { ...env, TEST_ROOT: root, TEST_AVAILABLE: options.available ?? "8388608", TEST_SWAP: options.swap ?? "0",
      TEST_LOAD: options.load ?? "not-found", TEST_LABEL: options.label ?? "database", TEST_USER: options.user ?? "nobody",
      TEST_GROUP: options.group ?? "nogroup", TEST_DENY_WORKSPACE: options.denyWorkspace ? "1" : "0" }, encoding: "utf8", timeout: 5000,
  })
}

test("real function gives database a private noexec tmpfs and hard cgroup ceilings", () => fixture(root => {
  const result = execute(root)
  assert.equal(result.status, 0, result.stderr)
  const args = readFileSync(join(root, "argv"), "utf8").trim().split("\n")
  for (const value of [
    "--property=TemporaryFileSystem=/run/leaddrive-postgres-backup:rw,nodev,nosuid,noexec,size=3221225472,mode=0750,uid=65534,gid=65534",
    "--property=MemoryHigh=3221225472", "--property=MemoryMax=4294967296", "--property=MemorySwapMax=0",
    "--property=ProtectSystem=strict", "--property=NoNewPrivileges=yes", "--property=RestrictNamespaces=yes",
    "--owner-operated", "age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ]) assert(args.includes(value), value)
  assert(!args.some(value => /remount|swapoff/.test(value)))
  assert.equal(readFileSync(join(root, "host-admission"), "utf8"), "/run/leaddrive-postgres-backup\n65534\n65534\n")
}))

test("low/unknown memory or enabled swap refuses before any unit launch", () => {
  for (const options of [{ available: "8388607" }, { available: "" }, { available: "bad" },
    { available: "8388608\n8388608" }, { swap: "1" }, { swap: "" }, { swap: "bad" }]) fixture(root => {
    const result = execute(root, options)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(root, "argv")), false)
    assert.match(result.stderr, /available host memory|swap-free production host/)
  })
})

test("root database identity and pre-existing unit are rejected without launch", () => {
  for (const options of [{ user: "root", group: "root" }, { user: "nobody", group: "root" }, { load: "loaded" }, { denyWorkspace: true }]) fixture(root => {
    const result = execute(root, options)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(root, "argv")), false)
  })
})

test("secrets/runtime workers do not receive the database workspace or a root-owned database bypass", () => {
  for (const label of ["secrets", "runtime-files"]) fixture(root => {
    const result = execute(root, { label, user: "root", group: "root", available: "1", swap: "1" })
    assert.equal(result.status, 0, result.stderr)
    const args = readFileSync(join(root, "argv"), "utf8")
    assert(!args.includes("TemporaryFileSystem"))
    assert(!args.includes("MemoryMax"))
    assert(args.includes("--property=MemorySwapMax=0"))
  })
})

test("existing plaintext capacity/crypto checks remain unchanged", () => {
  const postgres = readFileSync(new URL("./postgres-backup.sh", import.meta.url), "utf8")
  assert(postgres.includes("SOURCE_DATABASE_BYTES * CAPACITY_RATIO_PERCENT / 100 + 536870912"))
  assert(postgres.includes('[ "$CAPACITY_RATIO_PERCENT" -ge 250 ]'))
  assert(postgres.includes('[ "$minimum" -ge 1073741824 ]'))
  assert(postgres.includes('fatal "backup tmpfs has insufficient free capacity"'))
  assert(source.includes("verify_owner_key_proof"))
  assert(source.includes("prove_object_lock"))
})

test("host workspace admission preserves old files and rejects symlinks/ownership/modes", () => {
  for (const kind of ["empty", "nonempty", "symlink", "prefix-link", "mode", "owner", "missing", "find-error"]) fixture(root => {
    const directory = join(root, "workspace")
    if (kind !== "missing") mkdirSync(directory, { mode: 0o750 })
    let path = directory
    if (kind === "nonempty") writeFileSync(join(directory, "preserve"), "synthetic prior state")
    if (kind === "mode") chmodSync(directory, 0o777)
    if (kind === "symlink") { symlinkSync(directory, join(root, "link")); path = join(root, "link") }
    if (kind === "prefix-link") { symlinkSync(root, join(root, "alias")); path = join(root, "alias/workspace") }
    const result = spawnSync("bash", ["-c", "set -Eeuo pipefail\n" + extract("fatal") + "\n" + extract("assert_empty_transient_workspace") +
      (kind === "find-error" ? "\nfind() { return 1; }\n" : "\n") +
      '\nassert_empty_transient_workspace "$TEST_PATH" "$TEST_UID" "$TEST_GID"'], {
      env: { ...env, TEST_PATH: path, TEST_UID: String(kind === "owner" ? process.getuid() + 1 : process.getuid()), TEST_GID: String(process.getgid()) }, encoding: "utf8", timeout: 5000 })
    assert.equal(result.status === 0, kind === "empty", kind)
    if (kind === "nonempty") assert.equal(readFileSync(join(directory, "preserve"), "utf8"), "synthetic prior state")
  })
})

test("actual systemd unit mounts only a private bounded workspace; kernel/cgroup/UID/noexec proof", {
  skip: process.env.LEADDRIVE_TEST_REAL_WORKSPACE === "1" ? false : "requires isolated hosted Linux systemd, never run on DEV",
}, () => {
  assert.equal(process.getuid(), 0)
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted")
  assert.equal(existsSync("/var/lib/leaddrive-postgres-backup"), false, "never reuse pre-existing state")
  assert.equal(existsSync("/run/leaddrive-postgres-backup"), false, "never reuse pre-existing runtime")
  assert.equal(existsSync("/etc/leaddrive"), false, "isolated fixture must not touch existing configuration")
  const root = mkdtempSync("/usr/local/lib/leaddrive-workspace-fixture-")
  const runId = String(process.pid) + String(Date.now()).slice(-8)
  const unit = "leaddrive-backup-commission-database-" + runId + ".service"
  const hostSize = () => { const s = statfsSync("/run", { bigint: true }); return s.blocks * s.bsize }
  const before = hostSize()
  let attempted = false, ownedEtc = false, ownedRuntime = false
  try {
    chmodSync(root, 0o755)
    mkdirSync("/etc/leaddrive", { mode: 0o755 })
    ownedEtc = true
    mkdirSync("/run/leaddrive-postgres-backup", { mode: 0o750 })
    ownedRuntime = true
    chownSync("/run/leaddrive-postgres-backup", 65534, 65534)
    const program = join(root, "public-fixture.sh"), environment = join(root, "public.env")
    writeFileSync(environment, "# Synthetic, no credentials or customer data.\n", { mode: 0o644 })
    writeFileSync(program, `#!/bin/bash
set -euo pipefail
work=/run/leaddrive-postgres-backup
[ "$(id -u)" = 65534 ]
[ "$(stat -c '%u:%g:%a' "$work")" = 65534:65534:750 ]
[ "$(findmnt -n -o FSTYPE --target "$work")" = tmpfs ]
[ "$(df -B1 --output=size "$work" | tail -1 | tr -d ' ')" = 3221225472 ]
group="$(awk -F: '$1 == "0" {print $3}' /proc/self/cgroup)"
[ "$(cat "/sys/fs/cgroup$group/memory.max")" = 4294967296 ]
[ "$(cat "/sys/fs/cgroup$group/memory.high")" = 3221225472 ]
[ "$(cat "/sys/fs/cgroup$group/memory.swap.max")" = 0 ]
printf '#!/bin/sh\\nexit 0\\n' >"$work/noexec-probe"
chmod 0700 "$work/noexec-probe"
set +e
"$work/noexec-probe" >/dev/null 2>&1
status=$?
set -e
[ "$status" = 126 ]
printf 'PRIVATE_WORKSPACE_KERNEL_TEST=PASS\\n'
`, { mode: 0o755 })
    const load = spawnSync("systemctl", ["show", "--property=LoadState", "--value", unit], { env, encoding: "utf8", timeout: 5000 })
    assert(["", "not-found"].includes(load.stdout.trim()), "never acquire an existing unit")
    // Host-budget policy is tested above with synthetic counters. The actual
    // hosted kernel unit uses the exact production limits but touches only a
    // tiny synthetic file; it never reserves/allocates three GiB of payload.
    attempted = true
    const result = spawnSync("bash", ["-c", `set -Eeuo pipefail
${["fatal", "assert_empty_transient_workspace", "run_transient_backup_unit"].map(extract).join("\n")}
assert_transient_database_memory_budget() { :; }
log() { :; }
WORKFLOW_RUN_ID="$TEST_RUN_ID"
BACKUP_ENV_FILE="$TEST_ENV"
OPERATION=run-owner-backup
OWNER_RECIPIENT=age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ACTIVE_TRANSIENT_UNIT=""
run_transient_backup_unit database nobody nogroup "$TEST_PROGRAM" 30 "$TEST_ROOT/journal"
`], { env: { ...env, TEST_RUN_ID: runId, TEST_ENV: environment, TEST_PROGRAM: program, TEST_ROOT: root },
      encoding: "utf8", timeout: 45000 })
    if (result.status !== 0) {
      const diagnostic = spawnSync("journalctl", ["--unit=" + unit, "--no-pager", "--output=cat", "--lines=20"], { env, encoding: "utf8", timeout: 5000, maxBuffer: 32768 })
      assert.fail(result.stderr + "\nSynthetic fixture only:\n" + diagnostic.stdout)
    }
    assert.match(readFileSync(join(root, "journal"), "utf8"), /PRIVATE_WORKSPACE_KERNEL_TEST=PASS/)
    assert.equal(hostSize(), before, "global /run must not be resized")
  } finally {
    if (attempted) {
      spawnSync("systemctl", ["stop", unit], { env, timeout: 5000 })
      spawnSync("systemctl", ["reset-failed", unit], { env, timeout: 5000 })
      // The fixture proved absence before launch. Remove only its empty state
      // directory; never recursively erase any unexpected content.
      if (existsSync("/var/lib/leaddrive-postgres-backup")) rmdirSync("/var/lib/leaddrive-postgres-backup")
    }
    if (ownedRuntime && existsSync("/run/leaddrive-postgres-backup")) rmdirSync("/run/leaddrive-postgres-backup")
    if (ownedEtc && existsSync("/etc/leaddrive")) rmdirSync("/etc/leaddrive")
    rmSync(root, { recursive: true, force: true })
  }
})
