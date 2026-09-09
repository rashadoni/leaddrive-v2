// Canary "scenario-bd-coverage" (read-only).
//
// Owner question: "did every scenario's keywords actually reach Bright Data?"
// Reality: only TikTok keyword/hashtag terms dispatch to Bright Data (YouTube
// keywords -> Google API, Web keywords -> Apify). So this proves the BD
// integration per keyword: for each term-search source it shows platform,
// status, and whether a Bright Data provider run (externalRunId) exists —
// which is the provider-side proof the keyword reached BD. NO WRITES; no
// content, no tokens — ids/counts/queries only.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const short = (id) => (id ? id.slice(-8) : "-")

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  // All term-search sources (keyword/hashtag) — the ones a scenario's words create.
  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id, sourceType: { in: ["keyword", "hashtag"] } },
    select: { id: true, platform: true, sourceType: true, status: true, handle: true, query: true },
    orderBy: [{ platform: "asc" }, { status: "asc" }],
  })

  // Which of them ever dispatched to Bright Data (externalRunId = provider snapshot).
  const bdRuns = await prisma.socialProviderRun.groupBy({
    by: ["sourceId"],
    where: { organizationId: org.id, providerKey: "bright-data", externalRunId: { not: null } },
    _count: { _all: true },
    _max: { createdAt: true },
  })
  const bdBySource = new Map(bdRuns.map(r => [r.sourceId, { count: r._count._all, last: r._max.createdAt }]))

  const byPlatform = new Map()
  for (const s of sources) {
    const p = byPlatform.get(s.platform) ?? { total: 0, active: 0, reachedBd: 0, rows: [] }
    p.total += 1
    if (s.status === "active" || s.status === "limited") p.active += 1
    if (bdBySource.has(s.id)) p.reachedBd += 1
    p.rows.push(s)
    byPlatform.set(s.platform, p)
  }

  console.log(`[scenario-bd-coverage] tenant=${SLUG} term-search sources=${sources.length}`)
  for (const [platform, p] of [...byPlatform.entries()].sort()) {
    const bdNote = platform === "tiktok"
      ? `reachedBrightData=${p.reachedBd}/${p.total}`
      : platform === "facebook" || platform === "instagram"
        ? "(FB/IG: keyword search has NO provider path — never reaches BD)"
        : platform === "youtube"
          ? "(routes to YouTube Data API, not Bright Data)"
          : platform === "web"
            ? "(routes to Apify, not Bright Data)"
            : "(non-BD route)"
    console.log(`\n=== ${platform.toUpperCase()}: ${p.total} term sources (active=${p.active}) ${bdNote} ===`)
    for (const s of p.rows) {
      const q = s.handle || s.query || "-"
      const bd = bdBySource.get(s.id)
      const bdStr = bd ? `BD-runs=${bd.count} last=${bd.last?.toISOString().slice(5, 16)}` : (platform === "tiktok" ? "BD-runs=0 (never dispatched)" : "")
      console.log(`  ${short(s.id)} ${s.sourceType} ${s.status.padEnd(8)} "${q}" ${bdStr}`)
    }
  }

  // Focused verdict for the only BD platform.
  const tt = byPlatform.get("tiktok") ?? { total: 0, active: 0, reachedBd: 0 }
  console.log(`\n=== BRIGHT DATA VERDICT (TikTok is the only BD keyword platform) ===`)
  console.log(`  TikTok term sources: ${tt.total} | active: ${tt.active} | reached Bright Data at least once: ${tt.reachedBd}`)
  console.log(`  (YouTube/Web keywords intentionally route elsewhere; FB/IG keywords have no keyword path)`)
}

main()
  .catch((err) => { console.error("[scenario-bd-coverage] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
