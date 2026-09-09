// One-off repair for the single Brand Protection Apify dispatch that was
// durably queued locally on 2026-07-29 but was not observed in Apify history.
//
// Dry-run is the default:
//   DATABASE_URL=... NEXTAUTH_SECRET=... \
//     node scripts/repair-brandprotection-undispatched-apify-2026-07-29.mjs
//
// Execute only after reviewing the dry-run:
//   DATABASE_URL=... NEXTAUTH_SECRET=... \
//     node scripts/repair-brandprotection-undispatched-apify-2026-07-29.mjs \
//       --execute \
//       --confirm=repair-brandprotection-undispatched-apify-2026-07-29
//
// Output is deliberately limited to counts and states. The script never prints
// database ids, the Apify token, or provider input.

import crypto from "node:crypto"
import { makeScriptPrisma } from "./_rls.mjs"

const TENANT_SLUG = "brandprotection"
const ACTOR_ID = "apify/instagram-hashtag-scraper"
const PROVIDER_PHASE = "DISCOVER_CANDIDATE_POSTS"
const EXPECTED_RESERVED_CHARGE_USD = 50
const CREATED_FROM = new Date("2026-07-29T05:49:00.000Z")
const CREATED_TO = new Date("2026-07-29T05:52:00.000Z")
const CONFIRMATION = "repair-brandprotection-undispatched-apify-2026-07-29"
const REPAIR_ERROR = "operator_verified_apify_dispatch_not_observed_2026_07_29"
const COLLECTOR_ERROR = "collector_lease_expired"
const APIFY_API = "https://api.apify.com/v2"
const APIFY_WINDOW_MS = 2 * 60_000
const APIFY_REQUEST_TIMEOUT_MS = 10_000
const TRANSACTION_LOCK_TIMEOUT_MS = 15_000
const execute = process.argv.includes("--execute")
const confirmationArguments = process.argv
  .filter(value => value.startsWith("--confirm="))
const confirmation = confirmationArguments.length === 1
  ? confirmationArguments[0].slice("--confirm=".length)
  : undefined

class RepairError extends Error {
  constructor(code) {
    super(code)
    this.name = "RepairError"
    this.code = code
  }
}

function fail(code) {
  throw new RepairError(code)
}

function assertAllowedArguments() {
  const unknown = process.argv.slice(2).filter(value =>
    value !== "--execute" && !value.startsWith("--confirm="))
  if (unknown.length > 0) fail("unsupported_argument")
  if (confirmationArguments.length > 1) fail("exact_confirmation_required")
  if (execute && confirmation !== CONFIRMATION) fail("exact_confirmation_required")
  if (!execute && confirmation !== undefined) fail("confirmation_requires_execute")
}

function deriveTokenKey(purpose) {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) fail("nextauth_secret_unavailable")
  const base = crypto.createHash("sha256").update(secret).digest()
  return crypto.createHmac("sha256", base)
    .update(Buffer.from(`leaddrive:${purpose}`, "utf8"))
    .digest()
    .subarray(0, 32)
}

function decodeBase64Url(value) {
  const pad = value.length % 4
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat(pad ? 4 - pad : 0)
  return Buffer.from(normalized, "base64")
}

function decryptStoredToken(stored, purpose) {
  if (!stored) return ""
  if (!stored.startsWith("v1:")) return stored
  try {
    const raw = decodeBase64Url(stored.slice(3))
    if (raw.length < 28) fail("tenant_apify_token_decrypt_failed")
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(raw.length - 16)
    const ciphertext = raw.subarray(12, raw.length - 16)
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveTokenKey(purpose),
      iv,
    )
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8")
  } catch (error) {
    if (error instanceof RepairError) throw error
    fail("tenant_apify_token_decrypt_failed")
  }
}

function providerInputHash(input, organizationId) {
  const hmacKey = deriveTokenKey(`hmac:apify-input:${organizationId}`)
  return crypto.createHmac("sha256", hmacKey)
    .update(JSON.stringify(input), "utf8")
    .digest("hex")
}

function sameInstant(left, right) {
  return left instanceof Date
    && right instanceof Date
    && left.getTime() === right.getTime()
}

function isZeroMoney(value) {
  if (value === null || value === undefined) return true
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric === 0
}

async function fetchWithTimeout(url, init, failureCode) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(APIFY_REQUEST_TIMEOUT_MS),
    })
  } catch {
    fail(failureCode)
  }
}

