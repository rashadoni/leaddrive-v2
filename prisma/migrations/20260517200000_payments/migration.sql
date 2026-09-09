-- D5: Payment integrations (Phase 6 Block A).
-- Salesforce Payments analogue. Pluggable provider pattern mirroring
-- src/lib/sms/providers/ — each provider (stripe/paypal/yookassa/
-- robokassa) implements the same interface and the registry picks one
-- per PaymentIntent. Slice 1 ships schema + provider abstraction +
-- state machine + stubbed provider implementations (signature-only,
-- no real SDK calls). Slice 2 wires actual API calls + webhook
-- handlers; slice 3 wires the Stripe Elements checkout UI + customer
-- portal saved-payment-method flow.

-- ── PaymentProvider ─────────────────────────────────────────────
-- Per-tenant provider config. Credentials are stored as encrypted JSON
-- in `credentials` (slice 1 stores plaintext for testability; slice 2
-- wraps via the existing NamedCredentials vault — see N17 in Phase 5).
-- `type` is the canonical provider key matched against the registry.
-- A tenant may have MULTIPLE config rows of the same type (e.g. test
-- + live Stripe) — uniqueness is (orgId, type, isTestMode).
CREATE TABLE "payment_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "isTestMode" BOOLEAN NOT NULL DEFAULT FALSE,
    "webhookSecret" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_providers"
  ADD CONSTRAINT "payment_providers_type_check"
  CHECK ("type" IN ('stripe', 'paypal', 'yookassa', 'robokassa'));

-- One config per (org, type, isTestMode) — prevents the operator from
-- accidentally landing two live-Stripe rows that would race on the
-- webhook signature secret. Test + live can coexist.
CREATE UNIQUE INDEX "payment_providers_org_type_mode_uniq"
  ON "payment_providers"("organizationId", "type", "isTestMode");
CREATE INDEX "payment_providers_org_active_idx" ON "payment_providers"("organizationId", "isActive");

ALTER TABLE "payment_providers"
  ADD CONSTRAINT "payment_providers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PaymentIntent ───────────────────────────────────────────────
