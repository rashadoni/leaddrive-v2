import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { FIELDS, assessSchemaContract } from "./workforce-reconciliation-schema-contract.mjs"
import { ENV_DETAILS } from "./hrm-migration-metadata-preflight.mjs"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const SHA = /^[0-9a-f]{40}$/
export const MAX_WIRE_BYTES = 8192
export const SOURCE_PATHS = Object.freeze([
  "scripts/hrm-migration-metadata-preflight.mjs",
  "scripts/workforce-reconciliation-schema-contract.sql",
  "scripts/workforce-reconciliation-schema-contract.mjs",
  "scripts/hrm-c12-operational-schema-inspection.mjs",
  "scripts/hrm-c12-operational-schema-inspection.test.mjs",
  ".github/workflows/hrm-c12-operational-schema-inspection.yml",
])
const DEPENDENCY_DIGESTS = Object.freeze([
  "46b417da7bbe763960b8ede8fa0e9dbd98543d090d54f73979289504bfe35771",
  "9bb45ba8cc38afdba046e3bd761875c043731203de8dab18bfdce420c8aab49f",
  "8ffa59f87d927a8afc463988ba30ab6a9ec3f1a3ca253b5f9841fefddc1b0279",
])
export const LIMITS = Object.freeze([
  "Catalog prerequisites only; does not replace or reclassify the existing migration metadata gate",
  "No restored historical baseline, authenticated HR, business rows or operational acceptance",
  "No production files, grants, roles, activation, migrations, backfills or personnel decisions changed",
  "Even matching all thirteen booleans does not complete C12 or authorize activation",
])
const CODES = new Set([
  "INPUT_INVALID", "FILES_UNSAFE", "SOURCE_CHANGED", "ENV_INVALID", "QUERY_FAILED",
  "OUTPUT_INVALID", "ARTIFACT_MISMATCH", "INSPECTION_FAILED", "TRANSPORT_FAILED",
  "TRANSPORT_OR_OUTPUT_INVALID", "MAIN_CHANGED", "PROTECTED_MAIN_REQUIRED", "EARLY_INSPECTION_NOT_COMPLETED",
])
const ENV_DETAIL_SET = new Set(ENV_DETAILS)
const SQL_STATES = new Set(["08001", "08003", "08004", "08006", "08P01", "22003", "22023", "25001", "25006", "28000", "28P01", "3D000", "42501", "42601", "42703", "42704", "42804", "42883", "42P01", "55P03", "57014", "XX000"])
const validSha = value => typeof value === "string" && SHA.test(value)
const fail = code => { throw new Error(code) }
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).every(key => typeof key === "string")
  && Object.keys(value).sort().join(",") === [...fields].sort().join(",")

/** The test seam supplies only a synthetic repository; the CLI always uses real Git/files. */
export function readTrustedSource(expectedSha, io = {}) {
  if (!validSha(expectedSha)) fail("INPUT_INVALID")
  const head = io.head ?? (() => execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 }).trim())
  const working = io.working ?? (path => {
    const file = resolve(ROOT, path)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 262_144) fail("SOURCE_CHANGED")
    return fs.readFileSync(file)
  })
  const committed = io.committed ?? ((path, sha) => execFileSync("git", ["show", `${sha}:${path}`], { cwd: ROOT, timeout: 10_000, maxBuffer: 262_144, stdio: ["ignore", "pipe", "pipe"] }))
  try {
    if (head() !== expectedSha) fail("SOURCE_CHANGED")
    const bytes = SOURCE_PATHS.map((path, index) => {
      const value = working(path)
      const original = committed(path, expectedSha)
      if (!Buffer.isBuffer(value) || value.length < 1 || value.length > 262_144
        || !Buffer.isBuffer(original) || !value.equals(original)
        || (index < DEPENDENCY_DIGESTS.length && digest(value) !== DEPENDENCY_DIGESTS[index])) fail("SOURCE_CHANGED")
      return value
    })
    if (head() !== expectedSha) fail("SOURCE_CHANGED")
    return {
      sourceSha: expectedSha,
      bindings: SOURCE_PATHS.map((path, index) => ({ path, bytes: bytes[index].length, sha256: digest(bytes[index]) })),
      helper: bytes[0].toString("utf8"), sql: bytes[1].toString("utf8"),
    }
  } catch { fail("SOURCE_CHANGED") }
}

