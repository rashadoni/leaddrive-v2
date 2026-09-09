-- C2: Mobile Studio (Phase 6 Block G first slice).
--
-- Salesforce Marketing Cloud Mobile Studio analogue. Push / in-app /
-- SMS campaigns + reusable message templates. Builds on existing
-- LeadDrive infrastructure:
--   • PushSubscription (Web Push) — slice-2 dispatch hooks into it.
--   • src/lib/sms.ts + ChannelConfig(sms) — slice-2 SMS dispatch.
--   • ContactEvent — slice-2 in-app trigger taps this stream.
--   • Campaign / Segment — slice-2 may bridge audience filters.
--
-- Slice 1 ships schema + 5 pure helpers (state-machine + audience-
-- filter-validator + content-validator + delivery-scheduler +
-- types). No dispatcher, no admin UI, no cron.
--
-- Slice 2 wires:
--   • Admin UI for campaign authoring + scheduling.
--   • Channel-specific dispatchers (push-campaign.ts / sms-campaign.ts
--     / in-app-message.ts) — actual delivery + retry + DLQ.
--   • Cron-driven fire-on-schedule + audience materialization.
-- Slice 3 wires:
--   • A/B variant testing (reuse existing CampaignVariant pattern).
--   • Personalization tokens ({{contact.firstName}} interpolation).
--   • Cross-channel orchestration (try push → fallback SMS → email).

-- ── MobileMessageTemplate ──────────────────────────────────────
-- Reusable per-channel templates. Same template can be referenced
-- by multiple campaigns. Slice-1 stores templates as plain content
-- + JSONB variable spec; slice-2 admin UI surfaces a preview.
CREATE TABLE "mobile_message_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug, UNIQUE per (tenant, channel). */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Channel (DB CHECK):
     *   push | in_app | sms
     */
    "channel" TEXT NOT NULL,
    /** Push/in_app title — null for SMS (body-only). */
    "title" TEXT,
    /**
     * Body content. Per-channel limits enforced by content-validator
     * helper at INSERT/UPDATE:
     *   push   ≤ 240 chars total (title + body, after iOS/Android caps)
     *   sms    ≤ 1600 chars total (multi-part SMS up to ~10 segments)
     *   in_app ≤ 5000 chars (HTML sanitised by slice-2 render layer)
     */
    "body" TEXT NOT NULL,
    /**
     * Variable spec JSONB array — `[{ name, type, required, default? }]`.
     * Matches M5 template-variable shape. Slice-2 substituter interpolates
     * `{{varName}}` placeholders in title + body.
     */
    "variables" JSONB NOT NULL DEFAULT '[]',
    /** Optional deep-link URL — slice-2 push payload includes. */
    "deepLinkUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobile_message_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mobile_message_templates"
  ADD CONSTRAINT "mobile_message_templates_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "mobile_message_templates"
  ADD CONSTRAINT "mobile_message_templates_channel_check"
  CHECK ("channel" IN ('push', 'in_app', 'sms'));

-- SMS templates can't have a title; push + in_app must have one.
ALTER TABLE "mobile_message_templates"
  ADD CONSTRAINT "mobile_message_templates_title_coherence_check"
  CHECK (
    ("channel" = 'sms' AND "title" IS NULL)
    OR ("channel" <> 'sms' AND "title" IS NOT NULL)
  );

CREATE UNIQUE INDEX "mobile_message_templates_org_channel_slug_uniq"
  ON "mobile_message_templates"("organizationId", "channel", "slug");
CREATE INDEX "mobile_message_templates_org_active_idx"
  ON "mobile_message_templates"("organizationId", "isActive");

ALTER TABLE "mobile_message_templates"
  ADD CONSTRAINT "mobile_message_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── MobileCampaign ─────────────────────────────────────────────
