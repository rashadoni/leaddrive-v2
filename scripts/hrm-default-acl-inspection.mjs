import * as aclFs from "node:fs"
import { createHash as aclCreateHash } from "node:crypto"
import { execFileSync as aclExecFileSync } from "node:child_process"
import { pathToFileURL as aclPathToFileURL } from "node:url"
import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"

// This supplemental inspector never replaces assessMetadata or approves ACLs.
export const ACL_LIMITS = Object.freeze([
  "Supplemental catalog evidence only; READ_COMPLETE is not ACL approval or release readiness",
  "The original HRM preflight result and DEFAULT_ACL_UNREVIEWED check remain unchanged",
  "Expected runtime identity is proven through an actual bounded read-only application connection",
  "No role names, database identifiers, credentials, environment values or business rows exported",
  "OTHER recipients remain unidentified; no backup identity or authorization is inferred",
  "Two sequential sessions prove matching endpoint/catalog identity, not simultaneous liveness against a promoted physical clone",
  "No reserved DDL quiet window, index duration or simultaneous database snapshot is proved",
  "No production files, grants, role configuration, tenant activation or business data mutated",
])
export const ACL_PRIVILEGES = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
export const ACL_CODES = Object.freeze(["INPUT_INVALID", "FILES_UNSAFE", "SOURCE_CHANGED", "ARTIFACT_MISMATCH", "APP_ENV_INVALID", "MIGRATION_ENV_INVALID", "QUERY_FAILED", "OUTPUT_INVALID", "IDENTITY_UNPROVED", "PROFILE_UNPROVED", "INSPECTION_FAILED"])
const ACL_SHA = /^[0-9a-f]{40}$/
const ACL_DIGEST = /^[0-9a-f]{64}$/
const ACL_MAX = 65536
const aclHash = bytes => aclCreateHash("sha256").update(bytes).digest("hex")
const aclFail = code => { throw new Error(code) }
const aclExact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",")
const aclInteger = (value, min = 0, max = 10000) => Number.isSafeInteger(value) && value >= min && value <= max
const aclBools = (value, keys) => keys.split(",").every(key => typeof value[key] === "boolean")
const aclProfileValid = profile => aclExact(profile, "present,noSuperuser,noBypassRls,canLogin,setPrivilegedCount") && aclBools(profile, "present,noSuperuser,noBypassRls,canLogin") && aclInteger(profile.setPrivilegedCount)
const aclProfileValues = p => [p.present,p.noSuperuser,p.noBypassRls,p.canLogin,p.setPrivilegedCount]
const aclProfilesEqual = (a,b) => JSON.stringify(aclProfileValues(a)) === JSON.stringify(aclProfileValues(b))

/** Read one literal DATABASE_URL declaration, without executing any env content. */
export function parseApplicationEnv(text) {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > ACL_MAX || text.includes("\0")) aclFail("APP_ENV_INVALID")
    const values = []
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line)
      if (!match) continue
      let value = match[1]
      if (["'", '"'].includes(value[0])) {
        if (value.length < 2 || value.at(-1) !== value[0]) aclFail("APP_ENV_INVALID")
        value = value.slice(1, -1)
      }
      values.push(value)
    }
    if (values.length !== 1) aclFail("APP_ENV_INVALID")
    databaseConnectionEnvironment(values[0])
    return values[0]
  } catch { aclFail("APP_ENV_INVALID") }
}

