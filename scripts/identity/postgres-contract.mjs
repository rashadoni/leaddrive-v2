#!/usr/bin/env node
/** Hosted ephemeral PostgreSQL contract. Never accepts a production connection. */
import { readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { collectIdentitySnapshot } from "./snapshot.mjs"
import { auditIdentitySnapshot } from "./preflight.mjs"

const DATABASE = "identity_snapshot_contract_test"
const EXPECTED_SCOPE = { organizationId: "identity-company-a", organizationSlug: "identity-company-a" }
const PHONE = "+994550001122"
const invariant = value => { if (!value) throw new Error("CONTRACT_ASSERTION") }

export function admitContractTarget(raw, ci) {
  if (ci !== "true" || typeof raw !== "string") throw new Error("CONTRACT_TARGET_REFUSED")
  let url
  try { url = new URL(raw) } catch { throw new Error("CONTRACT_TARGET_REFUSED") }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !/^\d+$/.test(url.port)
    || url.pathname !== `/${DATABASE}` || url.username !== "postgres" || url.search || url.hash) {
    throw new Error("CONTRACT_TARGET_REFUSED")
  }
  return url
}

async function run() {
  let phase = "ADMISSION", admin, reader
  const receipt = { status: "FAIL", sourceSha: null, productionObserved: false, checks: [] }
  try {
    const url = admitContractTarget(process.env.IDENTITY_CONTRACT_DATABASE_URL, process.env.CI)
    const expected = process.env.IDENTITY_CONTRACT_HEAD_SHA
    invariant(typeof expected === "string" && /^[0-9a-f]{40}$/.test(expected))
    invariant(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === expected)
    receipt.sourceSha = expected
    const { PrismaClient } = await import("@prisma/client")
    admin = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] })
    phase = "EMPTY_EPHEMERAL_DATABASE"
    const [empty] = await admin.$queryRawUnsafe(`SELECT current_database() AS name,
      to_regclass('public.organizations')::text AS organizations,
      to_regclass('public.users')::text AS users, to_regclass('public.mtm_agents')::text AS agents`)
    invariant(empty.name === DATABASE && empty.organizations === null && empty.users === null && empty.agents === null)
    // Fixed, disposable service-only fixture. Deliberately no DROP/reset or URL fallback.
    const statements = JSON.parse(await readFile(new URL("./postgres-fixture.json", import.meta.url), "utf8"))
    for (const sql of statements) await admin.$executeRawUnsafe(sql)
    const readerUrl = new URL(url)
    readerUrl.username = "identity_snapshot_reader"
    readerUrl.password = "identity-contract-reader-only"
    reader = new PrismaClient({ datasources: { db: { url: readerUrl.href } }, log: [] })

    phase = "REAL_PRISMA_EXPORT"
    const snapshot = await collectIdentitySnapshot(reader, EXPECTED_SCOPE)
    invariant(snapshot.users.length === 2 && snapshot.agents.length === 2)
    invariant(snapshot.users.every(row => row.organizationId === EXPECTED_SCOPE.organizationId))
    invariant(snapshot.agents.every(row => row.organizationId === EXPECTED_SCOPE.organizationId))
    invariant(snapshot.users[0].hasCredential === false && snapshot.agents[0].hasCredential === true)
    invariant(!JSON.stringify(snapshot).includes("$2b$"))
    receipt.checks.push("real_prisma_scoped_snapshot_and_credential_projection")

    phase = "RLS_WITHOUT_CONTEXT"
    const noContext = await reader.$queryRawUnsafe("SELECT id FROM users")
    invariant(noContext.length === 0)
    await reader.$transaction(async tx => {
      await tx.$queryRawUnsafe("SELECT set_config('app.org_id', $1, true)", EXPECTED_SCOPE.organizationId)
      const foreign = await tx.$queryRawUnsafe("SELECT id FROM users WHERE \"organizationId\" = $1", "identity-company-b")
      invariant(foreign.length === 0)
    })
    receipt.checks.push("rls_denies_missing_and_foreign_tenant_context")

    phase = "SCOPE_MISMATCH"
    let mismatchRejected = false
    try { await collectIdentitySnapshot(reader, { ...EXPECTED_SCOPE, organizationSlug: "identity-company-b" }) }
    catch { mismatchRejected = true }
    invariant(mismatchRejected)
    receipt.checks.push("mismatched_tenant_id_and_slug_refused")

    phase = "READ_ONLY_DATABASE_ENFORCEMENT"
    let readonlyRejected = false
    const writeProbe = {
      $transaction: (callback, options) => admin.$transaction(async tx => callback({
        $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx),
        $queryRawUnsafe: async (sql, ...args) => {
          if (sql.includes("FROM users")) {
            await tx.$executeRawUnsafe("UPDATE users SET phone = phone WHERE id = $1", "identity-user-a")
          }
          return tx.$queryRawUnsafe(sql, ...args)
        },
      }), options),
    }
    try { await collectIdentitySnapshot(writeProbe, EXPECTED_SCOPE) }
    catch (error) { readonlyRejected = error?.meta?.code === "25006" }
    invariant(readonlyRejected)
    receipt.checks.push("postgres_read_only_refuses_write_even_for_fixture_owner")

    phase = "REPEATABLE_READ_DURING_CONCURRENT_CHANGE"
    let changed = false
    const concurrent = {
      $transaction: (callback, options) => reader.$transaction(async tx => callback({
        $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx),
        $queryRawUnsafe: async (sql, ...args) => {
          const result = await tx.$queryRawUnsafe(sql, ...args)
          if (sql.includes("FROM users") && !changed) {
            await admin.$transaction([
              admin.$executeRawUnsafe("UPDATE users SET phone = $1 WHERE id = $2", "+994550009999", "identity-user-a"),
              admin.$executeRawUnsafe("UPDATE mtm_agents SET phone = $1 WHERE id = $2", "+994550009999", "identity-agent-a"),
            ])
            changed = true
          }
          return result
        },
      }), options),
    }
    const stable = await collectIdentitySnapshot(concurrent, EXPECTED_SCOPE)
    invariant(changed && stable.users[0].phone === PHONE && stable.agents[0].phone === PHONE)
    const fresh = await collectIdentitySnapshot(reader, EXPECTED_SCOPE)
    invariant(fresh.users[0].phone === "+994550009999" && fresh.agents[0].phone === "+994550009999")
    receipt.checks.push("consistent_snapshot_across_concurrent_commit")

    phase = "REPORTED_PHONE_REGRESSION"
    await admin.$executeRawUnsafe("UPDATE users SET phone = $1 WHERE id = $2", "+994550008888", "identity-user-a")
    await admin.$executeRawUnsafe("UPDATE users SET phone = $1 WHERE id = $2", "+994550009999", "identity-user-a2")
    const conflict = auditIdentitySnapshot(await collectIdentitySnapshot(reader, EXPECTED_SCOPE))
    invariant(conflict.issues.some(issue => issue.code === "LINKED_PHONE_DISAGREEMENT"))
    invariant(conflict.issues.some(issue => issue.code === "PHONE_CLAIM_CONFLICT"))
    receipt.checks.push("crm_only_phone_change_keeps_old_actor_claim_detectable")
    receipt.status = "PASS"
  } catch {
    // Only fixed phase names reach CI. Never emit a raw database error/URL/query.
    receipt.failedPhase = phase
    process.exitCode = 1
  } finally {
    await reader?.$disconnect().catch(() => {})
    await admin?.$disconnect().catch(() => {})
    const output = `${JSON.stringify(receipt)}\n`
    if (process.env.IDENTITY_CONTRACT_RECEIPT) {
      await writeFile(process.env.IDENTITY_CONTRACT_RECEIPT, output, { flag: "wx", mode: 0o600 })
    }
    process.stdout.write(output)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { process.stderr.write("IDENTITY_CONTRACT_RECEIPT_FAILED\n"); process.exitCode = 1 })
}
