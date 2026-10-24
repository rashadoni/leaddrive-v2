#!/usr/bin/env node
/** Explicitly scoped read-only export. Private data goes only to a new 0600 file. */
import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { auditIdentitySnapshot } from "./preflight.mjs"

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url))
const MAX_BYTES = 5 * 1024 * 1024
const fail = () => { throw new Error("IDENTITY_SNAPSHOT_EXPORT_REFUSED") }
const credentialPresent = String.raw`COALESCE("passwordHash" ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$', false) AS "hasCredential"`
const USERS = `SELECT id, "organizationId", phone, "isActive", ("anonymizedAt" IS NOT NULL) AS anonymized,
  ${credentialPresent} FROM users WHERE "organizationId" = $1 ORDER BY id COLLATE "C" LIMIT 10001`
const AGENTS = `SELECT id, "organizationId", "userId", phone, role::text, status::text, "attendanceParticipant",
  ${credentialPresent} FROM mtm_agents WHERE "organizationId" = $1 ORDER BY id COLLATE "C" LIMIT 10001`

function scopeValid(scope) {
  if (!scope || Object.keys(scope).sort().join(",") !== "organizationId,organizationSlug"
    || typeof scope.organizationId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(scope.organizationId)
    || typeof scope.organizationSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(scope.organizationSlug)) fail()
}

/** The injected client interface is Prisma's transaction API; tests never connect. */
export async function collectIdentitySnapshot(client, scope) {
  scopeValid(scope)
  return client.$transaction(async tx => {
    // PostgreSQL forbids subsequent data writes regardless of the connection role.
    // These are fixed statements; all user-supplied values below are bound parameters.
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'")
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'")
    await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout = '10s'")
    await tx.$queryRawUnsafe("SELECT set_config('app.org_id', $1, true), set_config('app.rls_bypass', 'off', true)", scope.organizationId)
    const mode = await tx.$queryRawUnsafe(`SELECT current_setting('transaction_read_only') AS "readOnly",
      current_setting('transaction_isolation') AS isolation, current_setting('app.org_id') AS "organizationId",
      current_setting('app.rls_bypass') AS bypass`)
    if (mode.length !== 1 || mode[0].readOnly !== "on" || mode[0].isolation !== "repeatable read"
      || mode[0].organizationId !== scope.organizationId || mode[0].bypass !== "off") fail()
    const organization = await tx.$queryRawUnsafe(
      "SELECT id, slug FROM organizations WHERE id = $1 AND slug = $2 LIMIT 2",
      scope.organizationId, scope.organizationSlug,
    )
    if (organization.length !== 1 || organization[0].id !== scope.organizationId || organization[0].slug !== scope.organizationSlug) fail()
    const users = await tx.$queryRawUnsafe(USERS, scope.organizationId)
    const agents = await tx.$queryRawUnsafe(AGENTS, scope.organizationId)
    if (users.some(row => row.organizationId !== scope.organizationId) || agents.some(row => row.organizationId !== scope.organizationId)) fail()
    const snapshot = { schemaVersion: 1, users, agents }
    // Validate exact fields, row bounds and enums before any private output is created.
    auditIdentitySnapshot(snapshot)
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_BYTES) fail()
    return snapshot
  }, { isolationLevel: "RepeatableRead", timeout: 15_000, maxWait: 5_000 })
}

function inside(root, path) {
  const part = relative(root, path)
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

/** Reject repository destinations, shared directories, symlinks and overwrite. */
export async function writePrivateSnapshot(path, snapshot) {
  if (!isAbsolute(path)) fail()
  auditIdentitySnapshot(snapshot)
  const bytes = `${JSON.stringify(snapshot)}\n`
  if (Buffer.byteLength(bytes) > MAX_BYTES) fail()
  const parent = await realpath(dirname(path))
  const repository = await realpath(REPOSITORY)
  const metadata = await stat(parent)
  if (inside(repository, parent) || !metadata.isDirectory() || (metadata.mode & 0o077) !== 0
    || metadata.uid !== process.getuid()) fail()
  // The canonical parent prevents a caller's symlink from switching destinations
  // after the safety check; this directory is owned and accessible only by this user.
  const target = resolve(parent, basename(path))
  const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    await file.writeFile(bytes, "utf8")
    await file.sync()
  } finally { await file.close() }
}

function options(argv) {
  if (argv.length !== 6 || argv[0] !== "--organization-id" || argv[2] !== "--organization-slug" || argv[4] !== "--output") fail()
  const scope = { organizationId: argv[1], organizationSlug: argv[3] }
  scopeValid(scope)
  if (!isAbsolute(argv[5])) fail()
  return { scope, output: argv[5] }
}

async function main() {
  const { scope, output } = options(process.argv.slice(2))
  const url = process.env.IDENTITY_AUDIT_DATABASE_URL
  if (!url || !["postgres:", "postgresql:"].includes(new URL(url).protocol)) fail()
  // No environment-file loading or fallback database route. The operator supplies
  // a deliberately selected connection through the established secret mechanism.
  const { PrismaClient } = await import("@prisma/client")
  const client = new PrismaClient({ datasources: { db: { url } }, log: [] })
  try {
    const snapshot = await collectIdentitySnapshot(client, scope)
    await writePrivateSnapshot(output, snapshot)
    process.stdout.write(`${JSON.stringify({ status: "EXPORTED", readOnly: true,
      users: snapshot.users.length, agents: snapshot.agents.length, migrationAuthorized: false })}\n`)
  } finally { await client.$disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print database exceptions, connection URLs, phone values or file paths.
    process.stderr.write("IDENTITY_SNAPSHOT_EXPORT_REFUSED\n")
    process.exitCode = 1
  })
}