-- Payment-attempt lifecycle. `externalRef` is the provider's
-- PaymentIntent id (e.g. Stripe `pi_...`). `status` follows the
-- canonical state machine (see lib/payments/intent-state-machine.ts).
-- A PaymentIntent may link to:
--   subscriptionId — recurring charge from D4
--   invoiceId      — one-time invoice payment
--   contactId      — customer's saved payment context
-- All three are nullable; the route validates exactly-one-or-flexible
-- by use case.
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalRef" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "customerEmail" TEXT,
    "contactId" TEXT,
    "subscriptionId" TEXT,
    "invoiceId" TEXT,
    "paymentMethod" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_status_check"
  CHECK ("status" IN ('pending', 'processing', 'requires_action', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded'));

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amount_check"
  CHECK ("amount" >= 0);

-- Outcome coherence: status-specific timestamp columns must align with status.
--   pending/processing/requires_action → none of succeededAt/failedAt/cancelledAt
--   succeeded/refunded/partially_refunded → succeededAt set
--   failed → failedAt set
--   cancelled → cancelledAt set
-- The CHECK enforces this so a `succeeded` row without succeededAt
-- (or vice versa) cannot persist. Refund timestamps are tracked on the
-- PaymentRefund rows, not here.
ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_outcome_coherence_check"
  CHECK (
    ("status" IN ('pending', 'processing', 'requires_action')
      AND "succeededAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" IN ('succeeded', 'refunded', 'partially_refunded')
      AND "succeededAt" IS NOT NULL AND "failedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'failed'
      AND "succeededAt" IS NULL AND "failedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'cancelled'
      AND "succeededAt" IS NULL AND "failedAt" IS NULL AND "cancelledAt" IS NOT NULL)
  );

-- Failure-detail coherence: failureCode + failureMessage must align
-- with status='failed'. Tracked separately so a future webhook event
-- (e.g. "payment_intent.payment_failed.attempt_2") populates the latest
-- failure reason even before the intent moves to a terminal status.
-- For slice 1: simple coherence — failureCode is null unless failed.
ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_failure_coherence_check"
  CHECK (
    ("status" = 'failed' AND "failureCode" IS NOT NULL)
    OR ("status" <> 'failed' AND "failureCode" IS NULL AND "failureMessage" IS NULL)
  );

-- externalRef unique per (org, providerId) — a provider's PaymentIntent
-- id (e.g. Stripe pi_...) must never map to two CRM rows in the same
-- tenant. The webhook idempotency handler relies on this to dedupe.
CREATE UNIQUE INDEX "payment_intents_provider_external_uniq"
  ON "payment_intents"("organizationId", "providerId", "externalRef")
  WHERE "externalRef" IS NOT NULL;

CREATE INDEX "payment_intents_org_status_idx" ON "payment_intents"("organizationId", "status");
CREATE INDEX "payment_intents_org_provider_idx" ON "payment_intents"("organizationId", "providerId");
CREATE INDEX "payment_intents_subscription_idx" ON "payment_intents"("subscriptionId");
CREATE INDEX "payment_intents_invoice_idx" ON "payment_intents"("invoiceId");
CREATE INDEX "payment_intents_contact_idx" ON "payment_intents"("contactId");

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── PaymentRefund ───────────────────────────────────────────────
-- One row per refund issued against a PaymentIntent. A single intent
-- may have multiple refunds (partial refund N times until fully
-- refunded). The PaymentIntent.status auto-rolls to 'refunded' when
-- sum(refund.amount where status=succeeded) >= intent.amount, or
-- 'partially_refunded' when 0 < sum < amount. Slice-3 dunning
-- reconciler maintains this aggregate.
CREATE TABLE "payment_refunds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "externalRef" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_status_check"
  CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_amount_check"
  CHECK ("amount" > 0);

-- Outcome coherence — same model as payment_intents.
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_outcome_coherence_check"
  CHECK (
    ("status" IN ('pending', 'processing', 'cancelled')
      AND "succeededAt" IS NULL AND "failedAt" IS NULL)
    OR ("status" = 'succeeded' AND "succeededAt" IS NOT NULL AND "failedAt" IS NULL)
    OR ("status" = 'failed' AND "succeededAt" IS NULL AND "failedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "payment_refunds_intent_external_uniq"
  ON "payment_refunds"("paymentIntentId", "externalRef")
  WHERE "externalRef" IS NOT NULL;
CREATE INDEX "payment_refunds_intent_idx" ON "payment_refunds"("paymentIntentId");
CREATE INDEX "payment_refunds_org_status_idx" ON "payment_refunds"("organizationId", "status");

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── PaymentWebhookEvent ─────────────────────────────────────────
-- Incoming webhook log for idempotency. The webhook handler:
--   1. Verifies the signature against PaymentProvider.webhookSecret
--   2. INSERTs a row with externalId from the provider payload
--   3. UNIQUE on (providerId, externalId) deduplicates retries
--   4. Processes the event + sets processedAt + status
-- A row that already exists is treated as already-processed → 200 OK
-- without side-effects. This is the core idempotency guarantee.
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT FALSE,
    "status" TEXT NOT NULL DEFAULT 'received',
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_status_check"
  CHECK ("status" IN ('received', 'processing', 'processed', 'failed', 'ignored'));

-- The idempotency guarantee. A provider may retry the same webhook
-- multiple times; the unique index ensures the second arrival is a
-- no-op.
--
-- Scope: (orgId, providerId, externalId) — providerId alone is
-- FK→payment_providers which is org-scoped, so adding organizationId
-- is functionally redundant for legitimate writes. It IS defense-in-
-- depth: if a future bug ever lands a webhook row with mismatched
-- (orgId, provider.orgId), the dedupe still works AND cross-tenant
-- queries cannot leak rows because the index includes the tenant
-- discriminator. Slice 2 may also add a trigger asserting the
-- denormalized orgId matches the provider's orgId on insert.
CREATE UNIQUE INDEX "payment_webhook_events_provider_external_uniq"
  ON "payment_webhook_events"("organizationId", "providerId", "externalId");
CREATE INDEX "payment_webhook_events_org_received_idx" ON "payment_webhook_events"("organizationId", "receivedAt");
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events"("status", "receivedAt");

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
