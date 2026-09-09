-- R11: Media Cloud (Phase 7 backlog item — closes Phase 7 active roadmap).
--
-- Salesforce Media Cloud analogue. Subscriber lifecycle, ad sales,
-- content monetization, consumption analytics. Targets publishers
-- (news, streaming, podcast, music), OTT platforms, ad sales teams.
--
-- Reuses existing D4 Subscription schema for billing — this migration
-- adds the editorial / advertising / analytics layer that sits ABOVE
-- subscription billing.
--
-- Slice 1 ships SCHEMA + 5 PURE HELPERS only. Out of scope (slice-2+):
--   • Ad-server (real-time bidding / OpenRTB).
--   • Subscriber portal (preferences, paywall, account mgmt).
--   • Content CMS (editorial workflow, draft → published).
--   • Streaming/playback telemetry ingestion (high-volume; needs
--     dedicated time-series store).
--   • Royalty + revenue-share reporting (music PRO / publisher cuts).
--
-- 5 tables:
--   media_subscribers       — subscriber anchor (distinct from CRM Contact:
--                              subscription-tier, content preferences,
--                              billing-address per-region for tax)
--   media_content_inventory — catalog of media items (article / video /
--                              podcast / song / show); CMS metadata +
--                              monetization flags
--   media_ad_campaigns      — advertiser-owned campaign (budget, flight,
--                              creative refs, targeting JSON)
--   media_ad_placements     — individual ad placement = campaign × content
--                              slot; impressions + clicks counters
--   media_consumption_events — per-subscriber engagement log (view / read
--                              / listen / complete events; append-only)

-- ── MediaSubscriber ────────────────────────────────────────────
CREATE TABLE "media_subscribers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to CRM Contact (subscriber may also be a sales lead). */
    "contactId" TEXT,
    /** Optional User link for subscribers with portal login. */
    "userId" TEXT,
    /** Optional Subscription link (D4 billing) — NULL for free-tier subs. */
    "subscriptionId" TEXT,
    /** Subscriber number — UNIQUE per tenant. */
    "subscriberNumber" TEXT NOT NULL,
    /** Display name (PII — slice-2 pgcrypto wrap). */
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    /** Subscription tier slug (e.g. "free", "premium", "premium-plus",
     *  "family"). Slice-1 free-form per tenant; slice-2 may add a
     *  SubscriptionTier table. */
    "tierSlug" TEXT NOT NULL DEFAULT 'free',
    /** Billing region — ISO 3166-1 alpha-2 country code; used for tax
     *  + content licensing geo-restrictions. */
    "billingRegion" TEXT,
    /** Lifecycle (DB CHECK):
     *  trial | active | paused | churned | banned
     */
    "status" TEXT NOT NULL DEFAULT 'trial',
    "trialStartedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "churnedAt" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "banReason" TEXT,
    /** Content preferences JSONB — caller-defined shape, e.g.
     *  {"genres": ["news", "sports"], "languages": ["en", "fr"]} */
    "preferences" JSONB NOT NULL DEFAULT '{}',
    /** Lifetime value tracking — running tally; slice-2 cron updates. */
    "lifetimeRevenueCents" BIGINT NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_subscribers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_status_check"
  CHECK ("status" IN ('trial', 'active', 'paused', 'churned', 'banned'));

ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_region_check"
  CHECK ("billingRegion" IS NULL OR length("billingRegion") = 2);

ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_revenue_check"
  CHECK ("lifetimeRevenueCents" >= 0);

-- Status-timestamp coherence.
ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_trial_coherence_check"
  CHECK ("status" <> 'trial' OR "trialStartedAt" IS NOT NULL);
ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_active_coherence_check"
  CHECK ("status" NOT IN ('active', 'paused', 'churned') OR "activatedAt" IS NOT NULL);
ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_paused_coherence_check"
  CHECK ("status" <> 'paused' OR "pausedAt" IS NOT NULL);
ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_churned_coherence_check"
  CHECK ("status" <> 'churned' OR "churnedAt" IS NOT NULL);
ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_banned_coherence_check"
  CHECK ("status" <> 'banned'
         OR ("bannedAt" IS NOT NULL AND "banReason" IS NOT NULL));

