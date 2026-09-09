// One-off, fail-closed cleanup for the accidental Baku Electronics profile run
// started on 2026-07-28 around 08:01 UTC.
//
// Default mode is READ-ONLY:
//   DATABASE_URL=... NEXTAUTH_SECRET=... \
//     node scripts/cleanup-baku-social-run-2026-07-28.mjs
//
// Execute only after reviewing the dry-run output:
//   DATABASE_URL=... NEXTAUTH_SECRET=... \
//     node scripts/cleanup-baku-social-run-2026-07-28.mjs --execute
//
// The browser's Stop button only stops the next source from being dispatched.
// If the exact Bright Data discovery snapshot below is still active, execution
// refuses unless the operator explicitly authorizes its remote cancellation:
//   ... node scripts/cleanup-baku-social-run-2026-07-28.mjs \
//     --execute --abort-active-parent
//
// This script never selects by timestamp alone. Tenant, scenario, subject,
// source, collector run, provider run, provider counters, envelope counts and
// dependency absence must all match the audited production snapshot.

import crypto from "node:crypto"
import { makeScriptPrisma } from "./_rls.mjs"

const TENANT = {
  slug: "brandprotection",
  id: "cmrc5m4oe000050dqdgp4nhqi",
}
const TARGET = {
  scenarioId: "18673488-5dc6-4c1c-b013-98ecf4530eb6",
  subjectId: "cmrx7toej014850ie96u846gk",
  name: "Baku Electronics",
}
const RUNS = [
  {
    providerRunId: "cms4dcd370fb7508e6b8r1vep",
    collectorRunId: "cms4dcd2o0fb5508ea2kwfith",
    sourceId: "cmrc5m4qz001h50dqff6lhqnd",
    phase: "DISCOVER_CANDIDATE_POSTS",
    providerStatus: "IMPORTED",
    receivedCount: 1000,
    acceptedCount: 974,
    reviewCount: 0,
    rejectedCount: 0,
    duplicateCount: 26,
    envelopeStatus: "PENDING",
    envelopeCount: 974,
  },
  {
    providerRunId: "cms4du7l80gyb508ef84ihkjc",
    collectorRunId: "cms4du6cx0gy7508ehi24wcq4",
    sourceId: "cmrc5m4r2001l50dqim0aucxv",
    phase: "ENRICH_CONTENT",
    providerStatus: "IMPORTED",
    receivedCount: 5,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 5,
    duplicateCount: 0,
    envelopeStatus: "REJECTED",
    envelopeCount: 5,
  },
]
const UPSTREAM_DISCOVERY = {
  providerRunId: "cms4du6dn0gy9508ev7z3ytpk",
  collectorRunId: "cms4du6cx0gy7508ehi24wcq4",
  sourceId: "cmrc5m4r2001l50dqim0aucxv",
  phase: "DISCOVER_CANDIDATE_POSTS",
}
const EXPECTED_ENVELOPE_COUNT = 979
const EXPECTED_METRIC_COUNT = 5
const ACTIVE_PROVIDER_STATUSES = new Set(["QUEUED", "RUNNING", "IMPORTING", "SUCCEEDED"])
const REMOTE_ACTIVE_STATUSES = new Set(["starting", "running"])
const REMOTE_TERMINAL_STATUSES = new Set(["ready", "failed"])
const CLEANUP_REASON = "operator_cleanup_accidental_profile_run_2026_07_28"
const BRIGHT_DATA_API = "https://api.brightdata.com"

const execute = process.argv.includes("--execute")
const abortActiveParent = process.argv.includes("--abort-active-parent")
if (abortActiveParent && !execute) {
  throw new Error("--abort-active-parent requires --execute")
}

