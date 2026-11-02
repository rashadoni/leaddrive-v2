/**
 * The migration quiet window, asked of a real PostgreSQL.
 *
 * The deploy refuses to run a migration while anything is live. Until
 * 2026-11-02 it counted a job lease as live whenever its expiry was still in
 * the future — and every deploy stops the scheduler process without releasing
 * what it held, so a job caught mid-run leaves `status='running'` with an
 * expiry up to its whole TTL ahead. Those TTLs are ten and fifteen minutes, so
 * one deploy could block the next deploy's migration for a quarter of an hour.
 * It did: run 41480027867, five minutes of `system=1` with no transaction at
 * all, and the release never landed.
 *
 * A lease is live while it is being RENEWED. withJobLease renews every ttl/3
 * and writes "leaseUntil" and "updatedAt" from one CURRENT_TIMESTAMP, so a
 * lease carries its own TTL and a living one is never older than a third of
 * it. These tests run the deploy's OWN SQL — lifted out of the script, so the
 * two cannot drift — against rows that look exactly like the ones production
 * leaves behind.
 *
 * Set DEPLOY_MIGRATION_WINDOW_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   DEPLOY_MIGRATION_WINDOW_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Migration quiet window database gate»), where
 * `DEPLOY_MIGRATION_WINDOW_DB_GATE=required` turns a missing URL into a
 * failure so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const adminUrl = process.env.DEPLOY_MIGRATION_WINDOW_TEST_DATABASE_URL
if (!adminUrl && process.env.DEPLOY_MIGRATION_WINDOW_DB_GATE === "required") {
  throw new Error("DEPLOY_MIGRATION_WINDOW_TEST_DATABASE_URL is required by the migration quiet window database gate")
}

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

/**
 * The SQL as the deploy will send it. Taken from the script by its first line
 * so a rewritten query is tested, never a copy of it that has stopped matching.
 */
function sqlFromDeploy(firstLine: string): string {
  const at = deployScript.indexOf(firstLine)
  expect(at, `deploy script no longer contains: ${firstLine}`).toBeGreaterThan(-1)
  const end = deployScript.indexOf('" 2>/dev/null', at)
  expect(end, `cannot find the end of: ${firstLine}`).toBeGreaterThan(at)
  return deployScript.slice(at, end).replace(/\\"/g, '"')
}

const LIVE_SQL = sqlFromDeploy("SELECT count(*) FROM system_job_leases\n         WHERE status = 'running' AND \\\"leaseUntil\\\" > now()\n           AND \\\"updatedAt\\\" > now()")
const STALE_SQL = sqlFromDeploy("SELECT count(*) FROM system_job_leases\n         WHERE status = 'running' AND \\\"leaseUntil\\\" > now()\n           AND \\\"updatedAt\\\" <= now()")
const DETAIL_SQL = sqlFromDeploy("SELECT coalesce(string_agg(")

const database = `deploy_migration_window_${process.pid}`
const scratchUrl = (() => {
  if (!adminUrl) return null
  const url = new URL(adminUrl)
  url.pathname = `/${database}`
  return url.toString()
})()

function psql(url: string, sql: string): string {
  const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    timeout: 30_000,
  })
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

/** The table exactly as the migration creates it — TIMESTAMP(3), not timestamptz. */
function createLeaseTable(url: string) {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260711222000_system_job_leases/migration.sql"),
    "utf8",
  )
  const start = migration.indexOf('CREATE TABLE "system_job_leases"')
  const end = migration.indexOf(");", start)
  expect(start, "the system_job_leases migration no longer creates the table").toBeGreaterThan(-1)
  psql(url, migration.slice(start, end + 2))
}

/**
 * A lease as production leaves it: `renewedSecondsAgo` is how long since the
 * last heartbeat, `ttlSeconds` the TTL that heartbeat wrote.
 */