CREATE UNIQUE INDEX "media_subscribers_org_number_uniq"
  ON "media_subscribers"("organizationId", "subscriberNumber");
CREATE INDEX "media_subscribers_org_status_idx"
  ON "media_subscribers"("organizationId", "status");
CREATE INDEX "media_subscribers_org_tier_idx"
  ON "media_subscribers"("organizationId", "tierSlug");
CREATE INDEX "media_subscribers_org_region_idx"
  ON "media_subscribers"("organizationId", "billingRegion");
CREATE INDEX "media_subscribers_subscription_idx"
  ON "media_subscribers"("subscriptionId");
CREATE INDEX "media_subscribers_contact_idx"
  ON "media_subscribers"("contactId");

ALTER TABLE "media_subscribers"
  ADD CONSTRAINT "media_subscribers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION media_subscribers_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."trialStartedAt" IS NOT NULL AND NEW."trialStartedAt" IS DISTINCT FROM OLD."trialStartedAt" THEN
    RAISE EXCEPTION 'media_subscribers.trialStartedAt is immutable once set (subscriber %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'media_subscribers.activatedAt is immutable once set (subscriber %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."churnedAt" IS NOT NULL AND NEW."churnedAt" IS DISTINCT FROM OLD."churnedAt" THEN
    RAISE EXCEPTION 'media_subscribers.churnedAt is immutable once set (subscriber %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."bannedAt" IS NOT NULL AND NEW."bannedAt" IS DISTINCT FROM OLD."bannedAt" THEN
    RAISE EXCEPTION 'media_subscribers.bannedAt is immutable once set (subscriber %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- pausedAt intentionally NOT immutable — paused/resume can re-pause
  -- (e.g. seasonal subscriber pausing again).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_subscribers_timestamps_immutable_trigger
  BEFORE UPDATE ON "media_subscribers"
  FOR EACH ROW
  EXECUTE FUNCTION media_subscribers_timestamps_immutable_fn();

-- ── MediaContentInventory ──────────────────────────────────────
CREATE TABLE "media_content_inventory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** External content ID from CMS — UNIQUE per tenant. */
    "contentSlug" TEXT NOT NULL,
    /** Content kind (DB CHECK):
     *  article | video | audio | podcast | live_stream | series_episode
     */
    "contentKind" TEXT NOT NULL,
    /** Display title. */
    "title" TEXT NOT NULL,
    /** Author / artist / publisher name. */
    "byline" TEXT,
    /** Lifecycle (DB CHECK):
     *  draft | scheduled | published | unpublished | archived
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Monetization tier (DB CHECK):
     *  free | metered | paywalled | ad_supported | premium_only
     */
    "monetization" TEXT NOT NULL DEFAULT 'free',
    /** Duration in seconds (video / audio); NULL for articles. */
    "durationSeconds" INTEGER,
    /** Word count (articles); NULL for video/audio. */
    "wordCount" INTEGER,
    /** Genre / vertical slug (e.g. "news", "sports", "fiction"). */
    "genreSlug" TEXT,
    /** Language ISO 639-1 code (e.g. "en", "fr", "ru"). */
    "languageCode" TEXT,
    /** Regions where content is licensed (ISO country codes; empty = global). */
    "licensedRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    /** Scheduled publish date. */
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_content_inventory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_kind_check"
  CHECK ("contentKind" IN (
    'article', 'video', 'audio', 'podcast', 'live_stream', 'series_episode'
  ));

ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_status_check"
  CHECK ("status" IN (
    'draft', 'scheduled', 'published', 'unpublished', 'archived'
  ));

ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_monetization_check"
  CHECK ("monetization" IN (
    'free', 'metered', 'paywalled', 'ad_supported', 'premium_only'
  ));

ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_duration_check"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_words_check"
  CHECK ("wordCount" IS NULL OR "wordCount" >= 0);
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_lang_check"
  CHECK ("languageCode" IS NULL OR length("languageCode") = 2);

-- Status-timestamp coherence.
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_scheduled_coherence_check"
  CHECK ("status" <> 'scheduled' OR "scheduledAt" IS NOT NULL);
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_published_coherence_check"
  CHECK ("status" NOT IN ('published', 'unpublished', 'archived')
         OR "publishedAt" IS NOT NULL);
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_unpublished_coherence_check"
  CHECK ("status" <> 'unpublished' OR "unpublishedAt" IS NOT NULL);
ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

CREATE UNIQUE INDEX "media_content_inventory_org_slug_uniq"
  ON "media_content_inventory"("organizationId", "contentSlug");
CREATE INDEX "media_content_inventory_org_status_idx"
  ON "media_content_inventory"("organizationId", "status");
CREATE INDEX "media_content_inventory_org_kind_idx"
  ON "media_content_inventory"("organizationId", "contentKind");
CREATE INDEX "media_content_inventory_org_monetization_idx"
  ON "media_content_inventory"("organizationId", "monetization");
CREATE INDEX "media_content_inventory_published_idx"
  ON "media_content_inventory"("organizationId", "publishedAt")
  WHERE "status" = 'published';

ALTER TABLE "media_content_inventory"
  ADD CONSTRAINT "media_content_inventory_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION media_content_inventory_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'media_content_inventory.publishedAt is immutable once set (content %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'media_content_inventory.archivedAt is immutable once set (content %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_content_inventory_timestamps_immutable_trigger
  BEFORE UPDATE ON "media_content_inventory"
  FOR EACH ROW
  EXECUTE FUNCTION media_content_inventory_timestamps_immutable_fn();

-- ── MediaAdCampaign ────────────────────────────────────────────
CREATE TABLE "media_ad_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Soft FK to advertiser (CRM Company). */
    "advertiserCompanyId" TEXT,
    /** Campaign number — UNIQUE per tenant. */
    "campaignNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  draft | scheduled | running | paused | completed | cancelled
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Goal (DB CHECK):
     *  brand_awareness | reach | conversions | retargeting | direct_response
     */
    "campaignGoal" TEXT NOT NULL DEFAULT 'reach',
    /** Total budget (DECIMAL for accounting precision). */
    "totalBudget" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Daily budget cap — NULL = no daily cap. */
    "dailyBudgetCap" DECIMAL(18, 2),
    /**
     * Spent-to-date — running total.
     *
     * SLICE-2 LEDGER INVARIANT: campaign.spentAmount must equal
     * SUM(placement.placementSpentAmount) for placements of this
     * campaign. Slice-1 doesn't enforce (no double-entry ledger yet);
     * slice-2 ingester wires either a per-campaign trigger that
     * re-sums on placement update OR an explicit reconciliation cron.
     * Until then, callers must keep both in lockstep via the same
     * transaction.
     */
    "spentAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    /** Currency. */
    "currency" TEXT NOT NULL DEFAULT 'USD',
    /** Flight: start/end of campaign run. */
    "flightStartAt" TIMESTAMP(3),
    "flightEndAt" TIMESTAMP(3),
    /** Targeting criteria JSONB — e.g.
     *  {"genres": ["sports"], "regions": ["US", "CA"], "tiers": ["premium"]} */
    "targetingCriteria" JSONB NOT NULL DEFAULT '{}',
    /** Creative refs — e.g. ["asset-12", "asset-34"]. */
    "creativeAssetRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_ad_campaigns_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_status_check"
  CHECK ("status" IN (
    'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'
  ));

ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_goal_check"
  CHECK ("campaignGoal" IN (
    'brand_awareness', 'reach', 'conversions', 'retargeting', 'direct_response'
  ));

ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_budget_check"
  CHECK ("totalBudget" >= 0);
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_daily_cap_check"
  CHECK ("dailyBudgetCap" IS NULL OR "dailyBudgetCap" >= 0);
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_spent_check"
  CHECK ("spentAmount" >= 0);
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_spent_bound_check"
  CHECK ("spentAmount" <= "totalBudget");
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_currency_check"
  CHECK (length("currency") = 3);

-- Flight window CHECK.
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_flight_check"
  CHECK ("flightEndAt" IS NULL OR "flightStartAt" IS NULL
         OR "flightEndAt" > "flightStartAt");

-- Status-timestamp coherence.
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_running_coherence_check"
  CHECK ("status" NOT IN ('running', 'paused', 'completed')
         OR "startedAt" IS NOT NULL);
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_completed_coherence_check"
  CHECK ("status" <> 'completed' OR "completedAt" IS NOT NULL);
ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled'
         OR ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL));

