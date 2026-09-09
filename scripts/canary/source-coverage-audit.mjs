// Canary "source-coverage-audit" (read-only).
//
// Owner question: "did the scrape ACTUALLY run over every source I added, so a
// client's news on those pages can't be missed silently?" This step answers it
// per source: collection freshness, last-48h collector/provider runs, route
// plans, ingest outcomes, and a blunt verdict per source:
//   OK        successful collection within the last 24h
//   STALE     active but no successful run in 24h (watchdog territory)
//   FAILING   latest runs are failed/partial (with the error class)
//   NO_PATH   active but NO adapter can serve it (e.g. FB/IG keyword sources —
//             Bright Data FB/IG datasets are URL-based, keyword search has no
//             provider); these sources silently collect NOTHING
//   INACTIVE  paused/disabled/needs_setup — collected on purpose: never
//
// Also prints the built-in watchdog state (aiAlert social_coverage_rule rows,
// last 24h) and the spike-notification recipient count, so the notification
// path is verifiable too. NO WRITES. Counts/ids/statuses only — no content.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const H24 = 24 * 3600 * 1000
const H48 = 48 * 3600 * 1000
const NOW = Date.now()

const short = (id) => (id ? id.slice(-8) : "-")
const ago = (d) => {
  if (!d) return "never"
  const min = Math.round((NOW - new Date(d).getTime()) / 60000)
  if (min < 60) return `${min}m ago`
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`
  return `${Math.round(min / 1440)}d ago`
}
const trunc = (s, n = 140) => {
  const v = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""
  return v.length > n ? `${v.slice(0, n)}…` : v
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, slug: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const since48 = new Date(NOW - H48)

  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id },
    select: {
      id: true, platform: true, sourceType: true, status: true, ownership: true,
      collectionMode: true, cadenceMinutes: true, url: true, handle: true, query: true,
      keywords: true, lastCheckedAt: true, lastSuccessfulAt: true, lastError: true,
    },
    orderBy: [{ platform: "asc" }, { sourceType: "asc" }, { createdAt: "asc" }],
  })

  const [collectorRuns, providerRuns, plans, envelopes] = await Promise.all([
    prisma.collectorRun.findMany({
      where: { organizationId: org.id, startedAt: { gte: since48 } },
      select: { sourceId: true, startedAt: true, status: true, foundCount: true, newCount: true, error: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.socialProviderRun.findMany({
      where: { organizationId: org.id, createdAt: { gte: since48 } },
      select: { sourceId: true, providerKey: true, phase: true, status: true, receivedCount: true, acceptedCount: true, lastError: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sourceRoutePlan.findMany({
      where: { organizationId: org.id },
      select: { sourceId: true, capability: true, primaryAdapter: true, status: true },
    }),
    prisma.ingestEnvelope.groupBy({
      by: ["sourceId", "relevanceStatus"],
      where: { organizationId: org.id, createdAt: { gte: since48 } },
      _count: { _all: true },
    }),
  ])

  const bySource = (rows) => {
    const map = new Map()
    for (const r of rows) {
      const list = map.get(r.sourceId) ?? []
      list.push(r)
      map.set(r.sourceId, list)
    }
    return map
  }
  const crBySource = bySource(collectorRuns)
  const prBySource = bySource(providerRuns)
  const planBySource = bySource(plans)
  const envBySource = new Map()
  for (const e of envelopes) {
    const m = envBySource.get(e.sourceId) ?? {}
    m[e.relevanceStatus] = (m[e.relevanceStatus] ?? 0) + e._count._all
    envBySource.set(e.sourceId, m)
  }

  const ACTIVE = new Set(["active", "limited"])
  const verdicts = new Map()
  const problems = []

  console.log(`[source-coverage-audit] tenant=${org.slug} sources=${sources.length} window=48h now=${new Date(NOW).toISOString()}`)
  let currentPlatform = ""
  for (const s of sources) {
    if (s.platform !== currentPlatform) {
      currentPlatform = s.platform
      console.log(`\n=== ${currentPlatform.toUpperCase()} ===`)
    }
    const target = s.url || s.handle || s.query || (s.keywords?.length ? `kw:[${s.keywords.slice(0, 3).join(",")}]` : "-")
    const myPlans = (planBySource.get(s.id) ?? []).filter(p => p.status !== "INVALIDATED")
    const myRuns = crBySource.get(s.id) ?? []
    const myProv = prBySource.get(s.id) ?? []
    const env = envBySource.get(s.id) ?? {}
    const lastSuccessMs = s.lastSuccessfulAt ? new Date(s.lastSuccessfulAt).getTime() : 0
    const latest3 = myRuns.slice(0, 3)

    let verdict
    if (!ACTIVE.has(s.status)) {
      verdict = "INACTIVE"
    } else if (myPlans.length === 0) {
      verdict = "NO_PATH"
    } else if (latest3.length >= 2 && latest3.every(r => r.status === "failed" || r.status === "partial")) {
      verdict = "FAILING"
    } else if (lastSuccessMs >= NOW - H24) {
      verdict = "OK"
    } else {
      verdict = "STALE"
    }
    verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1)
    if (verdict !== "OK" && verdict !== "INACTIVE") {
      problems.push({ id: s.id, platform: s.platform, sourceType: s.sourceType, target, verdict, lastError: s.lastError })
    }

    const runAgg = myRuns.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
    const provAgg = myProv.reduce((acc, r) => { acc[`${r.phase}:${r.status}`] = (acc[`${r.phase}:${r.status}`] ?? 0) + 1; return acc }, {})
    const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(" ") || "-"
    const latest = myRuns[0]

    console.log(`\n[${verdict}] ${short(s.id)} ${s.sourceType} ${s.status} ${s.ownership} "${trunc(target, 70)}" cadence=${s.cadenceMinutes}m`)
    console.log(`  lastSuccess=${ago(s.lastSuccessfulAt)} lastChecked=${ago(s.lastCheckedAt)} plans=[${myPlans.map(p => `${p.capability}>${p.primaryAdapter}`).join(", ") || "NONE"}]`)
    console.log(`  runs48h: ${fmt(runAgg)}${latest ? ` | latest ${ago(latest.startedAt)} ${latest.status} found=${latest.foundCount} new=${latest.newCount}` : ""}`)
    if (myProv.length) console.log(`  provider48h: ${fmt(provAgg)} recv=${myProv.reduce((a, r) => a + r.receivedCount, 0)} acc=${myProv.reduce((a, r) => a + r.acceptedCount, 0)}`)
    const envLine = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ")
    if (envLine) console.log(`  ingest48h: ${envLine}`)
    if (s.lastError && verdict !== "OK") console.log(`  lastError: ${trunc(s.lastError)}`)
    const provErr = myProv.find(r => r.lastError)
    if (provErr && verdict !== "OK") console.log(`  providerError: [${provErr.phase}] ${trunc(provErr.lastError)}`)
  }

  // --- Built-in watchdog + notification path ---
  const alerts = await prisma.aiAlert.findMany({
    where: { organizationId: org.id, type: "social_coverage_rule", createdAt: { gte: new Date(NOW - H24) } },
    select: { severity: true, message: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  })
  console.log(`\n=== WATCHDOG (aiAlert social_coverage_rule, 24h): ${alerts.length} ===`)
  for (const a of alerts) {
    const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {}
    console.log(`  ${a.severity.padEnd(8)} ${ago(a.createdAt).padEnd(8)} src=${short(meta.sourceId)} ${trunc(a.message, 110)}`)
  }
  const admins = await prisma.user.count({ where: { organizationId: org.id, role: { in: ["admin", "manager"] }, isActive: true } })
  console.log(`  spike/coverage notification recipients (active admin|manager): ${admins}`)

  // --- Verdict summary ---
  console.log(`\n=== SUMMARY ===`)
  for (const [v, n] of [...verdicts.entries()].sort()) console.log(`  ${v.padEnd(8)} ${n}`)
  if (problems.length) {
    console.log(`  !! PROBLEM SOURCES (${problems.length}):`)
    for (const p of problems) console.log(`     ${p.verdict.padEnd(8)} ${p.platform}/${p.sourceType} ${short(p.id)} "${trunc(p.target, 60)}"${p.lastError ? ` err: ${trunc(p.lastError, 90)}` : ""}`)
  } else {
    console.log(`  no active source is stale, failing, or path-less`)
  }
}

main()
  .catch((err) => { console.error("[source-coverage-audit] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
