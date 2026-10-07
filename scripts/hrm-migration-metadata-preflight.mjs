import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const TARGET_SOURCE_SHA = "9f3cc73dcdb8c4ccea1fdac9dfae29570339abc5"
export const MIGRATIONS = [
  "20261005193000_workforce_reconciliation_operations",
  "20261006150000_workforce_transferred_assignment_window",
]
export const RELATIONS = ["organizations", "mtm_agent_workdays", "mtm_agent_workday_events", "workforce_site_transitions", "workforce_attendance_evidence", "workforce_evidence_assessments", "workforce_exception_cases", "workforce_exception_decisions", "workforce_timesheet_approvals", "mtm_audit_logs", "workforce_shift_assignments", "workforce_shift_templates", "workforce_shift_snapshots", "mtm_agents", "workforce_reconciliation_tenant_states"].sort()
export const INDEXES = ["wf_reconciliation_due_attempt_org_idx", "wf_recon_workdays_c_idx", "wf_recon_events_c_idx", "wf_recon_transitions_c_idx", "wf_recon_evidence_c_idx", "wf_recon_assessments_c_idx", "wf_recon_exceptions_c_idx", "wf_recon_approvals_c_idx", "wf_recon_exports_c_idx", "wf_recon_approval_group_c_idx"].sort()
export const GUARD_MD5 = { pending: "712f178455a49648664dba800c9f52d8", applied: "65a4268c973604f70832dbe350841cde" }
export const LEDGER_GUARD_MD5 = { append: "eba304d394c516e8439246844c269722", revision: "ff5eb1a7ab63f1c9e7d75f926180f643" }
const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const MAX_OUTPUT = 65_536
const CODES = new Set(["INPUT_INVALID", "FILES_UNSAFE", "SOURCE_CHANGED", "ENV_INVALID", "QUERY_FAILED", "OUTPUT_INVALID", "ARTIFACT_MISMATCH", "INSPECTION_FAILED"])
const SQL_STATES = new Set(["08001", "08003", "08004", "08006", "08P01", "22003", "22023", "25001", "25006", "28000", "28P01", "3D000", "42501", "42601", "42703", "42704", "42804", "42883", "42P01", "55P03", "57014", "XX000"])
const REASONS = new Set(["TIMEOUT_DEFAULTS", "READ_ONLY_UNVERIFIED", "ROLE_PROFILE_UNVERIFIED", "LEDGER_UNRESOLVED", "LEDGER_AMBIGUOUS", "CHECKSUM_MISMATCH", "RELATION_SHAPE", "RLS_UNVERIFIED", "OWNER_ABILITY", "INDEX_SHAPE", "INDEX_LEDGER_MISMATCH", "FUNCTION_SHAPE", "LEDGER_GUARDS_UNVERIFIED", "DEFAULT_ACL_UNREVIEWED", "APPLIED_TABLE_CONSTRAINTS_NOT_PROVED", "ACTIVITY_VISIBILITY_UNVERIFIED"])
const LIMITS = ["Metadata only; not a release, staging, full migration replay or C12 acceptance", "Relation rows are PostgreSQL estimates; live activity is one observation, not a reserved DDL quiet window", "Ordinary CREATE INDEX can block writes; elapsed time and future contention are not proved", "Decision guards cover row UPDATE/DELETE/INSERT; no TRUNCATE or privileged-bypass guarantee", "No business rows, role names, credentials, environment values or raw logs exported", "No production files, grants, role configuration, tenant activation or data mutated"]
const TLS_ENV = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY" }
// Fixed failure classifications only. Never reflect an env key or value.
const PARAMETER_CATEGORIES = ["CONNECT_TIMEOUT", "APPLICATION_NAME", "SESSION_OPTIONS", "HOST_OR_SOCKET", "IDENTITY_OVERRIDE", "SSL", "PRISMA", "OTHER"]
export const ENV_DETAILS = Object.freeze([
  "CONTENT_INVALID", "URL_DECLARATION_MISSING", "URL_DECLARATION_DUPLICATED",
  "ROLE_DECLARATION_MISSING", "ROLE_DECLARATION_DUPLICATED", "URL_QUOTES_INVALID", "ROLE_QUOTES_INVALID",
  "ROLE_PROFILE_INVALID", "URL_SYNTAX_INVALID", "URL_SCHEME_UNSUPPORTED", "URL_HOST_REQUIRED",
  "URL_DATABASE_REQUIRED", "URL_FRAGMENT_UNSUPPORTED", "URL_CONTROL_INVALID",
  "USERNAME_ENCODING_INVALID", "USERNAME_PROFILE_INVALID", "DATABASE_ENCODING_INVALID", "PASSWORD_ENCODING_INVALID",
  "TCP_HOST_INVALID", "TCP_PORT_INVALID", "ROLE_IDENTITY_MISMATCH", "SCHEMA_UNSUPPORTED", "POOL_HINT_INVALID",
  "SSL_VALUE_INVALID", "SSL_MODE_INVALID", "SSL_PATH_UNSUPPORTED", "UNCLASSIFIED_ENV_REJECTION",
  ...PARAMETER_CATEGORIES.map(category => "PARAM_UNSUPPORTED_" + category),
  "PARAM_DUPLICATED_SSL", "PARAM_DUPLICATED_PRISMA",
])
const ENV_DETAIL_SET = new Set(ENV_DETAILS)
const parameterCategory = key => {
  if (key === "connect_timeout") return "CONNECT_TIMEOUT"
  if (key === "application_name" || key === "fallback_application_name") return "APPLICATION_NAME"
  if (key === "options") return "SESSION_OPTIONS"
  if (["host", "hostaddr", "port", "service", "servicefile"].includes(key)) return "HOST_OR_SOCKET"
  if (["user", "dbname", "password", "passfile"].includes(key)) return "IDENTITY_OVERRIDE"
  if ([...Object.keys(TLS_ENV), "sslpassword", "ssl", "sslcrl", "sslcrldir"].includes(key)) return "SSL"
  if (["schema", "connection_limit", "pool_timeout", "pgbouncer"].includes(key)) return "PRISMA"
  return "OTHER"
}
const isDetailedEnvError = error => error?.message === "ENV_INVALID" && ENV_DETAIL_SET.has(error?.envDetail)
const invalidEnv = detail => {
  const error = new Error("ENV_INVALID")
  error.envDetail = ENV_DETAIL_SET.has(detail) ? detail : "UNCLASSIFIED_ENV_REJECTION"
  throw error
}
const fail = code => { throw new Error(code) }
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",")
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max
const booleans = (value, keys) => keys.split(",").every(key => typeof value[key] === "boolean")