async function readApifyToken(db, organizationId) {
  const configs = await db.channelConfig.findMany({
    where: {
      organizationId,
      channelType: "social_monitoring",
      configName: "Monitoring providers",
    },
    select: { apiKey: true },
  })
  if (configs.length > 1) fail("tenant_provider_config_count_invalid")

  let token = process.env.APIFY_API_TOKEN?.trim() || ""
  if (configs[0]?.apiKey) {
    token = decryptStoredToken(
      configs[0].apiKey,
      `social-search-index:${organizationId}`,
    ).trim()
  }
  if (!token) fail("tenant_apify_token_unavailable")
  return token
}

async function verifyNoRemoteDispatch(run, organizationId, apifyToken) {
  const windowStart = new Date(run.createdAt.getTime() - APIFY_WINDOW_MS)
  const windowEnd = new Date(run.createdAt.getTime() + APIFY_WINDOW_MS)
  const actorApiId = ACTOR_ID.replace("/", "~")
  const historyUrl = new URL(
    `${APIFY_API}/acts/${encodeURIComponent(actorApiId)}/runs`,
  )
  historyUrl.searchParams.set("limit", "1000")
  historyUrl.searchParams.set("desc", "1")
  historyUrl.searchParams.set("startedAfter", windowStart.toISOString())
  historyUrl.searchParams.set("startedBefore", windowEnd.toISOString())

  const headers = {
    Authorization: `Bearer ${apifyToken}`,
    Accept: "application/json",
  }
  const response = await fetchWithTimeout(
    historyUrl,
    { headers },
    "apify_history_request_failed",
  )
  if (response.status !== 200) fail("apify_history_status_not_200")

  const body = await response.json().catch(() => null)
  const items = body?.data?.items
  const total = body?.data?.total
  if (
    !Array.isArray(items)
    || !Number.isInteger(total)
    || total < 0
    || total !== items.length
  ) {
    fail("apify_history_response_incomplete")
  }

  const candidates = []
  for (const item of items) {
    const remoteAt = Date.parse(item?.createdAt || item?.startedAt || "")
    if (!Number.isFinite(remoteAt)) fail("apify_history_time_invalid")
    if (
      remoteAt >= windowStart.getTime()
      && remoteAt <= windowEnd.getTime()
    ) {
      candidates.push(item)
    }
  }

  let exactInputMatches = 0
  for (const item of candidates) {
    const storeId = typeof item?.defaultKeyValueStoreId === "string"
      ? item.defaultKeyValueStoreId.trim()
      : ""
    if (!storeId) fail("apify_candidate_input_unavailable")
    const inputResponse = await fetchWithTimeout(
      `${APIFY_API}/key-value-stores/${encodeURIComponent(storeId)}/records/INPUT`,
      { headers },
      "apify_input_request_failed",
    )
    if (inputResponse.status !== 200) fail("apify_input_status_not_200")
    const input = await inputResponse.json().catch(() => null)
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail("apify_input_response_invalid")
    }
    if (providerInputHash(input, organizationId) === run.inputHash) {
      exactInputMatches += 1
    }
  }

  if (candidates.length !== 0 || exactInputMatches !== 0) {
    fail("apify_dispatch_absence_not_proven")
  }
  return {
    historyStatus: response.status,
    candidates: candidates.length,
    exactInputMatches,
  }
}

