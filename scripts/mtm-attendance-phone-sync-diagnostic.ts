/** Fixed, read-only diagnostic for two failed fictional-phone operations.
 * No general log reader, SQL input, credential reader or production mutation. */
import fs from "node:fs"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { PHONE, readPhone } from "./mtm-attendance-phone-fixture"
import { APP, databaseUrlFromEnv, readRootFile } from "./mtm-attendance-demo-verification"

export const DIAGNOSTIC_LOG = "/var/lib/leaddrive-v2-logs/error.log"
export const DIAGNOSTIC_BYTES = 4 * 1024 * 1024
export const DIAGNOSTIC_OPERATIONS = [
  "mtm-phone-diagnostic-36f54932-d778-4dc5-90e5-0cee5932649c",
  "mtm-phone-diag-166dd9c1-403d-4f71-920d-aea72d78318e",
] as const
const SQLSTATES = ["23502", "23503", "23505", "23514", "42703", "42P01", "42501", "42883", "55P03", "40P01", "25P02", "22007", "22P02", "42804", "57014", "42601", "42P10", "0A000", "53300"]
const COLUMNS = ["id", "organizationId", "agentId", "eventId", "installationId", "action", "claimedAt", "serverReceivedAt", "locationState", "latitude", "longitude", "accuracy", "fixCapturedAt", "fixAgeSeconds", "provider", "isMock", "consentId", "branchRevisionId", "primaryBranchId", "distanceMeters", "redactedRequestHash", "createdAt", "type", "occurredAt", "workdayId"]
const MTM_CODES = ["MTM_ATTENDANCE_MARK_EVENT_MISMATCH", "MTM_ATTENDANCE_LOCATION_IMMUTABLE", "MTM_ATTENDANCE_LOCATION_CONSENT_REQUIRED", "MTM_ATTENDANCE_LOCATION_POLICY_CHANGED", "MTM_ATTENDANCE_LOCATION_HISTORY_CHANGED", "MTM_ATTENDANCE_RISK_EVIDENCE_MISSING", "MTM_ATTENDANCE_RISK_COHORT_TOO_LARGE", "MTM_ATTENDANCE_RISK_EVENT_MISMATCH"]
const CONSTRAINTS = ["mtm_attendance_mark_evidence_check", ...Array.from({ length: 8 }, (_, n) => `mtm_attendance_mark_evidence_check${n + 1}`),
  ...["installationId", "redactedRequestHash", "action", "locationState", "provider", "distanceMeters"].map(column => `mtm_attendance_mark_evidence_${column}_check`),
  ...["agentId", "eventId", "consentId", "branchRevisionId"].map(column => `mtm_attendance_mark_evidence_organizationId_${column}_fkey`)]
const MIGRATIONS = ["20261013090000_mtm_attendance_location_evidence", "20261013120000_mtm_attendance_risks", "20261013160000_mtm_attendance_branch_qr"]
const RELATIONS = ["mtm_attendance_mark_evidence", "mtm_attendance_location_policies", "mtm_attendance_risk_cases", "mtm_agent_workday_events"]
const RECORDS = ["canonical_event", "predecessor", "consent", "current_policy", "new"]
const unique = (values: string[]) => [...new Set(values)].sort()
const quoted = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function fail(): never { throw new Error("PHONE_SYNC_DIAGNOSTIC_FAILED") }
export function diagnosticFailure() { return { version: 1, status: "FAIL", code: "PHONE_SYNC_DIAGNOSTIC_FAILED" } }