export function validateAclData(value) {
  if (!aclExact(value, "explicitPrivilegeRows,publicPrivilegeRows,nonOwnerWriteRows,grantableRows,entries") || ![value.explicitPrivilegeRows,value.publicPrivilegeRows,value.nonOwnerWriteRows,value.grantableRows].every(n => aclInteger(n, 0, 100)) || !Array.isArray(value.entries) || value.entries.length > 100) aclFail("OUTPUT_INVALID")
  let total = 0, publicRows = 0, nonOwnerWriteRows = 0, grantableRows = 0
  const keys = new Set()
  for (const entry of value.entries) {
    if (!aclExact(entry, "scope,recipient,privilege,grantable,rowCount,recipientProfile") || !["GLOBAL","PUBLIC_SCHEMA"].includes(entry.scope) || !["OWNER","EXPECTED_RUNTIME","PUBLIC","OTHER"].includes(entry.recipient) || !ACL_PRIVILEGES.includes(entry.privilege) || typeof entry.grantable !== "boolean" || !aclInteger(entry.rowCount, 1, 100) || !aclProfileValid(entry.recipientProfile)) aclFail("OUTPUT_INVALID")
    const p = entry.recipientProfile
    if (entry.recipient === "PUBLIC" ? p.present || p.noSuperuser || p.noBypassRls || p.canLogin || p.setPrivilegedCount : !p.present) aclFail("OUTPUT_INVALID")
    const key = JSON.stringify([entry.scope,entry.recipient,entry.privilege,entry.grantable,...aclProfileValues(p)])
    if (keys.has(key)) aclFail("OUTPUT_INVALID")
    keys.add(key)
    total += entry.rowCount
    if (entry.recipient === "PUBLIC") publicRows += entry.rowCount
    if (entry.recipient !== "OWNER" && entry.privilege !== "SELECT") nonOwnerWriteRows += entry.rowCount
    if (entry.grantable) grantableRows += entry.rowCount
  }
  if (total !== value.explicitPrivilegeRows || publicRows !== value.publicPrivilegeRows || nonOwnerWriteRows !== value.nonOwnerWriteRows || grantableRows !== value.grantableRows) aclFail("OUTPUT_INVALID")
  return value
}

/** Internal identifiers are compared in memory and never enter the public report. */
export function validateAclSnapshot(value, mode) {
  if (!aclExact(value, "mode,identity,roleProfile,acl") || !["runtime","migration"].includes(mode) || value.mode !== mode || !aclExact(value.identity, "expectedIdentity,sessionIdentityUnchanged,systemIdentifier,databaseOid,databaseName,primary,readOnly,repeatableRead") || !aclBools(value.identity, "expectedIdentity,sessionIdentityUnchanged,primary,readOnly,repeatableRead") || typeof value.identity.systemIdentifier !== "string" || !/^[0-9]{1,20}$/.test(value.identity.systemIdentifier) || typeof value.identity.databaseOid !== "string" || !/^[0-9]{1,10}$/.test(value.identity.databaseOid) || typeof value.identity.databaseName !== "string" || !value.identity.databaseName || Buffer.byteLength(value.identity.databaseName) > 63 || /[\0\r\n]/.test(value.identity.databaseName) || !aclProfileValid(value.roleProfile)) aclFail("OUTPUT_INVALID")
  validateAclData(value.acl)
  if (mode === "runtime" && value.acl.explicitPrivilegeRows !== 0) aclFail("OUTPUT_INVALID")
  return value
}

export function queryAclMetadata(connection, sql, runtimeRole, mode, execute = aclExecFileSync) {
  try {
    const env = databaseConnectionEnvironment(connection)
    if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(runtimeRole) || !["runtime","migration"].includes(mode)) aclFail("INPUT_INVALID")
    return execute("psql", ["-X","-qAt","--no-password","-v","ON_ERROR_STOP=1","-v","VERBOSITY=sqlstate"], {
      input: sql, encoding: "utf8", maxBuffer: ACL_MAX, timeout: 30000,
      env: { ...env, PGOPTIONS: "-c default_transaction_read_only=on -c application_name=hrm_default_acl_inspection -c hrm.acl_expected_role=" + env.PGUSER + " -c hrm.acl_runtime_role=" + runtimeRole + " -c hrm.acl_mode=" + mode },
      stdio: ["pipe","pipe","pipe"],
    })
  } catch { aclFail("QUERY_FAILED") }
}

const aclSafeProfile = p => p.present && p.noSuperuser && p.noBypassRls && p.canLogin && p.setPrivilegedCount === 0
const aclMigrationProfile = p => p.present && p.noSuperuser && !p.noBypassRls && p.canLogin

