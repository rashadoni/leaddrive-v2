// Fail-closed clean-slate reset for tenant-wide Social Monitoring operational
// data in the dedicated Brand Protection tenant.
//
// Dry-run (default):
//   DATABASE_URL=... node scripts/reset-brandprotection-scenario-monitoring.mjs
//
// Execute only after reviewing the dry-run:
//   DATABASE_URL=... node scripts/reset-brandprotection-scenario-monitoring.mjs \
//     --execute --confirm=reset-brandprotection-scenario-monitoring
//
// The reset preserves scenarios, monitored subjects, keywords/hashtags,
// independent source definitions and provider configuration. It removes
// scenario findings, operational run/spend history and dedupe/cursor state so
// the same public items can be collected again in a deliberate clean-slate
// test. Minimal PURGED provider tombstones remain for late callback
// authentication while their owning source definitions exist; an immutable
// aggregate financial snapshot is appended to the reset boundary. Operational
// reports start at that boundary. The boundary retains only cumulative,
// content-free enforcement counters; detailed operational finance is removed.
// Scenarios are left paused (or draft when they only had retired direct-page
// targets) so the five-minute collector cannot refill the baseline before the
// operator intentionally resumes one.

import crypto from "node:crypto"
import { makeScriptPrisma } from "./_rls.mjs"

const TENANT = {
  id: "cmrc5m4oe000050dqdgp4nhqi",
  slug: "brandprotection",
  name: "Brand Protection",
}
const CONFIRMATION = "reset-brandprotection-scenario-monitoring"
const APIFY_API = "https://api.apify.com/v2"
const BRIGHT_DATA_API = "https://api.brightdata.com"
const ACTIVE_LOCAL_PROVIDER_STATUSES = new Set(["QUEUED", "RUNNING", "SUCCEEDED", "IMPORTING"])
const REMOTE_ACTIVE_LOCAL_PROVIDER_STATUSES = new Set(["QUEUED", "RUNNING"])
const ACTIVE_APIFY_STATUSES = new Set(["READY", "RUNNING", "ABORTING"])
const TERMINAL_APIFY_STATUSES = new Set(["SUCCEEDED", "FAILED", "TIMING-OUT", "TIMED-OUT", "ABORTED"])
const ACTIVE_BRIGHT_DATA_STATUSES = new Set(["starting", "running"])
const TERMINAL_BRIGHT_DATA_STATUSES = new Set(["ready", "failed", "canceled"])
const PROVIDER_REQUEST_TIMEOUT_MS = 10_000
const PROVIDER_QUIESCE_CONCURRENCY = 8
const RESET_BUDGET_CARRY_SCHEMA_VERSION = "social-monitoring-budget-carry-v1"
// Must remain aligned with PAID_SOCIAL_HARD_MAX_PER_RUN_USD. Legacy
// authorization rows are conservatively bounded at the same immutable fuse.
const STANDARD_PAID_RUN_HARD_CAP_USD = 4
const execute = process.argv.includes("--execute")
const confirmation = process.argv
  .find(value => value.startsWith("--confirm="))
  ?.slice("--confirm=".length)

function serialize(value) {
  if (typeof value === "bigint") return Number(value)
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === "object" && typeof value.toJSON === "function") {
    return serialize(value.toJSON())
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  }
  return value
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function providerToken(name) {
  const value = text(process.env[name])
  if (!value) throw new Error(`${name} is required to quiesce active provider runs`)
  return value
}

function masterSecret() {
  const value = text(process.env.NEXTAUTH_SECRET)
  if (!value) throw new Error("NEXTAUTH_SECRET is required to queue provider dataset deletion")
  return value
}

function hmacToken(value, purpose) {
  const base = crypto.createHash("sha256").update(masterSecret()).digest()
  const info = Buffer.from(`leaddrive:hmac:${purpose}`, "utf8")
  const key = crypto.createHmac("sha256", base).update(info).digest().subarray(0, 32)
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex")
}

function deletionIdentity(organizationId, targetType, targetKey) {
  const targetKeyHmac = hmacToken(targetKey, `social-deletion:${organizationId}`)
  return {
    targetKeyHmac,
    idempotencyKey: `${targetType}:${targetKeyHmac}`,
  }
}

async function responseJson(response, label) {
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} response=${JSON.stringify(body.slice(0, 160))}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

async function fetchProvider(url, init, label) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${label} failed before a response within ${PROVIDER_REQUEST_TIMEOUT_MS}ms: ${message}`,
      { cause: error },
    )
  }
}

async function mapWithBoundedConcurrency(items, concurrency, mapper) {
  const results = []
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const batch = items.slice(offset, offset + concurrency)
    const settled = await Promise.allSettled(batch.map(mapper))
    const failures = settled
      .filter(result => result.status === "rejected")
      .map(result => result.reason)
    if (failures.length > 0) {
      const details = failures
        .map(error => error instanceof Error ? error.message : String(error))
        .join("; ")
      throw new AggregateError(
        failures,
        `provider quiescence failed for batch at offset ${offset}: ${details}`,
      )
    }
    results.push(...settled.map(result => result.value))
  }
  return results
}

async function quiesceApifyRun(run) {
  if (!run.externalRunId) return { providerRunId: run.id, outcome: "no_external_run" }
  const token = providerToken("APIFY_API_TOKEN")
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` }
  const inspect = await fetchProvider(
    `${APIFY_API}/actor-runs/${encodeURIComponent(run.externalRunId)}`,
    { headers },
    `Apify run ${run.id} inspection`,
  )
  const inspected = record((await responseJson(inspect, `Apify run ${run.id} inspection`)).data)
  if (text(inspected.id) !== run.externalRunId) {
    throw new Error(`Apify run ${run.id} inspection returned a mismatched id`)
  }
  const status = text(inspected.status)?.toUpperCase()
  if (!status) throw new Error(`Apify run ${run.id} inspection returned no status`)
  if (ACTIVE_APIFY_STATUSES.has(status)) {
    const aborted = await fetchProvider(
      `${APIFY_API}/actor-runs/${encodeURIComponent(run.externalRunId)}/abort`,
      { method: "POST", headers },
      `Apify run ${run.id} abort`,
    )
    const result = record((await responseJson(aborted, `Apify run ${run.id} abort`)).data)
    if (text(result.id) !== run.externalRunId) {
      throw new Error(`Apify run ${run.id} abort returned a mismatched id`)
    }
    return { providerRunId: run.id, outcome: "abort_requested" }
  }
  if (!TERMINAL_APIFY_STATUSES.has(status)) {
    throw new Error(`Apify run ${run.id} returned unknown status ${status}`)
  }
  return { providerRunId: run.id, outcome: `terminal_${status.toLowerCase()}` }
}

