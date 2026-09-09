import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (relative: string) => readFileSync(join(root, relative), "utf8")
const deploySource = read("scripts/server-deploy.sh")
const deployFunctionPrefix = deploySource.slice(
  0,
  deploySource.indexOf("# Lock the host before even reading the deployment environment."),
)
const stagedOperationsValidationStart = deploySource.indexOf(
  "validate_staged_operations_systemd_units()",
)
const stagedOperationsValidationFunction = deploySource.slice(
  stagedOperationsValidationStart,
  deploySource.indexOf("\n}\n\ncapture_root_crontab()", stagedOperationsValidationStart) + 2,
)

function runExactLegacyHelpVideoRewrite(input: string) {
  const directory = mkdtempSync(join(tmpdir(), "leaddrive-runtime-env-bridge-"))
  try {
    const appDirectory = join(directory, "checkout")
    const envFile = join(directory, "app.env")
    const harnessFile = join(directory, "deploy-functions.sh")
    mkdirSync(appDirectory)
    writeFileSync(envFile, input.replaceAll("$APP_DIR", appDirectory))
    chmodSync(envFile, 0o600)
    writeFileSync(harnessFile, deployFunctionPrefix)
    chmodSync(harnessFile, 0o700)

    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
HARNESS_FILE="$1"
TEST_APP_DIR="$2"
TEST_APP_ENV_FILE="$3"
set -- normal "${"a".repeat(40)}"
source "$HARNESS_FILE"
APP_DIR="$TEST_APP_DIR"
APP_ENV_FILE="$TEST_APP_ENV_FILE"
rewrite_exact_app_env_value "HELP_VIDEO_ASSET_DIR" "$APP_DIR/help-videos/player" "/srv/leaddrive-runtime/help-videos/player"`,
        "bash",
        harnessFile,
        appDirectory,
        envFile,
      ],
      { encoding: "utf8" },
    )

    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      content: readFileSync(envFile, "utf8"),
      mode: statSync(envFile).mode & 0o777,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const operationsSystemdUnits = [
  "leaddrive-log-ship.service",
  "leaddrive-log-ship.timer",
  "leaddrive-postgres-backup.service",
  "leaddrive-postgres-backup.timer",
  "leaddrive-runtime-files-snapshot.service",
  "leaddrive-runtime-files-snapshot.timer",
  "leaddrive-secrets-snapshot.service",
  "leaddrive-secrets-snapshot.timer",
]

function runStagedOperationsSystemdValidation(options: {
  corruptExecStart?: boolean
  extraWhitespaceExecStart?: boolean
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "leaddrive-ops-systemd-"))
  try {
    const opsRoot = join(directory, "ops")
    const deploySha = "a".repeat(40)
    const releaseRoot = join(opsRoot, "releases", deploySha)
    const systemdRoot = join(releaseRoot, "systemd")
    const backupRoot = join(releaseRoot, "backup")
    const harnessFile = join(directory, "deploy-functions.sh")
    mkdirSync(systemdRoot, { recursive: true })
    mkdirSync(backupRoot, { recursive: true })
    for (const unit of operationsSystemdUnits) {
      const target = join(systemdRoot, unit)
      copyFileSync(join(root, "ops", "systemd", unit), target)
      writeFileSync(
        target,
        readFileSync(target, "utf8").replaceAll(
          "/usr/local/lib/leaddrive-v2/ops/current",
          `${opsRoot}/current`,
        ),
      )
    }
    for (const script of ["ship-logs.sh", "postgres-backup.sh", "snapshot-runtime-files.sh", "snapshot-secrets.sh"]) {
      const scriptPath = join(backupRoot, script)
      writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n")
      chmodSync(scriptPath, 0o755)
    }
    if (options.corruptExecStart) {
      const service = join(systemdRoot, "leaddrive-log-ship.service")
      writeFileSync(
        service,
        readFileSync(service, "utf8").replace(
          `${opsRoot}/current/backup/ship-logs.sh`,
          "/opt/leaddrive-v2/scripts/backup/ship-logs.sh",
        ),
      )
    }
    if (options.extraWhitespaceExecStart) {
      const service = join(systemdRoot, "leaddrive-log-ship.service")
      writeFileSync(
        service,
        readFileSync(service, "utf8").replace(
          `${opsRoot}/current/backup/ship-logs.sh`,
          `${opsRoot}/current/backup/ship-logs.sh\nExecStart = /bin/true`,
        ),
      )
    }
    writeFileSync(harnessFile, `${deployFunctionPrefix}\n${stagedOperationsValidationFunction}\n`)
    chmodSync(harnessFile, 0o700)

    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
HARNESS_FILE="$1"
OPS_ROOT="$2"
DEPLOY_SHA="$3"
RELEASE_ROOT="$4"
set -- normal "$DEPLOY_SHA"
source "$HARNESS_FILE"
OPERATIONS_SYSTEMD_UNITS=(
  leaddrive-log-ship.service
  leaddrive-log-ship.timer
  leaddrive-postgres-backup.service
  leaddrive-postgres-backup.timer
  leaddrive-runtime-files-snapshot.service
  leaddrive-runtime-files-snapshot.timer
  leaddrive-secrets-snapshot.service
  leaddrive-secrets-snapshot.timer
)
validate_staged_operations_systemd_units "$RELEASE_ROOT"`,
        "bash",
        harnessFile,
        opsRoot,
        deploySha,
        releaseRoot,
      ],
      { encoding: "utf8" },
    )

    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      currentExists: existsSync(join(opsRoot, "current")),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("runtime release boundaries", () => {
  it("does not let skipped mode-specific jobs suppress a successful normal deploy", () => {
    const workflow = read(".github/workflows/deploy.yml")

    expect(workflow).toContain(
      "if: ${{ always() && needs.checks.result == 'success' && needs.build.result == 'success' && !(github.event_name == 'workflow_dispatch' && inputs.recovery_sha != '') }}",
    )
  })

  it("holds deployment and app-env locks, while keeping preflight read-only", () => {
    const deploy = read("scripts/server-deploy.sh")
    const preflightExit = deploy.indexOf('log "Deploy preflight passed')
    const canonicalMove = deploy.indexOf("ensure_canonical_app_env\n", preflightExit)

    expect(deploy).toContain('DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/run/lock/leaddrive-deploy.lock}"')
    expect(deploy).toContain('APP_ENV_LOCK_FILE="${APP_ENV_LOCK_FILE:-/run/lock/leaddrive-app-env.lock}"')
    expect(deploy).toContain("flock -n 7")
    expect(deploy).toContain("flock -w 120 8")
    expect(deploy).toContain("validate_canonical_app_env")
    expect(deploy).toContain('if [ -e "$OPS_ACTIVATION_JOURNAL" ] || [ -L "$OPS_ACTIVATION_JOURNAL" ]; then')
    expect(deploy).toContain("an immutable operations activation recovery is pending")
    expect(canonicalMove).toBeGreaterThan(preflightExit)
  })

  it("never lets an app env steer the root deployment control plane", () => {
    const deploy = read("scripts/server-deploy.sh")
    const fallback = deploy.indexOf('APP_ENV_SOURCE_FILE="$APP_DIR/.env"')
    const firstRuntimeLoad = deploy.indexOf('configure_runtime_paths "$APP_ENV_SOURCE_FILE"')
    const validation = deploy.lastIndexOf(
      'validate_checkout_app_env_for_first_cutover "$APP_DIR/.env"',
      fallback,
    )

    expect(deploy).toContain('assert_root_owned_nonwritable_directory "LeadDrive checkout" "$APP_DIR"')
    expect(deploy).toContain("validate_checkout_app_env_for_first_cutover()")
    expect(deploy).toContain('assert_root_owned_nonwritable_file "checkout application environment before canonical migration" "$file"')
    expect(deploy).toContain('"$(stat -c \'%a\' "$file")" = "600"')
    expect(validation).toBeGreaterThan(-1)
    expect(validation).toBeLessThan(fallback)
    expect(firstRuntimeLoad).toBeGreaterThan(validation)

    expect(deploy).toContain("assert_dotenv_key_allowed()")
    expect(deploy).toContain("APP_DIR|APP_ENV_FILE|APP_ENV_LOCK_FILE|APP_ENV_SOURCE_FILE|")
    expect(deploy).toContain("OPERATIONS_ACTIVATION_STARTED|GENESIS_ACTIVATION_DURABLE|OPERATIONS_CRONTAB_INTENT|OPERATIONS_SYSTEMD_UNITS|OPERATIONS_TIMERS|")
    expect(deploy).toContain("LD_*|NODE_OPTIONS|NODE_PATH")
    expect(deploy).toContain("TAR_OPTIONS|CURL_HOME|XDG_CONFIG_HOME|HOME|TMPDIR|TMP|TEMP|PG*)")
    expect(deploy).toContain('application environment must not contain migration-only key')
    expect(deploy).toContain('MIGRATION_DATABASE_URL|MIGRATION_EXPECTED_DB_ROLE|MIGRATION_WINDOW_ATTEMPTS')
    expect(deploy).toContain('load_dotenv_file "$MIGRATION_ENV_FILE" migration')
    expect(deploy).toContain('unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE MIGRATION_WINDOW_ATTEMPTS')
  })

  it("migrates only the exact historical checkout help-video path after artifact verification", () => {
    const deploy = read("scripts/server-deploy.sh")
    const normalizerStart = deploy.indexOf("normalize_exact_legacy_help_video_path()")
    const normalizerEnd = deploy.indexOf("rewrite_exact_app_env_value()", normalizerStart)
    const normalizer = deploy.slice(normalizerStart, normalizerEnd)
    const rewriteStart = normalizerEnd
    const rewriteEnd = deploy.indexOf("migrate_exact_legacy_help_video_env_path()", rewriteStart)
    const rewrite = deploy.slice(rewriteStart, rewriteEnd)
    const migrationFunctionEnd = deploy.indexOf("configure_runtime_paths()", rewriteEnd)
    const migrationFunction = deploy.slice(rewriteEnd, migrationFunctionEnd)
    const sourceEnvLoad = deploy.indexOf('load_dotenv_file "$APP_ENV_SOURCE_FILE"')
    const sourceEnvNormalization = deploy.indexOf(
      "normalize_exact_legacy_help_video_path\n",
      sourceEnvLoad,
    )
    const canonicalMove = deploy.indexOf("ensure_canonical_app_env\n")
    const migration = deploy.indexOf("migrate_exact_legacy_help_video_env_path\n", canonicalMove)
    const postMoveValidation = deploy.indexOf("validate_canonical_app_env\n", migration)
    const postMoveRuntimeConfig = deploy.indexOf('configure_runtime_paths "$APP_ENV_FILE"', migration)

    expect(normalizer).toContain('[ "${HELP_VIDEO_ASSET_DIR:-}" = "$APP_DIR/help-videos/player" ]')
    expect(normalizer).toContain('DEPLOY_PREFLIGHT_ONLY:-0')
    expect(normalizer).toContain("requires the approved deployment to migrate it outside the checkout")
    expect(normalizer).not.toContain('"$APP_DIR"/*')
    expect(rewrite).toContain('stage="$(mktemp "$(dirname -- "$APP_ENV_FILE")/.app.env.deploy.XXXXXX")"')
    expect(rewrite).toContain('chown --reference="$APP_ENV_FILE" "$stage"')
    expect(rewrite).toContain('chmod --reference="$APP_ENV_FILE" "$stage"')
    expect(rewrite).toContain('sync -f -- "$stage"')
    expect(rewrite).toContain('mv -f -- "$stage" "$APP_ENV_FILE"')
    expect(rewrite).toContain('canonical app environment has duplicate $target_key assignments')
    expect(migrationFunction).toContain('"HELP_VIDEO_ASSET_DIR"')
    expect(migrationFunction).toContain('"$APP_DIR/help-videos/player"')
    expect(migrationFunction).toContain('"$RUNTIME_DIR/help-videos/player"')
    expect(sourceEnvNormalization).toBeGreaterThan(sourceEnvLoad)
    expect(migration).toBeGreaterThan(canonicalMove)
    expect(postMoveValidation).toBeGreaterThan(migration)
    expect(postMoveRuntimeConfig).toBeGreaterThan(postMoveValidation)
  })

  it("executes the exact legacy help-video rewrite atomically without widening path acceptance", () => {
    const exact = runExactLegacyHelpVideoRewrite(
      'KEEP_ME=still-here\nHELP_VIDEO_ASSET_DIR="$APP_DIR/help-videos/player"\n',
    )
    expect(exact.status).toBe(0)
    expect(exact.content).toBe(
      "KEEP_ME=still-here\nHELP_VIDEO_ASSET_DIR=/srv/leaddrive-runtime/help-videos/player\n",
    )
    expect(exact.mode).toBe(0o600)

    const otherCheckoutPath = runExactLegacyHelpVideoRewrite(
      "HELP_VIDEO_ASSET_DIR=$APP_DIR/another-runtime-path/player\n",
    )
    expect(otherCheckoutPath.status).toBe(0)
    expect(otherCheckoutPath.content).toContain("another-runtime-path/player")

    const duplicate = runExactLegacyHelpVideoRewrite(
      "HELP_VIDEO_ASSET_DIR=$APP_DIR/help-videos/player\nHELP_VIDEO_ASSET_DIR=$APP_DIR/help-videos/player\n",
    )
    expect(duplicate.status).not.toBe(0)
    expect(duplicate.output).toContain("duplicate HELP_VIDEO_ASSET_DIR assignments")
    expect(duplicate.content).toContain("help-videos/player")
  })

  it("validates the AI-call preflight app environment before dotenv parses it", () => {
    const workflow = read(".github/workflows/deploy.yml")
    const dotenvLoad = workflow.indexOf("dotenv.config({ path: envFile })")
    const canonicalFileValidation = workflow.indexOf('assertRootOnlyEnvFile("canonical app env", canonicalEnv)')
    const legacyFileValidation = workflow.indexOf('assertRootOnlyEnvFile("legacy checkout app env", legacyEnv)')

    expect(workflow).toContain("fs.lstatSync(candidate)")
    expect(workflow).toContain("hasPathOrSymlink(canonicalEnv)")
    expect(workflow).toContain("stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0")
    expect(workflow).toContain("(stat.mode & 0o777) !== 0o600")
    expect(canonicalFileValidation).toBeGreaterThan(-1)
    expect(legacyFileValidation).toBeGreaterThan(-1)
    expect(dotenvLoad).toBeGreaterThan(canonicalFileValidation)
    expect(dotenvLoad).toBeGreaterThan(legacyFileValidation)
  })

  it("uses one canonical upload root and rolls a failed PM2 handoff back", () => {
    const deploy = read("scripts/server-deploy.sh")

    expect(deploy).toContain('move_runtime_directory_and_link "$APP_DIR/uploads" "$RUNTIME_UPLOADS_DIR" "uploads"')
    expect(deploy).toContain("merge_legacy_public_uploads_into_canonical_root")
    expect(deploy).toContain("recover_application_handoff()")
    expect(deploy).toContain("HANDOFF_STARTED=true")
    expect(deploy).toContain("pm2 start \"$rollback_config\"")
    expect(deploy).toContain("rollback_incomplete_runtime_cutover")
    expect(deploy).toContain("rollback_incomplete_runtime_state_cutover")
    expect(deploy).toContain("RUNTIME_STATE_CUTOVER_FINALIZED=true")
    expect(deploy).toContain("RUNTIME_PUBLIC_MERGE_JOURNAL")
    expect(deploy).toContain('rollback_ping_code="$(curl')
    expect(deploy).toContain('rollback handoff API health check failed')
    expect(deploy).toContain('No checkout $label directory; external runtime target will be created')
    expect(deploy).toContain('legacy-public-merge status=linked-empty')
    expect(deploy).not.toContain("RUNTIME_LEGACY_PUBLIC_UPLOADS_ROOT")
  })

  it("stages release-owned operations outside a replaceable standalone tree", () => {
    const deploy = read("scripts/server-deploy.sh")
    const ci = read(".github/workflows/deploy.yml")
    const onBox = read("scripts/server-build-deploy.sh")
    const stagedValidation = deploy.indexOf('validate_staged_operations_systemd_units "$release_root"')
    const pointerSwitch = deploy.indexOf('switch_release_owned_operations_current "$release_root"')
    const finalUnitValidation = deploy.indexOf(
      'systemd-analyze verify "${OPERATIONS_SYSTEMD_UNITS[@]/#/$SYSTEMD_UNIT_DIR/}"',
      pointerSwitch,
    )
    const daemonReload = deploy.indexOf("systemctl daemon-reload", finalUnitValidation)

    expect(deploy).toContain('OPS_ROOT="${OPS_ROOT:-/usr/local/lib/leaddrive-v2/ops}"')
    expect(deploy).toContain('mv -Tf -- "$next_link" "$OPS_CURRENT_LINK"')
    expect(deploy).toContain("rollback_operations_activation_on_exit")
    expect(deploy).toContain("OPERATIONS_RELEASE_FINALIZED=true")
    expect(deploy).toContain('logrotate -d "$release_root/logrotate/$rotate"')
    expect(deploy).toContain('logrotate -d "$LOGROTATE_DIR/$rotate"')
    expect(stagedValidation).toBeGreaterThan(-1)
    expect(pointerSwitch).toBeGreaterThan(stagedValidation)
    expect(finalUnitValidation).toBeGreaterThan(pointerSwitch)
    expect(daemonReload).toBeGreaterThan(finalUnitValidation)
    expect(deploy).toContain('install_release_owned_operations "$APP_DIR/.next/standalone" full-recovery\nmigrate_legacy_cron_paths')
    expect(deploy).toContain('SCRIPTS="$OPS_CURRENT_LINK/cron-scripts"')
    expect(deploy).toContain('"$stage/cron-scripts"')
    expect(deploy).toContain('/\\.next\\/standalone)?\\/scripts\\/')
    expect(ci).toContain("release-cron-script-manifest.txt")
    expect(ci).toContain("release-script-allowlist.txt")
    expect(ci).toContain('/usr/local/lib/leaddrive-v2/ops/current/cron-scripts/cron-trigger.sh')
    expect(ci).not.toContain('SMOKE_OUTPUT="$(/opt/leaddrive-v2/.next/standalone/scripts/cron-trigger.sh')
    expect(onBox).toContain("intentionally retired")
    expect(onBox).toContain("reviewed main -> .github/workflows/deploy.yml")
    expect(onBox).toContain("exit 64")
    expect(onBox).not.toContain("release-cron-script-manifest.txt")
    expect(onBox).not.toMatch(/\bnpm (?:ci|run build)|\bpm2 (?:start|restart)/u)
    for (const unit of [
      "leaddrive-log-ship.service",
      "leaddrive-postgres-backup.service",
      "leaddrive-runtime-files-snapshot.service",
      "leaddrive-secrets-snapshot.service",
    ]) {
      expect(read(`ops/systemd/${unit}`)).toContain("/usr/local/lib/leaddrive-v2/ops/current/backup/")
    }
  })

  it("validates a first immutable operations bootstrap without exposing a current pointer", () => {
    const valid = runStagedOperationsSystemdValidation()
    expect(valid.status, valid.output).toBe(0)
    expect(valid.currentExists).toBe(false)

    const corrupt = runStagedOperationsSystemdValidation({ corruptExecStart: true })
    expect(corrupt.status).not.toBe(0)
    expect(corrupt.output).toContain(
      "immutable operations service must contain exactly one stable-pointer ExecStart",
    )
    expect(corrupt.currentExists).toBe(false)

    const extraWhitespace = runStagedOperationsSystemdValidation({
      extraWhitespaceExecStart: true,
    })
    expect(extraWhitespace.status).not.toBe(0)
    expect(extraWhitespace.output).toContain(
      "immutable operations service must contain exactly one stable-pointer ExecStart",
    )
    expect(extraWhitespace.currentExists).toBe(false)
  })

  it("journals /etc and timer state before operations activation and restores it on every incomplete transaction", () => {
    const deploy = read("scripts/server-deploy.sh")
    const snapshot = deploy.indexOf('snapshot_operations_system_config "$release_root"')
    const activationStarted = deploy.indexOf("OPERATIONS_ACTIVATION_STARTED=true", snapshot)
    const journal = deploy.indexOf('write_operations_activation_journal "system-config-intent"', snapshot)
    const quiesceBeforeWrite = deploy.indexOf("quiesce_operations_timers_for_rollback", journal)
    const firstInstall = deploy.indexOf("install_operations_config_file_atomically", quiesceBeforeWrite)
    const rollback = deploy.slice(
      deploy.indexOf("rollback_operations_activation_on_exit()"),
      deploy.indexOf("migrate_legacy_cron_paths()"),
    )
    const quiesce = rollback.indexOf("quiesce_operations_timers_for_rollback")
    const pointer = rollback.indexOf('if [ "$OPS_CURRENT_SWITCHED" = "true" ] || [ "$OPS_POINTER_SWITCH_INTENT" = "true" ]')
    const restore = rollback.indexOf("restore_operations_system_config_files")

    expect(deploy).toContain("OPERATIONS_SYSTEM_CONFIG_BACKUP_DIR")
    expect(deploy).toContain("snapshot_operations_config_file()")
    expect(deploy).toContain("operations_config_file_matches()")
    expect(deploy).toContain("verify_operations_system_config_rollback_state")
    expect(deploy).toContain("restore_operations_timer_states()")
    expect(deploy).toContain("OPERATIONS_ACTIVATION_STARTED")
    expect(deploy).toContain("install_operations_config_file_atomically()")
    expect(deploy).toContain('sync -f -- "$stage"')
    expect(snapshot).toBeGreaterThan(-1)
    expect(activationStarted).toBeGreaterThan(snapshot)
    expect(journal).toBeGreaterThan(activationStarted)
    expect(quiesceBeforeWrite).toBeGreaterThan(journal)
    expect(firstInstall).toBeGreaterThan(quiesceBeforeWrite)
    expect(rollback).toContain('[ "$OPERATIONS_ACTIVATION_STARTED" = "true" ] || return 0')
    expect(quiesce).toBeGreaterThan(-1)
    expect(pointer).toBeGreaterThan(quiesce)
    expect(restore).toBeGreaterThan(pointer)
  })

  it("recovers a durable interrupted operations activation before accepting a new backup baseline", () => {
    const deploy = read("scripts/server-deploy.sh")
    const resilienceInstaller = read("scripts/install-resilience-crons.sh")
    const recoveryDefinition = deploy.indexOf("recover_pending_operations_activation()")
    const recoveryCall = deploy.indexOf("recover_pending_operations_activation\n", recoveryDefinition + 1)
    const backupStep = deploy.indexOf('log "Creating backup..."')
    const operationsInstall = deploy.indexOf('install_release_owned_operations "$APP_DIR/.next/standalone" full-recovery', backupStep)
    const installDefinition = deploy.indexOf("install_release_owned_operations()")
    const finalJournal = deploy.indexOf('write_operations_activation_journal "finalized"', installDefinition)
    const finalClear = deploy.indexOf("clear_operations_activation_journal", finalJournal)

    expect(deploy).toContain('OPS_ACTIVATION_JOURNAL="$OPS_ROOT/activation.journal"')
    expect(deploy).toContain("write_operations_activation_journal()")
    expect(deploy).toContain("clear_operations_activation_journal()")
    expect(deploy).toContain("assert_operations_activation_release_path()")
    expect(deploy).toContain("assert_operations_activation_crontab_snapshot()")
    expect(deploy).toContain("validate_operations_system_config_snapshot()")
    expect(deploy).toContain('write_operations_activation_journal "pointer-intent"')
    expect(deploy).toContain('write_operations_activation_journal "resilience-intent"')
    expect(deploy).toContain('LEADDRIVE_CRON_EXPECTED_PATH="$expected"')
    expect(deploy).toContain('sync -f -- "$OPS_ACTIVATION_JOURNAL" "$OPS_ROOT"')
    expect(deploy).toContain("Root crontab was already restored by an earlier recovery")
    expect(recoveryDefinition).toBeGreaterThan(-1)
    expect(recoveryCall).toBeGreaterThan(recoveryDefinition)
    expect(recoveryCall).toBeLessThan(backupStep)
    expect(operationsInstall).toBeGreaterThan(backupStep)
    expect(finalJournal).toBeGreaterThan(installDefinition)
    expect(finalClear).toBeGreaterThan(finalJournal)

    expect(resilienceInstaller).toContain('EXPECTED_CRONTAB_PATH="${LEADDRIVE_CRON_EXPECTED_PATH:-}"')
    expect(resilienceInstaller).toContain('install -m 0600 -- "$NEXT" "$EXPECTED_STAGE"')
    expect(resilienceInstaller).toContain('sync -f -- "$EXPECTED_STAGE"')
    expect(resilienceInstaller).toContain('mv -Tf -- "$EXPECTED_STAGE" "$EXPECTED_CRONTAB_PATH"')
    expect(resilienceInstaller).toContain('sync -f -- "$EXPECTED_CRONTAB_PATH" "$EXPECTED_PARENT"')
    expect(resilienceInstaller).toContain("crontab \"$NEXT\"")
  })

  it("hardens only the deployment-owned backup root before copying runtime data", () => {
    const deploy = read("scripts/server-deploy.sh")

    expect(deploy).toContain("ensure_root_only_backup_directory()")
    expect(deploy).toContain('ensure_root_only_backup_directory "$BACKUP_DIR"')
    expect(deploy).toContain('"$(stat -c \'%U:%G:%a\' "$directory")" = "root:root:700"')
    expect(deploy).toContain('chmod 0700 -- "$directory"')
    expect(deploy).toContain("Hardened deployment backup root permissions to root-only")
  })

  it("fails closed on insecure pre-existing external runtime paths", () => {
    const deploy = read("scripts/server-deploy.sh")

    expect(deploy).toContain("assert_root_owned_nonwritable_directory")
    expect(deploy).toContain("must not be group- or world-writable")
    expect(deploy).toContain('assert_secure_existing_or_parent "LEADDRIVE_RUNTIME_DIR" "$RUNTIME_DIR"')
    expect(deploy).toContain('assert_secure_existing_or_parent "LEADDRIVE_LOG_DIR" "$LOG_DIR"')
    expect(deploy).toContain('assert_secure_existing_or_parent "MTM document storage directory" "$MTM_DOCUMENT_STORAGE_DIR_RESOLVED"')
    expect(deploy).toContain('ensure_secure_root_directory "voice operator state directory" "$VOICE_OPERATOR_STATE_DIR_RESOLVED" "0750"')
    expect(deploy).toContain('"$VOICE_OPERATOR_STATE_DIR_RESOLVED/voice-provider-registry-cutover.lock"')
    expect(deploy).not.toContain('"$RUNTIME_STATE_DIR/operator/voice-provider-registry-cutover.lock"')
    expect(deploy).toContain('ensure_secure_root_directory "immutable operations root" "$OPS_ROOT" "0755"')
    expect(deploy).toContain("assert_secure_operations_tree")
  })

  it("keeps the cron allowlist narrow and release-owned", () => {
    const allowlist = read("ops/cron/release-script-allowlist.txt").trim().split("\n")

    expect(allowlist).toEqual([
      "cron-attribution-drain.sh",
      "cron-attribution-recompute.sh",
      "cron-cdp-identity-scan.sh",
      "cron-cdp-profile-refresh.sh",
      "cron-customer-insights-snapshot.sh",
      "cron-trigger.sh",
    ])
    expect(read("scripts/install-resilience-crons.sh"))
      .toContain('/usr/local/lib/leaddrive-v2/ops/current/cron-scripts')
  })

  it("allows the first release to migrate an empty root crontab before managed schedules exist", () => {
    const deploy = read("scripts/server-deploy.sh")
    const migration = deploy.slice(
      deploy.indexOf("migrate_legacy_cron_paths()"),
      deploy.indexOf("run_resilience_cron_installer()"),
    )

    expect(migration).toContain('capture_root_crontab "$current" "release-owned path migration"')
    expect(migration).toContain('capture_root_crontab "$verify" "release-owned path migration verification"')
    expect(migration).not.toContain('crontab -l > "$verify"')
  })

  it("does not let log shipment double-count nested source directories", () => {
    const shipLogs = read("scripts/backup/ship-logs.sh")

    expect(shipLogs).toContain('EXPECTED_LOG_DIRS="/var/lib/leaddrive-v2-logs /var/log/nginx /var/log/postgresql"')
    expect(shipLogs).toContain('LOG_DIRS="${LOG_SHIP_SOURCE_DIRS:-$EXPECTED_LOG_DIRS}"')
    expect(shipLogs).toContain('[ -z "${LOG_SHIP_SOURCE_DIR:-}" ]')
    expect(shipLogs).toContain('value = $2; found = 1')
    expect(shipLogs).toContain("overlapping log source directories are not allowed")
  })

  it("keeps recovery credentials out of the long-lived timeout argv", () => {
    const readiness = read("scripts/backup/report-production-readiness.sh")
    const commissioning = read("scripts/backup/commission-production-backup.sh")

    for (const source of [deploySource, readiness, commissioning]) {
      expect(source).not.toMatch(/timeout[^\n]*env -i/)
    }
    expect(deploySource).toContain(
      'AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null \\\n    timeout "$timeout_seconds" "$BACKUP_AWS_BIN"',
    )

    const sentinel = "codex-proc-argv-secret-sentinel"
    // The loop below waits for the backgrounded shell to exec `timeout`, then
    // reads its argv. That wait was 100 x 20 ms = 2 s, which is generous on an
    // idle machine and not generous at all on a CI runner sharing a host with
    // three other jobs: the exec lands late, the loop gives up, and the
    // assertion reports the PRE-exec argv as if the invariant were broken.
    // 500 x 20 ms = 10 s buys the exec room without weakening anything — the
    // test still fails if the secret ever appears in `timeout`'s argv, which
    // is the property under test. `sleep 15` outlives the longer window, so
    // the process is guaranteed to still be there to read.
    const probe = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
env -i PATH=/usr/bin:/bin AWS_SECRET_ACCESS_KEY="$1" timeout 15 sleep 15 &
pid=$!
cmdline=""
observed=no
for _ in $(seq 1 500); do
  if [ -r "/proc/$pid/cmdline" ]; then
    cmdline="$(tr '\\0' '\\n' <"/proc/$pid/cmdline")"
    # Match the FIRST argv element, not a substring anywhere in it. Until the
    # forked child execs, /proc/<pid>/cmdline still shows this very script's
    # own argv — which contains both the word "timeout" and the sentinel, so a
    # substring match could "succeed" on the pre-exec snapshot and then report
    # the secret as leaked. After the exec the first element is exactly
    # "timeout"; before it, it is "bash".
    if [ "\${cmdline%%$'\\n'*}" = timeout ]; then
      observed=yes
      break
    fi
  fi
  sleep 0.02
done
if [ "$observed" = yes ]; then
  printf '%s\\n' "$cmdline"
else
  # Never saw the exec inside the window. Say so in its own words: a slow
  # machine must not be reported as a credential leak.
  printf 'PROBE_NEVER_OBSERVED_EXEC\\n'
fi
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true`,
        "bash",
        sentinel,
      ],
      { encoding: "utf8" },
    )

    expect(probe.status).toBe(0)
    expect(
      probe.stdout,
      "the probe never saw the child exec `timeout` within 10s — that is a slow machine, not a leak; re-run before reading anything into it",
    ).not.toContain("PROBE_NEVER_OBSERVED_EXEC")
    expect(probe.stdout).toContain("timeout\n15\nsleep\n15\n")
    expect(probe.stdout).not.toContain(sentinel)
  }, 30_000)
})
