// Canary "release-stale-reservations" (one-off ledger repair, write step).
//
// Runs finished BEFORE the #473 reservation-release fix deployed keep their
// full per-run cap in reservedChargeUsd forever (Bright Data actuals settle
// via webhook; the reconcile cron only covers Apify). Today's sum of those
// idle holds exceeds the tenant's daily route budget, so every new automatic
// Bright Data run fails closed (paid_route_daily_budget_exhausted) until the
// UTC midnight reset even though real spend is cents.
//
// Repair applies the exact #473 semantics retroactively to TODAY's finished
// bright-data runs: step reservedChargeUsd down to the record-based estimate,
// never up (min(held, receivedCount x rate)). Rows with a settled actual are
// untouched. Idempotent; counts/ids only, no content, no secrets.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
// Conservative per-record ceiling: observed account rate is ~$2.3/1000 records;
// use $2.5/1000 so the retained estimate can only overstate, never understate.
const USD_PER_RECORD = 0.0025

function roundUsd(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))

  const rows = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: org.id,
      providerKey: "bright-data",
      createdAt: { gte: dayStart },
      status: { notIn: ["RUNNING", "QUEUED", "IMPORTING"] },
      reservedChargeUsd: { gt: 0 },
      actualChargeUsd: null,
    },
    select: { id: true, phase: true, status: true, receivedCount: true, reservedChargeUsd: true },
    orderBy: { createdAt: "asc" },
  })

  let before = 0
  let after = 0
  let repaired = 0
  for (const row of rows) {
    const held = Number(row.reservedChargeUsd) || 0
    const records = Math.max(0, Math.trunc(Number(row.receivedCount) || 0))
    const estimate = roundUsd(records * USD_PER_RECORD)
    const target = Math.min(held, estimate)
    before += held
    after += target
    if (target >= held) continue
    const update = await prisma.socialProviderRun.updateMany({
      where: { id: row.id, organizationId: org.id, actualChargeUsd: null, status: { notIn: ["RUNNING", "QUEUED", "IMPORTING"] } },
      data: { reservedChargeUsd: target },
    })
    if (update.count === 1) {
      repaired += 1
      console.log(`  ${row.id.slice(-8)} ${row.phase} ${row.status} recv=${records} $${held.toFixed(4)} -> $${target.toFixed(4)}`)
    }
  }
  console.log(`[release-stale-reservations] rows=${rows.length} repaired=${repaired} reservedSum $${before.toFixed(4)} -> $${after.toFixed(4)}`)
}

main()
  .catch((err) => { console.error("[release-stale-reservations] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