export function validateAclReport(value, expectedSha) {
  if (!ACL_SHA.test(expectedSha) || !aclExact(value, "version,status,expectedMainSha,productionArtifactSha,bindings,proof,limits,code") || value.version !== 1 || value.expectedMainSha !== expectedSha || !["READ_COMPLETE","ERROR"].includes(value.status) || !aclExact(value.bindings, "baseHelperSha256,helperSha256,sqlSha256") || !Object.values(value.bindings).every(v => typeof v === "string" && ACL_DIGEST.test(v)) || JSON.stringify(value.limits) !== JSON.stringify(ACL_LIMITS)) aclFail("OUTPUT_INVALID")
  if (value.status === "ERROR") {
    if (!ACL_CODES.includes(value.code) || value.productionArtifactSha !== null || value.proof !== null) aclFail("OUTPUT_INVALID")
  } else {
    const p = value.proof
    if (value.code !== null || value.productionArtifactSha !== expectedSha || !aclExact(p, "readOnlyBoth,repeatableReadBoth,expectedRuntimeSession,expectedMigrationSession,separatePrincipals,sameDeclaredEndpoint,sameDatabaseCatalogIdentity,writablePrimaryBoth,businessRowsRead,runtimeProfile,migrationProfile,acl") || !aclBools(p, "readOnlyBoth,repeatableReadBoth,expectedRuntimeSession,expectedMigrationSession,separatePrincipals,sameDeclaredEndpoint,sameDatabaseCatalogIdentity,writablePrimaryBoth,businessRowsRead") || ![p.readOnlyBoth,p.repeatableReadBoth,p.expectedRuntimeSession,p.expectedMigrationSession,p.separatePrincipals,p.sameDeclaredEndpoint,p.sameDatabaseCatalogIdentity,p.writablePrimaryBoth].every(v => v === true) || p.businessRowsRead !== false || !aclProfileValid(p.runtimeProfile) || !aclSafeProfile(p.runtimeProfile) || !aclProfileValid(p.migrationProfile) || !aclMigrationProfile(p.migrationProfile)) aclFail("OUTPUT_INVALID")
    validateAclData(p.acl)
    for (const e of p.acl.entries) {
      if (e.recipient === "EXPECTED_RUNTIME" && !aclProfilesEqual(e.recipientProfile,p.runtimeProfile)) aclFail("OUTPUT_INVALID")
      if (e.recipient === "OWNER" && !aclProfilesEqual(e.recipientProfile,p.migrationProfile)) aclFail("OUTPUT_INVALID")
    }
  }
  return value
}

export function inspectAclRemote(sql, bindings, expectedSha, dependencies = {}) {
  const report = { version: 1, status: "ERROR", expectedMainSha: expectedSha, productionArtifactSha: null, bindings, proof: null, limits: ACL_LIMITS, code: "INSPECTION_FAILED" }
  try {
    if (!ACL_SHA.test(expectedSha) || (dependencies.uid ?? process.getuid()) !== 0) aclFail("INPUT_INVALID")
    const read = dependencies.read ?? readRootFile
    const marker = "/opt/leaddrive-v2/.next/standalone/.deploy-sha"
    if (read(marker,128).trim() !== expectedSha) aclFail("ARTIFACT_MISMATCH")
    const migrationText = read("/etc/leaddrive/migration.env",32768,0o600)
    const appText = read("/etc/leaddrive/app.env",ACL_MAX,0o600)
    let migrationConnection
    try { migrationConnection = parseMigrationEnv(migrationText) } catch { aclFail("MIGRATION_ENV_INVALID") }
    const runtimeConnection = parseApplicationEnv(appText)
    const runtimeEnv = databaseConnectionEnvironment(runtimeConnection)
    const migrationEnv = databaseConnectionEnvironment(migrationConnection)
    if (runtimeEnv.PGUSER === migrationEnv.PGUSER) aclFail("IDENTITY_UNPROVED")
    for (const key of ["PGHOST","PGPORT","PGDATABASE"]) if (runtimeEnv[key] !== migrationEnv[key]) aclFail("IDENTITY_UNPROVED")
    const query = dependencies.query ?? queryAclMetadata
    const observe = (connection,mode) => {
      const raw = query(connection,sql,runtimeEnv.PGUSER,mode)
      if (typeof raw !== "string" || Buffer.byteLength(raw) > ACL_MAX || raw.trim().split("\n").length !== 1) aclFail("OUTPUT_INVALID")
      let parsed
      try { parsed = JSON.parse(raw) } catch { aclFail("OUTPUT_INVALID") }
      return validateAclSnapshot(parsed,mode)
    }
    const runtime = observe(runtimeConnection,"runtime")
    const migration = observe(migrationConnection,"migration")
    for (const s of [runtime,migration]) if (![s.identity.expectedIdentity,s.identity.sessionIdentityUnchanged,s.identity.primary,s.identity.readOnly,s.identity.repeatableRead].every(v => v === true)) aclFail("IDENTITY_UNPROVED")
    for (const key of ["systemIdentifier","databaseOid","databaseName"]) if (runtime.identity[key] !== migration.identity[key]) aclFail("IDENTITY_UNPROVED")
    if (!aclSafeProfile(runtime.roleProfile) || !aclMigrationProfile(migration.roleProfile)) aclFail("PROFILE_UNPROVED")
    if (read(marker,128).trim() !== expectedSha) aclFail("ARTIFACT_MISMATCH")
    if (read("/etc/leaddrive/migration.env",32768,0o600) !== migrationText || read("/etc/leaddrive/app.env",ACL_MAX,0o600) !== appText) aclFail("SOURCE_CHANGED")
    const proof = { readOnlyBoth: true, repeatableReadBoth: true, expectedRuntimeSession: true, expectedMigrationSession: true, separatePrincipals: true, sameDeclaredEndpoint: true, sameDatabaseCatalogIdentity: true, writablePrimaryBoth: true, businessRowsRead: false, runtimeProfile: runtime.roleProfile, migrationProfile: migration.roleProfile, acl: migration.acl }
    Object.assign(report,{ status: "READ_COMPLETE", productionArtifactSha: expectedSha, proof, code: null })
    // Reject contradictions before emitting any metadata.
    validateAclReport(report,expectedSha)
  } catch (error) {
    Object.assign(report,{ status: "ERROR", productionArtifactSha: null, proof: null, code: ACL_CODES.includes(error?.message) ? error.message : "INSPECTION_FAILED" })
  }
  return validateAclReport(report,expectedSha)
}