function connectionUrl(connection) {
  try {
    const url = new URL(connection)
    if (!["postgres:", "postgresql:"].includes(url.protocol)) invalidEnv("URL_SCHEME_UNSUPPORTED")
    if (!url.hostname) invalidEnv("URL_HOST_REQUIRED")
    if (url.pathname.length < 2) invalidEnv("URL_DATABASE_REQUIRED")
    if (url.hash) invalidEnv("URL_FRAGMENT_UNSUPPORTED")
    if (/[\x00-\x20\x7f]/.test(connection)) invalidEnv("URL_CONTROL_INVALID")
    const allowed = new Set(["schema", "connection_limit", "pool_timeout", ...Object.keys(TLS_ENV)])
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) invalidEnv("PARAM_UNSUPPORTED_" + parameterCategory(key))
      if (url.searchParams.getAll(key).length !== 1) invalidEnv("PARAM_DUPLICATED_" + parameterCategory(key))
    }
    if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") invalidEnv("SCHEMA_UNSUPPORTED")
    for (const key of ["connection_limit", "pool_timeout"]) if (url.searchParams.has(key) && !/^[0-9]{1,4}$/.test(url.searchParams.get(key))) invalidEnv("POOL_HINT_INVALID")
    for (const key of Object.keys(TLS_ENV)) if (url.searchParams.has(key)) {
      const value = url.searchParams.get(key)
      if (!value || /[\0\r\n]/.test(value)) invalidEnv("SSL_VALUE_INVALID")
      if (key === "sslmode" ? !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(value) : !(value.startsWith("/") || key === "sslrootcert" && value === "system")) invalidEnv(key === "sslmode" ? "SSL_MODE_INVALID" : "SSL_PATH_UNSUPPORTED")
    }
    for (const key of ["schema", "connection_limit", "pool_timeout"]) url.searchParams.delete(key)
    return url
  } catch (error) { if (isDetailedEnvError(error)) throw error; invalidEnv("URL_SYNTAX_INVALID") }
}