CREATE UNIQUE INDEX "media_ad_campaigns_org_number_uniq"
  ON "media_ad_campaigns"("organizationId", "campaignNumber");
CREATE INDEX "media_ad_campaigns_org_status_idx"
  ON "media_ad_campaigns"("organizationId", "status");
CREATE INDEX "media_ad_campaigns_advertiser_idx"
  ON "media_ad_campaigns"("advertiserCompanyId");
CREATE INDEX "media_ad_campaigns_flight_idx"
  ON "media_ad_campaigns"("organizationId", "flightStartAt", "flightEndAt");

ALTER TABLE "media_ad_campaigns"
  ADD CONSTRAINT "media_ad_campaigns_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION media_ad_campaigns_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'media_ad_campaigns.startedAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'media_ad_campaigns.completedAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'media_ad_campaigns.cancelledAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  -- pausedAt intentionally NOT immutable (re-pause allowed).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_ad_campaigns_timestamps_immutable_trigger
  BEFORE UPDATE ON "media_ad_campaigns"
  FOR EACH ROW
  EXECUTE FUNCTION media_ad_campaigns_timestamps_immutable_fn();

-- ── MediaAdPlacement ───────────────────────────────────────────
CREATE TABLE "media_ad_placements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    /** Content slot — content this ad attaches to. NULL = run-of-site
     *  placement (any content matching targeting). */
    "contentId" TEXT,
    /** Slot kind (DB CHECK):
     *  pre_roll | mid_roll | post_roll | banner | sidebar | native_inline
     *  | sponsored_content
     */
    "slotKind" TEXT NOT NULL,
    /** Lifecycle (DB CHECK):
     *  pending | live | paused | completed | cancelled
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Pricing model (DB CHECK):
     *  cpm — cost per 1000 impressions
     *  cpc — cost per click
     *  cpa — cost per action / conversion
     *  flat — fixed-fee placement (regardless of metric)
     */
    "pricingModel" TEXT NOT NULL DEFAULT 'cpm',
    /** Bid amount per unit (in placement currency, slice-1 same as campaign). */
    "bidAmount" DECIMAL(18, 4) NOT NULL DEFAULT 0,
    /** Counters — slice-2 ingestion increments. */
    "impressionCount" BIGINT NOT NULL DEFAULT 0,
    "clickCount" BIGINT NOT NULL DEFAULT 0,
    "conversionCount" BIGINT NOT NULL DEFAULT 0,
    /** Spent on this placement (running). */
    "placementSpentAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_ad_placements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_slot_check"
  CHECK ("slotKind" IN (
    'pre_roll', 'mid_roll', 'post_roll', 'banner', 'sidebar',
    'native_inline', 'sponsored_content'
  ));

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_status_check"
  CHECK ("status" IN ('pending', 'live', 'paused', 'completed', 'cancelled'));

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_pricing_check"
  CHECK ("pricingModel" IN ('cpm', 'cpc', 'cpa', 'flat'));

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_bid_check"
  CHECK ("bidAmount" >= 0);
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_counts_check"
  CHECK ("impressionCount" >= 0 AND "clickCount" >= 0 AND "conversionCount" >= 0);
