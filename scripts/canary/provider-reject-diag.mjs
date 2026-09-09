// Canary "provider-reject-diag" (read-only).
//
// Owner follow-up: several FB pages and most IG profiles return 1-4 rows with
// zero accepted. The schema-drift failure codes are persisted per provider run
// (inputSnapshot.driftWarnings, #479) — dump them per source so we can tell
// dead_page/URL-variant problems (fixable by editing the source URL) apart
// from provider-side yield gaps. NO WRITES; ids/codes/counts only.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const H24 = 24 * 3600 * 1000

const short = (id) => (id ? id.slice(-8) : "-")

function warningsOf(run) {
  const snap = run.inputSnapshot && typeof run.inputSnapshot === "object" ? run.inputSnapshot : {}
  const list = Array.isArray(snap.driftWarnings) ? snap.driftWarnings : []
  return list.map(String)
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: org.id,
      providerKey: "bright-data",
      createdAt: { gte: new Date(Date.now() - H24) },
      OR: [
        { receivedCount: { gt: 0 }, acceptedCount: 0 },
        { status: { in: ["PARTIAL", "FAILED"] } },
      ],
    },
    select: {
      id: true, sourceId: true, phase: true, status: true,
      receivedCount: true, acceptedCount: true, lastError: true,
      inputSnapshot: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  const sourceIds = [...new Set(runs.map(r => r.sourceId))]
  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id, id: { in: sourceIds } },
    select: { id: true, platform: true, sourceType: true, url: true, handle: true },
  })
  const srcById = new Map(sources.map(s => [s.id, s]))

  console.log(`[provider-reject-diag] tenant=${SLUG} runs(24h, rejected/partial/failed)=${runs.length}`)

  // Group per source: aggregate warning codes across its runs.
  const bySource = new Map()
  for (const run of runs) {
    const list = bySource.get(run.sourceId) ?? []
    list.push(run)
    bySource.set(run.sourceId, list)
  }
  for (const [sourceId, list] of bySource) {
    const s = srcById.get(sourceId)
    const target = s?.url || s?.handle || "?"
    const codes = {}
    for (const run of list) for (const w of warningsOf(run)) codes[w] = (codes[w] ?? 0) + 1
    console.log(`\n${s?.platform ?? "?"}/${s?.sourceType ?? "?"} ${short(sourceId)} "${target}"`)
    for (const run of list.slice(0, 4)) {
      console.log(`  ${run.createdAt.toISOString().slice(11, 16)} ${run.phase} ${run.status} recv=${run.receivedCount} acc=${run.acceptedCount}${run.lastError ? ` err=${run.lastError}` : ""}`)
    }
    const codeLines = Object.entries(codes).sort((a, b) => b[1] - a[1])
    if (codeLines.length) {
      for (const [code, n] of codeLines) console.log(`    drift: ${code} x${n}`)
    } else {
      console.log(`    (no persisted drift warnings)`)
    }
  }
}

main()
  .catch((err) => { console.error("[provider-reject-diag] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