/** Explicit libpq defaults, not a URI in PGDATABASE. Values never leave child env. */
export function databaseConnectionEnvironment(connection) {
  const url = connectionUrl(connection)
  const decode = (value, detail) => { try { const decoded = decodeURIComponent(value); if (!decoded || /[\0\r\n]/.test(decoded)) invalidEnv(detail); return decoded } catch { invalidEnv(detail) } }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const port = url.port || "5432"
  if (!/^[A-Za-z0-9.:-]+$/.test(host)) invalidEnv("TCP_HOST_INVALID")
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) invalidEnv("TCP_PORT_INVALID")
  const user = decode(url.username, "USERNAME_ENCODING_INVALID")
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(user)) invalidEnv("USERNAME_PROFILE_INVALID")
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C", PGHOST: host, PGPORT: port, PGDATABASE: decode(url.pathname.slice(1), "DATABASE_ENCODING_INVALID"), PGUSER: user, PGPASSWORD: url.password ? decode(url.password, "PASSWORD_ENCODING_INVALID") : "", PGPASSFILE: "/dev/null", PGCONNECT_TIMEOUT: "10" }
  for (const [key, variable] of Object.entries(TLS_ENV)) if (url.searchParams.has(key)) env[variable] = url.searchParams.get(key)
  return env
}

/** Root-owned, bounded, non-symlink, stable reads; never execute an env file. */
export function readRootFile(file, limit, mode, io = fs) {
  const parts = file.split("/").filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const parent = io.lstatSync("/" + parts.slice(0, i).join("/"))
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022)) fail("FILES_UNSAFE")
  }
  const before = io.lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0 || (before.mode & 0o022) || before.size < 1 || before.size > limit || (mode && (before.mode & 0o777) !== mode)) fail("FILES_UNSAFE")
  const signature = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode, s.uid].join(":")
  const descriptor = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    if (signature(before) !== signature(io.fstatSync(descriptor))) fail("SOURCE_CHANGED")
    const bytes = io.readFileSync(descriptor)
    if (bytes.length !== before.size || signature(before) !== signature(io.fstatSync(descriptor)) || signature(before) !== signature(io.lstatSync(file))) fail("SOURCE_CHANGED")
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } finally { io.closeSync(descriptor) }
}

