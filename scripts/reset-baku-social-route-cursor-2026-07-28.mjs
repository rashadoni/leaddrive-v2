// One-off, fail-closed reset for the single route/provider cursor advanced by
// the stopped Baku Electronics archive run on 2026-07-28.
//
// Default mode is READ-ONLY:
//   node --env-file=.env scripts/reset-baku-social-route-cursor-2026-07-28.mjs
//
// Execute only after reviewing the dry-run:
//   node --env-file=.env scripts/reset-baku-social-route-cursor-2026-07-28.mjs \
//     --execute --confirm=reset-baku-electronics-route-cursor-2026-07-28

import { makeScriptPrisma } from "./_rls.mjs"

const TENANT = {
  slug: "brandprotection",
  id: "cmrc5m4oe000050dqdgp4nhqi",
}
const TARGET = {
  scenarioId: "18673488-5dc6-4c1c-b013-98ecf4530eb6",
  subjectId: "cmrx7toej014850ie96u846gk",
  name: "Baku Electronics",
  archiveStartAt: "2026-07-01T00:00:00.000Z",
}
const SOURCE = {
  id: "cmrc5m4r5001p50dq9885dvle",
  platform: "facebook",
  sourceType: "profile",
  collectionMode: "search_index",
}
const CUTOFF = new Date("2026-07-28T09:47:00.000Z")
const CURSOR_KEY =
  "archive:v1:18673488-5dc6-4c1c-b013-98ecf4530eb6:1782864000000:"
  + "cmryssgbz009j50ugkma28ycj:BRIGHT_DATA_SNAPSHOT"
const EXPECTED_CURSOR = {
  reason: "bright_data_route_package_imported",
  updatedAt: "2026-07-28T09:51:22.845Z",
  adapterKey: "BRIGHT_DATA_SNAPSHOT",
  fetchAfter: "2026-07-28T09:49:34.468Z",
  routePlanId: "cmryssgbz009j50ugkma28ycj",
  archiveStartAt: TARGET.archiveStartAt,
  fullArchiveRun: true,
  targetScenarioId: TARGET.scenarioId,
}
const PROVIDER_RUNS = [
  {
    id: "cms4h2thz000t50q22e6ki15p",
    sourceId: "cmrc5m4r4001n50dqupmm1wpv",
    routePlanId: "cmrhqqi1p04r250vn2vy3le0e",
    adapterKey: "APIFY_ASYNC",
    phase: "DISCOVER_CANDIDATE_POSTS",
    status: "PARTIAL",
  },
  {
    id: "cms4h43cl001150q234z6wwnc",
    sourceId: SOURCE.id,
    routePlanId: "cmryssgbx009h50ug6cl76m7k",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "DISCOVER_CANDIDATE_POSTS",
    status: "BLOCKED",
  },
  {
    id: "cms4h55ru001350q2cns36jbt",
    sourceId: SOURCE.id,
    routePlanId: EXPECTED_CURSOR.routePlanId,
    adapterKey: EXPECTED_CURSOR.adapterKey,
    phase: "ENRICH_CONTENT",
    status: "IMPORTED",
  },
  {
    id: "cms4h569v001550q2jihwd9x3",
    sourceId: SOURCE.id,
    routePlanId: "cmryssgc4009p50ug6f9jobsr",
    adapterKey: "BRIGHT_DATA_SNAPSHOT",
    phase: "PAID_ROUTE_COLLECTION",
    status: "SUCCEEDED",
  },
]
const CONFIRMATION = "reset-baku-electronics-route-cursor-2026-07-28"
const execute = process.argv.includes("--execute")
const confirmation = process.argv.find(value => value.startsWith("--confirm="))?.slice("--confirm=".length)

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  )
}

function assertJsonEqual(actual, expected, label) {
  assertEqual(JSON.stringify(canonical(actual)), JSON.stringify(canonical(expected)), label)
}

function routeProviderCursors(settings) {
  return row(row(settings).searchIndex).routeProviderCursors
}

function settingsWithoutTargetCursor(settings) {
  const next = structuredClone(row(settings))
  const searchIndex = row(next.searchIndex)
  const cursors = row(searchIndex.routeProviderCursors)
  delete cursors[CURSOR_KEY]
  searchIndex.routeProviderCursors = cursors
  next.searchIndex = searchIndex
  return next
}

async function assertScenario(prisma) {
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
  assertEqual(text(row(scenario.archive).startAt), TARGET.archiveStartAt, "scenario archive start")
}

async function assertProviderRuns(prisma) {
  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: TENANT.id,
      id: { in: PROVIDER_RUNS.map(run => run.id) },
    },
    select: {
      id: true,
      sourceId: true,
      routePlanId: true,
      adapterKey: true,
      phase: true,
      status: true,
      externalRunId: true,
      webhookSecretHash: true,
      inputSnapshot: true,
      createdAt: true,
      purgedAt: true,
    },
  })
  assertEqual(runs.length, PROVIDER_RUNS.length, "provider run count")
  for (const expected of PROVIDER_RUNS) {
    const actual = runs.find(run => run.id === expected.id)
    if (!actual) throw new Error(`provider run ${expected.id} was not found`)
    for (const field of ["sourceId", "routePlanId", "adapterKey", "phase", "status"]) {
      assertEqual(actual[field], expected[field], `${expected.id}.${field}`)
    }
    if (actual.createdAt < CUTOFF) {
      throw new Error(`${expected.id}.createdAt predates the audited run cutoff`)
    }
    if (!actual.purgedAt) throw new Error(`${expected.id}.purgedAt is missing`)
    assertEqual(actual.externalRunId, null, `${expected.id}.externalRunId`)
    assertEqual(actual.webhookSecretHash, null, `${expected.id}.webhookSecretHash`)
    assertJsonEqual(actual.inputSnapshot, {}, `${expected.id}.inputSnapshot`)
  }
  return runs
}