export function summarizePhoneSyncLog(raw: string) {
  if (Buffer.byteLength(raw) > DIAGNOSTIC_BYTES) fail()
  // PM2 may prefix every line; remove only its fixed timestamp/process prefix.
  const text = raw.replace(/\x1b\[[0-9;]*m/g, "")
  return DIAGNOSTIC_OPERATIONS.map(operationId => {
    const marker = `[MTM/sync/push] op=create entity=workdays operationId=${operationId}`
    const starts = [...text.matchAll(new RegExp(quoted(marker) + "(?=\\s|$)", "g"))].map(match => match.index!)
    const snippets = starts.slice(-4).map(start => {
      const tail = text.slice(start, start + 16384)
      const next = tail.indexOf("[MTM/sync/push]", marker.length)
      const block = next < 0 ? tail : tail.slice(0, next)
      // The first complete top-level error-object terminator bounds the error.
      const end = block.search(/\n(?:\d{4}-\d\d-\d\dT[^\n]{0,35}: )?\}(?:\r?\n|$)/)
      return end < 0 ? block : block.slice(0, end + 2)
    })
    const blocks = snippets.join("\n")
    return { operationId, found: starts.length > 0, sampledErrors: snippets.length,
      prismaCodes: unique([...blocks.matchAll(/\bP\d{4}\b/g)].map(match => match[0])),
      sqlStates: SQLSTATES.filter(code => new RegExp(`(?:[Cc]ode|SQLSTATE)[\\s:=\\x27\\x22\\x60]*${code}\\b`).test(blocks)),
      mtmCodes: MTM_CODES.filter(code => new RegExp(`\\b${code}\\b`).test(blocks)),
      constraints: CONSTRAINTS.filter(name => new RegExp(`constraint[ \\"\\x27\\x60]+${quoted(name)}[\\x22\\x27\\x60]`, "i").test(blocks)),
      missingColumns: COLUMNS.filter(name => new RegExp(`column[ \\"\\x27\\x60]+${quoted(name)}[\\x22\\x27\\x60] (?:does not exist|of relation)`, "i").test(blocks)),
      missingRelations: RELATIONS.filter(name => new RegExp(`relation[ \\"\\x27\\x60]+${name}[\\x22\\x27\\x60] does not exist`, "i").test(blocks)),
      missingRecordFields: RECORDS.flatMap(record => COLUMNS.filter(column => new RegExp(`record [\\x22\\x27]${record}[\\x22\\x27] has no field [\\x22\\x27]${column}[\\x22\\x27]`, "i").test(blocks)).map(column => ({ record, column }))),
    }
  })
}
export function readDiagnosticTail() {
  const fd = fs.openSync(DIAGNOSTIC_LOG, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.nlink !== 1 || stat.size < 0) fail()
    const size = Math.min(stat.size, DIAGNOSTIC_BYTES), bytes = Buffer.alloc(size)
    const read = fs.readSync(fd, bytes, 0, size, stat.size - size)
    return bytes.subarray(0, read).toString("utf8")
  } finally { fs.closeSync(fd) }
}
export async function readDiagnosticCatalog(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    const columns = await tx.$queryRaw<{ name: string }[]>`SELECT attname AS name FROM pg_attribute WHERE attrelid=to_regclass('public.mtm_attendance_mark_evidence') AND attnum>0 AND NOT attisdropped`
    const functions = await tx.$queryRaw<{ definition: string }[]>`SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='mtm_attendance_location_history_guard' AND p.pronargs=0`
    const constraints = await tx.$queryRaw<{ name: string }[]>`SELECT conname AS name FROM pg_constraint WHERE conrelid=to_regclass('public.mtm_attendance_mark_evidence')`
    const migrations = await tx.$queryRaw<{ name: string; applied: boolean }[]>`SELECT migration_name AS name,(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied FROM _prisma_migrations WHERE migration_name IN ('20261013090000_mtm_attendance_location_evidence','20261013120000_mtm_attendance_risks','20261013160000_mtm_attendance_branch_qr')`
    const [context] = await tx.$queryRaw<{ utc: boolean; selectAllowed: boolean | null; insertAllowed: boolean | null }[]>`SELECT current_setting('TimeZone') IN ('UTC','Etc/UTC') AS utc,has_table_privilege(current_user,to_regclass('public.mtm_attendance_mark_evidence'),'SELECT') AS "selectAllowed",has_table_privilege(current_user,to_regclass('public.mtm_attendance_mark_evidence'),'INSERT') AS "insertAllowed"`
    if (functions.length > 1 || !context) fail()
    return { columnsPresent: COLUMNS.filter(name => columns.some(column => column.name === name)),
      constraintsPresent: CONSTRAINTS.filter(name => constraints.some(constraint => constraint.name === name)),
      triggerFunctionSha256: functions[0] ? createHash("sha256").update(functions[0].definition).digest("hex") : null,
      migrations: MIGRATIONS.map(name => ({ name, present: migrations.some(row => row.name === name), applied: migrations.some(row => row.name === name && row.applied === true) })),
      utcSession: context.utc === true, selectAllowed: context.selectAllowed === true, insertAllowed: context.insertAllowed === true }
  })
}
export async function runPhoneSyncDiagnostic(sha: string) {
  if (process.getuid?.() !== 0 || !/^[a-f0-9]{40}$/.test(sha) || readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail()
  const response = await fetch(`${PHONE.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10000) })
  if (!response.ok || (await response.json()).artifactSha !== sha) fail()
  process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
  const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
  const db: PrismaClient = await makeScriptPrisma({ orgId: PHONE.id })
  try {
    await readPhone(db)
    // Runtime roles may deny migration-ledger reads; logs remain independently useful.
    const catalog = await readDiagnosticCatalog(db).catch(() => null)
    const operations = summarizePhoneSyncLog(readDiagnosticTail())
    if (readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail()
    return { version: 1, status: "PASS", tenant: PHONE.slug, artifactSha: sha, readOnly: true, catalog, operations }
  } finally { await db.$disconnect(); delete process.env.DATABASE_URL }
}
export function validatePhoneSyncDiagnostic(value: unknown, sha: string) {
  // Rebuild every leaf through the same finite vocabulary; unknown fields fail.
  const row = value as Awaited<ReturnType<typeof runPhoneSyncDiagnostic>>
  if (JSON.stringify(value) === JSON.stringify(diagnosticFailure())) return value
  if (!row || row.version !== 1 || row.status !== "PASS" || row.tenant !== PHONE.slug || row.artifactSha !== sha || !/^[a-f0-9]{40}$/.test(sha) || row.readOnly !== true) fail()
  const list = (values: string[], allowed: readonly string[]) => { if (!Array.isArray(values) || values.length > allowed.length || values.some(v => !allowed.includes(v)) || new Set(values).size !== values.length) fail(); return values }
  const c = row.catalog
  if (c !== null && (!c || ![c.utcSession,c.selectAllowed,c.insertAllowed].every(v => typeof v === 'boolean') || (c.triggerFunctionSha256 !== null && !/^[a-f0-9]{64}$/.test(c.triggerFunctionSha256)))) fail()
  const clean = { version: 1, status: "PASS", tenant: PHONE.slug, artifactSha: sha, readOnly: true,
    catalog: c === null ? null : { columnsPresent:list(c.columnsPresent,COLUMNS),constraintsPresent:list(c.constraintsPresent,CONSTRAINTS),triggerFunctionSha256:c.triggerFunctionSha256,
      migrations:MIGRATIONS.map((name,i) => { const m=c.migrations[i]; if(!m || m.name!==name || typeof m.present!=='boolean' || typeof m.applied!=='boolean') fail(); return {name,present:m.present,applied:m.applied} }),
      utcSession:c.utcSession,selectAllowed:c.selectAllowed,insertAllowed:c.insertAllowed },
    operations:DIAGNOSTIC_OPERATIONS.map((operationId,i) => { const op=row.operations[i]; if(!op || op.operationId!==operationId || typeof op.found!=='boolean' || !Number.isInteger(op.sampledErrors) || op.sampledErrors<0 || op.sampledErrors>4)fail();
      return {operationId,found:op.found,sampledErrors:op.sampledErrors,prismaCodes:list(op.prismaCodes,Array.from({length:10000},(_,n)=>`P${String(n).padStart(4,'0')}`)),sqlStates:list(op.sqlStates,SQLSTATES),mtmCodes:list(op.mtmCodes,MTM_CODES),constraints:list(op.constraints,CONSTRAINTS),missingColumns:list(op.missingColumns,COLUMNS),missingRelations:list(op.missingRelations,RELATIONS),missingRecordFields:op.missingRecordFields.map(field=>{if(!RECORDS.includes(field.record)||!COLUMNS.includes(field.column))fail();return {record:field.record,column:field.column}})} }) }
  if(JSON.stringify(clean)!==JSON.stringify(value)) fail()
  return clean
}
if (process.argv[2] === "--phone-sync-diagnostic") {
  void runPhoneSyncDiagnostic(process.argv[3]).then(value=>process.stdout.write(JSON.stringify(value)+"\n"))
    .catch(()=>{process.stdout.write(JSON.stringify(diagnosticFailure())+"\n");process.exitCode=1})
} else if (process.argv[2] === "--validate-phone-sync-diagnostic") {
  try { process.stdout.write(JSON.stringify(validatePhoneSyncDiagnostic(JSON.parse(fs.readFileSync(0,"utf8")),process.argv[3]))+"\n") }
  catch { process.stderr.write("Invalid bounded diagnostic; raw output withheld\n");process.exitCode=1 }
}
