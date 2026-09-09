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

/** @param {{ orgId?: string }} [opts] */
export async function makeScriptPrisma({ orgId } = {}) {
  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.set("connection_limit", "1")
  const prisma = new PrismaClient({ datasourceUrl: url.toString() })
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

  return new PrismaClient({ datasourceUrl: actual.toString() })
}
