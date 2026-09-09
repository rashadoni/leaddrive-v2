// One-off, fail-closed cleanup for the Baku Electronics profile run started
// after the 2026-07-28 archive-window deployment.
//
// Default mode is READ-ONLY:
//   DATABASE_URL=... NEXTAUTH_SECRET=... BRIGHT_DATA_API_TOKEN=... \
//     node scripts/cleanup-baku-social-run-2026-07-28-followup.mjs
//
// Execute only after reviewing the dry-run:
//   ... node scripts/cleanup-baku-social-run-2026-07-28-followup.mjs --execute

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
const COLLECTOR_RUNS = [
  {
    id: "cms4h2th1000r50q2p2loy31y",
    sourceId: "cmrc5m4r4001n50dqupmm1wpv",
    status: "partial",
  },
  {
    id: "cms4h43by000z50q2exg116sr",
    sourceId: "cmrc5m4r5001p50dq9885dvle",
    status: "partial",
  },
]
const PROVIDER_RUNS = [
  {
    id: "cms4h2thz000t50q22e6ki15p",
    collectorRunId: COLLECTOR_RUNS[0].id,
    sourceId: COLLECTOR_RUNS[0].sourceId,
    providerKey: "APIFY",
    adapterKey: "APIFY_ASYNC",
    phase: "DISCOVER_CANDIDATE_POSTS",
    status: "PARTIAL",
    externalRunId: "ExQtcZ8WJKaVwAKh0",
    receivedCount: 1,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 1,
    duplicateCount: 0,
  },
  {
    id: "cms4h43cl001150q234z6wwnc",
    collectorRunId: COLLECTOR_RUNS[1].id,
    sourceId: COLLECTOR_RUNS[1].sourceId,
    providerKey: "bright-data",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "DISCOVER_CANDIDATE_POSTS",
    status: "RUNNING",
    externalRunId: "sd_ms4h55lv202n9xteiu",
    receivedCount: 0,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
  },
  {
    id: "cms4h55ru001350q2cns36jbt",
    collectorRunId: COLLECTOR_RUNS[1].id,
    sourceId: COLLECTOR_RUNS[1].sourceId,
    providerKey: "bright-data",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "ENRICH_CONTENT",
    status: "IMPORTED",
    externalRunId: "sd_ms4h56641j44oa4f3h",
    receivedCount: 10,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 10,
    duplicateCount: 0,
  },
  {
    id: "cms4h569v001550q2jihwd9x3",
    collectorRunId: COLLECTOR_RUNS[1].id,
    sourceId: COLLECTOR_RUNS[1].sourceId,
    providerKey: "bright-data",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "PAID_ROUTE_COLLECTION",
    status: "SUCCEEDED",
    receivedCount: 0,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
  },
]
const CANCELED_RUN_ID = "cms4h43cl001150q234z6wwnc"
const METRIC_RUN_ID = "cms4h55ru001350q2cns36jbt"
const EXPECTED_METRIC_COUNT = 10
const CLEANUP_REASON = "operator_cleanup_stale_profile_resume_2026_07_28"
const BRIGHT_DATA_API = "https://api.brightdata.com"
const execute = process.argv.includes("--execute")

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
  return crypto
    .createHmac("sha256", base)
    .update(Buffer.from(`leaddrive:${purpose}`, "utf8"))
    .digest()
    .subarray(0, 32)
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
    scenarioId: text(snapshot.leadDriveTargetScenarioId)
      ?? text(snapshot.targetScenarioId),
    subjectId: text(snapshot.leadDriveTargetSubjectId)
      ?? text(snapshot.targetSubjectId),
  }
}

