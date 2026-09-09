import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const resetScript = readFileSync(
  join(process.cwd(), "scripts/reset-brandprotection-scenario-monitoring.mjs"),
  "utf8",
)

function section(startMarker: string, endMarker: string): string {
  const start = resetScript.indexOf(startMarker)
  const end = resetScript.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`reset script section missing: ${startMarker}`)
  return resetScript.slice(start, end)
}

describe("Brand Protection clean-slate media reset", () => {
  it("scopes every tenant media-history table instead of only mention-linked rows", () => {
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_discovery_leads")
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_media_observations")
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_media_signals")
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_media_processing_runs")
    expect(resetScript).toMatch(
      /FROM discovery_leads AS lead\s+WHERE lead\."organizationId" = \$1\s+`/,
    )
    expect(resetScript).toMatch(
      /FROM media_observations AS observation\s+WHERE observation\."organizationId" = \$1\s+`/,
    )
    expect(resetScript).toMatch(
      /FROM media_signals AS signal\s+WHERE signal\."organizationId" = \$1\s+`/,
    )
    expect(resetScript).toMatch(
      /FROM media_processing_runs AS run\s+WHERE run\."organizationId" = \$1\s+`/,
    )
  })

  it("fails closed for live or unknown processing state while reporting queued work separately", () => {
    expect(resetScript).toContain('AS "blockingRuns"')
    expect(resetScript).toContain('AS "queuedRuns"')
    expect(resetScript).toContain('AS "blockingObservations"')
    expect(resetScript).toContain('AS "queuedObservations"')
    expect(resetScript).toContain('AS "unexpiredObservationClaims"')
    expect(resetScript).toContain("run.status NOT IN (")
    expect(resetScript).toContain('observation."claimExpiresAt" > NOW()')
    expect(resetScript).toContain("active media processing exists; refusing reset")
  })

  it("deletes media cards, signals, runs and costs with zero-row postconditions", () => {
    expect(resetScript).toMatch(
      /DELETE FROM media_signals AS signal\s+WHERE signal\."organizationId" = \$1/,
    )
    expect(resetScript).toMatch(
      /DELETE FROM media_processing_runs AS run\s+WHERE run\."organizationId" = \$1/,
    )
    expect(resetScript).toMatch(
      /DELETE FROM media_observations AS observation\s+WHERE observation\."organizationId" = \$1/,
    )
    expect(resetScript).toMatch(
      /DELETE FROM discovery_leads AS lead\s+WHERE lead\."organizationId" = \$1/,
    )
    expect(resetScript).toContain('AS "visibleMediaDiscoveryCardsRemaining"')
    expect(resetScript).toContain('AS "mediaReservedCostUsdRemaining"')
    expect(resetScript).toContain('AS "mediaActualCostUsdRemaining"')
    expect(resetScript).not.toContain("mediaProcessingFinancialAudit")
  })

  it("deletes every tenant metric snapshot, including orphaned provenance rows", () => {
    expect(resetScript).toMatch(
      /DELETE FROM social_metric_snapshots AS metric\s+WHERE metric\."organizationId" = \$1\s+`/,
    )
    expect(resetScript).toContain('AS "socialMetricSnapshotsRemaining"')
  })

  it("deletes every tenant mention cluster, including orphaned aggregate history", () => {
    expect(resetScript).toMatch(
      /INSERT INTO _cs_clusters\(id\)\s+SELECT cluster\.id\s+FROM mention_clusters AS cluster\s+WHERE cluster\."organizationId" = \$1/,
    )
    expect(resetScript).toContain('AS "mentionClustersRemaining"')
  })

  it("deletes durable manual run jobs so no stale queue survives the reset", () => {
    expect(resetScript).toMatch(
      /DELETE FROM social_monitoring_run_jobs AS job\s+WHERE job\."organizationId" = \$1/,
    )
    expect(resetScript).toContain('AS "monitoringRunJobsRemaining"')
    expect(resetScript).toContain("deletedMonitoringRunJobs")
  })

  it("fails closed for CRM tasks and already-attempted derived actions", () => {
    expect(resetScript).toContain('AS "crmTasksLinkedByReverseRelation"')
    expect(resetScript).toContain('task."relatedType" = \'social_mention\'')
    expect(resetScript).toMatch(
      /FROM tasks AS task\s+WHERE task\."organizationId" = \$1\s+AND task\."relatedType" = 'social_mention'\s+\) AS "crmTasksLinkedByReverseRelation"/,
    )
    expect(resetScript).toMatch(
      /FROM ai_alerts AS alert\s+WHERE alert\."organizationId" = \$1\s+AND alert\.type = 'social_manual_escalation'\s+\) AS "manualEscalationAlerts"/,
    )
    expect(resetScript).toContain('AS "authorizedOrAttemptedSocialShadowActions"')
    expect(resetScript).toContain("action.approved IS TRUE")
    expect(resetScript).toContain("COALESCE(action.\"executionStatus\", '') NOT IN ('pending', 'rejected')")
    expect(resetScript).toContain('AS "attemptedSocialScheduledActions"')
    expect(resetScript).toContain('action."executedAt" IS NOT NULL')
    expect(resetScript).toContain("action.attempts > 0")
  })

  it("removes only unacted monitoring actions, alerts, notifications and spike markers", () => {
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_shadow_actions")
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_scheduled_actions")
    expect(resetScript).toMatch(
      /INSERT INTO _cs_shadow_actions\(id\)\s+SELECT action\.id\s+FROM ai_shadow_actions AS action\s+WHERE action\."organizationId" = \$1\s+AND action\."entityType" = 'social_mention'\s+`/,
    )
    expect(resetScript).toMatch(
      /INSERT INTO _cs_scheduled_actions\(id\)\s+SELECT action\.id\s+FROM scheduled_actions AS action\s+WHERE action\."organizationId" = \$1\s+AND action\."entityType" = 'social_mention'\s+`/,
    )
    expect(resetScript).toContain("DELETE FROM scheduled_actions AS action")
    expect(resetScript).toContain("DELETE FROM ai_shadow_actions AS action")
    expect(resetScript).toContain("DELETE FROM ai_alerts AS alert")
    expect(resetScript).toContain("'social_source_failure'")
    expect(resetScript).toContain("DELETE FROM notifications AS notification")
    expect(resetScript).toContain("marker.action LIKE 'social-neg-spike:%'")
    expect(resetScript).toContain('AS "targetSocialScheduledActionsRemaining"')
    expect(resetScript).toContain('AS "targetSocialShadowActionsRemaining"')
    expect(resetScript).toContain('AS "derivedSocialAiAlertsRemaining"')
    expect(resetScript).toContain('AS "socialNotificationsRemaining"')
  })

  it("scrubs raw provider identifiers from retained decision-envelope tombstones", () => {
    expect(resetScript).toContain('"providerItemId" = NULL')
    expect(resetScript).toContain('AS "targetEnvelopeProviderItemIdsRemaining"')
  })

  it("deletes monitoring AI content while retaining only aggregate budget carry", () => {
    expect(resetScript).toContain("CREATE TEMP TABLE _cs_ai_interaction_logs")
    expect(resetScript).toContain("interaction.\"agentType\" = 'social_monitoring'")
    expect(resetScript).toContain("LEFT(interaction.\"userMessage\", 7) = 'social_'")
    expect(resetScript).toContain("DELETE FROM ai_interaction_logs")
    expect(resetScript).toContain('AS "socialAiInteractionLogsRemaining"')
    expect(resetScript).toContain("ai: {")
  })

  it("carries current-period provider, media and AI spend into hidden budget enforcement", () => {
    expect(resetScript).toContain("social-monitoring-budget-carry-v1")
    expect(resetScript).toContain("async function computeBudgetCarryForward")
    expect(resetScript).toContain("budgetCarryForward,")
    expect(resetScript).toContain("paidRunAuthorization:")
    expect(resetScript).toContain("dayReservedUsd:")
    expect(resetScript).toContain("monthReservedUsd:")
    expect(resetScript).toContain("dayCostUsd:")
    expect(resetScript).toContain("monthCostUsd:")
    expect(resetScript).toContain('AS "resetBudgetCarryFailures"')
    expect(resetScript).toContain('"reservedChargeUsd" = 0')
    expect(resetScript).toContain('"actualChargeUsd" = NULL')
    expect(resetScript).toContain(
      "audit.action IN ('authorize', 'complete', 'release', 'reset_boundary')",
    )
    expect(resetScript).not.toContain("providerFinancialAudit")
  })

  it("excludes only exact terminal no-dispatch markers from reset spend and run carry", () => {
    const carry = section(
      "async function computeBudgetCarryForward",
      "async function pauseAndNormalizeScenarios",
    )

    expect(carry.match(/AND\s+COALESCE\(run\."inputSnapshot", '\{\}'::jsonb\)\s+@> '\{"providerRequestDispatched": false\}'::jsonb/g)).toHaveLength(2)
    expect(carry.match(/@> '\{"providerRequestDispatched": true\}'::jsonb/g)).toHaveLength(2)
    expect(carry).not.toContain("->>'providerRequestDispatched'")
    expect(carry.match(/COALESCE\(run\."actualChargeUsd", 0\) <= 0/g)).toHaveLength(2)
    expect(carry.match(/adapterKey" IN \('X_API', 'TIKTOK_BUSINESS_API', 'BRIGHT_DATA_SNAPSHOT'\)/g)).toHaveLength(2)
    expect(carry.match(/status IN \('SUCCEEDED', 'FAILED', 'BLOCKED', 'PARTIAL', 'IMPORTED', 'PURGED'\)/g)).toHaveLength(2)
    expect(carry).not.toContain("status NOT IN ('QUEUED', 'RUNNING')")
  })

  it("takes the effective reset timestamp inside the final locked transaction", () => {
    expect(resetScript).toContain("const fenceAt = new Date()")
    expect(resetScript).toContain("const effectiveResetAt = new Date()")
    expect(resetScript).toContain(
      "await executeReset(tx, organization.id, effectiveResetAt)",
    )
  })

  it("clears every tenant polling cursor and dedupe checkpoint", () => {
    expect(resetScript).toContain("DELETE FROM social_connection_cursors AS cursor")
    expect(resetScript).toContain('SET "lastPolledAt" = NULL')
    expect(resetScript).toMatch(
      /DELETE FROM rejected_observation_fingerprints AS fingerprint\s+WHERE fingerprint\."organizationId" = \$1/,
    )
    expect(resetScript).toMatch(
      /DELETE FROM social_comment_checkpoints AS checkpoint\s+WHERE checkpoint\."organizationId" = \$1/,
    )
    expect(resetScript).toContain('AS "rejectedObservationFingerprintsRemaining"')
    expect(resetScript).toContain('AS "socialCommentCheckpointsRemaining"')
    expect(resetScript).toContain('AS "tiktokPublicationRevisitsRemaining"')
    expect(resetScript).toContain('AS "sourceOperationalStateRemaining"')
    expect(resetScript).toContain('AS "routeOperationalStateRemaining"')
  })

  it("preserves independent direct bindings while retiring scenario-owned ones", () => {
    expect(resetScript).toContain(
      'binding."scenarioId" IN (SELECT scenario_id FROM _cs_scenarios)',
    )
    expect(resetScript).toContain(
      "COALESCE(source.settings->>'managedBy', '') = 'monitoring_scenario'",
    )
    expect(resetScript).toContain(
      "link->>'scenarioId' IN (SELECT scenario_id FROM _cs_scenarios)",
    )
  })
})