export function errorReport(expectedSha, code, bindings = [], sqlState = null, envDetail = null) {
  return {
    version: 1, status: "ERROR", expectedArtifactSha: validSha(expectedSha) ? expectedSha : null,
    productionArtifactShaBefore: null, productionArtifactShaAfter: null, bindings,
    failed: [], snapshot: null, productionObserved: false, historicalReplay: false,
    originalRemoteWire: null, code: CODES.has(code) ? code : "INSPECTION_FAILED",
    sqlState: code === "QUERY_FAILED" && SQL_STATES.has(sqlState) ? sqlState : null,
    envDetail: code === "ENV_INVALID" ? (ENV_DETAIL_SET.has(envDetail) ? envDetail : "UNCLASSIFIED_ENV_REJECTION") : null,
    limits: [...LIMITS],
  }
}

export function emitRemoteProgram(expectedSha, io) {
  const source = readTrustedSource(expectedSha, io)
  // Exact unchanged executor prefix: connection fields stay in child environment,
  // psql has fixed args, no inherited config, read-only defaults and finite errors.
  return source.helper + "\nconst C12_INSPECTION_SQL=" + JSON.stringify(source.sql)
    + ";\nconst C12_INSPECTION_SOURCE=" + JSON.stringify({ sourceSha: source.sourceSha, bindings: source.bindings })
    + ";\nconst C12_INSPECTION_FIELDS=" + JSON.stringify(FIELDS) + ";\n" + String.raw`
const c12Report = {
  version: 1, status: "ERROR", expectedArtifactSha: C12_INSPECTION_SOURCE.sourceSha,
  productionArtifactShaBefore: null, productionArtifactShaAfter: null,
  bindings: C12_INSPECTION_SOURCE.bindings, snapshot: null, code: "INSPECTION_FAILED", sqlState: null, envDetail: null,
};
try {
  if (process.env.EXPECTED_DEPLOYED_SHA !== C12_INSPECTION_SOURCE.sourceSha || process.getuid() !== 0) fail("INPUT_INVALID");
  const marker = "/opt/leaddrive-v2/.next/standalone/.deploy-sha";
  if (readRootFile(marker, 128).trim() !== C12_INSPECTION_SOURCE.sourceSha) fail("ARTIFACT_MISMATCH");
  c12Report.productionArtifactShaBefore = C12_INSPECTION_SOURCE.sourceSha;
  const connection = parseMigrationEnv(readRootFile("/etc/leaddrive/migration.env", 32_768, 0o600));
  const text = queryMetadata(connection, C12_INSPECTION_SQL);
  if (typeof text !== "string" || Buffer.byteLength(text) > 4096) fail("OUTPUT_INVALID");
  const snapshot = JSON.parse(text);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || Object.keys(snapshot).sort().join(",") !== [...C12_INSPECTION_FIELDS].sort().join(",")
    || C12_INSPECTION_FIELDS.some(field => typeof snapshot[field] !== "boolean")) fail("OUTPUT_INVALID");
  if (readRootFile(marker, 128).trim() !== C12_INSPECTION_SOURCE.sourceSha) fail("ARTIFACT_MISMATCH");
  c12Report.productionArtifactShaAfter = C12_INSPECTION_SOURCE.sourceSha;
  Object.assign(c12Report, { status: "READ_COMPLETE", snapshot, code: null });
} catch (error) {
  c12Report.code = CODES.has(error?.message) ? error.message : "INSPECTION_FAILED";
  c12Report.sqlState = c12Report.code === "QUERY_FAILED" && SQL_STATES.has(error?.sqlState) ? error.sqlState : null;
  c12Report.envDetail = c12Report.code === "ENV_INVALID" ? (isDetailedEnvError(error) ? error.envDetail : "UNCLASSIFIED_ENV_REJECTION") : null;
}
console.log(JSON.stringify(c12Report));
if (c12Report.status !== "READ_COMPLETE") process.exitCode = 1;
`
}

