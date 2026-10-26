/** Bind root-configured aliases to the same live PostgreSQL primary. */
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"
const fail = code => { throw new Error(code) }

export function databaseEnvironment(appUrl, migrationUrl, readOnly) {
  try {
    const app = new URL(appUrl), db = new URL(migrationUrl)
    for (const url of [app, db]) if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error()
    const env = { PATH: process.env.PATH, LANG: "C.UTF-8", PGHOST: db.hostname, PGPORT: db.port || "5432",
      PGDATABASE: decodeURIComponent(db.pathname.slice(1)), PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
      PGCONNECT_TIMEOUT: "5", PGAPPNAME: "identity-runtime-commission",
      PGOPTIONS: `-c default_transaction_read_only=${readOnly ? "on" : "off"} -c statement_timeout=5000 -c lock_timeout=3000 -c search_path=public` }
    const seen = new Set()
    for (const [key, value] of db.searchParams) {
      if (seen.has(key)) fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_DUPLICATE")
      seen.add(key)
      if (key === "schema" && value === "public") continue
      if (key === "sslmode" && ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(value)) env.PGSSLMODE = value
      // The managed PostgreSQL deployment uses an explicit CA with verify-full.
      // Forward the root-owned configuration literally; never remove TLS
      // verification or inherit unrelated libpq overrides from the environment.
      else if (key === "sslrootcert" && path.isAbsolute(value) && value.length <= 1024 && !/[\0\r\n]/.test(value)) env.PGSSLROOTCERT = value
      else fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_OPTION")
    }
    return env
  } catch (error) {
    if (/^IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_(TARGET|DUPLICATE|OPTION)$/.test(error.message ?? "")) throw error
    fail("IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID")
  }
}

const identitySql = `SELECT json_build_object(
 'cluster',(pg_control_system()).system_identifier::text,
 'database',current_database(),
 'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'recovery',pg_is_in_recovery(),
 'readonly',current_setting('transaction_read_only')='on',
 'role',session_user);`

function query(input, env, parameters = {}, timeout = 10_000) {
  const result = spawnSync("psql", ["-X", "-qAt", "--set=ON_ERROR_STOP=1",
    ...Object.entries(parameters).map(([key, value]) => `--set=${key}=${value}`)], {
    input, env, encoding: "utf8", timeout, maxBuffer: 8192,
  })
  if (result.status !== 0 || result.error) fail("IDENTITY_COMMISSION_DATABASE_PROBE_FAILED")
  return result.stdout.trim()
}

export function assertDatabaseIdentity(app, migration) {
  for (const value of [app, migration]) {
    if (!value || !/^[0-9]+$/.test(value.cluster ?? "") || !/^[1-9][0-9]*$/.test(value.oid ?? "")
      || typeof value.database !== "string" || !value.database || typeof value.role !== "string" || !value.role
      || value.recovery !== false || value.readonly !== true) fail("IDENTITY_COMMISSION_DATABASE_TARGET_REFUSED")
  }
  if (["cluster", "database", "oid"].some(key => app[key] !== migration[key])) fail("IDENTITY_COMMISSION_DATABASE_TARGET_REFUSED")
}

export function assertLiveDatabase(count) {
  // Identical cluster metadata can belong to a promoted physical clone. Only
  // the exact, random app probe visible from migration proves live identity.
  if (count !== "1") fail("IDENTITY_COMMISSION_DATABASE_LIVE_TARGET_REFUSED")
}

/** Same admission as server-deploy.sh: metadata plus an observed app backend.
 * Both probes are READ ONLY. URL/passwords stay in child environments and
 * private query output; callers receive no database names, roles or addresses.
 */
export function verifyDatabaseTarget(appUrl, migrationUrl) {
  const appEnv = databaseEnvironment(appUrl, appUrl, true)
  const migrationEnv = databaseEnvironment(appUrl, migrationUrl, true)
  let app, migration
  try {
    app = JSON.parse(query(identitySql, appEnv))
    migration = JSON.parse(query(identitySql, migrationEnv))
  } catch { fail("IDENTITY_COMMISSION_DATABASE_PROBE_FAILED") }
  assertDatabaseIdentity(app, migration)
  const name = `identity-commission-${randomUUID().replaceAll("-", "")}`
  // The name is generated here from a UUID, never supplied by a caller. Set it
  // in SQL too, matching server-deploy when a pool ignores startup parameters.
  const probe = spawn("psql", ["-X", "-qAt", "--set=ON_ERROR_STOP=1", "-c",
    `SELECT set_config('application_name','${name}',false); SELECT pg_sleep(12);`], {
    env: { ...appEnv, PGAPPNAME: name,
      PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000 -c search_path=public" },
    stdio: "ignore",
  })
  // Never print a spawn/libpq error: it can contain connection metadata.
  probe.on("error", () => {})
  try {
    if (!probe.pid) fail("IDENTITY_COMMISSION_DATABASE_PROBE_FAILED")
    const deadline = Date.now() + 10_000
    const pause = new Int32Array(new SharedArrayBuffer(4))
    let count = "0"
    while (Date.now() < deadline) {
      count = query(`SELECT count(*) FROM pg_catalog.pg_stat_activity
        WHERE datname=current_database() AND application_name=:'probe'
          AND usename=:'role' AND backend_type='client backend';`, migrationEnv,
      { probe: name, role: app.role }, Math.max(1, Math.min(5000, deadline - Date.now())))
      if (count === "1") break
      if (count !== "0") break
      Atomics.wait(pause, 0, 0, Math.min(250, Math.max(0, deadline - Date.now())))
    }
    assertLiveDatabase(count)
    return true
  } finally {
    // This is only our read-only psql child; no service/process-name lookup.
    probe.kill("SIGTERM")
  }
}