export function parseMigrationEnv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 32_768 || text.includes("\0")) invalidEnv("CONTENT_INVALID")
  const values = { MIGRATION_DATABASE_URL: [], MIGRATION_EXPECTED_DB_ROLE: [] }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(MIGRATION_DATABASE_URL|MIGRATION_EXPECTED_DB_ROLE)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    let value = match[2]
    if (["'", '"'].includes(value[0])) {
      if (value.at(-1) !== value[0]) invalidEnv(match[1] === "MIGRATION_DATABASE_URL" ? "URL_QUOTES_INVALID" : "ROLE_QUOTES_INVALID")
      value = value.slice(1, -1)
    }
    values[match[1]].push(value)
  }
  for (const [key, entries] of Object.entries(values)) if (entries.length !== 1) invalidEnv((key === "MIGRATION_DATABASE_URL" ? "URL" : "ROLE") + (entries.length === 0 ? "_DECLARATION_MISSING" : "_DECLARATION_DUPLICATED"))
  const connection = values.MIGRATION_DATABASE_URL[0]
  const expectedRole = values.MIGRATION_EXPECTED_DB_ROLE[0]
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(expectedRole)) invalidEnv("ROLE_PROFILE_INVALID")
  try {
    const url = connectionUrl(connection)
    let username
    try { username = decodeURIComponent(url.username) } catch { invalidEnv("USERNAME_ENCODING_INVALID") }
    if (username !== expectedRole) invalidEnv("ROLE_IDENTITY_MISMATCH")
    databaseConnectionEnvironment(url.href)
    return url.href
  } catch (error) { if (isDetailedEnvError(error)) throw error; invalidEnv("URL_SYNTAX_INVALID") }
}

/** Reject unknown fields before any remote output is stored or printed. */
export function validateSnapshot(defaults, snapshot) {
  if (!exact(defaults, "lockTimeoutMs,statementTimeoutMs,readOnlyForced") || !integer(defaults.lockTimeoutMs) || !integer(defaults.statementTimeoutMs) || typeof defaults.readOnlyForced !== "boolean") fail("OUTPUT_INVALID")
  if (!exact(snapshot, "readOnly,repeatableRead,roleProfile,ledger,relations,indexes,guard,ledgerGuards,defaultAcl,activity") || !booleans(snapshot, "readOnly,repeatableRead")) fail("OUTPUT_INVALID")
  if (!exact(snapshot.roleProfile, "noSuperuser,bypassRls,canLogin,sessionIdentityUnchanged,expectedIdentity") || !booleans(snapshot.roleProfile, "noSuperuser,bypassRls,canLogin,sessionIdentityUnchanged,expectedIdentity")) fail("OUTPUT_INVALID")
  const ledger = snapshot.ledger
  if (!exact(ledger, "totalRows,unresolvedRows,known") || !integer(ledger.totalRows, 0, 5000) || !integer(ledger.unresolvedRows, 0, ledger.totalRows) || !Array.isArray(ledger.known) || ledger.known.length !== 2) fail("OUTPUT_INVALID")
  for (const [i, entry] of ledger.known.entries()) if (!exact(entry, "name,rows,applied,unresolved,rolledBack,checksumMatch") || entry.name !== MIGRATIONS[i] || ![entry.rows, entry.applied, entry.unresolved, entry.rolledBack].every(n => integer(n, 0, ledger.totalRows)) || entry.applied + entry.unresolved + entry.rolledBack !== entry.rows || typeof entry.checksumMatch !== "boolean") fail("OUTPUT_INVALID")
  if (ledger.known.reduce((sum, entry) => sum + entry.rows, 0) > ledger.totalRows) fail("OUTPUT_INVALID")
  if (!Array.isArray(snapshot.relations) || snapshot.relations.length !== RELATIONS.length) fail("OUTPUT_INVALID")
  for (const [i, entry] of snapshot.relations.entries()) if (!exact(entry, "name,present,ordinaryTable,rls,forcedRls,ownerAbility,bytes,estimatedRows,keyColumnsMatch") || entry.name !== RELATIONS[i] || !booleans(entry, "present,ordinaryTable,rls,forcedRls,ownerAbility,keyColumnsMatch") || !integer(entry.bytes) || !integer(entry.estimatedRows, -1)) fail("OUTPUT_INVALID")
  if (!Array.isArray(snapshot.indexes) || snapshot.indexes.length !== INDEXES.length) fail("OUTPUT_INVALID")
  for (const [i, entry] of snapshot.indexes.entries()) if (!exact(entry, "name,present,shapeMatch") || entry.name !== INDEXES[i] || !booleans(entry, "present,shapeMatch")) fail("OUTPUT_INVALID")
  if (!exact(snapshot.guard, "present,shapeMatch,bodyMd5,ownerAbility,triggerBound") || !booleans(snapshot.guard, "present,shapeMatch,ownerAbility,triggerBound") || !(snapshot.guard.bodyMd5 === null || /^[0-9a-f]{32}$/.test(snapshot.guard.bodyMd5))) fail("OUTPUT_INVALID")
  if (!exact(snapshot.ledgerGuards, "appendFunctionMatches,appendTriggerBound,revisionFunctionMatches,revisionTriggerBound") || !booleans(snapshot.ledgerGuards, "appendFunctionMatches,appendTriggerBound,revisionFunctionMatches,revisionTriggerBound")) fail("OUTPUT_INVALID")
  if (!exact(snapshot.defaultAcl, "canCreatePublicSchema,explicitPrivilegeRows,publicPrivilegeRows,nonOwnerWriteRows,grantableRows") || typeof snapshot.defaultAcl.canCreatePublicSchema !== "boolean" || ![snapshot.defaultAcl.explicitPrivilegeRows, snapshot.defaultAcl.publicPrivilegeRows, snapshot.defaultAcl.nonOwnerWriteRows, snapshot.defaultAcl.grantableRows].every(n => integer(n, 0, 10000))) fail("OUTPUT_INVALID")
  if (!exact(snapshot.activity, "visibilityComplete,otherActiveSessions,otherOpenTransactions,lockWaitSessions") || typeof snapshot.activity.visibilityComplete !== "boolean" || ![snapshot.activity.otherActiveSessions, snapshot.activity.otherOpenTransactions, snapshot.activity.lockWaitSessions].every(n => integer(n, 0, 10000))) fail("OUTPUT_INVALID")
  return { defaults, snapshot }
}

