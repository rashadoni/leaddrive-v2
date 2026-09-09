-- C3: Advertising Studio (Phase 6 Block G second slice).
--
-- Salesforce Marketing Cloud Advertising Studio analogue. Manage
-- FB / Google / LinkedIn ad accounts from CRM, sync segments →
-- external custom audiences, track campaign spend + conversion ROI.
--
-- Slice 1 ships schema + 5 pure helpers (provider config validator,
-- audience-payload builder for FB/Google/LinkedIn hashing rules,
-- pii-hasher with normalization, sync state machine, metrics
-- aggregator). NO actual API calls, NO admin UI, NO cron.
--
-- Unblocks G5 Activation: G4 DataCloudSegment now has a target —
-- slice-2 G5 worker calls C3 helpers to materialise a Segment into
-- AdAudienceSync rows, then slice-2 C3 dispatcher pushes payloads
-- to the external provider.
--
-- Slice 2 wires:
--   • Admin UI for provider connection + audience selection.
--   • Per-provider HTTP clients (src/lib/ads/facebook.ts etc.) with
--     OAuth + retry + DLQ.
--   • Sync cron — pulls audience members from Segment, builds payload
--     via slice-1 helper, dispatches to provider.
--   • Conversion-tracking webhook receivers.
-- Slice 3 wires:
--   • Multi-touch attribution (cross with C9 marketing attribution).
--   • Lookalike audience builder (FB / Google API features).
--   • Datorama-style cross-channel BI rollup.

-- ── AdProvider ─────────────────────────────────────────────────
-- Per-tenant provider config. One row per (tenant, providerType) is
-- typical, but we don't enforce — agencies running multiple FB ad
-- accounts under one tenant slug need flexibility. UNIQUE on
-- (org, providerType, externalAccountId) catches dupes.
CREATE TABLE "ad_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Provider (DB CHECK):
     *   facebook | google | linkedin | tiktok | twitter
     */
    "providerType" TEXT NOT NULL,
    /** Display name — "FB - Main", "Google - EU". */
    "displayName" TEXT NOT NULL,
    /** Provider's account ID (FB ad account id, Google customer id). */
    "externalAccountId" TEXT NOT NULL,
    /**
     * OAuth token / API key — stored ENCRYPTED at slice-2 ingest.
     * Slice-1 schema just declares the column; slice-2 wires
     * pgcrypto / KMS encryption-at-rest. NO PLAINTEXT in slice 1
     * — admin UI does not exist yet, so no risk surface.
     */
    "credentialEncrypted" TEXT,
    /**
     * Connection status (DB CHECK):
     *   draft | connected | disconnected | error | expired
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    "connectedAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    /** Set on transition to error / expired. */
    "errorAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    /** Slice-2 metadata — token expiry, scopes granted, etc. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_providers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ad_providers"
  ADD CONSTRAINT "ad_providers_type_check"
  CHECK ("providerType" IN ('facebook', 'google', 'linkedin', 'tiktok', 'twitter'));

ALTER TABLE "ad_providers"
  ADD CONSTRAINT "ad_providers_status_check"
  CHECK ("status" IN ('draft', 'connected', 'disconnected', 'error', 'expired'));

-- Status-timestamp coherence
ALTER TABLE "ad_providers"
  ADD CONSTRAINT "ad_providers_connected_coherence_check"
  CHECK ("status" <> 'connected' OR "connectedAt" IS NOT NULL);
ALTER TABLE "ad_providers"
  ADD CONSTRAINT "ad_providers_error_coherence_check"
  CHECK ("status" NOT IN ('error', 'expired') OR ("errorAt" IS NOT NULL AND "errorMessage" IS NOT NULL));

CREATE UNIQUE INDEX "ad_providers_org_type_account_uniq"
  ON "ad_providers"("organizationId", "providerType", "externalAccountId");
CREATE INDEX "ad_providers_org_status_idx"
  ON "ad_providers"("organizationId", "status");
CREATE INDEX "ad_providers_org_type_idx"
  ON "ad_providers"("organizationId", "providerType");

ALTER TABLE "ad_providers"
  ADD CONSTRAINT "ad_providers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- connectedAt + errorAt immutable once set (IS DISTINCT FROM — N2 lesson).
CREATE OR REPLACE FUNCTION ad_providers_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."connectedAt" IS NOT NULL AND NEW."connectedAt" IS DISTINCT FROM OLD."connectedAt" THEN
    RAISE EXCEPTION 'ad_providers.connectedAt is immutable once set (provider %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."errorAt" IS NOT NULL AND NEW."errorAt" IS DISTINCT FROM OLD."errorAt" THEN
    RAISE EXCEPTION 'ad_providers.errorAt is immutable once set (provider %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ad_providers_timestamps_immutable_trigger
  BEFORE UPDATE ON "ad_providers"
  FOR EACH ROW
  EXECUTE FUNCTION ad_providers_timestamps_immutable_fn();