-- IMPORTANT — Slice-2 telemetry ingester contract:
-- The two bound CHECKs below enforce funnel invariants per-row. They
-- are static immediate CHECKs, NOT deferrable. The slice-2 ingester
-- MUST write in order: impressions first, then clicks, then
-- conversions (a single transaction with descending-dependency
-- ordering). Out-of-order batch writes (e.g. processing a conversion
-- event before its parent click row was bumped) will fail the CHECK.
-- If slice-2 needs eventual-consistency batch ingestion, change these
-- to DEFERRABLE INITIALLY DEFERRED in a follow-up migration.
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_clicks_bound_check"
  CHECK ("clickCount" <= "impressionCount");
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_conversions_bound_check"
  CHECK ("conversionCount" <= "clickCount");
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_spent_check"
  CHECK ("placementSpentAmount" >= 0);

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_live_coherence_check"
  CHECK ("status" NOT IN ('live', 'paused', 'completed') OR "startedAt" IS NOT NULL);
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_completed_coherence_check"
  CHECK ("status" <> 'completed' OR "completedAt" IS NOT NULL);
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR "cancelledAt" IS NOT NULL);

CREATE INDEX "media_ad_placements_campaign_idx"
  ON "media_ad_placements"("campaignId");
CREATE INDEX "media_ad_placements_content_idx"
  ON "media_ad_placements"("contentId");
