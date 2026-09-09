import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (relative: string) => readFileSync(join(root, relative), "utf8")

const canonicalAppEnv = "/etc/leaddrive/app.env"
const checkoutAppEnv = "/opt/leaddrive-v2/.env"

const appEnvConsumers = [
  ".github/workflows/canary-brandprotection.yml",
  ".github/workflows/check-fb-env.yml",
  ".github/workflows/check-social-accounts.yml",
  ".github/workflows/ensure-social-smoke-user.yml",
  ".github/workflows/repair-module-visibility.yml",
  ".github/workflows/require-admin-2fa.yml",
  ".github/workflows/reset-brandprotection-social-monitoring.yml",
  ".github/workflows/seed-brandprotection.yml",
  ".github/workflows/set-openai-key.yml",
  ".github/workflows/set-social-app-secrets.yml",
  ".github/workflows/set-social-redirect-uris.yml",
  ".github/workflows/set-tenant-user-password.yml",
  ".github/workflows/set-voice-env.yml",
  ".github/workflows/set-voice-provider-registry-cutover.yml",
  ".github/workflows/strip-plan-module-readds.yml",
  ".github/workflows/swissmed-mtm-browser-evidence.yml",
  "scripts/cron-trigger.sh",
  "scripts/cron-attribution-drain.sh",
  "scripts/cron-attribution-recompute.sh",
  "scripts/cron-blind-index-backfill.sh",
  "scripts/cron-cdp-identity-scan.sh",
  "scripts/cron-cdp-profile-refresh.sh",
  "scripts/cron-customer-insights-snapshot.sh",
  "scripts/cron-sla.sh",
  "scripts/cf-purge-help-videos.mjs",
  "scripts/ci/refresh-swissmed-mtm-fixtures.sh",
  "scripts/backup/snapshot-secrets.sh",
  "scripts/rls/enable-one.sh",
]

describe("canonical production app-env boundary", () => {
  it("does not make these production consumers depend on a checkout .env", () => {
    for (const file of appEnvConsumers) {
      const source = read(file)
      expect(source, file).toContain(canonicalAppEnv)
      expect(source, file).not.toContain(checkoutAppEnv)
    }
  })

  it("keeps the retired on-host builder inert instead of making it an env consumer", () => {
    const source = read("scripts/server-build-deploy.sh")
    expect(source).toContain("intentionally retired")
    expect(source).toContain("exit 64")
    expect(source).not.toContain(canonicalAppEnv)
    expect(source).not.toContain(checkoutAppEnv)
    expect(source).not.toMatch(/\bnpm (?:ci|run build)|\bpm2 (?:start|restart)/u)
  })

  it("serializes atomic app-env writers through one host lock", () => {
    const writers = [
      [".github/workflows/canary-brandprotection.yml", "ENV"],
      [".github/workflows/set-openai-key.yml", "ENV"],
      [".github/workflows/set-social-app-secrets.yml", "ENV"],
      [".github/workflows/set-social-redirect-uris.yml", "ENV"],
      [".github/workflows/set-voice-env.yml", "ENV"],
      [".github/workflows/set-voice-provider-registry-cutover.yml", "ENV_FILE"],
    ]

    for (const [file, envFile] of writers) {
      const source = read(file)
      expect(source, file).toContain('APP_ENV_LOCK_FILE="${APP_ENV_LOCK_FILE:-/run/lock/leaddrive-app-env.lock}"')
      expect(source, file).toContain('flock -w 120')
      expect(source, file).toContain('[ -d "$ENV_DIR" ] && [ ! -L "$ENV_DIR" ]')
      expect(source, file).toContain('ENV_DIR_MODE="$(stat -c \'%a\' "$ENV_DIR")"')
      expect(source, file).toContain('8#$ENV_DIR_MODE & 8#022')
      expect(source, file).toContain(`[ "$(stat -c '%U:%G:%a' "$${envFile}")" = "root:root:600" ]`)
    }
  })

  it("keeps voice recovery and temporary state outside the checkout", () => {
    const voiceEnv = read(".github/workflows/set-voice-env.yml")
    const registryCutover = read(".github/workflows/set-voice-provider-registry-cutover.yml")

    expect(voiceEnv).toContain("VOICE_OPERATOR_STATE_DIR")
    expect(voiceEnv).toContain("Production returned an invalid voice operator state path")
    expect(voiceEnv).toContain('runtime_root="$(read_app_env_value LEADDRIVE_RUNTIME_DIR)"')
    expect(voiceEnv).toContain("VOICE_OPERATOR_STATE_DIR must stay inside the canonical runtime state root")
    expect(voiceEnv).toContain('[[ "$REMOTE_STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]]')
    expect(voiceEnv).toContain('voice env staging directory must be root:root mode 0700')
    expect(voiceEnv).not.toContain('REMOTE_STATE_ROOT="/opt/leaddrive-v2')
    expect(voiceEnv).not.toContain('REMOTE_STAGE="/tmp/leaddrive-voice-env-')
    expect(voiceEnv).toContain('mktemp "$ENV_DIR/.app.env.voice-next.XXXXXX"')
    expect(voiceEnv).toContain('mktemp "$ENV_DIR/.app.env.voice-rollback.XXXXXX"')

    expect(registryCutover).toContain('STATE_DIR="$(read_env_value "$ENV_FILE" VOICE_OPERATOR_STATE_DIR)"')
    expect(registryCutover).toContain('LOCK_FILE="$STATE_DIR/voice-provider-registry-cutover.lock"')
    expect(registryCutover).toContain('RUNTIME_ROOT="$(read_env_value "$ENV_FILE" LEADDRIVE_RUNTIME_DIR)"')
    expect(registryCutover).toContain("VOICE_OPERATOR_STATE_DIR must stay inside the canonical runtime state root")
    expect(registryCutover).toContain('assert_secure_existing_or_parent "voice operator state directory" "$STATE_DIR"')
    expect(registryCutover).not.toContain('mktemp "$APP_DIR/.voice-')
    expect(registryCutover).toContain('mktemp "$ENV_DIR/.app.env.voice-registry-stage.XXXXXX"')
    expect(registryCutover).toContain('mktemp "$ENV_DIR/.app.env.voice-registry-restore.XXXXXX"')
  })
})