function row(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function masterSecret() {
  const value = process.env.NEXTAUTH_SECRET?.trim()
  if (!value) throw new Error("NEXTAUTH_SECRET is required")
  return value
}

function deriveKey(purpose) {
  const base = crypto.createHash("sha256").update(masterSecret()).digest()
  const info = Buffer.from(`leaddrive:${purpose}`, "utf8")
  return crypto.createHmac("sha256", base).update(info).digest().subarray(0, 32)
}

function hmacToken(value, purpose) {
  return crypto
    .createHmac("sha256", deriveKey(`hmac:${purpose}`))
    .update(value, "utf8")
    .digest("hex")
}

function deletionIdentity(targetType, targetKey) {
  const targetKeyHmac = hmacToken(targetKey, `social-deletion:${TENANT.id}`)
  return {
    targetKeyHmac,
    idempotencyKey: `${targetType}:${targetKeyHmac}`,
  }
}

function providerTarget(run) {
  const snapshot = row(run.inputSnapshot)
  return {
    scenarioId: text(snapshot.leadDriveTargetScenarioId) ?? text(snapshot.targetScenarioId),
    subjectId: text(snapshot.leadDriveTargetSubjectId) ?? text(snapshot.targetSubjectId),
  }
}

async function cancelExactBrightDataSnapshot(parent) {
  const token = process.env.BRIGHT_DATA_API_TOKEN?.trim()
  if (!token) throw new Error("BRIGHT_DATA_API_TOKEN is unavailable; snapshot was not cancelled")
  if (!parent.externalRunId) throw new Error("active upstream discovery has no externalRunId")

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" }
  const inspect = await fetch(
    `${BRIGHT_DATA_API}/datasets/v3/progress/${encodeURIComponent(parent.externalRunId)}`,
    { headers },
  )
  if (!inspect.ok) throw new Error(`Bright Data snapshot inspection failed: HTTP ${inspect.status}`)
  const progress = row(await inspect.json())
  const returnedSnapshotId = text(progress.snapshot_id)
  if (returnedSnapshotId && returnedSnapshotId !== parent.externalRunId) {
    throw new Error("Bright Data snapshot inspection returned a mismatched snapshot_id")
  }
  const remoteStatus = text(progress.status)?.toLowerCase()
  if (!remoteStatus) throw new Error("Bright Data snapshot inspection returned no status")

  if (REMOTE_ACTIVE_STATUSES.has(remoteStatus)) {
    const cancelled = await fetch(
      `${BRIGHT_DATA_API}/datasets/v3/snapshot/${encodeURIComponent(parent.externalRunId)}/cancel`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json" } },
    )
    const body = (await cancelled.text()).trim()
    if (!cancelled.ok || body !== "OK") {
      throw new Error(
        `Bright Data snapshot cancellation failed: HTTP ${cancelled.status} `
        + `response=${JSON.stringify(body.slice(0, 120))}`,
      )
    }
    console.log("[cleanup-baku-run] exact Bright Data snapshot cancellation accepted")
    return "cancel_requested"
  }
  if (!REMOTE_TERMINAL_STATUSES.has(remoteStatus)) {
    throw new Error(`Bright Data snapshot returned unknown status: ${remoteStatus}`)
  }
  console.log(`[cleanup-baku-run] exact Bright Data snapshot is already terminal (${remoteStatus})`)
  return remoteStatus
}

async function inspect(prisma) {
  const organization = await prisma.organization.findFirst({
    where: { slug: TENANT.slug },
    select: { id: true, slug: true },
  })
  if (!organization) throw new Error(`tenant slug=${TENANT.slug} was not found`)
  assertEqual(organization.id, TENANT.id, "tenant id")

  const scenarioConfig = await prisma.channelConfig.findFirst({
    where: {
      organizationId: TENANT.id,
      channelType: "social_monitoring",
      configName: "Monitoring scenarios",
    },
    select: { settings: true },
  })
  const scenarios = Array.isArray(row(scenarioConfig?.settings).scenarios)
    ? row(scenarioConfig.settings).scenarios.map(row)
    : []
  const scenario = scenarios.find(item => text(item.id) === TARGET.scenarioId)
  if (!scenario) throw new Error(`scenario ${TARGET.scenarioId} was not found`)
  assertEqual(text(scenario.name), TARGET.name, "scenario name")
  assertEqual(text(scenario.subjectId), TARGET.subjectId, "scenario subject")

  const providerIds = RUNS.map(item => item.providerRunId)
  const providerRuns = await prisma.socialProviderRun.findMany({
    where: { organizationId: TENANT.id, id: { in: providerIds } },
    orderBy: { createdAt: "asc" },
  })
  assertEqual(providerRuns.length, RUNS.length, "provider run count")
  for (const expected of RUNS) {
    const actual = providerRuns.find(item => item.id === expected.providerRunId)
    if (!actual) throw new Error(`provider run ${expected.providerRunId} was not found`)
    for (const field of [
      "collectorRunId", "sourceId", "phase", "status", "receivedCount",
      "acceptedCount", "reviewCount", "rejectedCount", "duplicateCount",
    ]) {
      const expectedField = field === "status" ? "providerStatus" : field
      assertEqual(actual[field], expected[expectedField], `${actual.id}.${field}`)
    }
    assertEqual(actual.providerKey, "bright-data", `${actual.id}.providerKey`)
    assertEqual(actual.adapterKey, "BRIGHT_DATA_SNAPSHOT", `${actual.id}.adapterKey`)
    assertEqual(actual.parentRunId, null, `${actual.id}.parentRunId`)
    if (!actual.datasetId) throw new Error(`${actual.id}.datasetId is missing`)
    if (actual.purgedAt) throw new Error(`${actual.id} is already or partially purged`)
    const target = providerTarget(actual)
    assertEqual(target.scenarioId, TARGET.scenarioId, `${actual.id}.targetScenarioId`)
    assertEqual(target.subjectId, TARGET.subjectId, `${actual.id}.targetSubjectId`)
  }

  const collectorRuns = await prisma.collectorRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: RUNS.map(item => item.collectorRunId) },
    },
  })
  assertEqual(collectorRuns.length, RUNS.length, "collector run count")
  for (const expected of RUNS) {
    const actual = collectorRuns.find(item => item.id === expected.collectorRunId)
    if (!actual) throw new Error(`collector run ${expected.collectorRunId} was not found`)
    assertEqual(actual.sourceId, expected.sourceId, `${actual.id}.sourceId`)
    const stats = row(actual.rawStats)
    assertEqual(text(stats.targetScenarioId), TARGET.scenarioId, `${actual.id}.targetScenarioId`)
    assertEqual(text(stats.targetSubjectId), TARGET.subjectId, `${actual.id}.targetSubjectId`)
  }

  const envelopes = await prisma.ingestEnvelope.findMany({
    where: { organizationId: TENANT.id, providerRunId: { in: providerIds } },
    select: {
      id: true,
      providerRunId: true,
      relevanceStatus: true,
      acceptedMentionId: true,
      purgedAt: true,
      text: true,
      authorName: true,
      authorHandle: true,
      authorAvatar: true,
      url: true,
      canonicalUrl: true,
      parentPostUrl: true,
      rawPayload: true,
    },
  })
  assertEqual(envelopes.length, EXPECTED_ENVELOPE_COUNT, "total envelope count")
  for (const expected of RUNS) {
    const subset = envelopes.filter(item => item.providerRunId === expected.providerRunId)
    assertEqual(subset.length, expected.envelopeCount, `${expected.providerRunId}.envelopeCount`)
    const statuses = new Set(subset.map(item => item.relevanceStatus))
    assertEqual(statuses.size, 1, `${expected.providerRunId}.envelopeStatus cardinality`)
    assertEqual([...statuses][0], expected.envelopeStatus, `${expected.providerRunId}.envelopeStatus`)
  }
  assertEqual(envelopes.filter(item => item.acceptedMentionId !== null).length, 0, "linked mention count")
  assertEqual(envelopes.filter(item => item.purgedAt !== null).length, 0, "already-purged envelope count")

  // Keep this one-off script compatible with the currently deployed Prisma
  // client, which predates the TikTok revisit delegate even though the migrated
  // production table exists. Values remain parameterized and run under the
  // script's already-pinned RLS connection.
  const dependencyRows = await prisma.$queryRawUnsafe(`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "discovery_auto_review_decisions" AS d
        JOIN "ingest_envelopes" AS e
          ON e."organizationId" = d."organizationId"
         AND e.id = d."envelopeId"
        WHERE d."organizationId" = $1
          AND e."providerRunId" IN ($2, $3)
      ) AS "decisionCount",
      (
        SELECT COUNT(*)::int
        FROM "tiktok_publication_revisits" AS r
        JOIN "ingest_envelopes" AS e
          ON e."organizationId" = r."organizationId"
         AND e.id = r."ingestEnvelopeId"
        WHERE r."organizationId" = $1
          AND e."providerRunId" IN ($2, $3)
      ) AS "revisitCount",
      (
        SELECT COUNT(*)::int
        FROM "social_metric_snapshots"
        WHERE "organizationId" = $1
          AND "providerRunId" IN ($2, $3)
      ) AS "metricCount",
      (
        SELECT COUNT(*)::int
        FROM "social_mentions"
        WHERE "organizationId" = $1
          AND "sourceMetadata"->>'providerRunId' IN ($2, $3)
      ) AS "mentionMetadataCount"
  `, TENANT.id, providerIds[0], providerIds[1])
  const dependencies = row(dependencyRows[0])
  const decisionCount = Number(dependencies.decisionCount)
  const revisitCount = Number(dependencies.revisitCount)
  const metricCount = Number(dependencies.metricCount)
  const mentionMetadataCount = Number(dependencies.mentionMetadataCount)
  assertEqual(decisionCount, 0, "discovery auto-review decision count")
  assertEqual(revisitCount, 0, "TikTok revisit count")
  assertEqual(metricCount, EXPECTED_METRIC_COUNT, "provider metric count")
  assertEqual(mentionMetadataCount, 0, "provider-tagged mention count")

  const metricSnapshots = await prisma.socialMetricSnapshot.findMany({
    where: {
      organizationId: TENANT.id,
      providerRunId: { in: providerIds },
    },
    select: {
      id: true,
      providerRunId: true,
      mentionId: true,
    },
  })
  assertEqual(metricSnapshots.length, EXPECTED_METRIC_COUNT, "metric snapshot row count")
  assertEqual(
    metricSnapshots.filter(metric => metric.mentionId !== null).length,
    0,
    "metric snapshots linked to accepted mentions",
  )

  const parent = await prisma.socialProviderRun.findFirst({
    where: { organizationId: TENANT.id, id: UPSTREAM_DISCOVERY.providerRunId },
  })
  if (!parent) throw new Error(`upstream discovery ${UPSTREAM_DISCOVERY.providerRunId} was not found`)
  assertEqual(parent.collectorRunId, UPSTREAM_DISCOVERY.collectorRunId, "upstream collectorRunId")
  assertEqual(parent.sourceId, UPSTREAM_DISCOVERY.sourceId, "upstream sourceId")
  assertEqual(parent.phase, UPSTREAM_DISCOVERY.phase, "upstream phase")
  assertEqual(parent.providerKey, "bright-data", "upstream providerKey")
  assertEqual(parent.adapterKey, "BRIGHT_DATA_SNAPSHOT", "upstream adapterKey")
  assertEqual(parent.parentRunId, null, "upstream parentRunId")
  const parentTarget = providerTarget(parent)
  assertEqual(parentTarget.scenarioId, TARGET.scenarioId, "upstream targetScenarioId")
  assertEqual(parentTarget.subjectId, TARGET.subjectId, "upstream targetSubjectId")
  const parentEnvelopeCount = await prisma.ingestEnvelope.count({
    where: { organizationId: TENANT.id, providerRunId: parent.id },
  })
  assertEqual(parentEnvelopeCount, 0, "upstream envelope count")

  const cleanupLedgerKeys = [
    ...envelopes.map(envelope =>
      deletionIdentity("INGEST_ENVELOPE_RAW", envelope.id).idempotencyKey),
    ...metricSnapshots.map(metric =>
      deletionIdentity("SOCIAL_METRIC_SNAPSHOT", metric.id).idempotencyKey),
    ...[...providerRuns, parent].map(run =>
      deletionIdentity("PROVIDER_RUN_TRANSIT", run.id).idempotencyKey),
  ]
  const existingCleanupLedgerCount = await prisma.socialDeletionLedgerEntry.count({
    where: {
      organizationId: TENANT.id,
      idempotencyKey: { in: cleanupLedgerKeys },
    },
  })
  assertEqual(existingCleanupLedgerCount, 0, "pre-existing cleanup ledger count")

  return { providerRuns, parent, envelopes, metricSnapshots }
}

