// Canary "evidence" step (runbook Step 5, read-only). Prints the day's paid
// pipeline evidence for brandprotection: provider runs (with error classes,
// e.g. auth failures if the reissued Bright Data token was not updated in
// .env), target-source collector runs, tiktok route-plan state, and today's
// tiktok mention/evidence counts. Counts/ids/status only — no comment text,
// authors, tokens or secrets.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const SRC = "cmrlscyhx0036506ruferpk9c"

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))

  // Provider runs today
  const runs = await prisma.socialProviderRun.findMany({
    where: { organizationId: org.id, createdAt: { gte: dayStart } },
    select: {
      providerKey: true, phase: true, status: true, sourceId: true,
      receivedCount: true, acceptedCount: true, reviewCount: true, rejectedCount: true, duplicateCount: true,
      reservedChargeUsd: true, actualChargeUsd: true, lastError: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })
  console.log(`--- SocialProviderRuns today (UTC): ${runs.length} ---`)
  for (const r of runs) {
    console.log(
      `  ${r.createdAt.toISOString().slice(11, 19)} ${r.providerKey.padEnd(12)} ${r.phase.padEnd(32)} ${String(r.status).padEnd(9)}` +
      ` src=${r.sourceId === SRC ? "TARGET" : r.sourceId.slice(0, 8)}` +
      ` recv=${r.receivedCount} acc=${r.acceptedCount} rev=${r.reviewCount} rej=${r.rejectedCount} dup=${r.duplicateCount}` +
      ` reserved=$${Number(r.reservedChargeUsd).toFixed(4)} actual=${r.actualChargeUsd === null ? "-" : "$" + Number(r.actualChargeUsd).toFixed(4)}` +
      `${r.lastError ? ` err=${String(r.lastError).slice(0, 60)}` : ""}`,
    )
  }
  const spent = runs.reduce((sum, r) => sum + (r.actualChargeUsd ? Number(r.actualChargeUsd) : 0), 0)
  console.log(`  today actual spend: USD ${spent.toFixed(4)}`)

  // Revisit queue — the feed for the comment phase (PR #450 wiring check)
  const [revisitTotal, revisitDue, commentMentions] = await Promise.all([
    prisma.tikTokPublicationRevisit.count({ where: { organizationId: org.id } }),
    prisma.tikTokPublicationRevisit.count({ where: { organizationId: org.id, status: "ACTIVE", nextDueAt: { lte: new Date() } } }),
    prisma.socialMention.count({ where: { organizationId: org.id, platform: "tiktok", contentKind: { in: ["COMMENT", "REPLY"] }, createdAt: { gte: dayStart } } }),
  ])
  console.log(`--- TikTok revisit queue: total=${revisitTotal} dueNow=${revisitDue}; NEW comment mentions today=${commentMentions} ---`)

  // Explain a zero comments result without printing captions/authors. The
  // publication gate only schedules comments for ACCEPTED parent envelopes;
  // counts by status/reason show whether zero means "no eligible parents" or
  // a downstream provider failure.
  const targetDecisions = await prisma.ingestEnvelope.groupBy({
    by: ["relevanceStatus", "relevanceReason"],
    where: { organizationId: org.id, sourceId: SRC, platform: "tiktok" },
    _count: { _all: true },
  })
  console.log(`--- Target TikTok publication-gate decisions ---`)
  for (const row of targetDecisions) {
    console.log(`  ${row.relevanceStatus}/${row.relevanceReason ?? "no_reason"}: ${row._count._all}`)
  }
  const eligibleParents = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: org.id,
      sourceId: SRC,
      platform: "tiktok",
      relevanceStatus: "ACCEPTED",
      contentKind: { in: ["POST", "VIDEO"] },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { canonicalUrl: true, url: true, externalId: true, relevanceReason: true },
  })
  console.log(`  eligible parent samples=${eligibleParents.length}`)
  for (const parent of eligibleParents) {
    const publicUrl = parent.canonicalUrl || parent.url || "-"
    console.log(`    id=${String(parent.externalId ?? "-").slice(0, 40)} reason=${parent.relevanceReason ?? "-"} url=${String(publicUrl).slice(0, 180)}`)
  }

  // Target source due/claim state
  const src = await prisma.monitoringSource.findFirst({
    where: { organizationId: org.id, id: SRC },
    select: { status: true, cadenceMinutes: true, lastCheckedAt: true, lastSuccessfulAt: true, runClaimToken: true, runClaimExpiresAt: true },
  })
  if (src) {
    console.log(`--- Target source state ---`)
    console.log(
      `  status=${src.status} cadence=${src.cadenceMinutes}m` +
      ` lastChecked=${src.lastCheckedAt ? src.lastCheckedAt.toISOString() : "null(DUE)"}` +
      ` lastSuccess=${src.lastSuccessfulAt ? src.lastSuccessfulAt.toISOString() : "never"}` +
      ` claim=${src.runClaimToken ? `HELD until ${src.runClaimExpiresAt ? src.runClaimExpiresAt.toISOString() : "?"}` : "free"}`,
    )
  }

  // Target source collector runs (last 6)
  const collector = await prisma.collectorRun.findMany({
    where: { organizationId: org.id, sourceId: SRC },
    select: { startedAt: true, status: true, foundCount: true, newCount: true, duplicateCount: true, error: true },
    orderBy: { startedAt: "desc" },
    take: 6,
  })
  console.log(`--- Target source collector runs (latest 6) ---`)
  for (const r of collector) {
    console.log(`  ${r.startedAt.toISOString().slice(0, 19)} ${String(r.status).padEnd(8)} found=${r.foundCount} new=${r.newCount} dup=${r.duplicateCount}${r.error ? ` err=${String(r.error).slice(0, 60)}` : ""}`)
  }

  // tiktok route plan state (should include ACTIVE BRIGHT_DATA_SNAPSHOT after recompile)
  const plans = await prisma.sourceRoutePlan.groupBy({
    by: ["capability", "primaryAdapter", "status"],
    where: { organizationId: org.id, platform: "tiktok" },
    _count: { _all: true },
  })
  console.log(`--- tiktok route plans by capability/adapter/status ---`)
  for (const p of plans.sort((a, b) => a.capability.localeCompare(b.capability))) {
    console.log(`  ${p.capability.padEnd(24)} ${p.primaryAdapter.padEnd(22)} ${String(p.status).padEnd(12)} x${p._count._all}`)
  }

  // Today's tiktok mentions/evidence
  const [mentions, evidence] = await Promise.all([
    prisma.socialMention.count({ where: { organizationId: org.id, platform: "tiktok", createdAt: { gte: dayStart } } }),
    prisma.mentionEvidence.count({ where: { organizationId: org.id, capturedAt: { gte: dayStart } } }),
  ])
  console.log(`--- Today: tiktok mentions=${mentions}, mention evidence (all platforms)=${evidence} ---`)

  // Per-platform health: youtube / facebook / instagram (counts only)
  for (const platform of ["youtube", "facebook", "instagram"]) {
    const sources = await prisma.monitoringSource.findMany({
      where: { organizationId: org.id, platform },
      select: { id: true, status: true },
    })
    const ids = sources.map((s) => s.id)
    const active = sources.filter((s) => ["active", "limited", "needs_setup"].includes(s.status)).length
    const [runsToday, mentionsToday, plans] = await Promise.all([
      prisma.collectorRun.groupBy({
        by: ["status"],
        where: { organizationId: org.id, sourceId: { in: ids }, startedAt: { gte: dayStart } },
        _count: { _all: true },
      }),
      prisma.socialMention.groupBy({
        by: ["contentKind"],
        where: { organizationId: org.id, platform, createdAt: { gte: dayStart } },
        _count: { _all: true },
      }),
      prisma.sourceRoutePlan.groupBy({
        by: ["capability", "primaryAdapter", "status"],
        where: { organizationId: org.id, platform, status: { in: ["ACTIVE", "BLOCKED", "DEGRADED"] } },
        _count: { _all: true },
      }),
    ])
    const lastErr = await prisma.collectorRun.findFirst({
      where: { organizationId: org.id, sourceId: { in: ids }, startedAt: { gte: dayStart }, error: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { error: true, startedAt: true },
    })
    console.log(`--- ${platform}: sources=${sources.length} (activeStatus=${active}) ---`)
    console.log(`    runsToday: ${runsToday.map((r) => `${r.status}=${r._count._all}`).join(" ") || "(none)"}`)
    console.log(`    mentionsToday: ${mentionsToday.map((m) => `${m.contentKind}=${m._count._all}`).join(" ") || "(none)"}`)
    for (const p of plans.sort((a, b) => a.capability.localeCompare(b.capability))) {
      console.log(`    route ${p.capability.padEnd(24)} ${p.primaryAdapter.padEnd(22)} ${p.status} x${p._count._all}`)
    }
    if (lastErr) console.log(`    lastError: ${String(lastErr.error).slice(0, 70)} @${lastErr.startedAt.toISOString().slice(11, 16)}`)
  }

  // Deep diagnosis: proof scopes, fb source scopes, youtube/ig run rawStats
  const proofScopes = await prisma.socialProviderCapabilityProof.findMany({
    where: { organizationId: org.id, status: "VERIFIED", platform: { in: ["facebook", "instagram", "tiktok"] } },
    select: { platform: true, capability: true, contentScopeKey: true, adapterKey: true },
    orderBy: [{ platform: "asc" }, { capability: "asc" }],
  })
  console.log(`--- VERIFIED proof scopes ---`)
  for (const p of proofScopes) console.log(`    ${p.platform.padEnd(10)} ${p.capability.padEnd(24)} scopes=${p.contentScopeKey} adapter=${p.adapterKey}`)

  const fbSources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id, platform: "facebook", ownership: "external" },
    select: { settings: true, collectionMode: true, sourceType: true },
  })
  const fbScopes = {}
  for (const s of fbSources) {
    const st = s.settings && typeof s.settings === "object" ? s.settings : {}
    const key = `${s.collectionMode}/${s.sourceType}/scope=${(st.contentScope || "default-PUBLIC")}`
    fbScopes[key] = (fbScopes[key] || 0) + 1
  }
  console.log(`--- facebook external source shapes ---`)
  for (const [k, n] of Object.entries(fbScopes)) console.log(`    ${k} x${n}`)

  for (const platform of ["youtube", "instagram"]) {
    const srcIds = (await prisma.monitoringSource.findMany({
      where: { organizationId: org.id, platform }, select: { id: true },
    })).map((s) => s.id)
    const runs = await prisma.collectorRun.findMany({
      where: { organizationId: org.id, sourceId: { in: srcIds }, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" },
      take: 3,
      select: { startedAt: true, status: true, error: true, rawStats: true },
    })
    console.log(`--- ${platform} last runs rawStats ---`)
    for (const r of runs) {
      const raw = JSON.stringify(r.rawStats ?? {}).slice(0, 260)
      console.log(`    ${r.startedAt.toISOString().slice(11, 16)} ${r.status} err=${r.error ?? "-"} raw=${raw}`)
    }
  }

  // Route-level diagnosis: per-adapter routeResults + blocked-plan reasons
  for (const platform of ["youtube", "facebook", "instagram"]) {
    const srcIds2 = (await prisma.monitoringSource.findMany({
      where: { organizationId: org.id, platform }, select: { id: true },
    })).map((s) => s.id)
    const run = await prisma.collectorRun.findFirst({
      where: { organizationId: org.id, sourceId: { in: srcIds2 }, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true, error: true, rawStats: true },
    })
    console.log(`--- ${platform} routeResults breakdown (latest run) ---`)
    const raw = run?.rawStats && typeof run.rawStats === "object" ? run.rawStats : {}
    const results = Array.isArray(raw.routeResults) ? raw.routeResults : []
    for (const rr of results) {
      const r = rr && typeof rr === "object" ? rr : {}
      const extras = {}
      for (const k of ["searchQuery", "searchPages", "discoveredVideos", "approvedVideos", "reviewVideos", "rejectedVideos", "status", "body", "username", "reason", "coverageClass", "schemaHealth", "validCount", "invalidCount"]) {
        if (r[k] !== undefined) extras[k] = typeof r[k] === "string" ? String(r[k]).slice(0, 140) : r[k]
      }
      console.log(`    ${String(r.adapter).padEnd(22)} ${String(r.capability).padEnd(24)} ${String(r.status).padEnd(8)} err=${r.error ?? "-"} ${JSON.stringify(extras)}`)
      // Schema-drift warnings carry the exact per-row normalizer rejection (e.g.
      // "parent identity mapping is required") — the root cause when a comment
      // snapshot sticks at PARTIAL with validCount=0. Counts/errors only, no text.
      if (Array.isArray(r.warnings) && r.warnings.length) {
        for (const w of r.warnings.slice(0, 5)) console.log(`      warn: ${String(w).slice(0, 200)}`)
      }
    }
    if (Array.isArray(raw.blockedRoutes) && raw.blockedRoutes.length) {
      console.log(`    blockedRoutes reasons (first 3):`)
      for (const b of raw.blockedRoutes.slice(0, 3)) console.log(`      ${String(b.reason).slice(0, 160)}`)
    }
  }
  // Root-cause hunt for the PARTIAL comments phase: the schema-drift warnings
  // live in whichever collector run actually executed the Bright Data comments
  // route — often NOT the latest run (once the plan degrades, later runs fall
  // to MANUAL_TASK and carry no warnings). Scan today's runs and print every
  // Bright Data READ_EXTERNAL_COMMENTS route result with its warnings.
  for (const platform of ["facebook", "instagram"]) {
    const srcIds3 = (await prisma.monitoringSource.findMany({
      where: { organizationId: org.id, platform }, select: { id: true },
    })).map((s) => s.id)
    const runs3 = await prisma.collectorRun.findMany({
      where: { organizationId: org.id, sourceId: { in: srcIds3 }, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" },
      take: 12,
      select: { startedAt: true, status: true, rawStats: true },
    })
    console.log(`--- ${platform}: full routeResults of today's runs (truncated) ---`)
    for (const run of runs3) {
      const raw = run?.rawStats && typeof run.rawStats === "object" ? run.rawStats : {}
      const results = Array.isArray(raw.routeResults) ? raw.routeResults : []
      console.log(`  run ${run.startedAt.toISOString().slice(11, 19)} status=${run.status} routes=${results.length}`)
      for (const rr of results) {
        console.log(`    ${JSON.stringify(rr).slice(0, 380)}`)
      }
    }
    // The EXTRACT provider runs themselves — inputSnapshot may carry drift info.
    const exRuns = await prisma.socialProviderRun.findMany({
      where: {
        organizationId: org.id,
        phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
        createdAt: { gte: dayStart },
        source: { platform },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { createdAt: true, status: true, receivedCount: true, acceptedCount: true, lastError: true, inputSnapshot: true, schemaVersion: true },
    })
    for (const x of exRuns) {
      console.log(`  EXTRACT ${x.createdAt.toISOString().slice(11, 19)} ${x.status} recv=${x.receivedCount} acc=${x.acceptedCount} err=${x.lastError ?? "-"} schema=${x.schemaVersion}`)
      console.log(`    inputSnapshot: ${JSON.stringify(x.inputSnapshot ?? {}).slice(0, 380)}`)
      const snap = x.inputSnapshot && typeof x.inputSnapshot === "object" ? x.inputSnapshot : {}
      if (Array.isArray(snap.driftWarnings)) {
        for (const w of snap.driftWarnings) console.log(`    drift: ${String(w).slice(0, 300)}`)
      }
    }
  }
  // Schema-failure root cause: re-download the already-paid comments snapshot
  // and compare its row shape/ids against the parent-target map the normalizer
  // expects. Field keys, ids and URLs only — no comment text is printed.
  const exRun = await prisma.socialProviderRun.findFirst({
    where: {
      organizationId: org.id,
      phase: "EXTRACT_COMMENTS_FROM_CANDIDATES",
      externalRunId: { not: null },
      source: { platform: "facebook" },
    },
    orderBy: { createdAt: "desc" },
    select: { externalRunId: true, sourceId: true, createdAt: true, status: true },
  })
  const bdToken = (process.env.BRIGHT_DATA_API_TOKEN ?? "").trim()
  if (exRun?.externalRunId && bdToken) {
    console.log(`--- comments snapshot diff (run ${exRun.createdAt.toISOString().slice(11, 19)} ${exRun.status}) ---`)
    try {
      const res = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(exRun.externalRunId)}?format=json`, {
        headers: { authorization: `Bearer ${bdToken}` },
      })
      const rows = res.ok ? await res.json() : null
      if (!Array.isArray(rows)) {
        console.log(`    snapshot re-download failed: http=${res.status}`)
      } else {
        console.log(`    rows=${rows.length}`)
        if (rows[0] && typeof rows[0] === "object") console.log(`    keys: ${Object.keys(rows[0]).sort().join(",").slice(0, 380)}`)
        for (const r of rows.slice(0, 3)) {
          const o = r && typeof r === "object" ? r : {}
          console.log(`    row: post_id=${String(o.post_id ?? "-").slice(0, 40)} comment_id=${String(o.comment_id ?? "-").slice(0, 40)} hasText=${Boolean(o.comment_text)} textField=${["comment_text", "comment", "text", "content"].find((k) => typeof o[k] === "string" && o[k].trim()) ?? "-"}`)
          console.log(`         post_url=${String(o.post_url ?? "-").slice(0, 120)}`)
          console.log(`         url=${String(o.url ?? "-").slice(0, 120)}`)
        }
      }
    } catch (err) {
      console.log(`    snapshot re-download error: ${String(err).slice(0, 160)}`)
    }
  } else {
    console.log(`--- comments snapshot diff skipped (run=${Boolean(exRun)}, token=${Boolean(bdToken)}) ---`)
  }
  // DB-only: the id/url SHAPE of the expected parents tells whether the comments
  // dataset can possibly match them (pfbid-style URLs resolve to different
  // canonical URLs; numeric vs pfbid post ids cannot equal each other).
  if (exRun) {
    const parents = await prisma.ingestEnvelope.findMany({
      where: {
        organizationId: org.id,
        sourceId: exRun.sourceId,
        providerKey: "bright-data",
        acceptedMentionId: { not: null },
        contentKind: { in: ["POST", "VIDEO"] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { externalId: true, canonicalUrl: true, url: true },
    })
    console.log(`--- expected comment parents (${parents.length} newest, id+url shapes) ---`)
    for (const p of parents) console.log(`      externalId=${String(p.externalId ?? "-").slice(0, 48)} canonicalUrl=${String(p.canonicalUrl ?? p.url ?? "-").slice(0, 130)}`)
  }
  const fbPlan = await prisma.sourceRoutePlan.findFirst({
    where: { organizationId: org.id, platform: "facebook", status: "BLOCKED" },
    orderBy: { compiledAt: "desc" },
    select: { capability: true, primaryAdapter: true, policyVersion: true, compiledAt: true, version: true, reason: true },
  })
  if (fbPlan) console.log(`--- fb newest BLOCKED plan: ${fbPlan.capability} ${fbPlan.primaryAdapter} pv=${fbPlan.policyVersion} v${fbPlan.version} compiled=${fbPlan.compiledAt.toISOString()} reason="${String(fbPlan.reason).slice(0, 180)}"`)

  // Policy snapshot
  const settings = (await prisma.organization.findUnique({ where: { id: org.id }, select: { settings: true } }))?.settings
  const pol = settings && typeof settings === "object" ? settings.socialMonitoringPaidRuns || {} : {}
  console.log(`--- Policy: enabled=${pol.manualRunsEnabled === true} stop=${pol.emergencyStopped !== false} caps=${pol.maxPerRunUsd}/${pol.dailyBudgetUsd}/${pol.monthlyBudgetUsd} v${pol.policyVersion} ---`)
}

main()
  .catch((err) => { console.error("[evidence] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