async function aclReadStdin() {
  let value = ""
  for await (const chunk of process.stdin) {
    value += chunk
    if (Buffer.byteLength(value) > ACL_MAX) aclFail("OUTPUT_INVALID")
  }
  return value
}

const ACL_BASE_IMPORT = 'import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"'
async function aclMain() {
  const base = aclFs.readFileSync(new URL("./hrm-migration-metadata-preflight.mjs",import.meta.url))
  const helper = aclFs.readFileSync(new URL(import.meta.url))
  const sql = aclFs.readFileSync(new URL("./hrm-default-acl-inspection.sql",import.meta.url))
  const bindings = { baseHelperSha256: aclHash(base), helperSha256: aclHash(helper), sqlSha256: aclHash(sql) }
  if (process.argv[2] === "--emit-remote" && process.argv.length === 3) {
    const text = helper.toString("utf8")
    if (text.split("\n").filter(line => line === ACL_BASE_IMPORT).length !== 1) aclFail("SOURCE_CHANGED")
    // Reviewed standalone modules are streamed in memory; no files are installed.
    // Both normal CLI guards are false for Node stdin modules.
    process.stdout.write(base.toString("utf8") + "\n" + text.split("\n").filter(line => line !== ACL_BASE_IMPORT).join("\n") + "\nconst aclResult = inspectAclRemote(" + JSON.stringify(sql.toString("utf8")) + "," + JSON.stringify(bindings) + ",process.env.EXPECTED_MAIN_SHA);\nconsole.log(JSON.stringify(aclResult));\nif(aclResult.status !== 'READ_COMPLETE') process.exitCode=1;\n")
  } else if (process.argv[2] === "--validate-output" && process.argv.length === 4) {
    const report = validateAclReport(JSON.parse(await aclReadStdin()),process.argv[3])
    if (JSON.stringify(report.bindings) !== JSON.stringify(bindings)) aclFail("SOURCE_CHANGED")
    process.stdout.write(JSON.stringify(report,null,2) + "\n")
  } else aclFail("INPUT_INVALID")
}

if (process.argv[1] && import.meta.url === aclPathToFileURL(process.argv[1]).href) {
  aclMain().catch(() => { console.error("HRM supplemental ACL output invalid; raw data withheld"); process.exitCode=1 })
}