async function executeCleanup(prisma, snapshot, upstreamRemoteDisposition) {
  const now = new Date()
  const upstreamWasActive = ACTIVE_PROVIDER_STATUSES.has(snapshot.parent.status)
  if (upstreamWasActive && !upstreamRemoteDisposition) {
    throw new Error(
      `upstream discovery ${UPSTREAM_DISCOVERY.providerRunId} is ${snapshot.parent.status}; `
      + "run with --execute --abort-active-parent to cancel/quarantine that exact snapshot",
    )
  }

  const envelopeLedgerRows = snapshot.envelopes.map(envelope => {
    const identity = deletionIdentity("INGEST_ENVELOPE_RAW", envelope.id)
    return {
      organizationId: TENANT.id,
      idempotencyKey: identity.idempotencyKey,
      targetType: "INGEST_ENVELOPE_RAW",
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: "DATABASE",
      reason: CLEANUP_REASON,
      status: "COMPLETED",
      attempts: 1,
      requestedAt: now,
      dueAt: now,
      lastAttemptAt: now,
      completedAt: now,
      metadata: { priorStatus: envelope.relevanceStatus },
    }
  })
  const metricLedgerRows = snapshot.metricSnapshots.map(metric => {
    const identity = deletionIdentity("SOCIAL_METRIC_SNAPSHOT", metric.id)
    return {
      organizationId: TENANT.id,
      idempotencyKey: identity.idempotencyKey,
      targetType: "SOCIAL_METRIC_SNAPSHOT",
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: "DATABASE",
      reason: CLEANUP_REASON,
      status: "COMPLETED",
      attempts: 1,
      requestedAt: now,
      dueAt: now,
      lastAttemptAt: now,
      completedAt: now,
      metadata: { providerRunIdHmac: hmacToken(metric.providerRunId, "social-provider-run") },
    }
  })
  const transitRuns = [
    ...snapshot.providerRuns,
    snapshot.parent,
  ]
  const providerLedgerRows = transitRuns.map(run => {
    const identity = deletionIdentity("PROVIDER_RUN_TRANSIT", run.id)
    return {
      organizationId: TENANT.id,
      idempotencyKey: identity.idempotencyKey,
      targetType: "PROVIDER_RUN_TRANSIT",
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: "DATABASE",
      reason: CLEANUP_REASON,
      status: "COMPLETED",
      attempts: 1,
      requestedAt: now,
      dueAt: now,
      lastAttemptAt: now,
      completedAt: now,
      metadata: {
        brightDataSnapshotDisposition: run.id === UPSTREAM_DISCOVERY.providerRunId
          ? upstreamRemoteDisposition ?? "already_terminal_db"
          : "completed_auto_expires",
        remoteSnapshotRetentionDays: 16,
        sharedDatasetDefinitionPreserved: Boolean(run.datasetId),
      },
    }
  })

  await prisma.$transaction(async tx => {
    for (const expected of RUNS) {
      const updated = await tx.ingestEnvelope.updateMany({
        where: {
          organizationId: TENANT.id,
          providerRunId: expected.providerRunId,
          relevanceStatus: expected.envelopeStatus,
          acceptedMentionId: null,
          purgedAt: null,
        },
        data: {
          text: null,
          authorName: null,
          authorHandle: null,
          authorAvatar: null,
          url: null,
          canonicalUrl: null,
          parentPostUrl: null,
          rawPayload: {},
          relevanceStatus: "PURGED",
          relevanceReason: CLEANUP_REASON,
          relevanceConfidence: null,
          reviewMutationKey: null,
          reviewMutationUntil: null,
          purgeAt: now,
          purgedAt: now,
        },
      })
      assertEqual(updated.count, expected.envelopeCount, `${expected.providerRunId}.purged envelopes`)
    }

    const deletedMetrics = await tx.socialMetricSnapshot.deleteMany({
      where: {
        organizationId: TENANT.id,
        id: { in: snapshot.metricSnapshots.map(metric => metric.id) },
        providerRunId: { in: RUNS.map(run => run.providerRunId) },
        mentionId: null,
      },
    })
    assertEqual(deletedMetrics.count, EXPECTED_METRIC_COUNT, "deleted metric snapshots")

    await tx.socialDeletionLedgerEntry.createMany({
      data: [...envelopeLedgerRows, ...metricLedgerRows, ...providerLedgerRows],
      skipDuplicates: false,
    })

    for (const run of transitRuns) {
      const updated = await tx.socialProviderRun.updateMany({
        where: {
          organizationId: TENANT.id,
          id: run.id,
          purgedAt: null,
          datasetId: run.datasetId,
        },
        data: {
          inputSnapshot: {},
          webhookSecretHash: null,
          externalRunId: null,
          ...(run.id === UPSTREAM_DISCOVERY.providerRunId
            ? {
                status: "BLOCKED",
                lastError:
                  `operator_cleanup_bright_data_${upstreamRemoteDisposition ?? "already_terminal_db"}`,
                finishedAt: now,
              }
            : {}),
          purgedAt: now,
        },
      })
      assertEqual(updated.count, 1, `${run.id}.provider transit purge`)
    }
  }, { maxWait: 10_000, timeout: 60_000 })

  const postCleanupEnvelopes = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId: TENANT.id,
      providerRunId: { in: RUNS.map(item => item.providerRunId) },
    },
    select: {
      relevanceStatus: true,
      purgedAt: true,
      text: true,
      authorName: true,
      authorHandle: true,
      authorAvatar: true,
      url: true,
      canonicalUrl: true,
      parentPostUrl: true,
      rawPayload: true,
    },
  })
  const remainingRaw = postCleanupEnvelopes.filter(envelope =>
    envelope.purgedAt === null
    || envelope.relevanceStatus !== "PURGED"
    || envelope.text !== null
    || envelope.authorName !== null
    || envelope.authorHandle !== null
    || envelope.authorAvatar !== null
    || envelope.url !== null
    || envelope.canonicalUrl !== null
    || envelope.parentPostUrl !== null
    || JSON.stringify(envelope.rawPayload) !== "{}").length
  assertEqual(remainingRaw, 0, "post-cleanup raw envelope count")
  const remainingMetrics = await prisma.socialMetricSnapshot.count({
    where: {
      organizationId: TENANT.id,
      id: { in: snapshot.metricSnapshots.map(metric => metric.id) },
    },
  })
  assertEqual(remainingMetrics, 0, "post-cleanup metric snapshot count")
  const quarantinedRuns = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: transitRuns.map(run => run.id) },
    },
    select: {
      id: true,
      status: true,
      externalRunId: true,
      webhookSecretHash: true,
      inputSnapshot: true,
      purgedAt: true,
    },
  })
  assertEqual(quarantinedRuns.length, transitRuns.length, "post-cleanup provider run count")
  for (const run of quarantinedRuns) {
    assertEqual(run.externalRunId, null, `${run.id}.postCleanup.externalRunId`)
    assertEqual(run.webhookSecretHash, null, `${run.id}.postCleanup.webhookSecretHash`)
    assertEqual(JSON.stringify(run.inputSnapshot), "{}", `${run.id}.postCleanup.inputSnapshot`)
    if (!run.purgedAt) throw new Error(`${run.id}.postCleanup.purgedAt is missing`)
    if (run.id === UPSTREAM_DISCOVERY.providerRunId) {
      assertEqual(run.status, "BLOCKED", `${run.id}.postCleanup.status`)
    }
  }
  console.log(
    `[cleanup-baku-run] CLEANED ${EXPECTED_ENVELOPE_COUNT} envelopes and `
    + `${EXPECTED_METRIC_COUNT} unlinked metric snapshots; `
    + `${transitRuns.length} provider transit row(s) quarantined; `
    + "Bright Data completed snapshots will auto-expire",
  )
}