function lease(name: string, renewedSecondsAgo: number, ttlSeconds: number, status = "running") {
  return `INSERT INTO system_job_leases ("name", "ownerToken", "leaseUntil", "status", "updatedAt")
    VALUES ('${name}', 'owner-${name}',
      CURRENT_TIMESTAMP - interval '${renewedSecondsAgo} seconds' + interval '${ttlSeconds} seconds',
      '${status}', CURRENT_TIMESTAMP - interval '${renewedSecondsAgo} seconds')`
}

const run = adminUrl ? describe : describe.skip

run("migration quiet window on a real PostgreSQL", () => {
  beforeAll(() => {
    psql(adminUrl!, `DROP DATABASE IF EXISTS ${database}`)
    psql(adminUrl!, `CREATE DATABASE ${database}`)
    createLeaseTable(scratchUrl!)
  })

  afterAll(() => {
    if (!adminUrl) return
    psql(adminUrl, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  })

  function seed(rows: string[]) {
    psql(scratchUrl!, "TRUNCATE system_job_leases")
    for (const row of rows) psql(scratchUrl!, row)
  }

  it("counts a lease that is being renewed, however long its TTL", () => {
    // Renewal is every ttl/3: a minute into a fifteen-minute lease is normal.
    seed([lease("social-poll-all", 60, 900), lease("commitment-escalation", 40, 180)])
    expect(psql(scratchUrl!, LIVE_SQL)).toBe("2")
    expect(psql(scratchUrl!, STALE_SQL)).toBe("0")
  })

  it("does not count the lease a killed scheduler left behind", () => {
    // This is the deploy that failed: the previous deploy stopped the jobs
    // process eight minutes into a fifteen-minute lease. Nothing holds it, and
    // its expiry is still seven minutes away.
    seed([lease("finance-deadlines", 8 * 60, 900), lease("mtm-auto-checkout", 6 * 60, 600)])
    expect(psql(scratchUrl!, LIVE_SQL)).toBe("0")
    expect(psql(scratchUrl!, STALE_SQL)).toBe("2")
  })

  it("holds the window for the live one while disregarding the orphan", () => {
    seed([lease("social-poll-all", 60, 900), lease("finance-deadlines", 8 * 60, 900)])
    expect(psql(scratchUrl!, LIVE_SQL)).toBe("1")
    expect(psql(scratchUrl!, STALE_SQL)).toBe("1")
  })

  it("gives a missed heartbeat room before calling a lease abandoned", () => {
    // Renewal every ttl/3, so ttl/3 + a little is a late heartbeat, not death;
    // the line is half the TTL. A deploy must not migrate under a job whose
    // event loop merely stalled.
    seed([lease("social-poll-all", 310, 900)])
    expect(psql(scratchUrl!, LIVE_SQL), "a single late heartbeat must still count as live").toBe("1")
    seed([lease("social-poll-all", 460, 900)])
    expect(psql(scratchUrl!, LIVE_SQL), "two missed heartbeats is an orphan").toBe("0")
  })

  it("ignores leases that are expired, completed or never started", () => {
    seed([
      lease("expired", 16 * 60, 900),
      lease("completed", 10, 900, "completed"),
      `INSERT INTO system_job_leases ("name", "status", "updatedAt") VALUES ('never-ran', 'idle', CURRENT_TIMESTAMP)`,
    ])
    expect(psql(scratchUrl!, LIVE_SQL)).toBe("0")
    expect(psql(scratchUrl!, STALE_SQL)).toBe("0")
  })

  it("names every running lease and says which is which", () => {
    // The hour this cost on 2026-11-02 was spent finding out WHICH lease was in
    // the way; the counts alone could not say.
    seed([lease("social-poll-all", 60, 900), lease("finance-deadlines", 8 * 60, 900)])
    const detail = psql(scratchUrl!, DETAIL_SQL)
    expect(detail).toMatch(/finance-deadlines \(renewed 48\ds ago, ttl 900s, abandoned\)/)
    expect(detail).toMatch(/social-poll-all \(renewed 6\ds ago, ttl 900s, live\)/)
    seed([])
    expect(psql(scratchUrl!, DETAIL_SQL), "nothing running must read as empty, not as NULL").toBe("")
  })
})