async function loadExactLocalState(db, organizationId, now) {
  const providerRuns = await db.socialProviderRun.findMany({
    where: {
      organizationId,
      providerKey: "APIFY",
      actorId: ACTOR_ID,
      phase: PROVIDER_PHASE,
      status: "QUEUED",
      purgedAt: null,
      externalRunId: null,
      datasetId: null,
      startedAt: null,
      finishedAt: null,
      receivedCount: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      reservedChargeUsd: EXPECTED_RESERVED_CHARGE_USD,
      createdAt: { gte: CREATED_FROM, lte: CREATED_TO },
      OR: [
        { actualChargeUsd: null },
        { actualChargeUsd: 0 },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      sourceId: true,
      collectorRunId: true,
      routePlanId: true,
      providerKey: true,
      actorId: true,
      phase: true,
      status: true,
      inputHash: true,
      reservedChargeUsd: true,
      actualChargeUsd: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      source: {
        select: {
          id: true,
          organizationId: true,
          platform: true,
          sourceType: true,
          status: true,
          runClaimToken: true,
          runClaimVersion: true,
          runClaimExpiresAt: true,
          updatedAt: true,
        },
      },
    },
  })
  if (providerRuns.length !== 1) fail("provider_candidate_count_not_one")
  const providerRun = providerRuns[0]
  if (
    providerRun.organizationId !== organizationId
    || providerRun.source.organizationId !== organizationId
    || providerRun.source.id !== providerRun.sourceId
    || providerRun.source.platform !== "instagram"
    || providerRun.source.sourceType !== "keyword"
    || !providerRun.collectorRunId
    || typeof providerRun.routePlanId !== "string"
    || !providerRun.routePlanId.trim()
    || !/^[a-f0-9]{64}$/i.test(providerRun.inputHash)
    || !providerRun.source.runClaimToken
    || !providerRun.source.runClaimExpiresAt
    || providerRun.source.runClaimExpiresAt > now
    || !isZeroMoney(providerRun.actualChargeUsd)
    || Number(providerRun.reservedChargeUsd) !== EXPECTED_RESERVED_CHARGE_USD
  ) {
    fail("provider_source_state_mismatch")
  }

  const collectors = await db.collectorRun.findMany({
    where: {
      organizationId,
      sourceId: providerRun.sourceId,
      status: "running",
      finishedAt: null,
      claimToken: providerRun.source.runClaimToken,
      claimVersion: providerRun.source.runClaimVersion,
      leaseExpiresAt: { lte: now },
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
    },
    select: {
      id: true,
      organizationId: true,
      sourceId: true,
      claimToken: true,
      claimVersion: true,
      leaseExpiresAt: true,
      status: true,
      finishedAt: true,
    },
  })
  if (
    collectors.length !== 1
    || collectors[0].id !== providerRun.collectorRunId
    || collectors[0].organizationId !== organizationId
    || collectors[0].sourceId !== providerRun.sourceId
    || !sameInstant(
      collectors[0].leaseExpiresAt,
      providerRun.source.runClaimExpiresAt,
    )
  ) {
    fail("collector_claim_match_count_not_one")
  }
  const collectorRun = collectors[0]

  const [mentionCount, evidenceCount, linkedEnvelopeCount] = await Promise.all([
    db.socialMention.count({ where: { organizationId } }),
    db.mentionEvidence.count({ where: { organizationId } }),
    db.ingestEnvelope.count({
      where: {
        organizationId,
        OR: [
          { providerRunId: providerRun.id },
          { collectorRunId: collectorRun.id },
        ],
      },
    }),
  ])
  if (mentionCount !== 0 || evidenceCount !== 0) {
    fail("tenant_mentions_or_evidence_not_zero")
  }
  if (linkedEnvelopeCount !== 0) fail("linked_ingest_envelopes_not_zero")

  return {
    providerRun,
    collectorRun,
    source: providerRun.source,
    counts: {
      providerCandidates: providerRuns.length,
      matchingCollectors: collectors.length,
      mentions: mentionCount,
      evidence: evidenceCount,
      linkedEnvelopes: linkedEnvelopeCount,
    },
  }
}

function assertSameSnapshot(expected, current) {
  if (
    expected.providerRun.id !== current.providerRun.id
    || expected.collectorRun.id !== current.collectorRun.id
    || expected.source.id !== current.source.id
    || expected.providerRun.status !== current.providerRun.status
    || expected.collectorRun.status !== current.collectorRun.status
    || expected.source.status !== current.source.status
    || expected.providerRun.phase !== current.providerRun.phase
    || expected.source.platform !== current.source.platform
    || expected.source.sourceType !== current.source.sourceType
    || !sameInstant(
      expected.providerRun.updatedAt,
      current.providerRun.updatedAt,
    )
    || !sameInstant(expected.source.updatedAt, current.source.updatedAt)
    || expected.providerRun.inputHash !== current.providerRun.inputHash
  ) {
    fail("local_snapshot_changed")
  }
}

async function executeRepair(prisma, organizationId, expected) {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      `SET LOCAL lock_timeout = '${TRANSACTION_LOCK_TIMEOUT_MS}ms'`,
    )
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      `social-monitoring-clean-slate:${organizationId}`,
    )

    const current = await loadExactLocalState(tx, organizationId, new Date())
    assertSameSnapshot(expected, current)
    const apifyToken = await readApifyToken(tx, organizationId)
    const remote = await verifyNoRemoteDispatch(
      current.providerRun,
      organizationId,
      apifyToken,
    )
    const finishedAt = new Date()

    const providerUpdate = await tx.socialProviderRun.updateMany({
      where: {
        id: current.providerRun.id,
        organizationId,
        sourceId: current.source.id,
        collectorRunId: current.collectorRun.id,
        routePlanId: current.providerRun.routePlanId,
        providerKey: current.providerRun.providerKey,
        actorId: current.providerRun.actorId,
        phase: PROVIDER_PHASE,
        status: "QUEUED",
        purgedAt: null,
        externalRunId: null,
        datasetId: null,
        startedAt: null,
        finishedAt: null,
        receivedCount: 0,
        acceptedCount: 0,
        reviewCount: 0,
        rejectedCount: 0,
        duplicateCount: 0,
        inputHash: current.providerRun.inputHash,
        reservedChargeUsd: current.providerRun.reservedChargeUsd,
        actualChargeUsd: current.providerRun.actualChargeUsd,
        lastError: current.providerRun.lastError,
        createdAt: current.providerRun.createdAt,
        updatedAt: current.providerRun.updatedAt,
      },
      data: {
        status: "BLOCKED",
        lastError: REPAIR_ERROR,
        reservedChargeUsd: 0,
        finishedAt,
      },
    })
    if (providerUpdate.count !== 1) fail("provider_cas_count_not_one")

    const sourceUpdate = await tx.monitoringSource.updateMany({
      where: {
        id: current.source.id,
        organizationId,
        status: current.source.status,
        runClaimToken: current.collectorRun.claimToken,
        runClaimVersion: current.collectorRun.claimVersion,
        runClaimExpiresAt: current.collectorRun.leaseExpiresAt,
        updatedAt: current.source.updatedAt,
      },
      data: {
        runClaimToken: null,
        runClaimExpiresAt: null,
        lastError: COLLECTOR_ERROR,
      },
    })
    if (sourceUpdate.count !== 1) fail("source_cas_count_not_one")

    const collectorUpdate = await tx.collectorRun.updateMany({
      where: {
        id: current.collectorRun.id,
        organizationId,
        sourceId: current.source.id,
        status: "running",
        finishedAt: null,
        claimToken: current.collectorRun.claimToken,
        claimVersion: current.collectorRun.claimVersion,
        leaseExpiresAt: current.collectorRun.leaseExpiresAt,
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
      },
      data: {
        status: "failed",
        finishedAt,
        error: COLLECTOR_ERROR,
      },
    })
    if (collectorUpdate.count !== 1) fail("collector_cas_count_not_one")

    return {
      remote,
      providerUpdated: providerUpdate.count,
      sourceUpdated: sourceUpdate.count,
      collectorUpdated: collectorUpdate.count,
    }
  }, {
    isolationLevel: "ReadCommitted",
    maxWait: 10_000,
    timeout: 60_000,
  })
}