async function assertCanceledSnapshot() {
  const token = process.env.BRIGHT_DATA_API_TOKEN?.trim()
  if (!token) throw new Error("BRIGHT_DATA_API_TOKEN is required")
  const expected = PROVIDER_RUNS.find(run => run.id === CANCELED_RUN_ID)
  if (!expected?.externalRunId) throw new Error("canceled run external id is missing")
  const response = await fetch(
    `${BRIGHT_DATA_API}/datasets/v3/progress/${encodeURIComponent(expected.externalRunId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  )
  if (!response.ok) {
    throw new Error(`Bright Data canceled-snapshot check failed: HTTP ${response.status}`)
  }
  const progress = row(await response.json())
  assertEqual(text(progress.snapshot_id), expected.externalRunId, "Bright Data snapshot id")
  assertEqual(text(progress.status)?.toLowerCase(), "canceled", "Bright Data snapshot status")
}

async function inspect(prisma) {
  const organization = await prisma.organization.findFirst({
    where: { slug: TENANT.slug },
    select: { id: true },
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
  assertEqual(text(row(scenario.archive).startAt), "2026-07-01T00:00:00.000Z", "archive start")

  const collectorRuns = await prisma.collectorRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: COLLECTOR_RUNS.map(run => run.id) },
    },
  })
  assertEqual(collectorRuns.length, COLLECTOR_RUNS.length, "collector run count")
  for (const expected of COLLECTOR_RUNS) {
    const actual = collectorRuns.find(run => run.id === expected.id)
    if (!actual) throw new Error(`collector run ${expected.id} was not found`)
    assertEqual(actual.sourceId, expected.sourceId, `${actual.id}.sourceId`)
    assertEqual(actual.status, expected.status, `${actual.id}.status`)
    const stats = row(actual.rawStats)
    assertEqual(text(stats.targetScenarioId), TARGET.scenarioId, `${actual.id}.targetScenarioId`)
    assertEqual(text(stats.targetSubjectId), TARGET.subjectId, `${actual.id}.targetSubjectId`)
    assertEqual(actual.foundCount, 0, `${actual.id}.foundCount`)
    assertEqual(actual.newCount, 0, `${actual.id}.newCount`)
    assertEqual(actual.ignoredCount, 0, `${actual.id}.ignoredCount`)
    assertEqual(actual.duplicateCount, 0, `${actual.id}.duplicateCount`)
  }

  const providerRuns = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: PROVIDER_RUNS.map(run => run.id) },
    },
    orderBy: { createdAt: "asc" },
  })
  assertEqual(providerRuns.length, PROVIDER_RUNS.length, "provider run count")
  for (const expected of PROVIDER_RUNS) {
    const actual = providerRuns.find(run => run.id === expected.id)
    if (!actual) throw new Error(`provider run ${expected.id} was not found`)
    for (const field of [
      "collectorRunId",
      "sourceId",
      "providerKey",
      "adapterKey",
      "phase",
      "status",
      "receivedCount",
      "acceptedCount",
      "reviewCount",
      "rejectedCount",
      "duplicateCount",
    ]) {
      assertEqual(actual[field], expected[field], `${actual.id}.${field}`)
    }
    assertEqual(actual.parentRunId, null, `${actual.id}.parentRunId`)
    assertEqual(actual.purgedAt, null, `${actual.id}.purgedAt`)
    if (expected.externalRunId) {
      assertEqual(actual.externalRunId, expected.externalRunId, `${actual.id}.externalRunId`)
    } else {
      assertEqual(actual.externalRunId, null, `${actual.id}.externalRunId`)
    }
    const target = providerTarget(actual)
    assertEqual(target.scenarioId, TARGET.scenarioId, `${actual.id}.targetScenarioId`)
    assertEqual(target.subjectId, TARGET.subjectId, `${actual.id}.targetSubjectId`)
  }

  const providerIds = PROVIDER_RUNS.map(run => run.id)
  const envelopeCount = await prisma.ingestEnvelope.count({
    where: { organizationId: TENANT.id, providerRunId: { in: providerIds } },
  })
  assertEqual(envelopeCount, 0, "ingest envelope count")

  const metrics = await prisma.socialMetricSnapshot.findMany({
    where: { organizationId: TENANT.id, providerRunId: { in: providerIds } },
    select: { id: true, providerRunId: true, mentionId: true },
  })
  assertEqual(metrics.length, EXPECTED_METRIC_COUNT, "metric snapshot count")
  assertEqual(
    metrics.filter(metric => metric.providerRunId === METRIC_RUN_ID).length,
    EXPECTED_METRIC_COUNT,
    "metric provider run count",
  )
  assertEqual(
    metrics.filter(metric => metric.mentionId !== null).length,
    0,
    "linked metric snapshot count",
  )

  const mentionCount = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "social_mentions"
    WHERE "organizationId" = $1
      AND "sourceMetadata"->>'providerRunId' IN ($2, $3, $4, $5)
  `, TENANT.id, ...providerIds)
  assertEqual(Number(row(mentionCount[0]).count), 0, "provider-tagged mention count")

  const cleanupIdentities = [
    ...metrics.map(metric => deletionIdentity("SOCIAL_METRIC_SNAPSHOT", metric.id)),
    ...providerRuns.map(run => deletionIdentity("PROVIDER_RUN_TRANSIT", run.id)),
  ]
  const existingLedgerCount = await prisma.socialDeletionLedgerEntry.count({
    where: {
      organizationId: TENANT.id,
      idempotencyKey: { in: cleanupIdentities.map(identity => identity.idempotencyKey) },
    },
  })
  assertEqual(existingLedgerCount, 0, "pre-existing cleanup ledger count")

  return { providerRuns, metrics, cleanupIdentities }
}