export function assessMetadata(defaults, snapshot) {
  validateSnapshot(defaults, snapshot)
  const reasons = new Set()
  if (!defaults.readOnlyForced || !snapshot.readOnly || !snapshot.repeatableRead) reasons.add("READ_ONLY_UNVERIFIED")
  if (!Object.values(snapshot.roleProfile).every(value => value === true)) reasons.add("ROLE_PROFILE_UNVERIFIED")
  if (defaults.lockTimeoutMs !== 10_000 || defaults.statementTimeoutMs !== 840_000) reasons.add("TIMEOUT_DEFAULTS")
  if (snapshot.ledger.unresolvedRows) reasons.add("LEDGER_UNRESOLVED")
  const states = snapshot.ledger.known.map(entry => {
    if (!entry.checksumMatch) reasons.add("CHECKSUM_MISMATCH")
    if (entry.rows === 0) return "pending"
    if (entry.rows === 1 && entry.applied === 1 && entry.unresolved === 0 && entry.rolledBack === 0) return "applied"
    reasons.add("LEDGER_AMBIGUOUS"); return "unknown"
  })
  for (const entry of snapshot.relations) {
    if (entry.name === "workforce_reconciliation_tenant_states") {
      if (entry.present !== (states[0] === "applied")) reasons.add("INDEX_LEDGER_MISMATCH")
      // Existing catalog fingerprints/counts alone cannot prove every new
      // CHECK/FK/default/policy body. Do not accept an applied/manual table.
      if (entry.present) reasons.add("APPLIED_TABLE_CONSTRAINTS_NOT_PROVED")
      continue
    }
    if (!entry.present || !entry.ordinaryTable || !entry.keyColumnsMatch) reasons.add("RELATION_SHAPE")
    if (entry.name !== "organizations" && (!entry.rls || !entry.forcedRls)) reasons.add("RLS_UNVERIFIED")
    if (!entry.ownerAbility) reasons.add("OWNER_ABILITY")
  }
  for (const entry of snapshot.indexes) {
    if (entry.present && !entry.shapeMatch) reasons.add("INDEX_SHAPE")
    if (entry.present !== (states[0] === "applied")) reasons.add("INDEX_LEDGER_MISMATCH")
  }
  const guard = snapshot.guard
  if (!guard.present || !guard.shapeMatch || !guard.triggerBound || guard.bodyMd5 !== GUARD_MD5[states[1]]) reasons.add("FUNCTION_SHAPE")
  if (!guard.ownerAbility || !snapshot.defaultAcl.canCreatePublicSchema) reasons.add("OWNER_ABILITY")
  if (!Object.values(snapshot.ledgerGuards).every(value => value === true)) reasons.add("LEDGER_GUARDS_UNVERIFIED")
  if (snapshot.defaultAcl.publicPrivilegeRows || snapshot.defaultAcl.nonOwnerWriteRows) reasons.add("DEFAULT_ACL_UNREVIEWED")
  if (!snapshot.activity.visibilityComplete) reasons.add("ACTIVITY_VISIBILITY_UNVERIFIED")
  return { status: reasons.size ? "INCOMPLETE" : "READY_FOR_REVIEW", reasons: [...reasons].sort(), migrationStates: states }
}

