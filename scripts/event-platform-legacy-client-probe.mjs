#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const modulePath = process.env.LEGACY_PRISMA_CLIENT_MODULE
const runtimeUrl = process.env.LEGACY_RUNTIME_DATABASE_URL
const verifyUrl = process.env.LEGACY_VERIFY_DATABASE_URL
if (!modulePath || !runtimeUrl || !verifyUrl) {
  throw new Error(
    "LEGACY_PRISMA_CLIENT_MODULE, LEGACY_RUNTIME_DATABASE_URL and LEGACY_VERIFY_DATABASE_URL are required",
  )
}

const require = createRequire(import.meta.url)

// Loading the wrapper and proving it against the migrated schema are two
// different failures, and the caller turns any non-zero exit into "the exact
// previous Prisma client is incompatible with the migrated Fund schema". A
// staging bug therefore reads as a schema verdict — on 2026-09-07 that cost
// hours with production down, because `@prisma/client` internally requires
// the bare specifier `.prisma/client/default`, which Node resolves only
// through ancestor directories literally named `node_modules`. Say which of
// the two actually happened.
let legacyClientModule
try {
  legacyClientModule = require(resolve(modulePath))
} catch (error) {
  const detail = error && typeof error === "object" && "message" in error ? error.message : String(error)
  const unresolved = typeof detail === "string" && detail.includes(".prisma/client")
  throw new Error(
    unresolved
      ? `previous Prisma client could not be LOADED (not a schema mismatch): the generated client next to ${modulePath} is not resolvable — its parent directory must be named "node_modules". Original error: ${detail}`
      : `previous Prisma client could not be LOADED (not a schema mismatch) from ${modulePath}: ${detail}`,
  )
}

const LegacyPrismaClient = legacyClientModule.PrismaClient
if (typeof LegacyPrismaClient !== "function") {
  throw new Error(`previous artifact does not export PrismaClient: ${modulePath}`)
}

const runtime = new LegacyPrismaClient({ datasources: { db: { url: runtimeUrl } } })
const verifier = new LegacyPrismaClient({ datasources: { db: { url: verifyUrl } } })
const suffix = randomUUID()
const organizationId = `legacy-probe-${suffix}`
const fundId = `legacy-fund-${suffix}`
const deleteFundId = `legacy-delete-${suffix}`
let reachedDeleteFence = false
let rejectionText = ""

