// Read-only diagnostic: list a tenant's connected social accounts, channel
// configs and monitoring-source coverage, so an operator can verify what a
// channel connect actually produced without DB access.
//
// Usage:
//   node scripts/check-social-accounts.mjs                      # brandprotection
//   node scripts/check-social-accounts.mjs --slug=<tenant-slug>
//
// Prints platforms/handles/config names ONLY — no tokens, secrets or ids.

import crypto from "node:crypto"
import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

const slugArg = process.argv.find((a) => a.startsWith("--slug="))
const slug = slugArg ? slugArg.slice("--slug=".length) : "brandprotection"

function deriveTokenKey(purpose) {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) throw new Error("NEXTAUTH_SECRET unavailable")
  const base = crypto.createHash("sha256").update(secret).digest()
  return crypto.createHmac("sha256", base)
    .update(Buffer.from(`leaddrive:${purpose}`, "utf8"))
    .digest()
    .subarray(0, 32)
}

function decodeBase64Url(value) {
  const pad = value.length % 4
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad ? 4 - pad : 0)
  return Buffer.from(normalized, "base64")
}

function decryptStoredToken(stored, purpose) {
  if (!stored) return ""
  if (!stored.startsWith("v1:")) return stored
  const raw = decodeBase64Url(stored.slice(3))
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const ciphertext = raw.subarray(12, raw.length - 16)
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveTokenKey(purpose), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

function providerInputHash(input, organizationId) {
  const hmacKey = deriveTokenKey(`hmac:apify-input:${organizationId}`)
  return crypto.createHmac("sha256", hmacKey).update(JSON.stringify(input), "utf8").digest("hex")
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug },
    select: { id: true, slug: true, name: true, settings: true },
  })
  if (!org) {
    console.error(`[check-social-accounts] no tenant with slug="${slug}"`)
    process.exit(1)
  }
  console.log(`[check-social-accounts] tenant=${org.slug} (${org.name})`)
  const organizationSettings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
    ? org.settings
    : {}
  const paidRunSettings = organizationSettings.socialMonitoringPaidRuns
    && typeof organizationSettings.socialMonitoringPaidRuns === "object"
    && !Array.isArray(organizationSettings.socialMonitoringPaidRuns)
    ? organizationSettings.socialMonitoringPaidRuns
    : {}
  const cleanSlateSettings = organizationSettings.socialMonitoringCleanSlate
    && typeof organizationSettings.socialMonitoringCleanSlate === "object"
    && !Array.isArray(organizationSettings.socialMonitoringCleanSlate)
    ? organizationSettings.socialMonitoringCleanSlate
    : {}
  console.log(
    `--- Collection controls: emergencyStopped=${paidRunSettings.emergencyStopped !== false}` +
    ` cleanSlateBlocked=${cleanSlateSettings.collectionBlocked === true} ---`,
  )

  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId: org.id },
    select: { platform: true, handle: true, displayName: true, isActive: true, lastPolledAt: true, createdAt: true },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
  })
  console.log(`--- SocialAccounts: ${accounts.length} ---`)
  for (const a of accounts) {
    console.log(
      `  ${a.isActive ? "●" : "○"} ${a.platform.padEnd(10)} @${a.handle}` +
      `${a.displayName ? ` (${a.displayName})` : ""}` +
      `  lastPolled=${a.lastPolledAt ? a.lastPolledAt.toISOString() : "never"}` +
      `  created=${a.createdAt.toISOString().slice(0, 16)}`,
    )
  }
  const youtubeOauthAccounts = await prisma.socialAccount.count({
    where: {
      organizationId: org.id,
      platform: "youtube",
      isActive: true,
      accessToken: { not: null },
    },
  })
  console.log(
    `--- YouTube discovery credentials: apiKey=${process.env.YOUTUBE_API_KEY?.trim() ? "yes" : "no"}` +
    ` oauthAccounts=${youtubeOauthAccounts} ---`,
  )

  const configs = await prisma.channelConfig.findMany({
    where: { organizationId: org.id },
    select: { channelType: true, configName: true, isActive: true, pageId: true },
    orderBy: [{ channelType: "asc" }, { configName: "asc" }],
  })
  console.log(`--- ChannelConfigs: ${configs.length} ---`)
  for (const c of configs) {
    console.log(
      `  ${c.isActive ? "●" : "○"} ${c.channelType.padEnd(18)} "${c.configName}"` +
      `${c.pageId ? "  [page-bound]" : ""}`,
    )
  }

  const sources = await prisma.monitoringSource.groupBy({
    by: ["platform", "ownership", "collectionMode"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  console.log(`--- MonitoringSources by platform/ownership/mode ---`)
  for (const s of sources.sort((a, b) =>
    a.platform.localeCompare(b.platform) || String(a.ownership).localeCompare(String(b.ownership)),
  )) {
    console.log(`  ${s.platform.padEnd(12)} ownership=${String(s.ownership).padEnd(9)} mode=${String(s.collectionMode).padEnd(10)} ${s._count._all}`)
  }

  // The "My connected pages" section lists ownership="owned" sources — print
  // them row by row (handles/urls only) so an empty section is explainable.
  const owned = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id, ownership: "owned" },
    select: { platform: true, sourceType: true, handle: true, url: true, query: true, status: true, settings: true },
    orderBy: [{ platform: "asc" }],
  })
  console.log(`--- Owned sources ("My connected pages"): ${owned.length} ---`)
  for (const s of owned) {
    const settings = s.settings && typeof s.settings === "object" ? s.settings : {}
    console.log(
      `  ${s.status === "active" ? "●" : "○"} ${s.platform.padEnd(10)} ${s.sourceType}` +
      ` ${s.handle || s.url || s.query || "-"}` +
      `  linkedAccount=${settings.socialAccountId ? "yes" : "no"}`,
    )
  }

  // Monitored objects (subjects) — the brand/person/topic each monitoring
  // scenario watches. Prints names + status + alias/source coverage so an
  // operator can confirm the configured subjects are intact. Names only.
  const subjects = await prisma.monitoringSubject.findMany({
    where: { organizationId: org.id },
    select: {
      type: true,
      name: true,
      status: true,
      languages: true,
      _count: { select: { aliases: true, sources: true } },
    },
    orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }],
  })
  console.log(`--- MonitoringSubjects (monitored objects): ${subjects.length} ---`)
  for (const s of subjects) {
    console.log(
      `  ${s.status === "active" ? "●" : "○"} ${String(s.type).padEnd(12)} "${s.name}"` +
      `  status=${s.status}` +
      `  langs=[${(s.languages || []).join(",")}]` +
      `  aliases=${s._count.aliases}  sources=${s._count.sources}`,
    )
  }

  // Pipeline output — COUNTS/AGGREGATES ONLY. No mention text, author names,
  // handles or external ids are read or printed (privacy + evidence policy).
  const [mentionTotal, evidenceTotal, evidenceWithSnippet] = await Promise.all([
    prisma.socialMention.count({ where: { organizationId: org.id } }),
    prisma.mentionEvidence.count({ where: { organizationId: org.id } }),
    prisma.mentionEvidence.count({ where: { organizationId: org.id, rawSnippet: { not: null } } }),
  ])
  console.log(`--- Mentions & evidence (counts only) ---`)
  console.log(`  SocialMentions=${mentionTotal}  MentionEvidence=${evidenceTotal}  (withSnippet=${evidenceWithSnippet})`)
  const mByPlatform = await prisma.socialMention.groupBy({
    by: ["platform", "contentKind"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  for (const m of mByPlatform.sort((a, b) => a.platform.localeCompare(b.platform))) {
    console.log(`    ${String(m.platform).padEnd(10)} ${String(m.contentKind).padEnd(8)} ${m._count._all}`)
  }

  const runsByStatus = await prisma.collectorRun.groupBy({
    by: ["status"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  console.log(`--- CollectorRuns by status ---`)
  for (const r of runsByStatus) console.log(`    ${String(r.status).padEnd(10)} ${r._count._all}`)
  const latestRuns = await prisma.collectorRun.findMany({
    where: { organizationId: org.id },
    select: {
      status: true,
      startedAt: true,
      foundCount: true,
      newCount: true,
      error: true,
      source: { select: { platform: true, sourceType: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 12,
  })
  console.log(`--- Latest CollectorRuns (most recent 12) ---`)
  for (const r of latestRuns) {
    const error = String(r.error || "none").replace(/\s+/g, " ").slice(0, 160)
    console.log(
      `    ${r.startedAt.toISOString().slice(0, 16)}  ${String(r.status).padEnd(8)}` +
      ` source=${r.source.platform}/${r.source.sourceType}` +
      ` found=${r.foundCount} new=${r.newCount} error=${error}`,
    )
  }

  const providerRuns = await prisma.socialProviderRun.groupBy({
    by: ["providerKey", "phase", "status"],
    where: { organizationId: org.id },
    _count: { _all: true },
    _sum: { actualChargeUsd: true, reservedChargeUsd: true },
  })
  console.log(`--- SocialProviderRuns by provider/phase/status (paid routing spend) ---`)
  if (providerRuns.length === 0) {
    console.log(`    (none — no paid provider runs recorded)`)
  }
  let totalActualUsd = 0
  let totalReservedUsd = 0
  for (const p of providerRuns) {
    const actual = p._sum.actualChargeUsd ? Number(p._sum.actualChargeUsd) : 0
    const reserved = p._sum.reservedChargeUsd ? Number(p._sum.reservedChargeUsd) : 0
    totalActualUsd += actual
    totalReservedUsd += reserved
    console.log(
      `    ${String(p.providerKey).padEnd(12)} ${String(p.phase).padEnd(30)} ${String(p.status).padEnd(10)}` +
      ` n=${p._count._all}  actualUsd=${actual.toFixed(6)} reservedUsd=${reserved.toFixed(6)}`,
    )
  }
  console.log(
    `  HIDDEN/AUDIT all-time totals: actualUsd=${totalActualUsd.toFixed(6)}` +
    ` reservedUsd=${totalReservedUsd.toFixed(6)}`,
  )
  const operationalSpend = await prisma.socialProviderRun.aggregate({
    where: { organizationId: org.id, purgedAt: null },
    _count: { _all: true },
    _sum: { actualChargeUsd: true, reservedChargeUsd: true },
  })
  console.log(
    `  CURRENT operational period: runs=${operationalSpend._count._all}` +
    ` actualUsd=${Number(operationalSpend._sum.actualChargeUsd ?? 0).toFixed(6)}` +
    ` reservedUsd=${Number(operationalSpend._sum.reservedChargeUsd ?? 0).toFixed(6)}`,
  )

  // Latest operational provider rows — enough detail to distinguish a real
  // external actor run from a local QUEUED reservation, without printing
  // provider run ids, dataset ids, tokens or payloads.
  const activeProviderRuns = await prisma.socialProviderRun.findMany({
    where: { organizationId: org.id, purgedAt: null },
    select: {
      providerKey: true,
      phase: true,
      status: true,
      actorId: true,
      inputHash: true,
      externalRunId: true,
      datasetId: true,
      receivedCount: true,
      acceptedCount: true,
      reviewCount: true,
      rejectedCount: true,
      duplicateCount: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      finishedAt: true,
      source: {
        select: {
          platform: true,
          sourceType: true,
          query: true,
          keywords: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  })
  console.log(`--- Latest operational provider runs (redacted) ---`)
  if (activeProviderRuns.length === 0) console.log(`    (none)`)
  for (const run of activeProviderRuns) {
    const query = String(run.source.query || run.source.keywords?.[0] || "-")
      .replace(/\s+/g, " ")
      .slice(0, 80)
    console.log(
      `    ${String(run.providerKey).padEnd(12)} ${String(run.phase).padEnd(36)}` +
      ` ${String(run.status).padEnd(10)} actor=${run.actorId || "-"}` +
      ` source=${run.source.platform}/${run.source.sourceType} query="${query}"` +
      ` externalRun=${run.externalRunId ? "yes" : "no"}` +
      ` dataset=${run.datasetId ? "yes" : "no"}` +
      ` counts=${run.receivedCount}/${run.acceptedCount}/${run.reviewCount}/${run.rejectedCount}/${run.duplicateCount}` +
      ` error=${run.lastError || "none"}` +
      ` created=${run.createdAt.toISOString()}` +
      ` updated=${run.updatedAt.toISOString()}` +
      ` started=${run.startedAt?.toISOString() || "never"}` +
      ` finished=${run.finishedAt?.toISOString() || "never"}`,
    )
  }

  // If a local row never received an external run id, check the tenant's
  // Apify history read-only and compare the exact stored INPUT HMAC inside the
  // narrow dispatch window. This helps distinguish a lost acknowledgement
  // from a request that never reached Apify without exposing ids or inputs.
  const queuedWithoutExternalRun = activeProviderRuns.filter(run =>
    run.providerKey === "APIFY"
    && run.status === "QUEUED"
    && !run.externalRunId
    && Boolean(run.actorId),
  )
  if (queuedWithoutExternalRun.length > 0) {
    const providerConfig = await prisma.channelConfig.findFirst({
      where: {
        organizationId: org.id,
        channelType: "social_monitoring",
        configName: "Monitoring providers",
      },
      select: { apiKey: true },
    })
    let apifyToken = process.env.APIFY_API_TOKEN?.trim() || ""
    try {
      if (providerConfig?.apiKey) {
        apifyToken = decryptStoredToken(providerConfig.apiKey, `social-search-index:${org.id}`)
      }
    } catch {
      apifyToken = ""
    }
    console.log(`--- QUEUED Apify dispatch verification (no ids or inputs) ---`)
    if (!apifyToken) {
      console.log(`    unavailable: tenant/platform token could not be read`)
    } else {
      const inputByStore = new Map()
      for (const run of queuedWithoutExternalRun) {
        const actorApiId = run.actorId.replace("/", "~")
        const windowStart = new Date(run.createdAt.getTime() - 2 * 60_000)
        const windowEnd = new Date(run.createdAt.getTime() + 2 * 60_000)
        const historyUrl = new URL(
          `https://api.apify.com/v2/acts/${encodeURIComponent(actorApiId)}/runs`,
        )
        historyUrl.searchParams.set("limit", "50")
        historyUrl.searchParams.set("desc", "1")
        historyUrl.searchParams.set("startedAfter", windowStart.toISOString())
        historyUrl.searchParams.set("startedBefore", windowEnd.toISOString())
        const response = await fetch(
          historyUrl,
          {
            headers: { Authorization: `Bearer ${apifyToken}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          },
        )
        if (!response.ok) {
          console.log(`    actor=${run.actorId} historyStatus=${response.status} exactInputMatches=unknown`)
          continue
        }
        const body = await response.json().catch(() => null)
        const items = Array.isArray(body?.data?.items) ? body.data.items : []
        const candidates = items.filter(item => {
          const remoteAt = Date.parse(item?.createdAt || item?.startedAt || "")
          return Number.isFinite(remoteAt)
            && remoteAt >= windowStart.getTime()
            && remoteAt <= windowEnd.getTime()
        })
        const matches = []
        for (const item of candidates) {
          if (!item?.defaultKeyValueStoreId) continue
          let input = inputByStore.get(item.defaultKeyValueStoreId)
          if (input === undefined) {
            const inputResponse = await fetch(
              `https://api.apify.com/v2/key-value-stores/${encodeURIComponent(item.defaultKeyValueStoreId)}/records/INPUT`,
              {
                headers: { Authorization: `Bearer ${apifyToken}`, Accept: "application/json" },
                signal: AbortSignal.timeout(10_000),
              },
            )
            input = inputResponse.ok
              ? await inputResponse.json().catch(() => null)
              : null
            inputByStore.set(item.defaultKeyValueStoreId, input)
          }
          if (input && providerInputHash(input, org.id) === run.inputHash) matches.push(item)
        }
        console.log(
          `    actor=${run.actorId} dispatchWindowActorRuns=${candidates.length}` +
          ` exactInputMatches=${matches.length}` +
          ` matchConfidence=${matches.length === 1 ? "possible" : matches.length > 1 ? "ambiguous" : "none"}` +
          ` matchedStatuses=${matches.map(item => item.status).join(",") || "none"}`,
        )
      }
    }
  }

  // Per-provider recency — confirms whether any provider (esp. APIFY) still
  // runs after the Bright-Data-only cutover. Counts + latest timestamp only.
  const provKeys = [...new Set(providerRuns.map((p) => p.providerKey))].sort()
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  console.log(`--- Provider-run recency (counts only) ---`)
  for (const key of provKeys) {
    const [latest, last24h, last7d] = await Promise.all([
      prisma.socialProviderRun.findFirst({
        where: { organizationId: org.id, providerKey: key },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.socialProviderRun.count({ where: { organizationId: org.id, providerKey: key, createdAt: { gte: since24h } } }),
      prisma.socialProviderRun.count({ where: { organizationId: org.id, providerKey: key, createdAt: { gte: since7d } } }),
    ])
    console.log(
      `    ${String(key).padEnd(12)} latest=${latest?.createdAt ? latest.createdAt.toISOString() : "never"}` +
      `  last24h=${last24h}  last7d=${last7d}`,
    )
  }
}

main()
  .catch((err) => {
    console.error("[check-social-accounts] FAILED:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