export function validateReport(value, expectedSha) {
  if (!SHA.test(expectedSha) || !exact(value, "version,status,expectedMainSha,productionArtifactSha,targetSourceSha,bindings,reasons,migrationStates,defaults,snapshot,limits,code,sqlState,envDetail") || value.version !== 2 || value.expectedMainSha !== expectedSha || value.targetSourceSha !== TARGET_SOURCE_SHA || !["ERROR", "INCOMPLETE", "READY_FOR_REVIEW"].includes(value.status) || !exact(value.bindings, "helperSha256,sqlSha256") || !Object.values(value.bindings).every(v => DIGEST.test(v)) || JSON.stringify(value.limits) !== JSON.stringify(LIMITS)) fail("OUTPUT_INVALID")
  if (value.status === "ERROR") {
    if (!CODES.has(value.code) || value.productionArtifactSha !== null || value.defaults !== null || value.snapshot !== null || JSON.stringify(value.reasons) !== "[]" || JSON.stringify(value.migrationStates) !== "[]") fail("OUTPUT_INVALID")
    if (!(value.sqlState === null || (value.code === "QUERY_FAILED" && SQL_STATES.has(value.sqlState)))) fail("OUTPUT_INVALID")
    if (value.code === "ENV_INVALID" ? !ENV_DETAIL_SET.has(value.envDetail) : value.envDetail !== null) fail("OUTPUT_INVALID")
  } else {
    if (value.productionArtifactSha !== expectedSha || value.code !== null || value.sqlState !== null || value.envDetail !== null) fail("OUTPUT_INVALID")
    const assessment = assessMetadata(value.defaults, value.snapshot)
    if (JSON.stringify(value.reasons) !== JSON.stringify(assessment.reasons) || value.reasons.some(reason => !REASONS.has(reason)) || JSON.stringify(value.migrationStates) !== JSON.stringify(assessment.migrationStates) || value.status !== assessment.status) fail("OUTPUT_INVALID")
  }
  return value
}

export function queryMetadata(url, sql, execute = execFileSync) {
  try {
    const env = databaseConnectionEnvironment(url)
    // Connection fields are environment-only. Fixed args, no shell, no temp file, no app.env,
    // no inherited credentials/config and no raw child stderr reaches output.
    return execute("psql", ["-X", "-qAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], {
      input: sql, encoding: "utf8", maxBuffer: MAX_OUTPUT, timeout: 30_000,
      env: { ...env, PGOPTIONS: "-c default_transaction_read_only=on -c application_name=hrm_migration_metadata_preflight -c hrm.preflight_expected_role=" + env.PGUSER },
      stdio: ["pipe", "pipe", "pipe"],
    })
  } catch (error) {
    const failure = new Error("QUERY_FAILED")
    const stderr = typeof error?.stderr === "string" || Buffer.isBuffer(error?.stderr) ? error.stderr.toString() : ""
    const state = stderr.length <= 4096 ? /^psql:(?:<stdin>:\d+:\s*)?ERROR:\s+([0-9A-Z]{5})\s*$/m.exec(stderr)?.[1] : null
    failure.sqlState = SQL_STATES.has(state) ? state : null
    throw failure
  }
}