-- A campaign blasts a template (or inline content) to an audience
-- via one channel. Audience is JSONB — a slice-1 predicate filter
-- (e.g. `{ contactTags: ['vip'], anyChannelOptIn: 'push' }`).
-- Slice-2 audience materializer compiles it to a Contact set.
CREATE TABLE "mobile_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** URL-safe slug, UNIQUE per tenant. */
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    /**
     * Channel (DB CHECK) — same set as templates.
     */
    "channel" TEXT NOT NULL,
    /** Optional template reference — null = inline content. */
    "templateId" TEXT,
    /** Inline title (when not using template). NULL for SMS. */
    "title" TEXT,
    /** Inline body (when not using template). */
    "body" TEXT,
    /** Optional deep-link override. */
    "deepLinkUrl" TEXT,
    /**
     * JSONB audience filter — validated by audience-filter-validator
     * helper at INSERT/UPDATE. Slice-1 shape:
     *   {
     *     contactTags?: string[],
     *     segmentSlugs?: string[],
     *     channelOptIn?: 'push' | 'in_app' | 'sms',
     *     excludeContactIds?: string[]
     *   }
     */
    "audienceFilter" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK):
     *   draft     — being authored
     *   scheduled — admin clicked send; cron will fire at scheduledAt
     *   in_flight — dispatcher is processing deliveries
     *   completed — all deliveries terminal (sent/failed/bounced)
     *   cancelled — admin aborted (before in_flight)
     *   failed    — dispatcher hit a hard error
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Set on transition to scheduled — null for "send immediately" path. */
    "scheduledAt" TIMESTAMP(3),
    /** Set on transition to in_flight. */
    "startedAt" TIMESTAMP(3),
    /** Set on transition to completed. */
    "completedAt" TIMESTAMP(3),
    /** Set on transition to cancelled. */
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    /**
     * Per-channel delivery-window config — JSONB. Slice-1 shape:
     *   { quietHoursStart?: number, quietHoursEnd?: number, // 0..23
     *     timezone?: string }                              // IANA
     * delivery-scheduler helper consults at fire time.
     */
    "deliveryWindow" JSONB NOT NULL DEFAULT '{}',
    /** Snapshot count from audience materialization. */
    "audienceSize" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobile_campaigns_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_channel_check"
  CHECK ("channel" IN ('push', 'in_app', 'sms'));

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_status_check"
  CHECK ("status" IN ('draft', 'scheduled', 'in_flight', 'completed', 'cancelled', 'failed'));

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_audience_size_check"
  CHECK ("audienceSize" >= 0);

-- Content coherence: must have a template OR inline body (one or the
-- other but slice-1 allows both — template overrides at substitution
-- time). Title-channel coherence — same rule as templates.
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_content_coherence_check"
  CHECK ("templateId" IS NOT NULL OR "body" IS NOT NULL);

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_title_coherence_check"
  CHECK (
    "channel" = 'sms'
    OR "templateId" IS NOT NULL     -- template carries the title
    OR "title" IS NOT NULL          -- inline non-SMS requires title
  );

-- Status-timestamp coherence
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_scheduled_coherence_check"
  CHECK ("status" NOT IN ('scheduled', 'in_flight', 'completed') OR "scheduledAt" IS NOT NULL);
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_started_coherence_check"
  CHECK ("status" NOT IN ('in_flight', 'completed') OR "startedAt" IS NOT NULL);
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_completed_coherence_check"
  CHECK ("status" <> 'completed' OR "completedAt" IS NOT NULL);
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_cancelled_coherence_check"
  CHECK ("status" <> 'cancelled' OR ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL));

CREATE UNIQUE INDEX "mobile_campaigns_org_slug_uniq"
  ON "mobile_campaigns"("organizationId", "slug");
CREATE INDEX "mobile_campaigns_org_status_idx"
  ON "mobile_campaigns"("organizationId", "status");
CREATE INDEX "mobile_campaigns_org_scheduled_idx"
  ON "mobile_campaigns"("organizationId", "scheduledAt");