async function quiesceBrightDataRun(run) {
  if (!run.externalRunId) return { providerRunId: run.id, outcome: "no_external_run" }
  const token = providerToken("BRIGHT_DATA_API_TOKEN")
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` }
  const inspect = await fetchProvider(
    `${BRIGHT_DATA_API}/datasets/v3/progress/${encodeURIComponent(run.externalRunId)}`,
    { headers },
    `Bright Data run ${run.id} inspection`,
  )
  const progress = record(await responseJson(inspect, `Bright Data run ${run.id} inspection`))
  const returnedId = text(progress.snapshot_id)
  if (returnedId && returnedId !== run.externalRunId) {
    throw new Error(`Bright Data run ${run.id} inspection returned a mismatched snapshot_id`)
  }
  const status = text(progress.status)?.toLowerCase()
  if (!status) throw new Error(`Bright Data run ${run.id} inspection returned no status`)
  if (ACTIVE_BRIGHT_DATA_STATUSES.has(status)) {
    const cancelled = await fetchProvider(
      `${BRIGHT_DATA_API}/datasets/v3/snapshot/${encodeURIComponent(run.externalRunId)}/cancel`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      },
      `Bright Data run ${run.id} cancellation`,
    )
    const body = (await cancelled.text()).trim()
    if (!cancelled.ok || body !== "OK") {
      throw new Error(
        `Bright Data run ${run.id} cancellation failed: HTTP ${cancelled.status} `
        + `response=${JSON.stringify(body.slice(0, 160))}`,
      )
    }
    return { providerRunId: run.id, outcome: "cancel_requested" }
  }
  if (!TERMINAL_BRIGHT_DATA_STATUSES.has(status)) {
    throw new Error(`Bright Data run ${run.id} returned unknown status ${status}`)
  }
  return { providerRunId: run.id, outcome: `terminal_${status}` }
}

async function quiesceProviderRun(run) {
  const status = text(run.status)?.toUpperCase()
  if (!status || !ACTIVE_LOCAL_PROVIDER_STATUSES.has(status)) {
    throw new Error(`provider run ${run.id} has unknown local status ${String(run.status)}`)
  }
  if (
    run.externalRunId
    && run.providerKey !== "APIFY"
    && run.providerKey !== "bright-data"
  ) {
    throw new Error(
      `active provider run ${run.id} uses unsupported provider ${run.providerKey}; refusing reset`,
    )
  }
  if (status === "SUCCEEDED") {
    return { providerRunId: run.id, outcome: "local_succeeded_remote_terminal" }
  }
  if (status === "IMPORTING") {
    return { providerRunId: run.id, outcome: "local_importing_import_stage" }
  }
  if (!REMOTE_ACTIVE_LOCAL_PROVIDER_STATUSES.has(status)) {
    throw new Error(`provider run ${run.id} cannot be remotely quiesced from status ${status}`)
  }
  if (!run.externalRunId) {
    if (status === "RUNNING") {
      throw new Error(
        `provider run ${run.id} is RUNNING without an external id`
        + ` (${text(run.lastError) ?? "unknown dispatch state"}); refusing reset`,
      )
    }
    return { providerRunId: run.id, outcome: "no_external_run" }
  }
  if (run.providerKey === "APIFY") return quiesceApifyRun(run)
  if (run.providerKey === "bright-data") return quiesceBrightDataRun(run)
  throw new Error(
    `active provider run ${run.id} uses unsupported provider ${run.providerKey}; refusing reset`,
  )
}

async function materializeScope(tx, organizationId) {
  const statements = [
    `
      CREATE TEMP TABLE _cs_scenarios(
        scenario_id text PRIMARY KEY,
        subject_id text
      ) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_scenarios(scenario_id, subject_id)
      SELECT
        scenario.value->>'id',
        NULLIF(scenario.value->>'subjectId', '')
      FROM channel_configs AS config
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(config.settings, '{}'::jsonb)->'scenarios') = 'array'
            THEN config.settings->'scenarios'
          ELSE '[]'::jsonb
        END
      ) AS scenario(value)
      WHERE config."organizationId" = $1
        AND config."channelType" = 'social_monitoring'
        AND config."configName" = 'Monitoring scenarios'
        AND NULLIF(scenario.value->>'id', '') IS NOT NULL
    `,
    `
      CREATE TEMP TABLE _cs_subjects(subject_id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_subjects(subject_id)
      SELECT subject.id
      FROM monitoring_subjects AS subject
      WHERE subject."organizationId" = $1
      UNION
      SELECT DISTINCT subject_id
      FROM _cs_scenarios
      WHERE subject_id IS NOT NULL
    `,
    `
      CREATE TEMP TABLE _cs_sources(
        id text PRIMARY KEY,
        scenario_managed boolean NOT NULL
      ) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_sources(id, scenario_managed)
      SELECT DISTINCT
        source.id,
        COALESCE(source.settings->>'managedBy', '') IN ('monitoring_scenario', 'google_alerts_rss')
      FROM monitoring_sources AS source
      WHERE source."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_direct_sources(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_direct_sources(id)
      SELECT source.id
      FROM monitoring_sources AS source
      JOIN _cs_sources AS scoped ON scoped.id = source.id
      WHERE source."organizationId" = $1
        AND (
          source."sourceType" IN ('profile', 'page', 'search_url')
          OR source.settings->>'scenarioTargetType' IN ('handle', 'url')
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(source.settings->'scenarioLinks') = 'array'
                  THEN source.settings->'scenarioLinks'
                ELSE '[]'::jsonb
              END
            ) AS link
            WHERE link->>'targetType' IN ('handle', 'url')
          )
        )
        AND (
          COALESCE(source.settings->>'managedBy', '') = 'monitoring_scenario'
          OR source.settings->>'scenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(source.settings->'scenarioLinks') = 'array'
                  THEN source.settings->'scenarioLinks'
                ELSE '[]'::jsonb
              END
            ) AS link
            WHERE link->>'scenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
              AND link->>'targetType' IN ('handle', 'url')
          )
        )
    `,
    `
      CREATE TEMP TABLE _cs_direct_bindings(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_direct_bindings(id)
      SELECT binding.id
      FROM monitoring_subject_sources AS binding
      JOIN monitoring_sources AS source
        ON source."organizationId" = binding."organizationId"
        AND source.id = binding."sourceId"
      WHERE binding."organizationId" = $1
        AND binding."subjectId" IN (SELECT subject_id FROM _cs_subjects)
        AND binding."relationType" = 'MONITORS'
        AND (
          COALESCE(source.settings->>'managedBy', '') = 'monitoring_scenario'
          OR binding."scenarioId" IN (SELECT scenario_id FROM _cs_scenarios)
          OR source.settings->>'scenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(source.settings->'scenarioLinks') = 'array'
                  THEN source.settings->'scenarioLinks'
                ELSE '[]'::jsonb
              END
            ) AS link
            WHERE link->>'scenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
              AND link->>'targetType' IN ('handle', 'url')
          )
        )
        AND (
          source.url IS NOT NULL
          OR source.handle IS NOT NULL
          OR source."sourceType" IN (
            'profile',
            'page',
            'search_url',
            'competitor',
            'influencer'
          )
        )
    `,
    `
      INSERT INTO _cs_sources(id, scenario_managed)
      SELECT DISTINCT
        source.id,
        COALESCE(source.settings->>'managedBy', '') IN ('monitoring_scenario', 'google_alerts_rss')
      FROM monitoring_subject_sources AS binding
      JOIN _cs_direct_bindings AS direct_binding ON direct_binding.id = binding.id
      JOIN monitoring_sources AS source
        ON source."organizationId" = binding."organizationId"
        AND source.id = binding."sourceId"
      WHERE binding."organizationId" = $1
      ON CONFLICT (id) DO UPDATE
      SET scenario_managed = _cs_sources.scenario_managed OR EXCLUDED.scenario_managed
    `,
    `
      INSERT INTO _cs_direct_sources(id)
      SELECT DISTINCT binding."sourceId"
      FROM monitoring_subject_sources AS binding
      JOIN _cs_direct_bindings AS direct_binding ON direct_binding.id = binding.id
      WHERE binding."organizationId" = $1
      ON CONFLICT DO NOTHING
    `,
    `
      CREATE TEMP TABLE _cs_routes(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_routes(id)
      SELECT route.id
      FROM source_route_plans AS route
      WHERE route."organizationId" = $1
        AND (
          route."sourceId" IN (SELECT id FROM _cs_sources)
          OR route."sourceId" IN (SELECT id FROM _cs_direct_sources)
          OR route."scenarioId" IN (SELECT scenario_id FROM _cs_scenarios)
        )
    `,
    `
      CREATE TEMP TABLE _cs_collectors(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_collectors(id)
      SELECT run.id
      FROM collector_runs AS run
      WHERE run."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_provider_runs(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_provider_runs(id)
      WITH RECURSIVE family(id, "parentRunId") AS (
        SELECT run.id, run."parentRunId"
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND (
            run."sourceId" IN (
              SELECT id FROM _cs_sources WHERE scenario_managed
            )
            OR run."routePlanId" IN (SELECT id FROM _cs_routes)
            OR run."collectorRunId" IN (SELECT id FROM _cs_collectors)
            OR run."inputSnapshot"->>'targetScenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
            OR run."inputSnapshot"->>'leadDriveTargetScenarioId' IN (SELECT scenario_id FROM _cs_scenarios)
            OR run."inputSnapshot"->>'targetSubjectId' IN (SELECT subject_id FROM _cs_subjects)
            OR run."inputSnapshot"->>'leadDriveTargetSubjectId' IN (SELECT subject_id FROM _cs_subjects)
          )
        UNION
        SELECT run.id, run."parentRunId"
        FROM social_provider_runs AS run
        JOIN family
          ON run."parentRunId" = family.id
        WHERE run."organizationId" = $1
      )
      SELECT DISTINCT id FROM family
    `,
    `
      INSERT INTO _cs_collectors(id)
      SELECT DISTINCT run."collectorRunId"
      FROM social_provider_runs AS run
      WHERE run."organizationId" = $1
        AND run.id IN (SELECT id FROM _cs_provider_runs)
        AND run."collectorRunId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    `
      CREATE TEMP TABLE _cs_financial_runs(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_financial_runs(id)
      SELECT run.id
      FROM social_provider_runs AS run
      WHERE run."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_envelopes(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_envelopes(id)
      SELECT envelope.id
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_mentions(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_mentions(id)
      SELECT mention.id
      FROM social_mentions AS mention
      WHERE mention."organizationId" = $1
    `,
    `
      INSERT INTO _cs_envelopes(id)
      SELECT envelope.id
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope."acceptedMentionId" IN (SELECT id FROM _cs_mentions)
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_mentions(id)
      SELECT envelope."acceptedMentionId"
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope.id IN (SELECT id FROM _cs_envelopes)
        AND envelope."acceptedMentionId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    `
      CREATE TEMP TABLE _cs_subject_only_mentions(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_subject_only_mentions(id)
      SELECT mention.id
      FROM social_mentions AS mention
      WHERE mention."organizationId" = $1
        AND mention.id NOT IN (SELECT id FROM _cs_mentions)
        AND EXISTS (
          SELECT 1
          FROM social_mention_subject_matches AS subject_match
          WHERE subject_match."organizationId" = $1
            AND subject_match."mentionId" = mention.id
            AND subject_match."subjectId" IN (SELECT subject_id FROM _cs_subjects)
        )
    `,
    `
      INSERT INTO _cs_mentions(id)
      SELECT id
      FROM _cs_subject_only_mentions
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_envelopes(id)
      SELECT envelope.id
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope."acceptedMentionId" IN (SELECT id FROM _cs_mentions)
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_mentions(id)
      SELECT envelope."acceptedMentionId"
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope.id IN (SELECT id FROM _cs_envelopes)
        AND envelope."acceptedMentionId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_collectors(id)
      SELECT DISTINCT envelope."collectorRunId"
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope.id IN (SELECT id FROM _cs_envelopes)
        AND envelope."collectorRunId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_provider_runs(id)
      WITH RECURSIVE family(id, "parentRunId") AS (
        SELECT run.id, run."parentRunId"
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND (
            run.id IN (SELECT id FROM _cs_provider_runs)
            OR run."collectorRunId" IN (SELECT id FROM _cs_collectors)
          )
        UNION
        SELECT child.id, child."parentRunId"
        FROM social_provider_runs AS child
        JOIN family ON child."parentRunId" = family.id
        WHERE child."organizationId" = $1
      )
      SELECT DISTINCT id FROM family
      ON CONFLICT DO NOTHING
    `,
    `
      INSERT INTO _cs_collectors(id)
      SELECT DISTINCT run."collectorRunId"
      FROM social_provider_runs AS run
      WHERE run."organizationId" = $1
        AND run.id IN (SELECT id FROM _cs_provider_runs)
        AND run."collectorRunId" IS NOT NULL
      ON CONFLICT DO NOTHING
    `,
    `
      CREATE TEMP TABLE _cs_parent_urls(value text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_parent_urls(value)
      SELECT value
      FROM (
        SELECT NULLIF(envelope."parentPostUrl", '') AS value
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope.id IN (SELECT id FROM _cs_envelopes)
        UNION
        SELECT NULLIF(envelope."canonicalUrl", '') AS value
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope.id IN (SELECT id FROM _cs_envelopes)
        UNION
        SELECT NULLIF(mention."parentPostUrl", '') AS value
        FROM social_mentions AS mention
        WHERE mention."organizationId" = $1
          AND mention.id IN (SELECT id FROM _cs_mentions)
        UNION
        SELECT NULLIF(mention."canonicalUrl", '') AS value
        FROM social_mentions AS mention
        WHERE mention."organizationId" = $1
          AND mention.id IN (SELECT id FROM _cs_mentions)
      ) AS urls
      WHERE value IS NOT NULL
    `,
    `
      CREATE TEMP TABLE _cs_content_hmacs(value text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_content_hmacs(value)
      SELECT DISTINCT envelope."contentHmac"
      FROM ingest_envelopes AS envelope
      WHERE envelope."organizationId" = $1
        AND envelope.id IN (SELECT id FROM _cs_envelopes)
        AND NULLIF(envelope."contentHmac", '') IS NOT NULL
    `,
    `
      CREATE TEMP TABLE _cs_clusters(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_clusters(id)
      SELECT cluster.id
      FROM mention_clusters AS cluster
      WHERE cluster."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_review_runs(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_review_runs(id)
      SELECT run.id
      FROM discovery_auto_review_runs AS run
      WHERE run."organizationId" = $1
        AND (
          run."subjectId" IN (SELECT subject_id FROM _cs_subjects)
          OR EXISTS (
            SELECT 1
            FROM discovery_auto_review_decisions AS decision
            WHERE decision."organizationId" = run."organizationId"
              AND decision."runId" = run.id
              AND decision."envelopeId" IN (SELECT id FROM _cs_envelopes)
          )
        )
    `,
    `
      CREATE TEMP TABLE _cs_discovery_leads(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_discovery_leads(id)
      SELECT lead.id
      FROM discovery_leads AS lead
      WHERE lead."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_media_observations(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_media_observations(id)
      SELECT observation.id
      FROM media_observations AS observation
      WHERE observation."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_media_signals(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_media_signals(id)
      SELECT signal.id
      FROM media_signals AS signal
      WHERE signal."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_media_processing_runs(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_media_processing_runs(id)
      SELECT run.id
      FROM media_processing_runs AS run
      WHERE run."organizationId" = $1
    `,
    `
      CREATE TEMP TABLE _cs_shadow_actions(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_shadow_actions(id)
      SELECT action.id
      FROM ai_shadow_actions AS action
      WHERE action."organizationId" = $1
        AND action."entityType" = 'social_mention'
    `,
    `
      CREATE TEMP TABLE _cs_scheduled_actions(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_scheduled_actions(id)
      SELECT action.id
      FROM scheduled_actions AS action
      WHERE action."organizationId" = $1
        AND action."entityType" = 'social_mention'
    `,
    `
      CREATE TEMP TABLE _cs_ai_alerts(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_ai_alerts(id)
      SELECT alert.id
      FROM ai_alerts AS alert
      WHERE alert."organizationId" = $1
        AND alert.type IN (
          'social_signal_risk',
          'social_coverage_rule',
          'social_source_failure'
        )
    `,
    `
      CREATE TEMP TABLE _cs_ai_interaction_logs(id text PRIMARY KEY) ON COMMIT DROP
    `,
    `
      INSERT INTO _cs_ai_interaction_logs(id)
      SELECT interaction.id
      FROM ai_interaction_logs AS interaction
      WHERE interaction."organizationId" = $1
        AND (
          interaction."agentType" = 'social_monitoring'
          OR LEFT(interaction."userMessage", 7) = 'social_'
        )
    `,
  ]

  for (const statement of statements) {
    if (statement.includes("$1")) {
      await tx.$executeRawUnsafe(statement, organizationId)
    } else {
      await tx.$executeRawUnsafe(statement)
    }
  }
}

async function buildReport(tx, organizationId) {
  const [scope] = await tx.$queryRawUnsafe(`
    SELECT
      (SELECT count(*) FROM _cs_scenarios) AS scenarios,
      (SELECT count(*) FROM _cs_subjects) AS subjects,
      (SELECT count(*) FROM _cs_sources) AS "scenarioSources",
      (SELECT count(*) FROM _cs_sources WHERE scenario_managed) AS "managedSources",
      (SELECT count(*) FROM _cs_sources WHERE NOT scenario_managed) AS "sharedSources",
      (SELECT count(*) FROM _cs_direct_sources) AS "legacyDirectSources",
      (SELECT count(*) FROM _cs_direct_bindings) AS "legacyDirectBindings",
      (SELECT count(*) FROM _cs_routes) AS "routePlans",
      (SELECT count(*) FROM _cs_collectors) AS "collectorRuns",
      (
        SELECT count(*)
        FROM social_monitoring_run_jobs AS job
        WHERE job."organizationId" = $1
      ) AS "monitoringRunJobs",
      (SELECT count(*) FROM _cs_provider_runs) AS "providerRuns",
      (SELECT count(*) FROM _cs_financial_runs) AS "financialProviderRuns",
      (
        SELECT count(*)
        FROM social_provider_runs AS run
        WHERE run.id IN (SELECT id FROM _cs_financial_runs)
          AND run."providerKey" = 'APIFY'
          AND run."datasetId" IS NOT NULL
      ) AS "apifyDatasetsToDelete",
      (SELECT count(*) FROM _cs_envelopes) AS envelopes,
      (SELECT count(*) FROM _cs_mentions) AS mentions,
      (
        SELECT count(*)
        FROM manual_engagement_tasks AS task
        WHERE task."organizationId" = $1
          AND task."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "manualEngagementTasks",
      (SELECT count(*) FROM _cs_review_runs) AS "autoReviewRuns",
      (SELECT count(*) FROM _cs_subject_only_mentions) AS "subjectOnlyMentions",
      (SELECT count(*) FROM _cs_discovery_leads) AS "discoveryLeads",
      (SELECT count(*) FROM _cs_media_observations) AS "mediaObservations",
      (SELECT count(*) FROM _cs_media_signals) AS "mediaSignals",
      (SELECT count(*) FROM _cs_media_processing_runs) AS "mediaProcessingRuns",
      (SELECT count(*) FROM _cs_shadow_actions) AS "socialShadowActions",
      (SELECT count(*) FROM _cs_scheduled_actions) AS "socialScheduledActions",
      (SELECT count(*) FROM _cs_ai_alerts) AS "derivedSocialAiAlerts",
      (SELECT count(*) FROM _cs_ai_interaction_logs) AS "socialAiInteractionLogs",
      (
        SELECT count(*)
        FROM social_connection_cursors AS cursor
        WHERE cursor."organizationId" = $1
      ) AS "socialConnectionCursors",
      (
        SELECT count(*)
        FROM social_accounts AS account
        WHERE account."organizationId" = $1
          AND account."lastPolledAt" IS NOT NULL
      ) AS "socialAccountPollWatermarks",
      (
        SELECT count(*)
        FROM audit_logs AS auth_entry
        WHERE auth_entry."organizationId" = $1
          AND auth_entry."entityType" = 'social_paid_run_authorization'
          AND auth_entry.action IN ('authorize', 'complete', 'release', 'reset_boundary')
      ) AS "operationalPaidRunAuditEntries",
      (
        SELECT count(*)
        FROM notifications AS notification
        WHERE notification."organizationId" = $1
          AND notification."entityType" = 'social_mention'
      ) AS "socialNotifications"
  `, organizationId)

  const [tenantTotals] = await tx.$queryRawUnsafe(`
    SELECT
      (SELECT count(*) FROM monitoring_sources WHERE "organizationId" = $1) AS sources,
      (SELECT count(*) FROM collector_runs WHERE "organizationId" = $1) AS "collectorRuns",
      (SELECT count(*) FROM social_monitoring_run_jobs WHERE "organizationId" = $1) AS "monitoringRunJobs",
      (SELECT count(*) FROM social_provider_runs WHERE "organizationId" = $1) AS "providerRuns",
      (SELECT count(*) FROM ingest_envelopes WHERE "organizationId" = $1) AS envelopes,
      (SELECT count(*) FROM social_mentions WHERE "organizationId" = $1) AS mentions,
      (SELECT count(*) FROM discovery_leads WHERE "organizationId" = $1) AS "discoveryLeads",
      (SELECT count(*) FROM media_observations WHERE "organizationId" = $1) AS "mediaObservations",
      (SELECT count(*) FROM media_signals WHERE "organizationId" = $1) AS "mediaSignals",
      (SELECT count(*) FROM media_processing_runs WHERE "organizationId" = $1) AS "mediaProcessingRuns"
  `, organizationId)

  const scenarioStatuses = await tx.$queryRawUnsafe(`
    SELECT
      COALESCE(scenario.value->>'status', 'unknown') AS status,
      count(*) AS count
    FROM channel_configs AS config
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(config.settings, '{}'::jsonb)->'scenarios') = 'array'
          THEN config.settings->'scenarios'
        ELSE '[]'::jsonb
      END
    ) AS scenario(value)
    WHERE config."organizationId" = $1
      AND config."channelType" = 'social_monitoring'
      AND config."configName" = 'Monitoring scenarios'
    GROUP BY COALESCE(scenario.value->>'status', 'unknown')
    ORDER BY status
  `, organizationId)

  const sourceGroups = await tx.$queryRawUnsafe(`
    SELECT
      source.platform,
      source."sourceType",
      source.status,
      scoped.scenario_managed AS "scenarioManaged",
      (direct.id IS NOT NULL) AS "legacyDirect",
      count(*) AS count
    FROM _cs_sources AS scoped
    JOIN monitoring_sources AS source ON source.id = scoped.id
    LEFT JOIN _cs_direct_sources AS direct ON direct.id = source.id
    WHERE source."organizationId" = $1
    GROUP BY
      source.platform,
      source."sourceType",
      source.status,
      scoped.scenario_managed,
      (direct.id IS NOT NULL)
    ORDER BY source.platform, source."sourceType", source.status
  `, organizationId)

  const preservedMentionGroups = await tx.$queryRawUnsafe(`
    SELECT
      mention.platform,
      mention."sourceProvider",
      (mention."purgedAt" IS NOT NULL) AS purged,
      count(*) AS count
    FROM social_mentions AS mention
    WHERE mention."organizationId" = $1
      AND mention.id NOT IN (SELECT id FROM _cs_mentions)
    GROUP BY mention.platform, mention."sourceProvider", (mention."purgedAt" IS NOT NULL)
    ORDER BY mention.platform, mention."sourceProvider", purged
  `, organizationId)

  const preservedEnvelopeGroups = await tx.$queryRawUnsafe(`
    SELECT
      envelope.platform,
      COALESCE(envelope."providerKey", '-') AS "providerKey",
      envelope."relevanceStatus",
      (envelope."purgedAt" IS NOT NULL) AS purged,
      count(*) AS count
    FROM ingest_envelopes AS envelope
    WHERE envelope."organizationId" = $1
      AND envelope.id NOT IN (SELECT id FROM _cs_envelopes)
    GROUP BY
      envelope.platform,
      COALESCE(envelope."providerKey", '-'),
      envelope."relevanceStatus",
      (envelope."purgedAt" IS NOT NULL)
    ORDER BY envelope.platform, "providerKey", envelope."relevanceStatus", purged
  `, organizationId)

  const [protectedRefs] = await tx.$queryRawUnsafe(`
    SELECT
      count(*) FILTER (
        WHERE mention."leadId" IS NOT NULL
          OR mention."ticketId" IS NOT NULL
          OR mention."taskId" IS NOT NULL
          OR mention.status IN ('replied', 'converted_to_ticket', 'converted_to_lead', 'converted_to_task')
          OR mention."whatsappGroupDeliveredAt" IS NOT NULL
      ) AS "crmOrExternalActionMentions",
      (
        SELECT count(*)
        FROM social_legal_cases AS legal_case
        WHERE legal_case."organizationId" = $1
          AND legal_case."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "legalCases",
      (
        SELECT count(*)
        FROM social_legal_candidates AS candidate
        WHERE candidate."organizationId" = $1
          AND candidate."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "legalCandidates",
      (
        SELECT count(*)
        FROM social_legal_evidences AS legal_evidence
        JOIN mention_evidence AS evidence
          ON evidence."organizationId" = legal_evidence."organizationId"
          AND evidence.id = legal_evidence."mentionEvidenceId"
        WHERE legal_evidence."organizationId" = $1
          AND evidence."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "legalEvidenceLinks",
      (
        SELECT count(*)
        FROM outbound_social_replies AS reply
        WHERE reply."organizationId" = $1
          AND reply."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "outboundReplies",
      (
        SELECT count(*)
        FROM manual_engagement_tasks AS task
        WHERE task."organizationId" = $1
          AND task."mentionId" IN (SELECT id FROM _cs_mentions)
          AND (
            UPPER(COALESCE(task.status, '')) NOT IN ('OPEN', 'CANCELLED')
            OR task."completedAt" IS NOT NULL
            OR task."completedBy" IS NOT NULL
          )
      ) AS "manualEngagementActions",
      (
        SELECT count(*)
        FROM social_mention_ai_drafts AS draft
        WHERE draft."organizationId" = $1
          AND draft."mentionId" IN (SELECT id FROM _cs_mentions)
          AND (draft."sentAt" IS NOT NULL OR draft.status = 'sent')
      ) AS "sentAiDrafts",
      (
        SELECT count(*)
        FROM tasks AS task
        WHERE task."organizationId" = $1
          AND task."relatedType" = 'social_mention'
      ) AS "crmTasksLinkedByReverseRelation",
      (
        SELECT count(*)
        FROM ai_alerts AS alert
        WHERE alert."organizationId" = $1
          AND alert.type = 'social_manual_escalation'
      ) AS "manualEscalationAlerts",
      (
        SELECT count(*)
        FROM ai_shadow_actions AS action
        WHERE action."organizationId" = $1
          AND action.id IN (SELECT id FROM _cs_shadow_actions)
          AND (
            action.approved IS TRUE
            OR action."executedAt" IS NOT NULL
            OR COALESCE(action."executionStatus", '') NOT IN ('pending', 'rejected')
          )
      ) AS "authorizedOrAttemptedSocialShadowActions",
      (
        SELECT count(*)
        FROM scheduled_actions AS action
        WHERE action."organizationId" = $1
          AND action.id IN (SELECT id FROM _cs_scheduled_actions)
          AND (
            action."executedAt" IS NOT NULL
            OR action.attempts > 0
          )
      ) AS "attemptedSocialScheduledActions"
    FROM social_mentions AS mention
    WHERE mention."organizationId" = $1
      AND mention.id IN (SELECT id FROM _cs_mentions)
  `, organizationId)

  const decisionStates = await tx.$queryRawUnsafe(`
    SELECT decision.state, count(*) AS count
    FROM discovery_auto_review_decisions AS decision
    WHERE decision."organizationId" = $1
      AND decision."envelopeId" IN (SELECT id FROM _cs_envelopes)
    GROUP BY decision.state
    ORDER BY decision.state
  `, organizationId)

  const manualEngagementTaskGroups = await tx.$queryRawUnsafe(`
    SELECT
      task.status,
      task."engagementMode",
      count(*) AS count,
      count(*) FILTER (
        WHERE task."completedAt" IS NOT NULL
          OR task."completedBy" IS NOT NULL
      ) AS "completedAuditCount"
    FROM manual_engagement_tasks AS task
    WHERE task."organizationId" = $1
      AND task."mentionId" IN (SELECT id FROM _cs_mentions)
    GROUP BY task.status, task."engagementMode"
    ORDER BY task.status, task."engagementMode"
  `, organizationId)

  const activeProviderRuns = await tx.$queryRawUnsafe(`
    SELECT
      run.id,
      run."providerKey",
      run.phase,
      run.status,
      run."externalRunId",
      run."collectorRunId",
      run."sourceId",
      run."startedAt",
      run."updatedAt",
      run."timeoutSeconds",
      (
        COALESCE(run."startedAt", run."createdAt")
        + make_interval(secs => GREATEST(run."timeoutSeconds", 30) + 300)
      ) < NOW() AS stale
    FROM social_provider_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_financial_runs)
      AND run."purgedAt" IS NULL
      AND run.status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'IMPORTING')
    ORDER BY run."createdAt", run.id
  `, organizationId)

  const activeCollectorRuns = await tx.$queryRawUnsafe(`
    SELECT
      run.id,
      run."sourceId",
      run.status,
      run."startedAt",
      run."leaseExpiresAt",
      run."leaseExpiresAt" <= NOW() AS stale
    FROM collector_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_collectors)
      AND run.status = 'running'
    ORDER BY run."startedAt", run.id
  `, organizationId)

  const [boundaryRefs] = await tx.$queryRawUnsafe(`
    SELECT
      (
        SELECT count(*)
        FROM social_provider_runs AS child
        WHERE child."organizationId" = $1
          AND child."parentRunId" IN (SELECT id FROM _cs_provider_runs)
          AND child.id NOT IN (SELECT id FROM _cs_provider_runs)
      ) AS "nonTargetProviderChildren",
      (
        SELECT count(*)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run."collectorRunId" IN (SELECT id FROM _cs_collectors)
          AND run.id NOT IN (SELECT id FROM _cs_provider_runs)
      ) AS "nonTargetProviderRunsOnCollectors",
      (
        SELECT count(*)
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope."collectorRunId" IN (SELECT id FROM _cs_collectors)
          AND envelope.id NOT IN (SELECT id FROM _cs_envelopes)
      ) AS "nonTargetEnvelopesOnCollectors",
      (
        SELECT count(*)
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope."providerRunId" IN (SELECT id FROM _cs_provider_runs)
          AND envelope.id NOT IN (SELECT id FROM _cs_envelopes)
      ) AS "nonTargetEnvelopesOnProviderRuns",
      (
        SELECT count(*)
        FROM social_mentions AS mention
        WHERE mention."organizationId" = $1
          AND mention."sourceMetadata"->>'providerRunId' IN (SELECT id FROM _cs_provider_runs)
          AND mention.id NOT IN (SELECT id FROM _cs_mentions)
      ) AS "nonTargetMentionsOnProviderRuns",
      (
        SELECT count(*)
        FROM monitoring_subject_sources AS binding
        JOIN _cs_direct_bindings AS direct_binding ON direct_binding.id = binding.id
        JOIN monitoring_subject_sources AS other_binding
          ON other_binding."organizationId" = binding."organizationId"
          AND other_binding."sourceId" = binding."sourceId"
          AND other_binding."subjectId" NOT IN (SELECT subject_id FROM _cs_subjects)
        WHERE binding."organizationId" = $1
      ) AS "directSourcesSharedWithOtherSubjects",
      (
        SELECT count(DISTINCT decision."runId")
        FROM discovery_auto_review_decisions AS decision
        JOIN ingest_envelopes AS envelope
          ON envelope."organizationId" = decision."organizationId"
          AND envelope.id = decision."envelopeId"
        WHERE decision."organizationId" = $1
          AND decision."runId" IN (SELECT id FROM _cs_review_runs)
          AND decision."envelopeId" NOT IN (SELECT id FROM _cs_envelopes)
          -- A previous clean-slate pass intentionally retains only an
          -- immutable, content-free envelope tombstone for review history.
          -- It must not make an otherwise idempotent rerun fail closed.
          AND envelope."purgedAt" IS NULL
      ) AS "autoReviewRunsCrossingPreservedEnvelopes",
      (
        SELECT count(*)
        FROM social_metric_snapshots AS metric
        WHERE metric."organizationId" = $1
          AND metric."providerRunId" IN (SELECT id FROM _cs_provider_runs)
          AND metric."mentionId" IS NOT NULL
          AND metric."mentionId" NOT IN (SELECT id FROM _cs_mentions)
      ) AS "targetProviderMetricsOnPreservedMentions",
      (
        SELECT count(DISTINCT target_match."mentionId")
        FROM social_mention_subject_matches AS target_match
        WHERE target_match."organizationId" = $1
          AND target_match."mentionId" IN (SELECT id FROM _cs_mentions)
          AND target_match."subjectId" IN (SELECT subject_id FROM _cs_subjects)
          AND EXISTS (
            SELECT 1
            FROM social_mention_subject_matches AS preserved_match
            WHERE preserved_match."organizationId" = target_match."organizationId"
              AND preserved_match."mentionId" = target_match."mentionId"
              AND preserved_match."subjectId" NOT IN (SELECT subject_id FROM _cs_subjects)
          )
      ) AS "mentionsSharedWithOtherSubjects"
  `, organizationId)

  const [activeMedia] = await tx.$queryRawUnsafe(`
    SELECT
      (
        SELECT count(*)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
          -- QUEUED work is safe to discard after collectionBlocked is set.
          -- RUNNING and every unknown/future status remain fail-closed.
          AND run.status NOT IN (
            'QUEUED',
            'SUCCEEDED',
            'PARTIAL',
            'FAILED',
            'SKIPPED',
            'BLOCKED_BUDGET'
          )
      ) AS "blockingRuns",
      (
        SELECT count(*)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
          AND run.status = 'QUEUED'
      ) AS "queuedRuns",
      (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
          AND observation.status NOT IN (
            'QUEUED',
            'COMPLETE',
            'PARTIAL',
            'FAILED',
            'BLOCKED',
            'DROPPED',
            'PURGED'
          )
      ) AS "blockingObservations",
      (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
          AND observation.status = 'QUEUED'
      ) AS "queuedObservations",
      (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
          AND observation."claimToken" IS NOT NULL
          AND observation."claimExpiresAt" > NOW()
      ) AS "unexpiredObservationClaims",
      (
        SELECT count(*)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
          AND run.status NOT IN (
            'QUEUED',
            'SUCCEEDED',
            'PARTIAL',
            'FAILED',
            'SKIPPED',
            'BLOCKED_BUDGET'
          )
      ) + (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
          AND (
            observation.status NOT IN (
              'QUEUED',
              'COMPLETE',
              'PARTIAL',
              'FAILED',
              'BLOCKED',
              'DROPPED',
              'PURGED'
            )
            OR (
              observation."claimToken" IS NOT NULL
              AND observation."claimExpiresAt" > NOW()
            )
          )
      ) AS count
  `, organizationId)

  const [mediaSpend] = await tx.$queryRawUnsafe(`
    SELECT
      count(*) AS "runCount",
      count(*) FILTER (
        WHERE run."actualCostUsd" IS NULL
          AND run."reservedCostUsd" > 0
      ) AS "unsettledReservedRunCount",
      COALESCE(sum(run."estimatedCostUsd"), 0) AS "estimatedCostUsd",
      COALESCE(sum(run."reservedCostUsd"), 0) AS "reservedCostUsd",
      COALESCE(sum(run."actualCostUsd"), 0) AS "actualCostUsd",
      COALESCE(sum(
        CASE
          WHEN run."actualCostUsd" IS NULL THEN run."reservedCostUsd"
          ELSE 0
        END
      ), 0) AS "unsettledReservedCostUsd"
    FROM media_processing_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_media_processing_runs)
  `, organizationId)

  const [claimsAndSpend] = await tx.$queryRawUnsafe(`
    SELECT
      (
        SELECT count(*)
        FROM monitoring_sources AS source
        WHERE source."organizationId" = $1
          AND source.id IN (SELECT id FROM _cs_sources)
          AND source."runClaimToken" IS NOT NULL
          AND source."runClaimExpiresAt" > NOW()
      ) AS "unexpiredSourceClaims",
      (
        SELECT COALESCE(sum(run."reservedChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_financial_runs)
          AND run."purgedAt" IS NULL
      ) AS "reservedChargeUsdToReset",
      (
        SELECT COALESCE(sum(run."actualChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_financial_runs)
          AND run."purgedAt" IS NULL
      ) AS "actualChargeUsdToReset",
      (
        SELECT COALESCE(sum(run."actualChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_financial_runs)
          AND run."purgedAt" IS NOT NULL
      ) AS "actualChargeUsdRetainedForAudit",
      (
        SELECT COALESCE(sum(run."reservedChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_financial_runs)
          AND run."purgedAt" IS NOT NULL
      ) AS "reservedChargeUsdRetainedForAudit"
  `, organizationId)

  const budgetCarryForward = await computeBudgetCarryForward(
    tx,
    organizationId,
    new Date(),
  )

  return serialize({
    mode: execute ? "execute" : "dry-run",
    tenant: TENANT,
    scope,
    tenantTotals,
    scenarioStatuses,
    sourceGroups,
    preservedMentionGroups,
    preservedEnvelopeGroups,
    protectedRefs,
    decisionStates,
    manualEngagementTaskGroups,
    activeProviderRuns,
    activeCollectorRuns,
    activeMedia,
    mediaSpend,
    boundaryRefs,
    claimsAndSpend,
    budgetCarryForward,
  })
}

function protectedReferenceCount(report) {
  return Object.values(report.protectedRefs ?? {}).reduce((total, value) => {
    const count = typeof value === "number" ? value : Number(value ?? 0)
    return total + (Number.isFinite(count) ? count : 0)
  }, 0)
}

function boundaryReferenceCount(report) {
  return Object.values(report.boundaryRefs ?? {}).reduce((total, value) => {
    const count = typeof value === "number" ? value : Number(value ?? 0)
    return total + (Number.isFinite(count) ? count : 0)
  }, 0)
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())
    : []
}

function positiveNumber(value) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function nonNegativeNumber(value) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function roundUsd(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function utcPeriodStarts(now) {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  }
}

function parseResetBudgetCarry(newValue) {
  const carry = record(record(newValue).budgetCarryForward)
  if (Object.keys(carry).length === 0) return null
  if (carry.schemaVersion !== RESET_BUDGET_CARRY_SCHEMA_VERSION) {
    throw new Error("latest monitoring reset has an unsupported budget carry schema")
  }
  const capturedAt = new Date(carry.capturedAt)
  const dayStart = new Date(carry.utcDayStart)
  const monthStart = new Date(carry.utcMonthStart)
  if (
    !Number.isFinite(capturedAt.getTime())
    || dayStart.getTime() !== utcPeriodStarts(capturedAt).day.getTime()
    || monthStart.getTime() !== utcPeriodStarts(capturedAt).month.getTime()
  ) {
    throw new Error("latest monitoring reset has an invalid budget carry period")
  }
  const provider = record(carry.provider)
  const paidRunAuthorization = record(carry.paidRunAuthorization)
  const media = record(carry.media)
  const ai = record(carry.ai)
  const values = {
    providerDay: provider.dayChargeUsd,
    providerMonth: provider.monthChargeUsd,
    providerRuns: provider.runsToday,
    authorizationDay: paidRunAuthorization.dayReservedUsd,
    authorizationMonth: paidRunAuthorization.monthReservedUsd,
    authorizationRuns: paidRunAuthorization.runsToday,
    mediaDay: media.dayCostUsd,
    mediaMonth: media.monthCostUsd,
    aiDay: ai.dayCostUsd,
    aiMonth: ai.monthCostUsd,
  }
  for (const [key, value] of Object.entries(values)) {
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN
    if (
      !Number.isFinite(parsed)
      || parsed < 0
      || (key.endsWith("Runs") && !Number.isSafeInteger(parsed))
    ) {
      throw new Error(`latest monitoring reset has invalid budget carry value: ${key}`)
    }
  }
  if (
    Number(provider.monthChargeUsd) < Number(provider.dayChargeUsd)
    || Number(paidRunAuthorization.monthReservedUsd)
      < Number(paidRunAuthorization.dayReservedUsd)
    || Number(media.monthCostUsd) < Number(media.dayCostUsd)
    || Number(ai.monthCostUsd) < Number(ai.dayCostUsd)
  ) {
    throw new Error("latest monitoring reset has invalid cumulative budget carry totals")
  }
  return {
    capturedAt,
    utcDayStart: dayStart,
    utcMonthStart: monthStart,
    provider: {
      dayChargeUsd: Number(provider.dayChargeUsd),
      monthChargeUsd: Number(provider.monthChargeUsd),
      runsToday: Number(provider.runsToday),
    },
    paidRunAuthorization: {
      dayReservedUsd: Number(paidRunAuthorization.dayReservedUsd),
      monthReservedUsd: Number(paidRunAuthorization.monthReservedUsd),
      runsToday: Number(paidRunAuthorization.runsToday),
    },
    media: {
      dayCostUsd: Number(media.dayCostUsd),
      monthCostUsd: Number(media.monthCostUsd),
    },
    ai: {
      dayCostUsd: Number(ai.dayCostUsd),
      monthCostUsd: Number(ai.monthCostUsd),
    },
  }
}

function authorizationReservations(entries, since) {
  const reservations = new Map()
  const releases = new Map()
  for (const entry of entries) {
    if (!entry.entityId || entry.createdAt < since) continue
    const value = record(entry.newValue)
    if (entry.action === "authorize") {
      if (value.clientFundedManual === true) continue
      reservations.set(entry.entityId, {
        capUsd: roundUsd(Math.min(
          positiveNumber(value.maxTotalChargeUsd),
          STANDARD_PAID_RUN_HARD_CAP_USD,
        )),
        collectorRunId: null,
        providerRequestDispatched: null,
      })
    } else if (entry.action === "complete") {
      const reservation = reservations.get(entry.entityId)
      if (!reservation) continue
      reservation.collectorRunId = typeof value.collectorRunId === "string" && value.collectorRunId.trim()
        ? value.collectorRunId.trim()
        : null
      reservation.providerRequestDispatched = typeof value.providerRequestDispatched === "boolean"
        ? value.providerRequestDispatched
        : null
    } else if (entry.action === "release") {
      releases.set(entry.entityId, positiveNumber(value.releasedChargeUsd))
    }
  }
  for (const [id, reservation] of reservations) {
    reservation.capUsd = roundUsd(Math.max(
      0,
      reservation.capUsd - Math.min(reservation.capUsd, releases.get(id) ?? 0),
    ))
  }
  return reservations
}

function reconciledAuthorizationReservedUsd(reservations, providerRuns) {
  const active = new Set(["QUEUED", "RUNNING", "IMPORTING"])
  const terminal = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "IMPORTED", "PURGED"])
  const byCollector = new Map()
  for (const run of providerRuns) {
    if (!run.collectorRunId) continue
    const rows = byCollector.get(run.collectorRunId) ?? []
    rows.push(run)
    byCollector.set(run.collectorRunId, rows)
  }
  let total = 0
  for (const reservation of reservations.values()) {
    if (reservation.capUsd <= 0) continue
    if (reservation.providerRequestDispatched !== true || !reservation.collectorRunId) {
      total += reservation.providerRequestDispatched === false ? 0 : reservation.capUsd
      continue
    }
    const runs = byCollector.get(reservation.collectorRunId) ?? []
    if (
      runs.length === 0
      || runs.some(run => active.has(run.status))
      || runs.some(run => !terminal.has(run.status))
    ) {
      total += reservation.capUsd
      continue
    }
    const exposure = runs.reduce(
      (sum, run) => sum
        + nonNegativeNumber(run.reservedChargeUsd)
        + nonNegativeNumber(run.actualChargeUsd),
      0,
    )
    total += Math.min(reservation.capUsd, exposure)
  }
  return roundUsd(total)
}

async function computeBudgetCarryForward(tx, organizationId, now) {
  const period = utcPeriodStarts(now)
  const latestBoundary = await tx.auditLog.findFirst({
    where: {
      organizationId,
      entityType: "social_paid_run_authorization",
      action: "reset_boundary",
      userId: null,
      entityName: "Social Monitoring clean slate",
      entityId: { startsWith: "clean-slate:" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { newValue: true, createdAt: true },
  })
  const previousCarry = latestBoundary
    ? parseResetBudgetCarry(latestBoundary.newValue)
    : null
  const resetAtText = latestBoundary
    ? record(latestBoundary.newValue).resetAt
    : null
  const resetAt = typeof resetAtText === "string" ? new Date(resetAtText) : null
  const boundaryAt = latestBoundary
    ? (
        resetAt
        && Number.isFinite(resetAt.getTime())
        && resetAt > latestBoundary.createdAt
          ? resetAt
          : latestBoundary.createdAt
      )
    : null
  const dayCarry = previousCarry
    && previousCarry.utcDayStart.getTime() === period.day.getTime()
    && previousCarry.capturedAt >= period.day
      ? previousCarry
      : null
  const monthCarry = previousCarry
    && previousCarry.utcMonthStart.getTime() === period.month.getTime()
    && previousCarry.capturedAt >= period.month
      ? previousCarry
      : null
  // A versioned carry means every earlier purged/deleted row is already
  // represented cumulatively. Without one, include legacy purged provider rows
  // so the first upgraded reset cannot reopen the current-period budget.
  const includeLegacyPurgedProviderRows = previousCarry === null

  const providerSpend = async since => {
    const [row] = await tx.$queryRawUnsafe(`
      SELECT
        COALESCE(sum(run."reservedChargeUsd"), 0) AS "reservedChargeUsd",
        COALESCE(sum(run."actualChargeUsd"), 0) AS "actualChargeUsd"
      FROM social_provider_runs AS run
      WHERE run."organizationId" = $1
        AND run."createdAt" >= $2
        AND ($3::boolean OR run."purgedAt" IS NULL)
        AND COALESCE(run."inputSnapshot"->>'clientFundedManual', 'false') <> 'true'
        AND COALESCE(run."inputSnapshot"->>'leadDriveClientFundedManual', 'false') <> 'true'
        AND NOT (
          run."externalRunId" IS NULL
          AND COALESCE(run."actualChargeUsd", 0) <= 0
          AND (
            (
              run."adapterKey" IN ('X_API', 'TIKTOK_BUSINESS_API', 'BRIGHT_DATA_SNAPSHOT')
              AND
              COALESCE(run."inputSnapshot", '{}'::jsonb)
                @> '{"providerRequestDispatched": false}'::jsonb
              AND run.status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'PARTIAL', 'IMPORTED', 'PURGED')
            )
            OR (
              run.phase = 'PAID_ROUTE_COLLECTION'
              AND NOT COALESCE(run."inputSnapshot", '{}'::jsonb)
                @> '{"providerRequestDispatched": true}'::jsonb
              AND NOT COALESCE(run."inputSnapshot", '{}'::jsonb)
                @> '{"providerRequestDispatched": false}'::jsonb
              AND COALESCE(
                run."lastError" IN (
                  'bright_data_parent_targets_missing',
                  'bright_data_discovery_input_missing'
                ),
                FALSE
              )
            )
          )
        )
    `, organizationId, since, includeLegacyPurgedProviderRows)
    return roundUsd(
      nonNegativeNumber(row?.reservedChargeUsd)
      + nonNegativeNumber(row?.actualChargeUsd),
    )
  }
  const liveProviderDay = await providerSpend(period.day)
  const liveProviderMonth = await providerSpend(period.month)
  const providerRunRows = await tx.$queryRawUnsafe(`
    SELECT DISTINCT run."collectorRunId"
    FROM social_provider_runs AS run
    WHERE run."organizationId" = $1
      AND run.phase = 'PAID_ROUTE_COLLECTION'
      AND run."createdAt" >= $2
      AND ($3::boolean OR run."purgedAt" IS NULL)
      AND run."collectorRunId" IS NOT NULL
      AND COALESCE(run."inputSnapshot"->>'clientFundedManual', 'false') <> 'true'
      AND COALESCE(run."inputSnapshot"->>'leadDriveClientFundedManual', 'false') <> 'true'
      AND NOT (
        run."externalRunId" IS NULL
        AND COALESCE(run."actualChargeUsd", 0) <= 0
        AND (
          (
            run."adapterKey" IN ('X_API', 'TIKTOK_BUSINESS_API', 'BRIGHT_DATA_SNAPSHOT')
            AND
            COALESCE(run."inputSnapshot", '{}'::jsonb)
              @> '{"providerRequestDispatched": false}'::jsonb
            AND run.status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'PARTIAL', 'IMPORTED', 'PURGED')
          )
          OR COALESCE(
            run.phase = 'PAID_ROUTE_COLLECTION'
            AND NOT COALESCE(run."inputSnapshot", '{}'::jsonb)
              @> '{"providerRequestDispatched": true}'::jsonb
            AND NOT COALESCE(run."inputSnapshot", '{}'::jsonb)
              @> '{"providerRequestDispatched": false}'::jsonb
            AND run."lastError" IN (
              'bright_data_parent_targets_missing',
              'bright_data_discovery_input_missing'
            ),
            FALSE
          )
        )
      )
  `, organizationId, period.day, includeLegacyPurgedProviderRows)

  const authorizationMonthStart = previousCarry && boundaryAt && boundaryAt > period.month
    ? boundaryAt
    : period.month
  const authorizationDayStart = previousCarry && boundaryAt && boundaryAt > period.day
    ? boundaryAt
    : period.day
  const authorizationEntries = await tx.auditLog.findMany({
    where: {
      organizationId,
      entityType: "social_paid_run_authorization",
      action: { in: ["authorize", "complete", "release"] },
      createdAt: { gte: authorizationMonthStart },
    },
    select: { action: true, entityId: true, newValue: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  const monthReservations = authorizationReservations(
    authorizationEntries,
    authorizationMonthStart,
  )
  const dayReservations = authorizationReservations(
    authorizationEntries,
    authorizationDayStart,
  )
  const collectorRunIds = Array.from(new Set(
    Array.from(monthReservations.values())
      .filter(item => (
        item.capUsd > 0
        && item.providerRequestDispatched === true
        && item.collectorRunId
      ))
      .map(item => item.collectorRunId),
  ))
  const authorizationProviderRuns = collectorRunIds.length === 0
    ? []
    : await tx.socialProviderRun.findMany({
        where: {
          organizationId,
          ...(!includeLegacyPurgedProviderRows ? { purgedAt: null } : {}),
          collectorRunId: { in: collectorRunIds },
        },
        select: {
          collectorRunId: true,
          status: true,
          reservedChargeUsd: true,
          actualChargeUsd: true,
        },
      })
  const manualCollectorRunIds = Array.from(dayReservations.values()).flatMap(
    reservation => reservation.capUsd > 0 && reservation.collectorRunId
      ? [reservation.collectorRunId]
      : [],
  )
  const pendingAuthorizedRuns = Array.from(dayReservations.values()).filter(
    reservation => reservation.capUsd > 0 && !reservation.collectorRunId,
  ).length
  const authorizationRunsSinceReset = new Set([
    ...providerRunRows.map(row => row.collectorRunId),
    ...manualCollectorRunIds,
  ]).size + pendingAuthorizedRuns

  const mediaSpend = async since => {
    const [row] = await tx.$queryRawUnsafe(`
      SELECT COALESCE(sum(
        CASE
          WHEN run."actualCostUsd" IS NULL THEN run."reservedCostUsd"
          ELSE run."actualCostUsd"
        END
      ), 0) AS cost
      FROM media_processing_runs AS run
      WHERE run."organizationId" = $1
        AND run."createdAt" >= $2
        AND run.status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL')
    `, organizationId, since)
    return roundUsd(nonNegativeNumber(row?.cost))
  }
  const liveMediaDay = await mediaSpend(period.day)
  const liveMediaMonth = await mediaSpend(period.month)
  const aiSpend = async since => {
    const [row] = await tx.$queryRawUnsafe(`
      SELECT COALESCE(sum(interaction."costUsd"), 0) AS cost
      FROM ai_interaction_logs AS interaction
      WHERE interaction."organizationId" = $1
        AND interaction.id IN (SELECT id FROM _cs_ai_interaction_logs)
        AND interaction."createdAt" >= $2
    `, organizationId, since)
    return roundUsd(nonNegativeNumber(row?.cost))
  }
  const liveAiDay = await aiSpend(period.day)
  const liveAiMonth = await aiSpend(period.month)

  return {
    schemaVersion: RESET_BUDGET_CARRY_SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    utcDayStart: period.day.toISOString(),
    utcMonthStart: period.month.toISOString(),
    provider: {
      dayChargeUsd: roundUsd((dayCarry?.provider.dayChargeUsd ?? 0) + liveProviderDay),
      monthChargeUsd: roundUsd((monthCarry?.provider.monthChargeUsd ?? 0) + liveProviderMonth),
      runsToday: (dayCarry?.provider.runsToday ?? 0) + providerRunRows.length,
    },
    paidRunAuthorization: {
      dayReservedUsd: roundUsd(
        (dayCarry?.paidRunAuthorization.dayReservedUsd ?? 0)
        + reconciledAuthorizationReservedUsd(dayReservations, authorizationProviderRuns),
      ),
      monthReservedUsd: roundUsd(
        (monthCarry?.paidRunAuthorization.monthReservedUsd ?? 0)
        + reconciledAuthorizationReservedUsd(monthReservations, authorizationProviderRuns),
      ),
      runsToday: (dayCarry?.paidRunAuthorization.runsToday ?? 0)
        + authorizationRunsSinceReset,
    },
    media: {
      dayCostUsd: roundUsd((dayCarry?.media.dayCostUsd ?? 0) + liveMediaDay),
      monthCostUsd: roundUsd((monthCarry?.media.monthCostUsd ?? 0) + liveMediaMonth),
    },
    ai: {
      dayCostUsd: roundUsd((dayCarry?.ai.dayCostUsd ?? 0) + liveAiDay),
      monthCostUsd: roundUsd((monthCarry?.ai.monthCostUsd ?? 0) + liveAiMonth),
    },
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

function jsonFingerprint(value) {
  return JSON.stringify(canonical(value))
}

async function pauseAndNormalizeScenarios(tx, organizationId, now) {
  const config = await tx.channelConfig.findFirst({
    where: {
      organizationId,
      channelType: "social_monitoring",
      configName: "Monitoring scenarios",
    },
    select: { id: true, settings: true },
  })
  if (!config) throw new Error("monitoring scenario config disappeared")
  const settings = structuredClone(record(config.settings))
  const scenarios = Array.isArray(settings.scenarios) ? settings.scenarios : []
  if (scenarios.length === 0) throw new Error("monitoring scenario config is empty")

  let draftCount = 0
  const normalized = scenarios.map(value => {
    const scenario = structuredClone(record(value))
    const search = record(scenario.search)
    const hasGlobalTerms = (
      stringList(search.topics).length
      + stringList(search.keywords).length
      + stringList(search.hashtags).length
    ) > 0
    if (!hasGlobalTerms) draftCount += 1
    return {
      ...scenario,
      status: hasGlobalTerms ? "paused" : "draft",
      search: {
        ...search,
        handles: [],
        urls: [],
      },
      archive: {
        ...record(scenario.archive),
        lastBackfilledAt: null,
        scannedCount: 0,
        matchedCount: 0,
        status: "pending",
      },
      updatedAt: now.toISOString(),
    }
  })

  await tx.channelConfig.update({
    where: { id: config.id },
    data: {
      settings: {
        ...settings,
        scenarios: normalized,
      },
    },
  })
  return { paused: normalized.length - draftCount, draft: draftCount }
}

async function resetScenarioSources(tx, organizationId, now) {
  const scenarioRows = await tx.$queryRawUnsafe(
    `SELECT scenario_id AS id FROM _cs_scenarios`,
  )
  const scenarioIds = new Set(scenarioRows.map(row => row.id))
  const sources = await tx.$queryRawUnsafe(`
    SELECT
      source.id,
      source.status,
      source.settings,
      scoped.scenario_managed AS "scenarioManaged",
      (direct.id IS NOT NULL) AS "legacyDirect"
    FROM monitoring_sources AS source
    JOIN _cs_sources AS scoped ON scoped.id = source.id
    LEFT JOIN _cs_direct_sources AS direct ON direct.id = source.id
    WHERE source."organizationId" = $1
    ORDER BY source.id
  `, organizationId)

  let retiredDirect = 0
  let resetManaged = 0
  let resetSharedCursors = 0
  for (const source of sources) {
    const current = structuredClone(record(source.settings))
    const links = Array.isArray(current.scenarioLinks)
      ? current.scenarioLinks.map(record)
      : []
    const searchIndex = structuredClone(record(current.searchIndex))
    const cursors = record(searchIndex.routeProviderCursors)
    const nextCursors = {}
    if (
      !source.scenarioManaged
      && Object.keys(nextCursors).length !== Object.keys(cursors).length
    ) {
      resetSharedCursors += Object.keys(cursors).length - Object.keys(nextCursors).length
    }
    if (Object.keys(searchIndex).length > 0 || Object.keys(cursors).length > 0) {
      searchIndex.routeProviderCursors = nextCursors
      delete searchIndex.fetchAfter
      delete searchIndex.fetchAfterUpdatedAt
      delete searchIndex.fetchAfterReason
      current.searchIndex = searchIndex
    }

    if (source.legacyDirect) {
      retiredDirect += 1
      current.scenarioLinks = links.filter(link => !(
        scenarioIds.has(String(link.scenarioId ?? ""))
        && ["handle", "url"].includes(String(link.targetType ?? ""))
      ))
      if (
        scenarioIds.has(String(current.scenarioId ?? ""))
        && ["handle", "url"].includes(String(current.scenarioTargetType ?? ""))
      ) {
        current.retiredScenarioId = current.scenarioId
        current.retiredScenarioName = current.scenarioName ?? null
        delete current.scenarioId
        delete current.scenarioName
        delete current.scenarioTargetType
        delete current.scenarioTargetValue
      }
      current.retiredDirectScenarioSourceAt = now.toISOString()
    }
    current.liveExternalSendEnabled = false
    current.autoReplyEnabled = false

    const data = {
      settings: current,
      status: source.legacyDirect || source.status === "disabled" ? "disabled" : "paused",
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastError: null,
      runClaimToken: null,
      runClaimExpiresAt: null,
      runClaimVersion: { increment: 1 },
    }
    await tx.monitoringSource.update({
      where: { id: source.id },
      data,
    })
    if (source.scenarioManaged) resetManaged += 1
  }

  return { retiredDirect, resetManaged, resetSharedCursors }
}

async function releasePaidAuthorizations(tx, organizationId, now) {
  const entries = await tx.auditLog.findMany({
    where: {
      organizationId,
      entityType: "social_paid_run_authorization",
      action: { in: ["authorize", "complete", "release"] },
    },
    select: {
      userId: true,
      action: true,
      entityId: true,
      entityName: true,
      newValue: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })
  const authorizations = new Map()
  for (const entry of entries) {
    if (!entry.entityId) continue
    const value = record(entry.newValue)
    const state = authorizations.get(entry.entityId) ?? {
      userId: entry.userId,
      entityName: entry.entityName,
      cap: 0,
      released: 0,
      clientFundedManual: false,
    }
    if (entry.action === "authorize") {
      state.cap = positiveNumber(value.maxTotalChargeUsd)
      state.userId = entry.userId
      state.entityName = entry.entityName
      state.clientFundedManual = value.clientFundedManual === true
    }
    if (entry.action === "release") {
      state.released = positiveNumber(value.releasedChargeUsd)
    }
    authorizations.set(entry.entityId, state)
  }

  let released = 0
  for (const [authorizationId, state] of authorizations) {
    if (state.clientFundedManual) continue
    if (state.cap <= 0 || state.released >= state.cap) continue
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: state.userId,
        action: "release",
        entityType: "social_paid_run_authorization",
        entityId: authorizationId,
        entityName: state.entityName,
        newValue: {
          releasedChargeUsd: state.cap,
          reason: "operator_clean_slate_reset",
          releasedAt: now.toISOString(),
        },
      },
    })
    released += 1
  }
  return released
}

async function executeReset(tx, organizationId, now) {
  // `audit_logs` is append-only (migration 20260825120000, A.8.15): its trigger
  // rejects every DELETE unless the transaction opts in. This reset removes two
  // narrow sets of markers it created itself — the spike markers and the paid-run
  // authorization trail of a demo tenant — so it opts in deliberately. SET LOCAL
  // keeps the permission inside this transaction; nothing else inherits it.
  await tx.$executeRawUnsafe(`SET LOCAL app.audit_log_purge = 'on'`)

  await tx.$queryRawUnsafe(`
    SELECT source.id
    FROM monitoring_sources AS source
    JOIN _cs_sources AS scoped ON scoped.id = source.id
    WHERE source."organizationId" = $1
    ORDER BY source.id
    FOR UPDATE
  `, organizationId)

  // Capture a cumulative, content-free enforcement snapshot before releasing
  // authorizations or removing operational provider/media rows. Visible
  // history resets to zero, while same-day/month hard caps cannot be spent
  // twice after the operator starts the new monitoring cycle.
  const budgetCarryForward = await computeBudgetCarryForward(
    tx,
    organizationId,
    now,
  )
  const scenarios = await pauseAndNormalizeScenarios(tx, organizationId, now)
  const sources = await resetScenarioSources(tx, organizationId, now)
  const paidAuthorizationsReleased = await releasePaidAuthorizations(tx, organizationId, now)

  // Durable manual jobs contain source/profile labels and collector/provider
  // correlation. The tenant-wide clean slate must remove them under the same
  // advisory lock so a stale active job cannot resume into the new baseline.
  const deletedMonitoringRunJobs = await tx.$executeRawUnsafe(`
    DELETE FROM social_monitoring_run_jobs AS job
    WHERE job."organizationId" = $1
  `, organizationId)

  const deletedDirectBindings = await tx.$executeRawUnsafe(`
    DELETE FROM monitoring_subject_sources AS binding
    WHERE binding."organizationId" = $1
      AND binding.id IN (SELECT id FROM _cs_direct_bindings)
  `, organizationId)

  const deletedSocialConnectionCursors = await tx.$executeRawUnsafe(`
    DELETE FROM social_connection_cursors AS cursor
    WHERE cursor."organizationId" = $1
  `, organizationId)

  const resetSocialAccountPollWatermarks = await tx.$executeRawUnsafe(`
    UPDATE social_accounts AS account
    SET "lastPolledAt" = NULL, "updatedAt" = $2
    WHERE account."organizationId" = $1
      AND account."lastPolledAt" IS NOT NULL
  `, organizationId, now)

  await tx.$executeRawUnsafe(`
    UPDATE source_route_plans AS route
    SET
      status = CASE
        WHEN route."sourceId" IN (SELECT id FROM _cs_direct_sources)
          THEN 'INVALIDATED'
        WHEN route.status = 'DEGRADED'
          THEN 'ACTIVE'
        ELSE route.status
      END,
      "failureCount" = 0,
      "circuitOpenUntil" = NULL,
      "lastFailureClass" = NULL,
      "lastSucceededAt" = NULL,
      "invalidatedAt" = CASE
        WHEN route."sourceId" IN (SELECT id FROM _cs_direct_sources)
          THEN $2
        ELSE route."invalidatedAt"
      END,
      "updatedAt" = $2
    WHERE route."organizationId" = $1
      AND route.id IN (SELECT id FROM _cs_routes)
  `, organizationId, now)

  await tx.$executeRawUnsafe(`
    UPDATE ingest_envelopes AS envelope
    SET "acceptedMentionId" = NULL
    WHERE envelope."organizationId" = $1
      AND envelope.id IN (SELECT id FROM _cs_envelopes)
  `, organizationId)

  const deletedRevisits = await tx.$executeRawUnsafe(`
    DELETE FROM tiktok_publication_revisits AS revisit
    WHERE revisit."organizationId" = $1
      AND revisit."ingestEnvelopeId" IN (SELECT id FROM _cs_envelopes)
  `, organizationId)

  // Auto-review decisions are immutable audit tombstones with a one-way
  // lifecycle. Supersede the scoped decisions before scrubbing their envelope
  // content, and fail any still-APPLIED run so its partial unique index cannot
  // block the first review run after the clean slate.
  const decisionGroups = await tx.$queryRawUnsafe(`
    SELECT
      decision."runId",
      count(*) AS "rowCount",
      count(DISTINCT decision."groupKeyHmac") AS "groupCount"
    FROM discovery_auto_review_decisions AS decision
    WHERE decision."organizationId" = $1
      AND decision."runId" IN (SELECT id FROM _cs_review_runs)
      AND decision.state = 'SUPPRESSED'
    GROUP BY decision."runId"
    ORDER BY decision."runId"
  `, organizationId)
  const appliedReviewRuns = await tx.$queryRawUnsafe(`
    SELECT run.id
    FROM discovery_auto_review_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_review_runs)
      AND run.state = 'APPLIED'
    ORDER BY run.id
  `, organizationId)
  const supersededAutoReviewDecisions = await tx.$executeRawUnsafe(`
    UPDATE discovery_auto_review_decisions AS decision
    SET
      state = 'SUPERSEDED',
      "supersededAt" = GREATEST($2, decision."appliedAt"),
      "updatedAt" = GREATEST($2, decision."appliedAt")
    WHERE decision."organizationId" = $1
      AND decision."runId" IN (SELECT id FROM _cs_review_runs)
      AND decision.state = 'SUPPRESSED'
  `, organizationId, now)
  const failedAutoReviewRuns = await tx.$executeRawUnsafe(`
    UPDATE discovery_auto_review_runs AS run
    SET
      state = 'FAILED',
      error = 'operator_clean_slate_reset',
      "updatedAt" = $2
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_review_runs)
      AND run.state = 'APPLIED'
  `, organizationId, now)
  if (
    Number(supersededAutoReviewDecisions)
      !== decisionGroups.reduce((total, row) => total + Number(row.rowCount), 0)
    || Number(failedAutoReviewRuns) !== appliedReviewRuns.length
  ) {
    throw new Error("auto-review ledger changed concurrently during clean-slate reset")
  }
  const decisionCounts = new Map(
    decisionGroups.map(row => [
      String(row.runId),
      { rowCount: Number(row.rowCount), groupCount: Number(row.groupCount) },
    ]),
  )
  const autoReviewEvents = [
    ...decisionGroups.map(row => ({
      organizationId,
      runId: String(row.runId),
      eventType: "DECISION_SUPERSEDED",
      actorType: "SYSTEM",
      payload: {
        rowCount: Number(row.rowCount),
        groupCount: Number(row.groupCount),
      },
    })),
    ...appliedReviewRuns.map(run => {
      const counts = decisionCounts.get(String(run.id)) ?? { rowCount: 0, groupCount: 0 }
      return {
        organizationId,
        runId: String(run.id),
        eventType: "RUN_FAILED",
        actorType: "SYSTEM",
        payload: counts,
      }
    }),
  ]
  if (autoReviewEvents.length > 0) {
    await tx.discoveryAutoReviewEvent.createMany({ data: autoReviewEvents })
  }

  const deletedPlainEnvelopes = await tx.$executeRawUnsafe(`
    DELETE FROM ingest_envelopes AS envelope
    WHERE envelope."organizationId" = $1
      AND envelope.id IN (SELECT id FROM _cs_envelopes)
      AND NOT EXISTS (
        SELECT 1
        FROM discovery_auto_review_decisions AS decision
        WHERE decision."organizationId" = envelope."organizationId"
          AND decision."envelopeId" = envelope.id
      )
  `, organizationId)

  const scrubbedDecisionEnvelopes = await tx.$executeRawUnsafe(`
    UPDATE ingest_envelopes AS envelope
    SET
      "sourceId" = NULL,
      "collectorRunId" = NULL,
      "routePlanId" = NULL,
      "providerRunId" = NULL,
      "acceptedMentionId" = NULL,
      "providerItemId" = NULL,
      "externalId" = NULL,
      "externalIds" = '{}'::jsonb,
      "postExternalId" = NULL,
      "parentExternalId" = NULL,
      "threadExternalId" = NULL,
      "replyToExternalId" = NULL,
      url = NULL,
      "canonicalUrl" = NULL,
      "parentPostUrl" = NULL,
      "authorName" = NULL,
      "authorHandle" = NULL,
      "authorAvatar" = NULL,
      text = NULL,
      "rawPayload" = '{}'::jsonb,
      "policySnapshot" = '{}'::jsonb,
      "subjectDecision" = '{}'::jsonb,
      "matchedTerms" = ARRAY[]::text[],
      "relevanceStatus" = 'PURGED',
      "relevanceReason" = 'operator_clean_slate_reset',
      "relevanceConfidence" = NULL,
      "decidedAt" = $2,
      "acceptedAt" = NULL,
      "purgeAt" = $2,
      "purgedAt" = $2,
      "reviewMutationKey" = NULL,
      "reviewMutationUntil" = NULL,
      "idempotencyKey" = 'clean-slate:' || envelope.id,
      "updatedAt" = $2
    WHERE envelope."organizationId" = $1
      AND envelope.id IN (SELECT id FROM _cs_envelopes)
      AND EXISTS (
        SELECT 1
        FROM discovery_auto_review_decisions AS decision
        WHERE decision."organizationId" = envelope."organizationId"
          AND decision."envelopeId" = envelope.id
      )
  `, organizationId, now)

  const deletedMediaSignals = await tx.$executeRawUnsafe(`
    DELETE FROM media_signals AS signal
    WHERE signal."organizationId" = $1
      AND signal.id IN (SELECT id FROM _cs_media_signals)
  `, organizationId)

  const deletedMediaProcessingRuns = await tx.$executeRawUnsafe(`
    DELETE FROM media_processing_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_media_processing_runs)
  `, organizationId)

  const deletedMediaObservations = await tx.$executeRawUnsafe(`
    DELETE FROM media_observations AS observation
    WHERE observation."organizationId" = $1
      AND observation.id IN (SELECT id FROM _cs_media_observations)
  `, organizationId)

  const deletedDiscoveryLeads = await tx.$executeRawUnsafe(`
    DELETE FROM discovery_leads AS lead
    WHERE lead."organizationId" = $1
      AND lead.id IN (SELECT id FROM _cs_discovery_leads)
  `, organizationId)

  const deletedMetrics = await tx.$executeRawUnsafe(`
    DELETE FROM social_metric_snapshots AS metric
    WHERE metric."organizationId" = $1
  `, organizationId)

  const deletedManualEngagementTasks = await tx.$executeRawUnsafe(`
    DELETE FROM manual_engagement_tasks AS task
    WHERE task."organizationId" = $1
      AND task."mentionId" IN (SELECT id FROM _cs_mentions)
  `, organizationId)

  const deletedSocialScheduledActions = await tx.$executeRawUnsafe(`
    DELETE FROM scheduled_actions AS action
    WHERE action."organizationId" = $1
      AND action.id IN (SELECT id FROM _cs_scheduled_actions)
  `, organizationId)

  const deletedSocialShadowActions = await tx.$executeRawUnsafe(`
    DELETE FROM ai_shadow_actions AS action
    WHERE action."organizationId" = $1
      AND action.id IN (SELECT id FROM _cs_shadow_actions)
  `, organizationId)

  const deletedDerivedSocialAiAlerts = await tx.$executeRawUnsafe(`
    DELETE FROM ai_alerts AS alert
    WHERE alert."organizationId" = $1
      AND alert.id IN (SELECT id FROM _cs_ai_alerts)
  `, organizationId)

  const deletedSocialAiInteractionLogs = await tx.$executeRawUnsafe(`
    DELETE FROM ai_interaction_logs AS interaction
    WHERE interaction."organizationId" = $1
      AND interaction.id IN (SELECT id FROM _cs_ai_interaction_logs)
  `, organizationId)

  const deletedSocialNotifications = await tx.$executeRawUnsafe(`
    DELETE FROM notifications AS notification
    WHERE notification."organizationId" = $1
      AND notification."entityType" = 'social_mention'
  `, organizationId)

  const deletedSpikeAuditMarkers = await tx.$executeRawUnsafe(`
    DELETE FROM audit_logs AS marker
    WHERE marker."organizationId" = $1
      AND marker."entityType" = 'social_mention'
      AND marker.action LIKE 'social-neg-spike:%'
  `, organizationId)

  await tx.$executeRawUnsafe(`
    UPDATE mention_clusters AS cluster
    SET "primaryMentionId" = NULL, "updatedAt" = $2
    WHERE cluster."organizationId" = $1
      AND cluster."primaryMentionId" IN (SELECT id FROM _cs_mentions)
  `, organizationId, now)

  const deletedMentions = await tx.$executeRawUnsafe(`
    DELETE FROM social_mentions AS mention
    WHERE mention."organizationId" = $1
      AND mention.id IN (SELECT id FROM _cs_mentions)
  `, organizationId)

  const deletedEmptyClusters = await tx.$executeRawUnsafe(`
    DELETE FROM mention_clusters AS cluster
    WHERE cluster."organizationId" = $1
      AND cluster.id IN (SELECT id FROM _cs_clusters)
      AND NOT EXISTS (
        SELECT 1
        FROM social_mentions AS mention
        WHERE mention."organizationId" = cluster."organizationId"
          AND mention."clusterId" = cluster.id
      )
  `, organizationId)

  await tx.$executeRawUnsafe(`
    UPDATE mention_clusters AS cluster
    SET
      "mentionCount" = surviving.count,
      "firstSeenAt" = surviving."firstSeenAt",
      "lastSeenAt" = surviving."lastSeenAt",
      "updatedAt" = $2
    FROM (
      SELECT
        mention."clusterId" AS id,
        count(*)::integer AS count,
        min(COALESCE(mention."publishedAt", mention."createdAt")) AS "firstSeenAt",
        max(COALESCE(mention."publishedAt", mention."createdAt")) AS "lastSeenAt"
      FROM social_mentions AS mention
      WHERE mention."organizationId" = $1
        AND mention."clusterId" IN (SELECT id FROM _cs_clusters)
      GROUP BY mention."clusterId"
    ) AS surviving
    WHERE cluster."organizationId" = $1
      AND cluster.id = surviving.id
  `, organizationId, now)

  const deletedFingerprints = await tx.$executeRawUnsafe(`
    DELETE FROM rejected_observation_fingerprints AS fingerprint
    WHERE fingerprint."organizationId" = $1
  `, organizationId)

  const deletedCheckpoints = await tx.$executeRawUnsafe(`
    DELETE FROM social_comment_checkpoints AS checkpoint
    WHERE checkpoint."organizationId" = $1
  `, organizationId)

  const apifyDatasets = await tx.$queryRawUnsafe(`
    SELECT run.id, run."providerKey", run."datasetId"
    FROM social_provider_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_financial_runs)
      AND run."providerKey" = 'APIFY'
      AND run."datasetId" IS NOT NULL
    ORDER BY run.id
  `, organizationId)
  const providerDatasetDeletionRows = apifyDatasets.map(run => {
    const target = `${run.providerKey}:${run.datasetId}`
    const identity = deletionIdentity(organizationId, "PROVIDER_DATASET", target)
    return {
      organizationId,
      idempotencyKey: identity.idempotencyKey,
      targetType: "PROVIDER_DATASET",
      targetKeyHmac: identity.targetKeyHmac,
      storageScope: run.providerKey,
      reason: "operator_clean_slate_reset",
      status: "PENDING",
      requestedAt: now,
      dueAt: now,
      nextRetryAt: now,
      metadata: {
        providerRunId: run.id,
        providerKey: run.providerKey,
        datasetId: run.datasetId,
      },
    }
  })
  const providerDatasetsQueued = providerDatasetDeletionRows.length > 0
    ? await tx.socialDeletionLedgerEntry.createMany({
        data: providerDatasetDeletionRows,
        skipDuplicates: true,
      })
    : { count: 0 }

  const purgedProviderRuns = await tx.$executeRawUnsafe(`
    UPDATE social_provider_runs AS run
    SET
      status = 'PURGED',
      "collectorRunId" = CASE
        WHEN run."collectorRunId" IN (SELECT id FROM _cs_collectors) THEN NULL
        ELSE run."collectorRunId"
      END,
      "datasetId" = NULL,
      "inputSnapshot" = jsonb_strip_nulls(jsonb_build_object(
        'resetAt', $2::timestamptz,
        'reason', 'operator_clean_slate_reset'
      )),
      "reservedChargeUsd" = 0,
      "actualChargeUsd" = NULL,
      "maxTotalChargeUsd" = 0,
      "dailyBudgetUsd" = NULL,
      "monthlyBudgetUsd" = NULL,
      "receivedCount" = 0,
      "acceptedCount" = 0,
      "reviewCount" = 0,
      "rejectedCount" = 0,
      "duplicateCount" = 0,
      "lastError" = 'operator_clean_slate_reset',
      "finishedAt" = COALESCE(run."finishedAt", $2),
      "importedAt" = NULL,
      "purgeAt" = $2,
      "purgedAt" = $2,
      "updatedAt" = $2
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_financial_runs)
  `, organizationId, now)

  const deletedOperationalPaidRunAuditEntries = await tx.$executeRawUnsafe(`
    DELETE FROM audit_logs AS audit
    WHERE audit."organizationId" = $1
      AND audit."entityType" = 'social_paid_run_authorization'
      AND audit.action IN ('authorize', 'complete', 'release', 'reset_boundary')
  `, organizationId)

  await tx.auditLog.create({
    data: {
      organizationId,
      userId: null,
      action: "reset_boundary",
      entityType: "social_paid_run_authorization",
      entityId: `clean-slate:${now.toISOString()}`,
      entityName: "Social Monitoring clean slate",
      newValue: {
        resetAt: now.toISOString(),
        reason: "operator_clean_slate_reset",
        budgetCarryForward,
        providerRunTombstones: purgedProviderRuns,
        operationalPaidRunAuditEntriesDeleted: deletedOperationalPaidRunAuditEntries,
        manualEngagementTasksDeleted: deletedManualEngagementTasks,
        socialScheduledActionsDeleted: deletedSocialScheduledActions,
        socialShadowActionsDeleted: deletedSocialShadowActions,
        derivedSocialAiAlertsDeleted: deletedDerivedSocialAiAlerts,
        socialAiInteractionLogsDeleted: deletedSocialAiInteractionLogs,
        socialNotificationsDeleted: deletedSocialNotifications,
        spikeAuditMarkersDeleted: deletedSpikeAuditMarkers,
      },
    },
  })

  await tx.$executeRawUnsafe(`
    UPDATE ingest_envelopes AS envelope
    SET "collectorRunId" = NULL, "updatedAt" = $2
    WHERE envelope."organizationId" = $1
      AND envelope."collectorRunId" IN (SELECT id FROM _cs_collectors)
  `, organizationId, now)

  const deletedCollectorRuns = await tx.$executeRawUnsafe(`
    DELETE FROM collector_runs AS run
    WHERE run."organizationId" = $1
      AND run.id IN (SELECT id FROM _cs_collectors)
      AND NOT EXISTS (
        SELECT 1
        FROM social_provider_runs AS provider
        WHERE provider."organizationId" = run."organizationId"
          AND provider."collectorRunId" = run.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = run."organizationId"
          AND envelope."collectorRunId" = run.id
      )
  `, organizationId)

  return {
    scenarios,
    sources,
    paidAuthorizationsReleased,
    deletedMonitoringRunJobs,
    budgetCarryForward,
    deletedDirectBindings,
    deletedSocialConnectionCursors,
    resetSocialAccountPollWatermarks,
    deletedRevisits,
    supersededAutoReviewDecisions,
    failedAutoReviewRuns,
    deletedPlainEnvelopes,
    scrubbedDecisionEnvelopes,
    deletedDiscoveryLeads,
    deletedMediaObservations,
    deletedMediaSignals,
    deletedMediaProcessingRuns,
    deletedMetrics,
    deletedManualEngagementTasks,
    deletedSocialScheduledActions,
    deletedSocialShadowActions,
    deletedDerivedSocialAiAlerts,
    deletedSocialAiInteractionLogs,
    deletedSocialNotifications,
    deletedSpikeAuditMarkers,
    deletedOperationalPaidRunAuditEntries,
    deletedMentions,
    deletedEmptyClusters,
    deletedFingerprints,
    deletedCheckpoints,
    providerDatasetsReferenced: apifyDatasets.length,
    providerDatasetsQueued: providerDatasetsQueued.count,
    purgedProviderRuns,
    deletedCollectorRuns,
  }
}

async function verifyReset(tx, organizationId) {
  const [post] = await tx.$queryRawUnsafe(`
    SELECT
      (
        SELECT count(*)
        FROM social_mentions AS mention
        WHERE mention."organizationId" = $1
          AND mention.id IN (SELECT id FROM _cs_mentions)
      ) AS "targetMentionsRemaining",
      (
        SELECT count(*)
        FROM mention_clusters AS cluster
        WHERE cluster."organizationId" = $1
      ) AS "mentionClustersRemaining",
      (
        SELECT count(*)
        FROM manual_engagement_tasks AS task
        WHERE task."organizationId" = $1
          AND task."mentionId" IN (SELECT id FROM _cs_mentions)
      ) AS "targetManualEngagementTasksRemaining",
      (
        SELECT count(*)
        FROM scheduled_actions AS action
        WHERE action."organizationId" = $1
          AND action.id IN (SELECT id FROM _cs_scheduled_actions)
      ) AS "targetSocialScheduledActionsRemaining",
      (
        SELECT count(*)
        FROM ai_shadow_actions AS action
        WHERE action."organizationId" = $1
          AND action.id IN (SELECT id FROM _cs_shadow_actions)
      ) AS "targetSocialShadowActionsRemaining",
      (
        SELECT count(*)
        FROM ai_alerts AS alert
        WHERE alert."organizationId" = $1
          AND alert.id IN (SELECT id FROM _cs_ai_alerts)
      ) AS "derivedSocialAiAlertsRemaining",
      (
        SELECT count(*)
        FROM ai_interaction_logs AS interaction
        WHERE interaction."organizationId" = $1
          AND interaction.id IN (SELECT id FROM _cs_ai_interaction_logs)
      ) AS "socialAiInteractionLogsRemaining",
      (
        SELECT count(*)
        FROM notifications AS notification
        WHERE notification."organizationId" = $1
          AND notification."entityType" = 'social_mention'
      ) AS "socialNotificationsRemaining",
      (
        SELECT count(*)
        FROM audit_logs AS marker
        WHERE marker."organizationId" = $1
          AND marker."entityType" = 'social_mention'
          AND marker.action LIKE 'social-neg-spike:%'
      ) AS "socialSpikeAuditMarkersRemaining",
      (
        SELECT count(*)
        FROM discovery_leads AS lead
        WHERE lead."organizationId" = $1
      ) AS "discoveryLeadsRemaining",
      (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
      ) AS "mediaObservationsRemaining",
      (
        SELECT count(*)
        FROM media_signals AS signal
        WHERE signal."organizationId" = $1
      ) AS "mediaSignalsRemaining",
      (
        SELECT count(*)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
      ) AS "mediaProcessingRunsRemaining",
      (
        SELECT count(*)
        FROM discovery_leads AS lead
        WHERE lead."organizationId" = $1
          AND lead.status <> 'PURGED'
      ) + (
        SELECT count(*)
        FROM media_observations AS observation
        WHERE observation."organizationId" = $1
          AND observation."purgedAt" IS NULL
      ) AS "visibleMediaDiscoveryCardsRemaining",
      (
        SELECT COALESCE(sum(run."estimatedCostUsd"), 0)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
      ) AS "mediaEstimatedCostUsdRemaining",
      (
        SELECT COALESCE(sum(run."reservedCostUsd"), 0)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
      ) AS "mediaReservedCostUsdRemaining",
      (
        SELECT COALESCE(sum(run."actualCostUsd"), 0)
        FROM media_processing_runs AS run
        WHERE run."organizationId" = $1
      ) AS "mediaActualCostUsdRemaining",
      (
        SELECT count(*)
        FROM social_metric_snapshots AS metric
        WHERE metric."organizationId" = $1
      ) AS "socialMetricSnapshotsRemaining",
      (
        SELECT count(*)
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope.id IN (SELECT id FROM _cs_envelopes)
          AND envelope."purgedAt" IS NULL
      ) AS "visibleTargetEnvelopesRemaining",
      (
        SELECT count(*)
        FROM ingest_envelopes AS envelope
        WHERE envelope."organizationId" = $1
          AND envelope.id IN (SELECT id FROM _cs_envelopes)
          AND envelope."providerItemId" IS NOT NULL
      ) AS "targetEnvelopeProviderItemIdsRemaining",
      (
        SELECT count(*)
        FROM tiktok_publication_revisits AS revisit
        WHERE revisit."organizationId" = $1
      ) AS "tiktokPublicationRevisitsRemaining",
      (
        SELECT count(*)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run."purgedAt" IS NULL
      ) AS "providerRunsRemaining",
      (
        SELECT COALESCE(sum(run."reservedChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run."purgedAt" IS NULL
      ) AS "reservedChargeUsdRemaining",
      (
        SELECT COALESCE(sum(run."actualChargeUsd"), 0)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run."purgedAt" IS NULL
      ) AS "actualChargeUsdRemaining",
      (
        SELECT count(*)
        FROM social_provider_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_financial_runs)
          AND (
            run."reservedChargeUsd" <> 0
            OR run."actualChargeUsd" IS NOT NULL
            OR run."maxTotalChargeUsd" <> 0
            OR run."dailyBudgetUsd" IS NOT NULL
            OR run."monthlyBudgetUsd" IS NOT NULL
          )
      ) AS "providerFinancialFieldsRemaining",
      (
        SELECT count(*)
        FROM audit_logs AS auth_entry
        WHERE auth_entry."organizationId" = $1
          AND auth_entry."entityType" = 'social_paid_run_authorization'
          AND auth_entry.action IN ('authorize', 'complete', 'release')
      ) AS "operationalPaidRunAuditEntriesRemaining",
      (
        SELECT count(*)
        FROM audit_logs AS auth_entry
        WHERE auth_entry."organizationId" = $1
          AND auth_entry."entityType" = 'social_paid_run_authorization'
          AND auth_entry.action = 'authorize'
          AND auth_entry."createdAt" > COALESCE((
            SELECT max(boundary."createdAt")
            FROM audit_logs AS boundary
            WHERE boundary."organizationId" = $1
              AND boundary."entityType" = 'social_paid_run_authorization'
              AND boundary.action = 'reset_boundary'
              AND boundary."userId" IS NULL
              AND boundary."entityName" = 'Social Monitoring clean slate'
              AND boundary."entityId" LIKE 'clean-slate:%'
          ), '-infinity'::timestamptz)
      ) AS "postBoundaryAuthorizations",
      COALESCE((
        SELECT CASE
          WHEN boundary."newValue"->'budgetCarryForward'->>'schemaVersion'
            <> 'social-monitoring-budget-carry-v1' THEN 1
          WHEN boundary."newValue"->'budgetCarryForward'->>'capturedAt' IS NULL THEN 1
          WHEN boundary."newValue"->'budgetCarryForward'->'ai'->>'dayCostUsd' IS NULL THEN 1
          WHEN boundary."newValue"->'budgetCarryForward'->'ai'->>'monthCostUsd' IS NULL THEN 1
          ELSE 0
        END
        FROM (
          SELECT audit.id, audit."newValue"
          FROM audit_logs AS audit
          WHERE audit."organizationId" = $1
            AND audit."entityType" = 'social_paid_run_authorization'
            AND audit.action = 'reset_boundary'
            AND audit."userId" IS NULL
            AND audit."entityName" = 'Social Monitoring clean slate'
            AND audit."entityId" LIKE 'clean-slate:%'
          ORDER BY audit."createdAt" DESC
          LIMIT 1
        ) AS boundary
      ), 1) AS "resetBudgetCarryFailures",
      (
        SELECT count(*)
        FROM organizations AS organization
        WHERE organization.id = $1
          AND (
            COALESCE(
              organization.settings->'socialMonitoringPaidRuns'->>'emergencyStopped',
              'true'
            ) <> 'true'
            OR COALESCE(
              organization.settings->'socialMonitoringCleanSlate'->>'collectionBlocked',
              'false'
            ) <> 'true'
          )
      ) AS "resetFenceFailures",
      (
        SELECT count(*)
        FROM social_monitoring_run_jobs AS job
        WHERE job."organizationId" = $1
      ) AS "monitoringRunJobsRemaining",
      (
        SELECT count(*)
        FROM collector_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_collectors)
      ) AS "targetCollectorRunsRemaining",
      (
        SELECT count(*)
        FROM social_connection_cursors AS cursor
        WHERE cursor."organizationId" = $1
      ) AS "socialConnectionCursorsRemaining",
      (
        SELECT count(*)
        FROM social_accounts AS account
        WHERE account."organizationId" = $1
          AND account."lastPolledAt" IS NOT NULL
      ) AS "socialAccountPollWatermarksRemaining",
      (
        SELECT count(*)
        FROM rejected_observation_fingerprints AS fingerprint
        WHERE fingerprint."organizationId" = $1
      ) AS "rejectedObservationFingerprintsRemaining",
      (
        SELECT count(*)
        FROM social_comment_checkpoints AS checkpoint
        WHERE checkpoint."organizationId" = $1
      ) AS "socialCommentCheckpointsRemaining",
      (
        SELECT count(*)
        FROM monitoring_subject_sources AS binding
        WHERE binding."organizationId" = $1
          AND binding.id IN (SELECT id FROM _cs_direct_bindings)
      ) AS "legacyDirectBindingsRemaining",
      (
        SELECT count(*)
        FROM monitoring_sources AS source
        JOIN _cs_sources AS scoped ON scoped.id = source.id
        WHERE source."organizationId" = $1
          AND scoped.scenario_managed
          AND source.status NOT IN ('paused', 'disabled')
      ) AS "runnableManagedSourcesRemaining",
      (
        SELECT count(*)
        FROM monitoring_sources AS source
        JOIN _cs_direct_sources AS direct ON direct.id = source.id
        WHERE source."organizationId" = $1
          AND source.status <> 'disabled'
      ) AS "runnableLegacyDirectSourcesRemaining",
      (
        SELECT count(*)
        FROM monitoring_sources AS source
        WHERE source."organizationId" = $1
          AND (
            source.status NOT IN ('paused', 'disabled')
            OR source."lastCheckedAt" IS NOT NULL
            OR source."lastSuccessfulAt" IS NOT NULL
            OR source."lastError" IS NOT NULL
            OR source."runClaimToken" IS NOT NULL
            OR source."runClaimExpiresAt" IS NOT NULL
            OR COALESCE(source.settings->'searchIndex', '{}'::jsonb) ? 'fetchAfter'
            OR COALESCE(source.settings->'searchIndex', '{}'::jsonb) ? 'fetchAfterUpdatedAt'
            OR COALESCE(source.settings->'searchIndex', '{}'::jsonb) ? 'fetchAfterReason'
            OR EXISTS (
              SELECT 1
              FROM jsonb_object_keys(
                CASE
                  WHEN jsonb_typeof(source.settings->'searchIndex'->'routeProviderCursors') = 'object'
                    THEN source.settings->'searchIndex'->'routeProviderCursors'
                  ELSE '{}'::jsonb
                END
              )
            )
          )
      ) AS "sourceOperationalStateRemaining",
      (
        SELECT count(*)
        FROM source_route_plans AS route
        WHERE route."organizationId" = $1
          AND (
            route.status = 'DEGRADED'
            OR route."failureCount" <> 0
            OR route."circuitOpenUntil" IS NOT NULL
            OR route."lastFailureClass" IS NOT NULL
            OR route."lastSucceededAt" IS NOT NULL
          )
      ) AS "routeOperationalStateRemaining",
      (
        SELECT count(*)
        FROM monitoring_sources AS source
        JOIN _cs_sources AS scoped ON scoped.id = source.id
        WHERE source."organizationId" = $1
          AND scoped.scenario_managed
          AND EXISTS (
            SELECT 1
            FROM jsonb_object_keys(
              CASE
                WHEN jsonb_typeof(source.settings->'searchIndex'->'routeProviderCursors') = 'object'
                  THEN source.settings->'searchIndex'->'routeProviderCursors'
                ELSE '{}'::jsonb
              END
            )
          )
      ) AS "managedCursorSourcesRemaining",
      (
        SELECT count(*)
        FROM channel_configs AS config
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(config.settings, '{}'::jsonb)->'scenarios') = 'array'
              THEN config.settings->'scenarios'
            ELSE '[]'::jsonb
          END
        ) AS scenario(value)
        WHERE config."organizationId" = $1
          AND config."channelType" = 'social_monitoring'
          AND config."configName" = 'Monitoring scenarios'
          AND (
            scenario.value->>'status' = 'active'
            OR jsonb_array_length(
              CASE
                WHEN jsonb_typeof(scenario.value->'search'->'handles') = 'array'
                  THEN scenario.value->'search'->'handles'
                ELSE '[]'::jsonb
              END
            ) > 0
            OR jsonb_array_length(
              CASE
                WHEN jsonb_typeof(scenario.value->'search'->'urls') = 'array'
                  THEN scenario.value->'search'->'urls'
                ELSE '[]'::jsonb
              END
            ) > 0
          )
      ) AS "activeOrDirectScenarioConfigsRemaining",
      (
        SELECT count(*)
        FROM discovery_auto_review_runs AS run
        WHERE run."organizationId" = $1
          AND run.id IN (SELECT id FROM _cs_review_runs)
          AND run.state = 'APPLIED'
      ) AS "activeAutoReviewRunsRemaining",
      (
        SELECT count(*)
        FROM discovery_auto_review_decisions AS decision
        WHERE decision."organizationId" = $1
          AND decision."runId" IN (SELECT id FROM _cs_review_runs)
          AND decision.state = 'SUPPRESSED'
      ) AS "suppressedAutoReviewDecisionsRemaining"
  `, organizationId)

  const normalized = serialize(post)
  const nonZero = Object.entries(normalized).filter(([, value]) => Number(value) !== 0)
  if (nonZero.length > 0) {
    throw new Error(`postcondition failed: ${JSON.stringify(Object.fromEntries(nonZero))}`)
  }
  return normalized
}

async function engagePaidRunEmergencyStop(prisma, now) {
  return prisma.$transaction(async tx => {
    const lockKeys = [
      `social-paid-runs:${TENANT.id}`,
      `${TENANT.id}:paid-social-spend`,
      `social-monitoring-clean-slate:${TENANT.id}`,
    ].sort()
    for (const key of lockKeys) {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        key,
      )
    }
    const organization = await tx.organization.findFirst({
      where: { slug: TENANT.slug },
      select: { id: true, name: true, settings: true },
    })
    if (
      !organization
      || organization.id !== TENANT.id
      || organization.name !== TENANT.name
    ) {
      throw new Error("tenant identity mismatch while engaging paid-run emergency stop")
    }
    const settings = structuredClone(record(organization.settings))
    const paidRuns = structuredClone(record(settings.socialMonitoringPaidRuns))
    const wasEmergencyStopped = paidRuns.emergencyStopped !== false
    settings.socialMonitoringPaidRuns = {
      ...paidRuns,
      emergencyStopped: true,
      updatedAt: now.toISOString(),
    }
    settings.socialMonitoringCleanSlate = {
      ...record(settings.socialMonitoringCleanSlate),
      collectionBlocked: true,
      requestedAt: now.toISOString(),
      reason: "operator_clean_slate_reset",
    }
    await tx.organization.update({
      where: { id: TENANT.id },
      data: { settings },
    })
    return { wasEmergencyStopped, emergencyStopped: true }
  }, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 30_000,
  })
}

async function assertSafeContentReset(prisma) {
  return prisma.$transaction(async tx => {
    const organization = await tx.organization.findFirst({
      where: { slug: TENANT.slug },
      select: { id: true, name: true },
    })
    if (
      !organization
      || organization.id !== TENANT.id
      || organization.name !== TENANT.name
    ) {
      throw new Error("tenant identity mismatch during clean-slate preflight")
    }
    await materializeScope(tx, organization.id)
    const report = await buildReport(tx, organization.id)
    if (report.scope.scenarios < 1) {
      throw new Error("no monitoring scenarios found; refusing reset")
    }
    if (protectedReferenceCount(report) > 0) {
      throw new Error(
        `protected scenario findings exist; refusing reset: ${JSON.stringify(report.protectedRefs)}`,
      )
    }
    if (boundaryReferenceCount(report) > 0) {
      throw new Error(
        `scenario scope crosses preserved records; refusing reset: ${JSON.stringify(report.boundaryRefs)}`,
      )
    }
    if (Number(report.activeMedia?.count ?? 0) > 0) {
      throw new Error(
        `active media processing exists; refusing reset: ${JSON.stringify(report.activeMedia)}`,
      )
    }
    return {
      scenarios: report.scope.scenarios,
      mentions: report.scope.mentions,
      envelopes: report.scope.envelopes,
      providerRuns: report.scope.financialProviderRuns,
    }
  }, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 120_000,
  })
}

async function quiesceActiveProviderRuns(prisma, now) {
  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: TENANT.id,
      purgedAt: null,
      status: { in: [...ACTIVE_LOCAL_PROVIDER_STATUSES] },
    },
    select: {
      id: true,
      providerKey: true,
      externalRunId: true,
      collectorRunId: true,
      status: true,
      lastError: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  const remote = await mapWithBoundedConcurrency(
    runs,
    PROVIDER_QUIESCE_CONCURRENCY,
    quiesceProviderRun,
  )

  const runIds = runs.map(run => run.id)
  const collectorRunIds = Array.from(new Set(
    runs.flatMap(run => run.collectorRunId ? [run.collectorRunId] : []),
  ))
  if (runIds.length > 0) {
    await prisma.$transaction(async tx => {
      const lockKeys = [
        `social-paid-runs:${TENANT.id}`,
        `${TENANT.id}:paid-social-spend`,
        `social-monitoring-clean-slate:${TENANT.id}`,
      ].sort()
      for (const key of lockKeys) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          key,
        )
      }
      await tx.socialProviderRun.updateMany({
        where: {
          organizationId: TENANT.id,
          id: { in: runIds },
          status: { in: [...ACTIVE_LOCAL_PROVIDER_STATUSES] },
        },
        data: {
          status: "BLOCKED",
          lastError: "operator_clean_slate_provider_quiesced",
          finishedAt: now,
        },
      })
      if (collectorRunIds.length > 0) {
        await tx.collectorRun.updateMany({
          where: {
            organizationId: TENANT.id,
            id: { in: collectorRunIds },
            status: "running",
          },
          data: {
            status: "partial",
            finishedAt: now,
            error: "operator_clean_slate_provider_quiesced",
          },
        })
      }
    }, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000,
    })
  }
  return { runs: runs.length, remote }
}

async function main() {
  if (execute && confirmation !== CONFIRMATION) {
    throw new Error(`execute requires --confirm=${CONFIRMATION}`)
  }

  const prisma = await makeScriptPrisma()
  try {
    const fenceAt = new Date()
    const safety = execute
      ? {
          preflight: await assertSafeContentReset(prisma),
          paidRunFence: await engagePaidRunEmergencyStop(prisma, fenceAt),
          providerQuiescence: await quiesceActiveProviderRuns(prisma, fenceAt),
        }
      : null
    const report = await prisma.$transaction(async tx => {
      const lockKeys = [
        `social-monitoring-scenarios:${TENANT.id}`,
        `social-paid-runs:${TENANT.id}`,
        `${TENANT.id}:paid-social-spend`,
        `social-monitoring-clean-slate:${TENANT.id}`,
      ].sort()
      for (const key of lockKeys) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          key,
        )
      }
      // Lock the settings row before taking the transaction's authoritative
      // snapshot. A concurrent policy toggle must either finish first and be
      // observed here or wait until the reset commits; it cannot silently turn
      // collection back on midway through the clean slate.
      await tx.$queryRawUnsafe(
        `SELECT id FROM organizations WHERE id = $1 FOR UPDATE`,
        TENANT.id,
      )
      const organization = await tx.organization.findUnique({
        where: { id: TENANT.id },
        select: { id: true, slug: true, name: true, settings: true },
      })
      if (!organization) throw new Error(`tenant id=${TENANT.id} was not found`)
      if (organization.slug !== TENANT.slug || organization.name !== TENANT.name) {
        throw new Error("tenant identity mismatch; refusing clean-slate reset")
      }
      const paidRunSettings = record(record(organization.settings).socialMonitoringPaidRuns)
      const cleanSlateSettings = record(record(organization.settings).socialMonitoringCleanSlate)
      if (execute && (
        paidRunSettings.emergencyStopped !== true
        || cleanSlateSettings.collectionBlocked !== true
      )) {
        throw new Error(
          "clean-slate collection fence was resumed before reset; refusing execution",
        )
      }

      const providerConfigBefore = await tx.channelConfig.findMany({
        where: {
          organizationId: organization.id,
          channelType: "social_monitoring",
          configName: "Monitoring providers",
        },
        select: { id: true, settings: true, isActive: true },
        orderBy: { id: "asc" },
      })
      const providerConfigFingerprint = jsonFingerprint(providerConfigBefore)
      const organizationSettingsFingerprint = jsonFingerprint(organization.settings)

      await materializeScope(tx, organization.id)
      const before = await buildReport(tx, organization.id)
      if (before.scope.scenarios < 1) {
        throw new Error("no monitoring scenarios found; refusing reset")
      }
      if (!execute) return before
      if (protectedReferenceCount(before) > 0) {
        throw new Error(
          `protected scenario findings exist; refusing reset: ${JSON.stringify(before.protectedRefs)}`,
        )
      }
      if (boundaryReferenceCount(before) > 0) {
        throw new Error(
          `scenario scope crosses preserved records; refusing reset: ${JSON.stringify(before.boundaryRefs)}`,
        )
      }
      if (Number(before.activeMedia?.count ?? 0) > 0) {
        throw new Error(
          `active media processing exists; refusing reset: ${JSON.stringify(before.activeMedia)}`,
        )
      }
      if (before.activeProviderRuns.length > 0) {
        throw new Error(
          `active provider runs exist; reconcile or cancel them before reset: ${JSON.stringify(before.activeProviderRuns)}`,
        )
      }
      const liveCollectorRuns = before.activeCollectorRuns.filter(run => run.stale !== true)
      if (liveCollectorRuns.length > 0 || Number(before.claimsAndSpend?.unexpiredSourceClaims ?? 0) > 0) {
        throw new Error(
          `live collectors or source claims exist; wait for collection to stop before reset: ${JSON.stringify({
            liveCollectorRuns,
            unexpiredSourceClaims: before.claimsAndSpend?.unexpiredSourceClaims ?? 0,
          })}`,
        )
      }

      // Use a fresh timestamp only after all locks, quiescence and
      // authoritative checks have completed. If preflight crosses a UTC
      // day/month boundary, every carry period and deletion boundary must be
      // derived from this same final instant.
      const effectiveResetAt = new Date()
      const changes = await executeReset(tx, organization.id, effectiveResetAt)
      const postconditions = await verifyReset(tx, organization.id)
      const providerConfigAfter = await tx.channelConfig.findMany({
        where: {
          organizationId: organization.id,
          channelType: "social_monitoring",
          configName: "Monitoring providers",
        },
        select: { id: true, settings: true, isActive: true },
        orderBy: { id: "asc" },
      })
      const organizationAfter = await tx.organization.findFirst({
        where: { id: organization.id },
        select: { settings: true },
      })
      if (jsonFingerprint(providerConfigAfter) !== providerConfigFingerprint) {
        throw new Error("provider configuration changed during reset")
      }
      if (jsonFingerprint(organizationAfter?.settings) !== organizationSettingsFingerprint) {
        throw new Error("organization/provider policy settings changed during reset")
      }
      const after = await buildReport(tx, organization.id)
      return serialize({
        mode: "execute",
        tenant: TENANT,
        safety,
        before,
        changes,
        postconditions,
        after,
        preserved: {
          providerConfiguration: true,
          providerCredentialsAndLimits: true,
          paidRunEmergencyStop: true,
          providerCallbackTombstones: true,
          providerFinancialResetBoundary: true,
          mediaProcessingPolicy: true,
          visualReferences: true,
          crmFinance: true,
        },
      })
    }, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 120_000,
    })
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(`[reset-brandprotection-scenario-monitoring] FAILED: ${error.message}`)
  process.exit(1)
})