CREATE INDEX "media_ad_placements_org_status_idx"
  ON "media_ad_placements"("organizationId", "status");
CREATE INDEX "media_ad_placements_slot_idx"
  ON "media_ad_placements"("organizationId", "slotKind");

ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "media_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_ad_placements"
  ADD CONSTRAINT "media_ad_placements_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "media_content_inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION media_ad_placements_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'media_ad_placements.startedAt is immutable once set (placement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'media_ad_placements.completedAt is immutable once set (placement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'media_ad_placements.cancelledAt is immutable once set (placement %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_ad_placements_timestamps_immutable_trigger
  BEFORE UPDATE ON "media_ad_placements"
  FOR EACH ROW
  EXECUTE FUNCTION media_ad_placements_timestamps_immutable_fn();

-- ── MediaConsumptionEvent ──────────────────────────────────────
-- High-volume engagement log: view / read / listen / complete events.
-- APPEND-ONLY by trigger; raw events kept for ~90 days slice-2 then
-- aggregated to a daily-rollup table (slice-2 cron).
CREATE TABLE "media_consumption_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriberId" TEXT,
    "contentId" TEXT NOT NULL,
    /** Optional placement linkage (ad served during this content view). */
    "placementId" TEXT,
    /** Event kind (DB CHECK):
     *  view_start | view_progress | view_complete | view_abandon
     *  | click | conversion | share | bookmark
     */
    "eventKind" TEXT NOT NULL,
    /** Wall-clock when event happened. */
    "occurredAt" TIMESTAMP(3) NOT NULL,
    /** Progress percentage 0..100 — for view_progress + view_complete. */
    "progressPct" DECIMAL(5, 2),
    /** Watch / read / listen duration in seconds — for view_complete. */
    "engagedSeconds" INTEGER,
    /** Device kind (DB CHECK):
     *  web | mobile_web | ios_app | android_app | smart_tv | other
     */
    "deviceKind" TEXT NOT NULL DEFAULT 'web',
    /** Geo-region ISO country code (for licensing-tier reporting). */
    "regionCode" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_consumption_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_kind_check"
  CHECK ("eventKind" IN (
    'view_start', 'view_progress', 'view_complete', 'view_abandon',
    'click', 'conversion', 'share', 'bookmark'
  ));

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_device_check"
  CHECK ("deviceKind" IN (
    'web', 'mobile_web', 'ios_app', 'android_app', 'smart_tv', 'other'
  ));

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_progress_check"
  CHECK ("progressPct" IS NULL OR ("progressPct" >= 0 AND "progressPct" <= 100));

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_engaged_check"
  CHECK ("engagedSeconds" IS NULL OR "engagedSeconds" >= 0);

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_region_check"
  CHECK ("regionCode" IS NULL OR length("regionCode") = 2);

CREATE INDEX "media_consumption_events_org_time_idx"
  ON "media_consumption_events"("organizationId", "occurredAt");
CREATE INDEX "media_consumption_events_content_time_idx"
  ON "media_consumption_events"("contentId", "occurredAt");
CREATE INDEX "media_consumption_events_subscriber_time_idx"
  ON "media_consumption_events"("subscriberId", "occurredAt");
CREATE INDEX "media_consumption_events_kind_idx"
  ON "media_consumption_events"("organizationId", "eventKind");
CREATE INDEX "media_consumption_events_placement_idx"
  ON "media_consumption_events"("placementId");

ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_subscriberId_fkey"
  FOREIGN KEY ("subscriberId") REFERENCES "media_subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_contentId_fkey"
  FOREIGN KEY ("contentId") REFERENCES "media_content_inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_consumption_events"
  ADD CONSTRAINT "media_consumption_events_placementId_fkey"
  FOREIGN KEY ("placementId") REFERENCES "media_ad_placements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: NO UPDATE allowed (high-volume telemetry; corrections
-- via new event with eventKind='conversion' for retraction-like semantics).
CREATE OR REPLACE FUNCTION media_consumption_events_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'media_consumption_events is append-only; UPDATE not allowed (event %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_consumption_events_no_update_trigger
  BEFORE UPDATE ON "media_consumption_events"
  FOR EACH ROW
  EXECUTE FUNCTION media_consumption_events_no_update_fn();