async function main() {
  assertAllowedArguments()
  const prisma = await makeScriptPrisma()
  try {
    const organizations = await prisma.organization.findMany({
      where: { slug: TENANT_SLUG },
      select: { id: true },
    })
    if (organizations.length !== 1) fail("tenant_count_not_one")
    const organizationId = organizations[0].id
    const local = await loadExactLocalState(prisma, organizationId, new Date())

    console.log(
      `[repair-brandprotection-undispatched-apify-2026-07-29]` +
      ` mode=${execute ? "execute" : "dry-run"}` +
      ` providerCandidates=${local.counts.providerCandidates}` +
      ` matchingCollectors=${local.counts.matchingCollectors}`,
    )
    console.log(
      `  providerState=${local.providerRun.status}` +
      ` collectorState=${local.collectorRun.status}` +
      ` claimState=expired`,
    )
    console.log(
      `  mentions=${local.counts.mentions}` +
      ` evidence=${local.counts.evidence}` +
      ` linkedEnvelopes=${local.counts.linkedEnvelopes}`,
    )

    if (!execute) {
      const apifyToken = await readApifyToken(prisma, organizationId)
      const remote = await verifyNoRemoteDispatch(
        local.providerRun,
        organizationId,
        apifyToken,
      )
      console.log(
        `  apifyHistoryStatus=${remote.historyStatus}` +
        ` candidates=${remote.candidates}` +
        ` exactInputMatches=${remote.exactInputMatches}`,
      )
      console.log(`  result=verified_no_changes`)
      return
    }

    const repaired = await executeRepair(
      prisma,
      organizationId,
      local,
    )
    console.log(
      `  apifyHistoryStatus=${repaired.remote.historyStatus}` +
      ` candidates=${repaired.remote.candidates}` +
      ` exactInputMatches=${repaired.remote.exactInputMatches}`,
    )
    console.log(
      `  providerUpdated=${repaired.providerUpdated}` +
      ` sourceUpdated=${repaired.sourceUpdated}` +
      ` collectorUpdated=${repaired.collectorUpdated}`,
    )
    console.log(`  result=repaired`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  const code = error instanceof RepairError ? error.code : "unexpected_error"
  console.error(
    `[repair-brandprotection-undispatched-apify-2026-07-29]` +
    ` result=failed error=${code}`,
  )
  process.exitCode = 1
})
