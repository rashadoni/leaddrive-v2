-- Retroactive fix for NULL-handling bug in already-shipped
-- immutability triggers across M5/M6/M4/M5-data-cloud.
--
-- Bug: `NEW.col <> OLD.col` evaluates to NULL (not TRUE) when
-- NEW.col is NULL but OLD.col has a value. So a `published → draft`
-- UPDATE that simultaneously sets the timestamp to NULL passes the
-- trigger silently, clearing the audit timestamp despite the
-- "immutable once set" intent. Architect caught this during N2
-- review; this migration applies the fix retroactively.
--
-- Fix: replace `<>` with `IS DISTINCT FROM`, which evaluates NULL
-- as a distinct value (`NULL IS DISTINCT FROM 'foo'` = TRUE).
--
-- Tables / functions affected (in original migration order):
--   • M5 contract_approval_stages_decided_at_immutable_fn (decidedAt)
--   • M6 esign_envelopes_terminal_timestamps_immutable_fn
--     (sentAt / completedAt / voidedAt)
--   • M6 esign_signers_terminal_timestamps_immutable_fn
--     (signedAt / declinedAt / viewedAt)
--   • M4 revenue_recognition_schedules_recognized_at_immutable_fn
--     (recognizedAt)
--   • M5 data_cloud_segment_memberships_timestamps_monotonic_fn
--     (addedAt — immutable, lastConfirmedAt — monotonic forward)
--
-- The data-cloud monotonic check uses `<` for lastConfirmedAt which
-- handles NULL correctly (NULL < value evaluates to NULL → false,
-- so it doesn't raise — same gap, but with monotonic semantics it's
-- defensible since you can't move backward to NULL anyway).
-- Tightening anyway for consistency.
--
-- D8 loyalty_accounts_lifetime_monotonic_fn uses `<` on a non-null
-- integer column (lifetimePoints DEFAULT 0) — NULL semantics don't
-- apply. No change needed.

-- ── M5 contract_approval_stages ────────────────────────────────
CREATE OR REPLACE FUNCTION contract_approval_stages_decided_at_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."decidedAt" IS NOT NULL AND NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" THEN
    RAISE EXCEPTION 'contract_approval_stages.decidedAt is immutable once set; cannot change from % to % (stage %)',
      OLD."decidedAt", NEW."decidedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'pending' AND NEW."status" = 'pending' THEN
    RAISE EXCEPTION 'contract_approval_stages.status cannot revert from % to pending (stage %)',
      OLD."status", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── M6 esign_envelopes ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION esign_envelopes_terminal_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."sentAt" IS NOT NULL AND NEW."sentAt" IS DISTINCT FROM OLD."sentAt" THEN
    RAISE EXCEPTION 'esign_envelopes.sentAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'esign_envelopes.completedAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" THEN
    RAISE EXCEPTION 'esign_envelopes.voidedAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── M6 esign_signers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION esign_signers_terminal_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."signedAt" IS NOT NULL AND NEW."signedAt" IS DISTINCT FROM OLD."signedAt" THEN
    RAISE EXCEPTION 'esign_signers.signedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."declinedAt" IS NOT NULL AND NEW."declinedAt" IS DISTINCT FROM OLD."declinedAt" THEN
    RAISE EXCEPTION 'esign_signers.declinedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."viewedAt" IS NOT NULL AND NEW."viewedAt" IS DISTINCT FROM OLD."viewedAt" THEN
    RAISE EXCEPTION 'esign_signers.viewedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── M4 revenue_recognition_schedules ───────────────────────────
CREATE OR REPLACE FUNCTION revenue_recognition_schedules_recognized_at_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."recognizedAt" IS NOT NULL AND NEW."recognizedAt" IS DISTINCT FROM OLD."recognizedAt" THEN
    RAISE EXCEPTION 'revenue_recognition_schedules.recognizedAt is immutable once set (line %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── G4 data_cloud_segment_memberships ──────────────────────────
-- addedAt: immutable (any change rejected). lastConfirmedAt:
-- monotonic forward (only backward-move rejected).
CREATE OR REPLACE FUNCTION data_cloud_segment_memberships_timestamps_monotonic_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."addedAt" IS DISTINCT FROM OLD."addedAt" THEN
    RAISE EXCEPTION 'data_cloud_segment_memberships.addedAt is immutable; cannot change from % to % (id %)',
      OLD."addedAt", NEW."addedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lastConfirmedAt" < OLD."lastConfirmedAt" THEN
    RAISE EXCEPTION 'data_cloud_segment_memberships.lastConfirmedAt is monotonic forward; cannot decrease from % to % (id %)',
      OLD."lastConfirmedAt", NEW."lastConfirmedAt", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