const prisma = await makeScriptPrisma()
try {
  console.log(
    `[cleanup-baku-run] mode=${execute ? "EXECUTE" : "DRY-RUN"} `
    + `tenant=${TENANT.slug} scenario=${TARGET.name}`,
  )
  const snapshot = await inspect(prisma)
  const activeParent = ACTIVE_PROVIDER_STATUSES.has(snapshot.parent.status)
  console.log(
    `[cleanup-baku-run] verified ${snapshot.envelopes.length} dependency-free envelopes `
    + `across ${snapshot.providerRuns.length} exact provider runs`,
  )
  console.log(
    `[cleanup-baku-run] upstream=${UPSTREAM_DISCOVERY.providerRunId} `
    + `status=${snapshot.parent.status}`,
  )

  if (!execute) {
    console.log(
      activeParent
        ? "[cleanup-baku-run] DRY-RUN OK; EXECUTE BLOCKED until the exact Bright Data snapshot is cancelled"
        : "[cleanup-baku-run] DRY-RUN OK; exact cleanup is ready",
    )
  } else {
    const upstreamRemoteDisposition = activeParent && abortActiveParent
      ? await cancelExactBrightDataSnapshot(snapshot.parent)
      : null
    await executeCleanup(prisma, snapshot, upstreamRemoteDisposition)
  }
} catch (error) {
  console.error("[cleanup-baku-run] REFUSED:", error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