async function executeCleanup(prisma, snapshot) {
  const now = new Date()
  const ledgerRows = [
    ...snapshot.metrics.map(metric => {
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
    }),
    ...snapshot.providerRuns.map(run => {
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
          remoteSnapshotDisposition: run.id === CANCELED_RUN_ID
            ? "operator_canceled"
            : run.externalRunId
              ? "completed_auto_expires"
              : "none",
          sharedDatasetDefinitionPreserved: Boolean(run.datasetId),
        },
      }
    }),
  ]

  await prisma.$transaction(async tx => {
    const deletedMetrics = await tx.socialMetricSnapshot.deleteMany({
      where: {
        organizationId: TENANT.id,
        id: { in: snapshot.metrics.map(metric => metric.id) },
        providerRunId: METRIC_RUN_ID,
        mentionId: null,
      },
    })
    assertEqual(deletedMetrics.count, EXPECTED_METRIC_COUNT, "deleted metric snapshots")

    await tx.socialDeletionLedgerEntry.createMany({ data: ledgerRows })

    for (const run of snapshot.providerRuns) {
      const updated = await tx.socialProviderRun.updateMany({
        where: {
          organizationId: TENANT.id,
          id: run.id,
          purgedAt: null,
          externalRunId: run.externalRunId,
        },
        data: {
          inputSnapshot: {},
          webhookSecretHash: null,
          externalRunId: null,
          ...(run.id === CANCELED_RUN_ID
            ? {
                status: "BLOCKED",
                lastError: "operator_cleanup_bright_data_canceled",
                finishedAt: now,
              }
            : {}),
          purgedAt: now,
        },
      })
      assertEqual(updated.count, 1, `${run.id}.provider transit purge`)
    }
  }, { maxWait: 10_000, timeout: 60_000 })

  const remainingMetrics = await prisma.socialMetricSnapshot.count({
    where: {
      organizationId: TENANT.id,
      id: { in: snapshot.metrics.map(metric => metric.id) },
    },
  })
  assertEqual(remainingMetrics, 0, "post-cleanup metric snapshot count")
  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: snapshot.providerRuns.map(run => run.id) },
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
  assertEqual(runs.length, snapshot.providerRuns.length, "post-cleanup provider run count")
  for (const run of runs) {
    assertEqual(run.externalRunId, null, `${run.id}.externalRunId`)
    assertEqual(run.webhookSecretHash, null, `${run.id}.webhookSecretHash`)
    assertEqual(JSON.stringify(run.inputSnapshot), "{}", `${run.id}.inputSnapshot`)
    if (!run.purgedAt) throw new Error(`${run.id}.purgedAt is missing`)
    if (run.id === CANCELED_RUN_ID) {
      assertEqual(run.status, "BLOCKED", `${run.id}.status`)
    }
  }
  console.log(
    `[cleanup-baku-followup] CLEANED ${snapshot.metrics.length} unlinked metric snapshots; `
    + `${snapshot.providerRuns.length} provider transit rows quarantined`,
  )
}

const prisma = await makeScriptPrisma()
try {
  console.log(
    `[cleanup-baku-followup] mode=${execute ? "EXECUTE" : "DRY-RUN"} `
    + `tenant=${TENANT.slug} scenario=${TARGET.name}`,
  )
  await assertCanceledSnapshot()
  const snapshot = await inspect(prisma)
  console.log(
    `[cleanup-baku-followup] verified ${snapshot.metrics.length} unlinked metrics, `
    + "0 envelopes and 0 provider-tagged mentions",
  )
  if (execute) {
    await executeCleanup(prisma, snapshot)
  } else {
    console.log("[cleanup-baku-followup] DRY-RUN OK; exact cleanup is ready")
  }
} catch (error) {
  console.error(
    "[cleanup-baku-followup] REFUSED:",
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