export function inspectRemote(sql, bindings, expectedSha, dependencies = {}) {
  const report = { version: 2, status: "ERROR", expectedMainSha: expectedSha, productionArtifactSha: null, targetSourceSha: TARGET_SOURCE_SHA, bindings, reasons: [], migrationStates: [], defaults: null, snapshot: null, limits: LIMITS, code: "INSPECTION_FAILED", sqlState: null, envDetail: null }
  try {
    if (!SHA.test(expectedSha) || (dependencies.uid ?? process.getuid()) !== 0) fail("INPUT_INVALID")
    const read = dependencies.read ?? readRootFile
    const marker = "/opt/leaddrive-v2/.next/standalone/.deploy-sha"
    if (read(marker, 128).trim() !== expectedSha) fail("ARTIFACT_MISMATCH")
    const url = parseMigrationEnv(read("/etc/leaddrive/migration.env", 32_768, 0o600))
    const text = (dependencies.query ?? queryMetadata)(url, sql)
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_OUTPUT) fail("OUTPUT_INVALID")
    const lines = text.trim().split("\n")
    if (lines.length !== 2) fail("OUTPUT_INVALID")
    const [defaults, snapshot] = lines.map(line => JSON.parse(line))
    const assessment = assessMetadata(defaults, snapshot)
    if (read(marker, 128).trim() !== expectedSha) fail("ARTIFACT_MISMATCH")
    Object.assign(report, assessment, { productionArtifactSha: expectedSha, defaults, snapshot, code: null })
  } catch (error) {
    report.code = CODES.has(error?.message) ? error.message : "INSPECTION_FAILED"
    report.sqlState = report.code === "QUERY_FAILED" && SQL_STATES.has(error?.sqlState) ? error.sqlState : null
    report.envDetail = report.code === "ENV_INVALID" ? (isDetailedEnvError(error) ? error.envDetail : "UNCLASSIFIED_ENV_REJECTION") : null
  }
  return validateReport(report, expectedSha)
}

async function readStdin() {
  let text = ""
  for await (const chunk of process.stdin) {
    text += chunk
    if (Buffer.byteLength(text) > MAX_OUTPUT) fail("OUTPUT_INVALID")
  }
  return text
}

async function main() {
  if (process.argv[2] === "--emit-remote" && process.argv.length === 3) {
    const helper = fs.readFileSync(new URL(import.meta.url), "utf8")
    const sql = fs.readFileSync(new URL("./hrm-migration-metadata-preflight.sql", import.meta.url), "utf8")
    const bindings = { helperSha256: digest(helper), sqlSha256: digest(sql) }
    // The normal CLI entry stays false for stdin modules. Source and SQL are
    // reviewed bytes sent in memory, never copied onto production disk.
    process.stdout.write(helper + "\nconst report = inspectRemote(" + JSON.stringify(sql) + "," + JSON.stringify(bindings) + ", process.env.EXPECTED_MAIN_SHA);\nconsole.log(JSON.stringify(report));\nif(report.status !== 'READY_FOR_REVIEW') process.exitCode=1;\n")
  } else if (process.argv[2] === "--validate-output" && process.argv.length === 4) {
    const report = validateReport(JSON.parse(await readStdin()), process.argv[3])
    const helper = fs.readFileSync(new URL(import.meta.url))
    const sql = fs.readFileSync(new URL("./hrm-migration-metadata-preflight.sql", import.meta.url))
    if (report.bindings.helperSha256 !== digest(helper) || report.bindings.sqlSha256 !== digest(sql)) fail("SOURCE_CHANGED")
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  } else fail("INPUT_INVALID")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("HRM metadata output invalid; raw data withheld"); process.exitCode = 1 })
}
