// scripts/_rls.mjs
// RLS-aware Prisma factory for standalone scripts (own client, NOT src/lib/prisma).
// Pool SET state is per-connection → pin connection_limit=1 and set the bypass
// (or tenant) setting session-wide (is_local=false) once after connect.
// Classification: operator-run scripts are cross-tenant by default → bypass.
// Per-tenant seeds may pass { orgId } to scope writes instead.
import { PrismaClient } from "@prisma/client"

function sameDatabaseTarget(left, right) {
  return left.protocol === right.protocol
    && left.hostname === right.hostname
    && left.port === right.port
    && left.pathname === right.pathname
    && left.search === right.search
}

/**
 * `new PrismaClient({ … })` is typed by its options: the compiler infers a
 * client specific to that one object literal, and the first TypeScript caller
 * that hands it to a `PrismaClient` parameter makes it compare the two clients
 * model by model — about 150,000 types and over 100 MB of the type check's
 * heap, per construction. The scripts want the ordinary client, so say so. The
 * `any` in the middle is what stops the comparison from being made here.
 *
 * @param {import("@prisma/client").Prisma.PrismaClientOptions} options
 * @returns {PrismaClient}
 */
function newPrismaClient(options) {
  return /** @type {any} */ (new PrismaClient(options))
}

/**
 * An explicit database override is only available with a tenant scope; it must
 * never accidentally inherit the cross-tenant default used by maintenance scripts.
 * @param {{ orgId?: string, databaseUrl?: string }} [opts]
 */
export async function makeScriptPrisma({ orgId, databaseUrl } = {}) {
  if (databaseUrl !== undefined && (typeof orgId !== "string" || !orgId.trim())) {
    throw new Error("An explicit script database requires an organization scope")
  }
  const url = new URL(databaseUrl ?? process.env.DATABASE_URL)
  url.searchParams.set("connection_limit", "1")
  const prisma = newPrismaClient({ datasourceUrl: url.toString() })
  if (orgId) {
    await prisma.$executeRaw`SELECT set_config('app.org_id', ${orgId}, false)`
  } else {
    await prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`
  }
  return prisma
}

/**
 * Build an intentionally unscoped client for the disposable RLS integration
 * harness. The harness must connect as several roles before it can establish
 * tenant context, so the normal bypass/tenant bootstrap above would invalidate
 * the assertions it exists to exercise.
 *
 * The target is fenced to EVENT_PLATFORM_TEST_DATABASE_URL. Credentials may
 * differ because the harness derives app, migrator and operator role URLs, but
 * protocol, host, port and database name must remain identical.
 *
 * @param {string} databaseUrl
 */
export function makeRlsTestPrisma(databaseUrl) {
  const testDatabaseUrl = process.env.EVENT_PLATFORM_TEST_DATABASE_URL
  if (!testDatabaseUrl) {
    throw new Error("EVENT_PLATFORM_TEST_DATABASE_URL is required for an unscoped RLS test client")
  }

  const expected = new URL(testDatabaseUrl)
  const actual = new URL(databaseUrl)
  if (!sameDatabaseTarget(expected, actual)) {
    throw new Error("unscoped RLS test clients may only target EVENT_PLATFORM_TEST_DATABASE_URL")
  }

  return newPrismaClient({ datasourceUrl: actual.toString() })
}
