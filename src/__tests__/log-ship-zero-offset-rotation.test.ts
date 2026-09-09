import { spawnSync } from "node:child_process"
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const logShipSource = readFileSync(join(root, "scripts/backup/ship-logs.sh"), "utf8")
const helpersStart = logShipSource.indexOf("slice_name()")
const helpersEnd = logShipSource.indexOf("commit_state()", helpersStart)
const recoveryHelpers = logShipSource.slice(helpersStart, helpersEnd)
const rescanStart = logShipSource.indexOf("bootstrap_rescan_rotations()")
const rescanEnd = logShipSource.indexOf("\n}\n\nbootstrap_rescan_rotations", rescanStart) + 2
const bootstrapRescanHelper = logShipSource.slice(rescanStart, rescanEnd)
const emptySha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

function runZeroOffsetRecovery(mode: "rename" | "copytruncate") {
  const directory = mkdtempSync(join(tmpdir(), "leaddrive-log-zero-offset-"))
  try {
    const logDirectory = join(directory, "logs")
    const workDirectory = join(directory, "work")
    const sliceDirectory = join(workDirectory, "slice")
    const active = join(logDirectory, "application.log")
    mkdirSync(logDirectory)
    mkdirSync(sliceDirectory, { recursive: true })
    writeFileSync(active, "")
    const stored = statSync(active)

    appendFileSync(active, "old-entry-after-empty-cursor\n")
    if (mode === "rename") {
      renameSync(active, `${active}.1`)
      writeFileSync(active, "new-active-entry\n")
    } else {
      copyFileSync(active, `${active}.1`)
      writeFileSync(active, "")
      appendFileSync(active, "new-active-entry\n")
      expect(statSync(active).ino).toBe(stored.ino)
    }

    const harness = join(directory, "recover.sh")
    writeFileSync(
      harness,
      `#!/usr/bin/env bash
set -euo pipefail
WORK_DIR="$1"
SLICE_DIR="$2"
source_path="$3"
stored_device="$4"
stored_inode="$5"
TEST_LOG_ROOT="$6"
WORK_ROOT="$WORK_DIR"
RANGE_INDEX="$WORK_DIR/RANGES.tsv"
TIMESTAMP=20260905T120000Z
SHIPPED_BYTES=0
log() { :; }
fatal() { printf '%s\\n' "$1" >&2; exit 1; }
${recoveryHelpers}
assert_safe_log_path() {
  local path="$1" parent
  case "$path" in
    "$TEST_LOG_ROOT"/*) ;;
    *) fatal "test log path is outside its isolated root: $path" ;;
  esac
  parent="$(dirname -- "$path")"
  [ "$(realpath -e -- "$parent" 2>/dev/null || true)" = "$parent" ] \
    || fatal "test log parent is unsafe: $path"
}
printf 'TYPE\\tSLICE\\tSOURCE\\tSTART\\tEND\\tBYTES\\n' >"$RANGE_INDEX"
recover_previous_tail "$source_path" "$stored_device" "$stored_inode" 0 0 "${emptySha}" 0
exec {source_fd}<"$source_path"
source_ref="/proc/self/fd/$source_fd"
source_size="$(stat -Lc '%s' "$source_ref")"
ship_range "$source_ref" "$source_path" 0 "$source_size"
exec {source_fd}<&-
`,
      { mode: 0o700 },
    )

    const result = spawnSync(
      "bash",
      [
        harness,
        workDirectory,
        sliceDirectory,
        active,
        String(stored.dev),
        String(stored.ino),
        logDirectory,
      ],
      { encoding: "utf8" },
    )
    const payload = readdirSync(sliceDirectory)
      .sort()
      .map((name) => readFileSync(join(sliceDirectory, name), "utf8"))
      .join("")

    return { result, payload }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function runFormerlyCollidingRanges() {
  const directory = mkdtempSync(join(tmpdir(), "leaddrive-log-slice-collision-"))
  try {
    const workDirectory = join(directory, "work")
    const sliceDirectory = join(workDirectory, "slice")
    const sourceOne = join(directory, "a__b", "c.log")
    const sourceTwo = join(directory, "a", "b__c.log")
    mkdirSync(join(directory, "a__b"))
    mkdirSync(join(directory, "a"))
    mkdirSync(sliceDirectory, { recursive: true })
    writeFileSync(sourceOne, "first-collision-entry\n")
    writeFileSync(sourceTwo, "second-collision-entry\n")

    const harness = join(directory, "ship-ranges.sh")
    writeFileSync(
      harness,
      `#!/usr/bin/env bash
set -euo pipefail
WORK_DIR="$1"
SLICE_DIR="$2"
first="$3"
second="$4"
WORK_ROOT="$WORK_DIR"
RANGE_INDEX="$WORK_DIR/RANGES.tsv"
TIMESTAMP=20260905T120000Z
SHIPPED_BYTES=0
log() { :; }
fatal() { printf '%s\\n' "$1" >&2; exit 1; }
${recoveryHelpers}
printf 'TYPE\\tSLICE\\tSOURCE\\tSTART\\tEND\\tBYTES\\n' >"$RANGE_INDEX"
ship_range "$first" "$first" 0 "$(stat -Lc '%s' "$first")"
ship_range "$second" "$second" 0 "$(stat -Lc '%s' "$second")"
`,
      { mode: 0o700 },
    )
    const result = spawnSync(
      "bash",
      [harness, workDirectory, sliceDirectory, sourceOne, sourceTwo],
      { encoding: "utf8" },
    )
    const slices = readdirSync(sliceDirectory).sort()
    const payloads = slices.map((name) => readFileSync(join(sliceDirectory, name), "utf8"))
    return { result, slices, payloads }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function runBootstrapPostActiveRotation() {
  const directory = mkdtempSync(join(tmpdir(), "leaddrive-log-bootstrap-race-"))
  try {
    const logDirectory = join(directory, "logs")
    const workDirectory = join(directory, "work")
    const sliceDirectory = join(workDirectory, "slice")
    const active = join(logDirectory, "application.log")
    mkdirSync(logDirectory)
    mkdirSync(sliceDirectory, { recursive: true })
    writeFileSync(active, "captured-before-rotation\n")

    const harness = join(directory, "bootstrap-race.sh")
    writeFileSync(
      harness,
      `#!/usr/bin/env bash
set -euo pipefail
WORK_DIR="$1"
WORK_ROOT="$WORK_DIR"
SLICE_DIR="$2"
RANGE_INDEX="$WORK_DIR/RANGES.tsv"
TEST_LOG_ROOT="$3"
active="$4"
TIMESTAMP=20260905T120000Z
SHIPPED_BYTES=0
EVIDENCE_BOOTSTRAP=1
LOG_SOURCE_DIRS=("$TEST_LOG_ROOT")
declare -A BOOTSTRAP_ROTATION_SIZES=()
declare -A BOOTSTRAP_ROTATION_WINDOWS=()
declare -A BOOTSTRAP_ROTATION_CHECKPOINTS=()
declare -A ACTIVE_CAPTURED_SIZES=()
declare -A ACTIVE_CAPTURED_WINDOWS=()
declare -A ACTIVE_CAPTURED_CHECKPOINTS=()
log() { :; }
fatal() { printf '%s\\n' "$1" >&2; exit 1; }
${recoveryHelpers}
${bootstrapRescanHelper}
assert_safe_log_path() {
  case "$1" in
    "$TEST_LOG_ROOT"/*) ;;
    *) fatal "test log path is outside its isolated root: $1" ;;
  esac
}
printf 'TYPE\\tSLICE\\tSOURCE\\tSTART\\tEND\\tBYTES\\n' >"$RANGE_INDEX"
exec {active_fd}<"$active"
active_ref="/proc/self/fd/$active_fd"
identity="$(stat -Lc '%d:%i' "$active_ref")"
captured_size="$(stat -Lc '%s' "$active_ref")"
ACTIVE_CAPTURED_SIZES["$identity"]="$captured_size"
captured_window="$captured_size"
[ "$captured_window" -le 4096 ] || captured_window=4096
ACTIVE_CAPTURED_WINDOWS["$identity"]="$captured_window"
ACTIVE_CAPTURED_CHECKPOINTS["$identity"]="$(checkpoint_sha "$active_ref" "$captured_size" "$captured_window")"
ship_range "$active_ref" "$active" 0 "$captured_size"
mv -- "$active" "$active.1"
printf 'appended-after-active-capture\\n' >>"$active.1"
printf 'new-active\\n' >"$active"
bootstrap_rescan_rotations
exec {active_fd}<&-
`,
      { mode: 0o700 },
    )

    const result = spawnSync(
      "bash",
      [harness, workDirectory, sliceDirectory, logDirectory, active],
      { encoding: "utf8" },
    )
    const payload = readdirSync(sliceDirectory)
      .sort()
      .map((name) => readFileSync(join(sliceDirectory, name), "utf8"))
      .join("")
    return { result, payload }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("gap-free zero-offset log rotation recovery", () => {
  it.each(["rename", "copytruncate"] as const)(
    "ships entries written after an empty cursor across %s rotation",
    (mode) => {
      const { result, payload } = runZeroOffsetRecovery(mode)

      expect(`${result.stdout}${result.stderr}`).toBe("")
      expect(result.status).toBe(0)
      expect(payload).toContain("old-entry-after-empty-cursor\n")
      expect(payload).toContain("new-active-entry\n")
    },
  )

  it("routes every zero-offset v2 cursor through conservative sibling recovery", () => {
    expect(logShipSource).toContain('if [ "$offset" -eq 0 ]; then')
    expect(logShipSource).toContain(
      'recover_previous_tail "$source" "$stored_device" "$stored_inode"',
    )
    expect(logShipSource).toContain(
      "Conservatively ship every retained sibling once the",
    )
    expect(logShipSource).toContain(
      'recover_previous_tail "$prior_path" "$stored_device" "$stored_inode"',
    )
  })

  it("keeps formerly colliding source paths in separate no-clobber slices", () => {
    const { result, slices, payloads } = runFormerlyCollidingRanges()

    expect(`${result.stdout}${result.stderr}`).toBe("")
    expect(result.status).toBe(0)
    expect(slices).toHaveLength(2)
    expect(new Set(slices).size).toBe(2)
    expect(payloads.sort()).toEqual([
      "first-collision-entry\n",
      "second-collision-entry\n",
    ])
    expect(logShipSource).toContain("set -o noclobber")
    expect(logShipSource).toContain("conv=notrunc")
  })

  it("rescans rotations after active capture and preserves the appended tail", () => {
    const { result, payload } = runBootstrapPostActiveRotation()

    expect(`${result.stdout}${result.stderr}`).toBe("")
    expect(result.status).toBe(0)
    expect(payload).toContain("captured-before-rotation\n")
    expect(payload).toContain("appended-after-active-capture\n")
    expect(payload.match(/captured-before-rotation/g)).toHaveLength(1)
    expect(payload.match(/appended-after-active-capture/g)).toHaveLength(1)
  })
})
