import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

describe("production migration role boundary", () => {
  it("loads migration credentials from a separate root-only file", () => {
    expect(deployScript).toContain("/etc/leaddrive/migration.env")
    expect(deployScript).toContain('stat -c \'%U\' "$MIGRATION_ENV_FILE"')
    expect(deployScript).toContain('stat -c \'%a\' "$MIGRATION_ENV_FILE"')
    expect(deployScript).toContain('require_env MIGRATION_DATABASE_URL')
    expect(deployScript).toContain('require_env MIGRATION_EXPECTED_DB_ROLE')
  })

  it("fails closed unless app and migration roles have distinct RLS privileges", () => {
    expect(deployScript).toContain("application and migration connections must use different database roles")
    expect(deployScript).toContain("application database role must not have BYPASSRLS")
    expect(deployScript).toContain("migration database role must not be superuser")
    expect(deployScript).toContain("migration database role must have BYPASSRLS")
    expect(deployScript).toContain("migration role lacks membership")
  })

  it("uses only the migration URL for Prisma migration commands", () => {
    const migrationCommands = deployScript
      .split("\n")
      .filter((line) => /\bnpx prisma migrate (?:deploy|resolve)\b/.test(line))

    expect(migrationCommands.length).toBeGreaterThan(0)
    for (const command of migrationCommands) {
      expect(command).toContain('DATABASE_URL="$MIGRATION_DATABASE_URL"')
    }
  })

  it("waits for active work and drops the privileged URL before application scripts", () => {
    expect(deployScript).toContain("wait_for_migration_window")
    expect(deployScript).toContain("active transactions or live job leases")

    const loadIndexes = [
      ...deployScript.matchAll(/load_dotenv_file "\$MIGRATION_ENV_FILE" migration/g),
    ].map((marker) => marker.index ?? -1)
    const unsetIndexes = [
      ...deployScript.matchAll(/unset MIGRATION_DATABASE_URL MIGRATION_EXPECTED_DB_ROLE/g),
    ].map((marker) => marker.index ?? -1)
    const applicationBackfillsAt = deployScript.indexOf("# ── Step 3b:")
    const pm2StartAt = deployScript.indexOf('pm2 start "$PM2_CONFIG"')

    // Preflight, Fund cutover preparation and post-migration verification each
    // acquire the privileged URL independently and must drop it at the end of
    // their boundary.
    expect(loadIndexes).toHaveLength(3)
    expect(unsetIndexes).toHaveLength(loadIndexes.length)
    for (const [index, loadAt] of loadIndexes.entries()) {
      const unsetAt = unsetIndexes[index]
      const nextPrivilegedBoundary = loadIndexes[index + 1] ?? applicationBackfillsAt
      expect(unsetAt).toBeGreaterThan(loadAt)
      expect(unsetAt).toBeLessThan(nextPrivilegedBoundary)
    }
    expect(unsetIndexes.at(-1)).toBeLessThan(pm2StartAt)
  })

  it("supports a non-mutating production preflight", () => {
    const preflightAt = deployScript.indexOf('DEPLOY_PREFLIGHT_ONLY:-0')
    const backupAt = deployScript.indexOf("# ── Step 1:")

    expect(preflightAt).toBeGreaterThan(0)
    expect(preflightAt).toBeLessThan(backupAt)
    expect(deployScript).toContain("exiting before backup, extraction, migrations, or PM2 changes")
  })
})