async function assertOnlyExpectedAffectedCursor(prisma, providerRuns) {
  const signatures = new Set(
    providerRuns.map(run => `${run.sourceId}:${run.routePlanId}:${run.adapterKey}`),
  )
  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: TENANT.id },
    select: { id: true, settings: true },
  })
  const candidates = []
  for (const source of sources) {
    const cursors = row(routeProviderCursors(source.settings))
    for (const [key, value] of Object.entries(cursors)) {
      const cursor = row(value)
      const updatedAt = text(cursor.updatedAt)
      const updatedAtDate = updatedAt ? new Date(updatedAt) : null
      const signature =
        `${source.id}:${text(cursor.routePlanId) ?? ""}:${text(cursor.adapterKey) ?? ""}`
      const advancedAfterCutoff = Boolean(
        updatedAtDate
        && Number.isFinite(updatedAtDate.getTime())
        && updatedAtDate >= CUTOFF,
      )
      if (advancedAfterCutoff || signatures.has(signature)) {
        candidates.push({ sourceId: source.id, key, value: cursor })
      }
    }
  }
  assertEqual(candidates.length, 1, "affected route/provider cursor count")
  assertEqual(candidates[0].sourceId, SOURCE.id, "affected cursor source")
  assertEqual(candidates[0].key, CURSOR_KEY, "affected cursor key")
  assertJsonEqual(candidates[0].value, EXPECTED_CURSOR, "affected cursor value")
}

async function inspect(prisma) {
  const organization = await prisma.organization.findFirst({
    where: { slug: TENANT.slug },
    select: { id: true },
  })
  if (!organization) throw new Error(`tenant slug=${TENANT.slug} was not found`)
  assertEqual(organization.id, TENANT.id, "tenant id")
  await assertScenario(prisma)
  const providerRuns = await assertProviderRuns(prisma)
  await assertOnlyExpectedAffectedCursor(prisma, providerRuns)

  const source = await prisma.monitoringSource.findFirst({
    where: { organizationId: TENANT.id, id: SOURCE.id },
    select: {
      id: true,
      platform: true,
      sourceType: true,
      collectionMode: true,
      settings: true,
    },
  })
  if (!source) throw new Error(`source ${SOURCE.id} was not found`)
  for (const field of ["platform", "sourceType", "collectionMode"]) {
    assertEqual(source[field], SOURCE[field], `source.${field}`)
  }
  assertJsonEqual(
    row(routeProviderCursors(source.settings))[CURSOR_KEY],
    EXPECTED_CURSOR,
    "source cursor",
  )
  return source
}

async function resetCursor(prisma, auditedSource) {
  const expectedSettings = settingsWithoutTargetCursor(auditedSource.settings)
  await prisma.$transaction(async tx => {
    const before = await tx.monitoringSource.findFirst({
      where: { organizationId: TENANT.id, id: SOURCE.id },
      select: { settings: true },
    })
    if (!before) throw new Error(`source ${SOURCE.id} disappeared before reset`)
    assertJsonEqual(before.settings, auditedSource.settings, "pre-reset source settings")

    const updated = await tx.$executeRawUnsafe(`
      UPDATE monitoring_sources
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{searchIndex,routeProviderCursors}',
        COALESCE(settings->'searchIndex'->'routeProviderCursors', '{}'::jsonb)
          - ($3::text),
        true
      )
      WHERE id = $1
        AND "organizationId" = $2
        AND settings->'searchIndex'->'routeProviderCursors'->($3::text) = $4::jsonb
    `, SOURCE.id, TENANT.id, CURSOR_KEY, JSON.stringify(EXPECTED_CURSOR))
    assertEqual(updated, 1, "updated source count")

    const after = await tx.monitoringSource.findFirst({
      where: { organizationId: TENANT.id, id: SOURCE.id },
      select: { settings: true },
    })
    if (!after) throw new Error(`source ${SOURCE.id} disappeared after reset`)
    assertJsonEqual(after.settings, expectedSettings, "post-reset source settings")
  }, { maxWait: 10_000, timeout: 60_000 })

  const verified = await prisma.monitoringSource.findFirst({
    where: { organizationId: TENANT.id, id: SOURCE.id },
    select: { settings: true },
  })
  if (!verified) throw new Error(`source ${SOURCE.id} disappeared after commit`)
  assertJsonEqual(verified.settings, expectedSettings, "committed source settings")
  assertEqual(
    Object.hasOwn(row(routeProviderCursors(verified.settings)), CURSOR_KEY),
    false,
    "committed cursor presence",
  )
}

if (execute && confirmation !== CONFIRMATION) {
  throw new Error(`--execute requires --confirm=${CONFIRMATION}`)
}

const prisma = await makeScriptPrisma()
try {
  console.log(
    `[reset-baku-route-cursor] mode=${execute ? "EXECUTE" : "DRY-RUN"} `
    + `tenant=${TENANT.slug} scenario=${TARGET.name}`,
  )
  const source = await inspect(prisma)
  console.log(
    `[reset-baku-route-cursor] verified exactly one affected cursor: `
    + `source=${SOURCE.id} key=${CURSOR_KEY}`,
  )
  if (execute) {
    await resetCursor(prisma, source)
    console.log("[reset-baku-route-cursor] RESET 1 cursor; all other source settings preserved")
  } else {
    console.log("[reset-baku-route-cursor] DRY-RUN OK; exact one-key reset is ready")
  }
} catch (error) {
  console.error(
    "[reset-baku-route-cursor] REFUSED:",
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