CREATE INDEX "mobile_campaigns_template_idx"
  ON "mobile_campaigns"("templateId");

ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_campaigns"
  ADD CONSTRAINT "mobile_campaigns_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "mobile_message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- All lifecycle timestamps immutable once set (IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION mobile_campaigns_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."scheduledAt" IS NOT NULL AND NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt" THEN
    RAISE EXCEPTION 'mobile_campaigns.scheduledAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'mobile_campaigns.startedAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'mobile_campaigns.completedAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'mobile_campaigns.cancelledAt is immutable once set (campaign %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_campaigns_timestamps_immutable_trigger
  BEFORE UPDATE ON "mobile_campaigns"
  FOR EACH ROW
  EXECUTE FUNCTION mobile_campaigns_timestamps_immutable_fn();

-- Template-channel coherence: a campaign that references a template
-- MUST share the same channel. Without this, a push-campaign could
-- point at an SMS-channel template and the slice-2 dispatcher would
-- crash mid-flight. Architect-pass-1 close-out.
CREATE OR REPLACE FUNCTION mobile_campaigns_template_channel_match_fn()
RETURNS TRIGGER AS $$
DECLARE
  template_channel TEXT;
BEGIN
  IF NEW."templateId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "channel" INTO template_channel
    FROM "mobile_message_templates"
    WHERE "id" = NEW."templateId";
  IF template_channel IS NULL THEN
    -- FK SET NULL was applied (template deleted) — let it through.
    RETURN NEW;
  END IF;
  IF template_channel <> NEW."channel" THEN
    RAISE EXCEPTION 'mobile_campaigns.channel "%" does not match template.channel "%" (campaign %, template %)',
      NEW."channel", template_channel, NEW."id", NEW."templateId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_campaigns_template_channel_match_trigger
  BEFORE INSERT OR UPDATE ON "mobile_campaigns"
  FOR EACH ROW
  EXECUTE FUNCTION mobile_campaigns_template_channel_match_fn();

-- ── MobileCampaignDelivery ─────────────────────────────────────
-- Per-recipient delivery audit. One row per (campaign, contact).
-- Status tracks the lifecycle from queued to terminal. Bounce /
-- failure events feed slice-2 retry logic + analytics.
--
-- Append-only on terminal-timestamp columns (sentAt, deliveredAt,
-- failedAt) — once set, immutable. The status field itself is
-- mutable but transitions enforced by helper.
CREATE TABLE "mobile_campaign_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    /** Soft FK to Contact — slice-2 promotes. */
    "contactId" TEXT NOT NULL,
    /**
     * Delivery target snapshot at queue time — captures the address
     * even if contact later opts out / changes channels.
     */
    "targetAddress" TEXT NOT NULL,
    /**
     * Lifecycle (DB CHECK):
     *   pending    — queued, awaiting dispatcher
     *   sent       — dispatcher invoked channel API
     *   delivered  — channel API confirmed reach (push: device received,
     *                sms: carrier delivery receipt)
     *   failed     — non-retryable error (invalid address, blocked)
     *   bounced    — soft bounce / retry-able
     *   suppressed — pre-flight skip (opt-out / quiet hours)
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Channel-specific message id (Twilio sid, FCM message-id). */
    "providerMessageId" TEXT,
    /** Set on transition to sent. */
    "sentAt" TIMESTAMP(3),
    /** Set on transition to delivered. */
    "deliveredAt" TIMESTAMP(3),
    /** Set on transition to failed / bounced. */
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    /** Retry attempts so far. Slice-2 dispatcher increments. */
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobile_campaign_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_status_check"
  CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'suppressed'));

ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_attempts_check"
  CHECK ("attemptCount" >= 0 AND "attemptCount" <= 10);

-- Status-timestamp coherence
ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_sent_coherence_check"
  CHECK ("status" NOT IN ('sent', 'delivered') OR "sentAt" IS NOT NULL);
ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_delivered_coherence_check"
  CHECK ("status" <> 'delivered' OR "deliveredAt" IS NOT NULL);
ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_failed_coherence_check"
  CHECK (
    "status" NOT IN ('failed', 'bounced')
    OR ("failedAt" IS NOT NULL AND "failureReason" IS NOT NULL)
  );

-- One delivery per (campaign, contact) — re-targeting requires a new
-- campaign (or slice-2 may add retryEpoch column for re-dispatch).
CREATE UNIQUE INDEX "mobile_campaign_deliveries_campaign_contact_uniq"
  ON "mobile_campaign_deliveries"("campaignId", "contactId");
CREATE INDEX "mobile_campaign_deliveries_org_status_idx"
  ON "mobile_campaign_deliveries"("organizationId", "status");
CREATE INDEX "mobile_campaign_deliveries_campaign_idx"
  ON "mobile_campaign_deliveries"("campaignId");
CREATE INDEX "mobile_campaign_deliveries_contact_idx"
  ON "mobile_campaign_deliveries"("contactId");
CREATE INDEX "mobile_campaign_deliveries_provider_msg_idx"
  ON "mobile_campaign_deliveries"("providerMessageId");

ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_campaign_deliveries"
  ADD CONSTRAINT "mobile_campaign_deliveries_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "mobile_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sentAt / deliveredAt / failedAt immutable once set.
CREATE OR REPLACE FUNCTION mobile_campaign_deliveries_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."sentAt" IS NOT NULL AND NEW."sentAt" IS DISTINCT FROM OLD."sentAt" THEN
    RAISE EXCEPTION 'mobile_campaign_deliveries.sentAt is immutable once set (delivery %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."deliveredAt" IS NOT NULL AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
    RAISE EXCEPTION 'mobile_campaign_deliveries.deliveredAt is immutable once set (delivery %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."failedAt" IS NOT NULL AND NEW."failedAt" IS DISTINCT FROM OLD."failedAt" THEN
    RAISE EXCEPTION 'mobile_campaign_deliveries.failedAt is immutable once set (delivery %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_campaign_deliveries_timestamps_immutable_trigger
  BEFORE UPDATE ON "mobile_campaign_deliveries"
  FOR EACH ROW
  EXECUTE FUNCTION mobile_campaign_deliveries_timestamps_immutable_fn();
