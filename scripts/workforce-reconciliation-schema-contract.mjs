import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

export const MIGRATION = "prisma/migrations/20261005193000_workforce_reconciliation_operations/migration.sql"
export const MIGRATION_SHA256 = "c452e7f6d13dca1e5257d8353c252745d05cd4f18eae83cd45501f61664ef719"
export const FIELDS = Object.freeze([
  "readOnly", "repeatableRead", "postgres16", "ordinaryTable", "columnShape",
  "defaults", "primaryKey", "foreignKey", "checks", "rls", "policy", "indexes", "noUserTriggers",
])
const invalid = () => { throw new Error("C12_SCHEMA_OUTPUT_INVALID") }

/** Validate an identifier-free catalog projection; never repair unknown fields. */
export function assessSchemaContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some(key => typeof key !== "string") || keys.sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some(key => typeof descriptors[key]?.value !== "boolean")) invalid()
  const snapshot = Object.fromEntries(FIELDS.map(key => [key, descriptors[key].value]))
  const failed = FIELDS.filter(key => snapshot[key] !== true)
  return { status: failed.length ? "INCOMPLETE" : "MATCHED_CATALOG_CONTRACT_ONLY", failed, snapshot }
}

export function parseSchemaContract(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 4096) invalid()
  let value
  try { value = JSON.parse(text) } catch { invalid() }
  return assessSchemaContract(value)
}

export function sourceBindings() {
  const paths = [MIGRATION, "scripts/workforce-reconciliation-schema-contract.sql", "scripts/workforce-reconciliation-schema-contract.mjs",
    "scripts/workforce-reconciliation-schema-contract.test.mjs", ".github/workflows/workforce-reconciliation-schema-contract.yml"]
  const bindings = paths.map(path => {
    const bytes = readFileSync(new URL("../" + path, import.meta.url))
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  })
  if (bindings[0].sha256 !== MIGRATION_SHA256) throw new Error("C12_SCHEMA_SOURCE_CHANGED")
  return bindings
}

// This CLI validates stdin only. It never connects to a database or creates files.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) invalid()
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 4096) invalid()
      chunks.push(chunk)
    }
    const assessment = parseSchemaContract(Buffer.concat(chunks).toString("utf8"))
    console.log(JSON.stringify({ ...assessment, bindings: sourceBindings(), productionObserved: false, historicalReplay: false }))
    if (assessment.status === "INCOMPLETE") process.exitCode = 1
  } catch {
    console.log(JSON.stringify({ status: "ERROR", code: "C12_SCHEMA_OUTPUT_INVALID" }))
    process.exitCode = 1
  }
}