-- ── AdAudienceSync ─────────────────────────────────────────────
-- Sync record between a LeadDrive Segment (or G4 DataCloudSegment
-- via soft FK) and a provider's external custom audience. One row
-- per (provider, segmentRef) — re-targeting same segment is an
-- UPSERT, not a new row.
CREATE TABLE "ad_audience_syncs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    /**
     * Source-segment reference (soft FK — slice-2 wires the actual
     * Segment / DataCloudSegment join). Slice-1 accepts either
     * `segment_<id>` or `dataCloudSegment_<id>` opaque strings.
     */
    "segmentRef" TEXT NOT NULL,
    /** Tenant-side display name — copies from source segment. */
    "audienceName" TEXT NOT NULL,
    /** Provider's audience ID after first successful sync. */
    "externalAudienceId" TEXT,
    /**
     * Sync status (DB CHECK):
     *   pending      — created, not yet pushed
     *   syncing      — push in flight
     *   active       — last push succeeded, mirroring current
     *   stale        — source segment changed, needs re-push
     *   error        — last push failed (retry-able)
     *   deleted      — admin removed; preserved for audit
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Snapshot count at last successful sync. */
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    /** Set on transition to active / stale / error. */
    "lastSyncAt" TIMESTAMP(3),
    /** Set on transition to error. */
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    /** Set on transition to deleted. */
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_audience_syncs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_status_check"
  CHECK ("status" IN ('pending', 'syncing', 'active', 'stale', 'error', 'deleted'));

ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_member_count_check"
  CHECK ("memberCount" >= 0);

-- Coherence checks
ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'stale') OR ("externalAudienceId" IS NOT NULL AND "lastSyncAt" IS NOT NULL));
ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_error_coherence_check"
  CHECK ("status" <> 'error' OR ("lastErrorAt" IS NOT NULL AND "lastErrorMessage" IS NOT NULL));
ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_deleted_coherence_check"
  CHECK ("status" <> 'deleted' OR "deletedAt" IS NOT NULL);

CREATE UNIQUE INDEX "ad_audience_syncs_provider_segment_uniq"
  ON "ad_audience_syncs"("providerId", "segmentRef");
CREATE INDEX "ad_audience_syncs_org_status_idx"
  ON "ad_audience_syncs"("organizationId", "status");
CREATE INDEX "ad_audience_syncs_org_last_sync_idx"
  ON "ad_audience_syncs"("organizationId", "lastSyncAt");
CREATE INDEX "ad_audience_syncs_external_idx"
  ON "ad_audience_syncs"("externalAudienceId");

ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_audience_syncs"
  ADD CONSTRAINT "ad_audience_syncs_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ad_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- lastSyncAt + lastErrorAt + deletedAt immutable once set.
CREATE OR REPLACE FUNCTION ad_audience_syncs_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
    RAISE EXCEPTION 'ad_audience_syncs.deletedAt is immutable once set (sync %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- lastSyncAt + lastErrorAt are NOT immutable — they advance on each
  -- sync attempt. Caller is expected to monotonically advance them;
  -- slice-2 dispatcher does so.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ad_audience_syncs_timestamps_immutable_trigger
  BEFORE UPDATE ON "ad_audience_syncs"
  FOR EACH ROW
  EXECUTE FUNCTION ad_audience_syncs_timestamps_immutable_fn();

-- Provider-channel coherence: provider exists → its providerType is
-- pinned. We don't denormalise providerType here since the FK
-- guarantees consistency.

-- ── AdCampaignTracking ─────────────────────────────────────────
-- External campaign tracking. One row per external campaign (FB
-- campaign id, Google campaign id, etc.). Slice-2 webhook receiver
-- inserts; admin dashboard reads.
--
-- Money + count columns are BIGINT (signed 64-bit) — defends against
-- huge ad-tech rollups where impressions can hit 1B+ per campaign
-- and spend can reach billions of minor units across multi-year
-- archived data. Helpers cast BigInt → Number at I/O boundary;
-- realistic per-campaign values stay within Number.MAX_SAFE_INTEGER
-- but the column type defends against future big-tenant edge cases.
CREATE TABLE "ad_campaign_tracking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    /** Provider's campaign ID. */
    "externalCampaignId" TEXT NOT NULL,
    /** Display name — provider's campaign name at sync time. */
    "campaignName" TEXT NOT NULL,
    /** Optional CRM Campaign link — slice-2 wires the typed relation. */
    "crmCampaignId" TEXT,
    /**
     * Status (DB CHECK):
     *   active | paused | completed | archived
     */
    "status" TEXT NOT NULL DEFAULT 'active',
    /** Spend in minor units — slice-2 webhook ingests. */
    "spendMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "conversions" BIGINT NOT NULL DEFAULT 0,
    /** Conversion value in minor units (revenue attributable). */
    "conversionValueMinor" BIGINT NOT NULL DEFAULT 0,
    "campaignStartAt" TIMESTAMP(3),
    "campaignEndAt" TIMESTAMP(3),
    /** Last metric refresh from provider. */
    "lastSyncAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_campaign_tracking_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_status_check"
  CHECK ("status" IN ('active', 'paused', 'completed', 'archived'));

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_spend_check"
  CHECK ("spendMinor" >= 0);

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_impressions_check"
  CHECK ("impressions" >= 0);

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_clicks_check"
  CHECK ("clicks" >= 0 AND "clicks" <= "impressions");

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_conversions_check"
  CHECK ("conversions" >= 0 AND "conversions" <= "clicks");

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_conversion_value_check"
  CHECK ("conversionValueMinor" >= 0);

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_period_check"
  CHECK ("campaignEndAt" IS NULL OR "campaignStartAt" IS NULL OR "campaignEndAt" >= "campaignStartAt");

CREATE UNIQUE INDEX "ad_campaign_tracking_provider_external_uniq"
  ON "ad_campaign_tracking"("providerId", "externalCampaignId");
CREATE INDEX "ad_campaign_tracking_org_status_idx"
  ON "ad_campaign_tracking"("organizationId", "status");
CREATE INDEX "ad_campaign_tracking_org_last_sync_idx"
  ON "ad_campaign_tracking"("organizationId", "lastSyncAt");
CREATE INDEX "ad_campaign_tracking_crm_campaign_idx"
  ON "ad_campaign_tracking"("crmCampaignId");

ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_campaign_tracking"
  ADD CONSTRAINT "ad_campaign_tracking_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ad_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