async function flushDeferredCoherence(tx) {
  // A compatibility trigger may update the head before inserting its event
  // and outbox through later SPI statements. Flush only after the complete
  // legacy Prisma operation, then defer again for the next operation.
  await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`)
  await tx.$executeRawUnsafe(`SET CONSTRAINTS ALL DEFERRED`)
}

try {
  try {
    await runtime.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, organizationId)
      const organizationColumns = await tx.$queryRawUnsafe(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'organizations'
           AND column_name IN ('slug', 'updatedAt')
      `)
      const organizationColumnNames = new Set(
        organizationColumns.map((column) => column.column_name),
      )
      if (organizationColumnNames.has("slug") && organizationColumnNames.has("updatedAt")) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          organizationId,
          "Legacy compatibility probe",
          organizationId,
        )
      } else if (organizationColumnNames.has("slug")) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "organizations" ("id", "name", "slug") VALUES ($1, $2, $3)`,
          organizationId,
          "Legacy compatibility probe",
          organizationId,
        )
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO "organizations" ("id", "name") VALUES ($1, $2)`,
          organizationId,
          "Legacy compatibility probe",
        )
      }

      const created = await tx.fund.create({
        data: {
          id: fundId,
          organizationId,
          name: "Legacy Float client",
          currency: "USD",
          targetAmount: 100.5,
          currentBalance: 0,
        },
      })
      if (typeof created.currentBalance !== "number" || typeof created.targetAmount !== "number") {
        throw new Error("previous client no longer decodes NUMERIC Fund money as its Float response surface")
      }
      await flushDeferredCoherence(tx)

      const ledger = await tx.fundTransaction.create({
        data: {
          id: `legacy-tx-${suffix}`,
          organizationId,
          fundId,
          type: "deposit",
          amount: 10.25,
          description: "pinned atomic expand route",
          relatedType: "manual",
        },
      })
      if (typeof ledger.amount !== "number" || ledger.amount !== 10.25) {
        throw new Error("previous client transaction amount response changed after NUMERIC migration")
      }
      const depositUpdate = await tx.fund.updateMany({
        where: { id: fundId, organizationId },
        data: { currentBalance: { increment: 10.25 } },
      })
      if (depositUpdate.count !== 1) throw new Error("pinned expand deposit did not update one Fund")
      await flushDeferredCoherence(tx)
      const afterDeposit = await tx.fund.findFirst({ where: { id: fundId, organizationId } })
      if (!afterDeposit || afterDeposit.currentBalance !== 10.25) {
        throw new Error(`pinned expand deposit path is not exactly-once: ${JSON.stringify(afterDeposit)}`)
      }

      await tx.fundTransaction.create({
        data: {
          id: `legacy-partial-withdraw-${suffix}`,
          organizationId,
          fundId,
          type: "withdrawal",
          amount: 6.25,
          description: "partial conditional withdrawal",
          relatedType: "manual",
        },
      })
      const partialUpdate = await tx.fund.updateMany({
        where: { id: fundId, organizationId, currentBalance: { gte: 6.25 } },
        data: { currentBalance: { increment: -6.25 } },
      })
      if (partialUpdate.count !== 1) throw new Error("pinned expand partial withdrawal was rejected")
      await flushDeferredCoherence(tx)
      const afterPartial = await tx.fund.findFirst({ where: { id: fundId, organizationId } })
      if (!afterPartial || afterPartial.currentBalance !== 4) {
        throw new Error(`pinned expand partial withdrawal diverged: ${JSON.stringify(afterPartial)}`)
      }

      await tx.fundTransaction.create({
        data: {
          id: `legacy-exact-withdraw-${suffix}`,
          organizationId,
          fundId,
          type: "withdrawal",
          amount: 4,
          description: "exact-balance conditional withdrawal",
          relatedType: "manual",
        },
      })
      const exactUpdate = await tx.fund.updateMany({
        where: { id: fundId, organizationId, currentBalance: { gte: 4 } },
        data: { currentBalance: { increment: -4 } },
      })
      if (exactUpdate.count !== 1) throw new Error("pinned expand exact-balance withdrawal was rejected")
      await flushDeferredCoherence(tx)
      const afterExact = await tx.fund.findFirst({ where: { id: fundId, organizationId } })
      if (!afterExact || afterExact.currentBalance !== 0) {
        throw new Error(`pinned expand exact withdrawal diverged: ${JSON.stringify(afterExact)}`)
      }

      const metadata = await tx.fund.update({
        where: { id: fundId },
        data: { name: "Legacy renamed", targetAmount: 200.75, currency: "USD" },
      })
      const serialized = JSON.parse(JSON.stringify({ data: metadata }))
      if (serialized.data.currentBalance !== 0 || serialized.data.targetAmount !== 200.75) {
        throw new Error(`previous response JSON changed after NUMERIC migration: ${JSON.stringify(serialized)}`)
      }
      await flushDeferredCoherence(tx)

      await tx.fund.create({
        data: {
          id: deleteFundId,
          organizationId,
          name: "Legacy delete must fail closed",
          currency: "USD",
        },
      })
      await flushDeferredCoherence(tx)
      const deleteCandidate = await tx.fund.findFirst({
        where: { id: deleteFundId, organizationId },
      })
      if (!deleteCandidate) throw new Error("previous delete pre-read did not find its Fund")

      reachedDeleteFence = true
      await tx.fund.delete({ where: { id: deleteFundId } })
    })
  } catch (error) {
    rejectionText = error instanceof Error ? error.message : String(error)
  }

  if (!reachedDeleteFence) {
    throw new Error(`previous client failed before the intentional delete fence: ${rejectionText}`)
  }
  if (!rejectionText.includes("fund hard delete is forbidden")) {
    throw new Error(`previous client did not hit the reviewed hard-delete fence: ${rejectionText}`)
  }

  const leftovers = await verifier.$queryRawUnsafe(
    `SELECT
       (SELECT count(*)::int FROM "organizations" WHERE "id" = $1) AS organizations,
       (SELECT count(*)::int FROM "funds" WHERE "organizationId" = $1) AS funds,
       (SELECT count(*)::int FROM "domain_events" WHERE "organizationId" = $1) AS events`,
    organizationId,
  )
  const state = leftovers[0]
  if (!state || state.organizations !== 0 || state.funds !== 0 || state.events !== 0) {
    throw new Error(`legacy-client probe transaction did not roll back cleanly: ${JSON.stringify(state)}`)
  }

  console.log("event-platform previous Prisma client compatibility: PASS")
} finally {
  await Promise.allSettled([runtime.$disconnect(), verifier.$disconnect()])
}