export function validateRemoteOutput(text, expectedSha, transportExit, io) {
  let source
  try {
    source = readTrustedSource(expectedSha, io)
    if (!Number.isInteger(transportExit) || transportExit < 0 || transportExit > 255) fail("INPUT_INVALID")
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_WIRE_BYTES) fail("OUTPUT_INVALID")
    const value = JSON.parse(text)
    // The emitter writes canonical JSON. Reject duplicates, appended output and
    // alternate representations before any remote value reaches a runner file.
    if (JSON.stringify(value) !== text.trim()
      || !exact(value, ["version", "status", "expectedArtifactSha", "productionArtifactShaBefore", "productionArtifactShaAfter", "bindings", "snapshot", "code", "sqlState", "envDetail"])
      || value.version !== 1 || value.expectedArtifactSha !== expectedSha
      || JSON.stringify(value.bindings) !== JSON.stringify(source.bindings)) fail("OUTPUT_INVALID")
    if (value.status === "ERROR") {
      if (!CODES.has(value.code) || value.snapshot !== null
        || ![null, expectedSha].includes(value.productionArtifactShaBefore)
        || value.productionArtifactShaAfter !== null
        || !(value.sqlState === null || value.code === "QUERY_FAILED" && SQL_STATES.has(value.sqlState))
        || (value.code === "ENV_INVALID" ? !ENV_DETAIL_SET.has(value.envDetail) : value.envDetail !== null)
        || transportExit === 0) fail("OUTPUT_INVALID")
      return { ...errorReport(expectedSha, value.code, source.bindings, value.sqlState, value.envDetail),
        productionArtifactShaBefore: value.productionArtifactShaBefore, originalRemoteWire: text }
    }
    if (value.status !== "READ_COMPLETE" || value.code !== null || value.sqlState !== null || value.envDetail !== null
      || value.productionArtifactShaBefore !== expectedSha || value.productionArtifactShaAfter !== expectedSha) fail("OUTPUT_INVALID")
    const assessment = assessSchemaContract(value.snapshot)
    if (transportExit !== 0) return { ...errorReport(expectedSha, "TRANSPORT_FAILED", source.bindings),
      productionArtifactShaBefore: expectedSha, productionArtifactShaAfter: expectedSha, originalRemoteWire: text }
    return {
      version: 1, ...assessment, expectedArtifactSha: expectedSha,
      productionArtifactShaBefore: expectedSha, productionArtifactShaAfter: expectedSha,
      bindings: source.bindings, productionObserved: true, historicalReplay: false,
      originalRemoteWire: text, code: null, sqlState: null, envDetail: null, limits: [...LIMITS],
    }
  } catch (error) {
    const code = error?.message === "SOURCE_CHANGED" || error?.message === "INPUT_INVALID" ? error.message : "TRANSPORT_OR_OUTPUT_INVALID"
    return errorReport(expectedSha, code, source?.bindings ?? [])
  }
}

async function boundedStdin() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_WIRE_BYTES) fail("OUTPUT_INVALID")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let expectedSha = process.argv[3]
  try {
    if (process.argv[2] === "--emit-remote" && process.argv.length === 4) {
      process.stdout.write(emitRemoteProgram(expectedSha))
    } else if (process.argv[2] === "--validate-output" && process.argv.length === 5
      && /^(?:0|[1-9][0-9]{0,2})$/.test(process.argv[4]) && Number(process.argv[4]) <= 255) {
      const report = validateRemoteOutput(await boundedStdin(), expectedSha, Number(process.argv[4]))
      console.log(JSON.stringify(report, null, 2))
      if (report.status !== "MATCHED_CATALOG_CONTRACT_ONLY") process.exitCode = 1
    } else if (process.argv[2] === "--error" && process.argv.length === 5 && CODES.has(process.argv[4])) {
      console.log(JSON.stringify(errorReport(expectedSha, process.argv[4]), null, 2))
      process.exitCode = 1
    } else fail("INPUT_INVALID")
  } catch (error) {
    console.log(JSON.stringify(errorReport(expectedSha, CODES.has(error?.message) ? error.message : "INSPECTION_FAILED"), null, 2))
    process.exitCode = 1
  }
}
