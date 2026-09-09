# Social Monitoring operator runbook

This runbook is the production handoff for Brand Protection Social Monitoring.
It is intentionally operational: credentials, provider tokens, and paid caps
must stay in GitHub Actions secrets or the production secret store and must
never be copied from chat or shell history.

## Post-deploy verification

1. Confirm the deploy workflow completed the quality, artifact, deploy, ping,
   and feature-smoke stages.
2. Check the immutable artifact marker on the server:

   /opt/leaddrive-v2/.next/standalone/.deploy-sha

3. Check the public database-path probe:

   GET /api/v1/ping

   A healthy response has `ok: true`. The public probe deliberately omits
   database metadata, tenant counts, latency, and internal error details.
4. When the repository secrets SOCIAL_SMOKE_EMAIL and
   SOCIAL_SMOKE_PASSWORD are configured, the deploy workflow also runs
   scripts/social-monitoring-browser-smoke.mjs. It authenticates through
   the credentials callback, verifies the tenant-scoped monitoring-sources
   API, opens Sources, and selects READ_EXTERNAL_COMMENTS in a configured
   paid-source dialog. It asserts that the suggested cap is at most USD 1,
   that an empty cap disables confirmation, and that no provider-run request
   was sent. The step emits a warning and skips rather than pretending to pass
   while those secrets are absent.

## Source diagnostics and reruns

- Open Social Monitoring -> Sources and inspect the source readiness badge,
  last successful run, last error, route plan, and provider capability proof.
- For a read-only API diagnostic, use the authenticated
  GET /api/v1/social/monitoring-sources?limit=200 endpoint.
- Rerun only the affected source after checking its route and provider
  capability. Bulk Run all excludes paid sources.
- Paid manual runs require a positive one-shot USD cap in the confirmation
  dialog. The cap is forwarded to the provider and fails closed when the
  tenant policy is stopped, exhausted, or missing.
- Never raise a tenant budget or enable recurring paid collection as part of a
  rerun. Those are separate owner-authorized changes.

## Error handling

Use the collector error class and the source health state to choose the next
action:

- AUTH / 401 / 403: reconnect or rotate the provider account; do not retry
  blindly.
- RATE_LIMIT / 429: respect provider quota and retry-after; reduce cadence.
- BUDGET: stop paid retries until the tenant budget is explicitly changed.
- TRANSIENT / 5xx / timeout: allow backoff and retry; investigate if the
  failure persists for three runs.
- POLICY or PERMANENT: quarantine the route and review capability, terms, or
  schema before re-enabling it.

The source lease reaper marks abandoned running leases as failed. Do not
manually delete collector-run rows to hide a failed attempt.

The source cron evaluates SLOs after each collection wave and writes
tenant-scoped, 24-hour-deduplicated alerts for stale runs, consecutive failures,
zero-result anomalies, rejection spikes, quota/budget exhaustion, and repeated
provider status failures.

## Test-account recovery

The authenticated browser smoke account is CI-managed:

- SOCIAL_SMOKE_EMAIL
- SOCIAL_SMOKE_PASSWORD
- optional SOCIAL_SMOKE_ORG_SLUG (defaults to brandprotection)

Rotate the account through the approved tenant-seed/recovery workflow and
update the repository secrets. Do not place the password in a commit, issue,
PR comment, local probe, or this runbook. A missing secret intentionally keeps
the smoke step in an explicit skipped state.

## Rollback

Use the production deployment workflow's server rollback procedure. Verify the
rollback target's .deploy-sha, then repeat /api/v1/ping, login asset smoke, and
(when configured) the authenticated Social Monitoring smoke before closing the
incident. Preserve the failed run ID and collector error details for follow-up;
do not force-push or rewrite the deployment history.

## Current release-gate gaps

Use [SOCIAL_MONITORING_SOAK_LOG.md](./SOCIAL_MONITORING_SOAK_LOG.md) for the time-based evidence record; an empty template is intentionally not a completed soak.


The following still require owner or time-based evidence and are not implied by
this runbook:

- two monitoring subjects and their expected scope;
- CI secret provisioning for the authenticated smoke;
- YouTube comments provider-to-database-to-UI proof;
- reviewed multilingual precision/recall gold set;
- 48-72 hour production soak.
