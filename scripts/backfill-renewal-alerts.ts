/**
 * One-time backfill: schedule renewal alerts for all existing contracts
 * that have an endDate set but no contractRenewalAlert records yet.
 *
 * Run on the server:
 *   npx tsx scripts/backfill-renewal-alerts.ts
 *
 * Safe to re-run — upsertRenewalAlerts is idempotent.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { upsertRenewalAlerts } from "../src/lib/contract-lifecycle/upsert-renewal-alerts"
import { runWithRlsBypass } from "../src/lib/rls-context"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const now = new Date()
  console.log(`[backfill] Starting at ${now.toISOString()}`)

  const contracts = await prisma.contract.findMany({
    where: { endDate: { not: null } },
    select: { id: true, organizationId: true, endDate: true, contractNumber: true },
  })

  console.log(`[backfill] Found ${contracts.length} contracts with endDate`)

  let ok = 0
  let skipped = 0
  let errors = 0

  for (const c of contracts) {
    try {
      const result = await upsertRenewalAlerts(c.organizationId, c.id, c.endDate, now)
      if (result.upserted > 0 || result.superseded > 0) {
        console.log(
          `[backfill] ${c.contractNumber} → upserted=${result.upserted} superseded=${result.superseded} skippedPastDue=${result.skippedPastDue}`,
        )
        ok++
      } else {
        skipped++
      }
    } catch (err) {
      console.error(`[backfill] ERROR for contract ${c.contractNumber} (${c.id}):`, err)
      errors++
    }
  }

  console.log(`[backfill] Done — ok=${ok} skipped=${skipped} errors=${errors}`)
}

// upsertRenewalAlerts (src lib) queries the ALS-extended app singleton — wrap the
// whole run in bypass context so those queries don't fail closed under RLS.
runWithRlsBypass(() => main())
  .catch(console.error)
  .finally(() => prisma.$disconnect())