-- ── Cross-table coherence (C2/C4/G5/R2/R6/R7/R8 pattern) ───────
-- 7 coherence checks (all BEFORE INSERT, NULL-tolerant for optional FKs):
--   media_ad_placements.campaignId     → campaign.org match (required)
--   media_ad_placements.contentId      → content.org match (optional)
--   media_consumption_events.subscriberId → subscriber.org match (optional)
--   media_consumption_events.contentId    → content.org match (required)
--   media_consumption_events.placementId  → placement.org match (optional)

CREATE OR REPLACE FUNCTION media_ad_placements_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  campaign_org_id TEXT;
  content_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO campaign_org_id
    FROM "media_ad_campaigns" WHERE "id" = NEW."campaignId";
  IF campaign_org_id IS NULL THEN
    RAISE EXCEPTION 'media_ad_placements.campaignId "%" does not resolve',
      NEW."campaignId" USING ERRCODE = 'check_violation';
  END IF;
  IF campaign_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'media_ad_placements: campaign "%" belongs to org "%" but placement references org "%"',
      NEW."campaignId", campaign_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."contentId" IS NOT NULL THEN
    SELECT "organizationId" INTO content_org_id
      FROM "media_content_inventory" WHERE "id" = NEW."contentId";
    IF content_org_id IS NULL THEN
      RAISE EXCEPTION 'media_ad_placements.contentId "%" does not resolve',
        NEW."contentId" USING ERRCODE = 'check_violation';
    END IF;
    IF content_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'media_ad_placements: content "%" belongs to org "%" but placement references org "%"',
        NEW."contentId", content_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_ad_placements_coherence_trigger
  BEFORE INSERT ON "media_ad_placements"
  FOR EACH ROW
  EXECUTE FUNCTION media_ad_placements_coherence_fn();

CREATE OR REPLACE FUNCTION media_consumption_events_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  subscriber_org_id TEXT;
  content_org_id TEXT;
  placement_org_id TEXT;
BEGIN
  IF NEW."subscriberId" IS NOT NULL THEN
    SELECT "organizationId" INTO subscriber_org_id
      FROM "media_subscribers" WHERE "id" = NEW."subscriberId";
    IF subscriber_org_id IS NULL THEN
      RAISE EXCEPTION 'media_consumption_events.subscriberId "%" does not resolve',
        NEW."subscriberId" USING ERRCODE = 'check_violation';
    END IF;
    IF subscriber_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'media_consumption_events: subscriber "%" belongs to org "%" but event references org "%"',
        NEW."subscriberId", subscriber_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT "organizationId" INTO content_org_id
    FROM "media_content_inventory" WHERE "id" = NEW."contentId";
  IF content_org_id IS NULL THEN
    RAISE EXCEPTION 'media_consumption_events.contentId "%" does not resolve',
      NEW."contentId" USING ERRCODE = 'check_violation';
  END IF;
  IF content_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'media_consumption_events: content "%" belongs to org "%" but event references org "%"',
      NEW."contentId", content_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."placementId" IS NOT NULL THEN
    SELECT "organizationId" INTO placement_org_id
      FROM "media_ad_placements" WHERE "id" = NEW."placementId";
    IF placement_org_id IS NULL THEN
      RAISE EXCEPTION 'media_consumption_events.placementId "%" does not resolve',
        NEW."placementId" USING ERRCODE = 'check_violation';
    END IF;
    IF placement_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'media_consumption_events: placement "%" belongs to org "%" but event references org "%"',
        NEW."placementId", placement_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_consumption_events_coherence_trigger
  BEFORE INSERT ON "media_consumption_events"
  FOR EACH ROW
  EXECUTE FUNCTION media_consumption_events_coherence_fn();
