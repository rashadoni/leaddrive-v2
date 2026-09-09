-- Extend the already-deployed reversible auto-review ledger with the
-- provider-free SAFE_RESOLVE mode. The source envelopes are intentionally not
-- mutated by this migration.

SELECT set_config('app.rls_bypass', 'on', false);

ALTER TABLE "discovery_auto_review_runs"
  DROP CONSTRAINT "discovery_auto_review_runs_mode_check",
  ADD CONSTRAINT "discovery_auto_review_runs_mode_check"
    CHECK ("mode" IN ('REJECT_ONLY', 'SAFE_RESOLVE'));

ALTER TABLE "discovery_auto_review_decisions"
  DROP CONSTRAINT "discovery_auto_review_decisions_action_check",
  ADD CONSTRAINT "discovery_auto_review_decisions_action_check"
    CHECK ("action" IN ('REJECT', 'RELEASE_TO_NORMAL_PIPELINE'));

-- SAFE_RESOLVE adds only aggregate action counts to the immutable event
-- stream. The same scalar-only and sensitive-key guards remain in force.
ALTER TABLE "discovery_auto_review_events"
  DROP CONSTRAINT "discovery_auto_review_events_payload_check",
  ADD CONSTRAINT "discovery_auto_review_events_payload_check"
    CHECK (
      jsonb_typeof("payload") = 'object'
      AND octet_length("payload"::TEXT) <= 8192
      AND social_discovery_auto_review_json_is_sanitized("payload")
      AND social_discovery_auto_review_json_is_allowed_scalar_object(
        "payload",
        ARRAY[
          'groupCount',
          'rowCount',
          'resolverVersion',
          'mode',
          'skippedGroupCount',
          'skippedRowCount',
          'planFingerprint',
          'rollbackRequestId',
          'finalizedRowCount',
          'supersededRowCount',
          'rejectGroupCount',
          'rejectRowCount',
          'releaseGroupCount',
          'releaseRowCount'
        ]::TEXT[]
      )
    );

SELECT set_config('app.rls_bypass', 'off', false);
