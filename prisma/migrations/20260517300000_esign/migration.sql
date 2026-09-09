-- M6: E-Signature (Phase 6 Block C slice 1).
-- Salesforce E-Sign / DocuSign analogue. Slice 1 ships schema +
-- 5 pure helpers (state-machine + HMAC token issuer/verifier +
-- signature payload validator + audit event constructor). No
-- portal route, no Contract auto-advance, no DocuSign integration
-- — those land in slice 2.
--
-- Builds on M5 CLM (PR #12, commit f5a5f7b8): EsignEnvelope
-- references contracts.id; slice-2 envelope-completed handler
-- sets Contract.signedAt + Contract.signedBy + advances status
-- approved → active.
--
-- Slice 2 wires:
--   • Public signer route /sign/[token] (token-authenticated)
--   • POST /api/v1/esign/submit/[token] (signature collection)
--   • Email/SMS dispatch to signers on envelope.sent
--   • Contract.status advance on envelope.completed
--   • Optional DocuSign provider (own e-sign vs. delegated)

-- ── EsignEnvelope ──────────────────────────────────────────────
-- One envelope per contract per sign cycle. If a contract needs
-- re-signing (amendment, addendum), a NEW envelope is created;
-- envelopes are append-only audit objects.
CREATE TABLE "esign_envelopes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    /** Slice-2 dispatch emails embed this body; HTML allowed. */
    "message" TEXT,
    /**
     * Lifecycle:
     *   created → sent (emails dispatched)
     *          → voided (sender cancelled before any signer signed)
     *   sent → in_progress (first signer viewed/signed)
     *        → voided / expired
     *   in_progress → completed (all signers signed)
     *                → declined (any signer declined)
     *                → voided / expired
     * Helper enforces transitions; DB CHECK below pins the allowed set.
     */
    "status" TEXT NOT NULL DEFAULT 'created',
    /** Set on transition to "sent". */
    "sentAt" TIMESTAMP(3),
    /** Set on transition to "completed". */
    "completedAt" TIMESTAMP(3),
    /** Set on transition to "voided" — voiderUserId + reason. */
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    /** Auto-expire timestamp — slice-2 cron flips status to 'expired'. */
    "expiresAt" TIMESTAMP(3),
    /** Optional provider hints (DocuSign envelope-id, etc.) — slice-2/3. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "esign_envelopes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_status_check"
  CHECK ("status" IN (
    'created', 'sent', 'in_progress', 'completed', 'declined', 'voided', 'expired'
  ));

-- Status-timestamp coherence: terminal states MUST have their
-- transition timestamp set. (sent → sentAt; completed → completedAt;
-- voided → voidedAt+voidedBy.)
ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_completion_coherence_check"
  CHECK (
    ("status" <> 'completed') OR ("completedAt" IS NOT NULL)
  );
ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_void_coherence_check"
  CHECK (
    ("status" <> 'voided') OR ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL)
  );

CREATE INDEX "esign_envelopes_org_status_idx" ON "esign_envelopes"("organizationId", "status");
CREATE INDEX "esign_envelopes_contract_idx" ON "esign_envelopes"("contractId");
CREATE INDEX "esign_envelopes_org_expires_idx" ON "esign_envelopes"("organizationId", "expiresAt");

ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_envelopes"
  ADD CONSTRAINT "esign_envelopes_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Monotonicity guard: completedAt / voidedAt / sentAt immutable
-- once set. Mirrors M5 approval-stage decided-at-immutable pattern.
CREATE OR REPLACE FUNCTION esign_envelopes_terminal_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."sentAt" IS NOT NULL AND NEW."sentAt" <> OLD."sentAt" THEN
    RAISE EXCEPTION 'esign_envelopes.sentAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NEW."completedAt" <> OLD."completedAt" THEN
    RAISE EXCEPTION 'esign_envelopes.completedAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" <> OLD."voidedAt" THEN
    RAISE EXCEPTION 'esign_envelopes.voidedAt is immutable once set (env %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER esign_envelopes_terminal_timestamps_immutable_trigger
  BEFORE UPDATE ON "esign_envelopes"
  FOR EACH ROW
  EXECUTE FUNCTION esign_envelopes_terminal_timestamps_immutable_fn();

-- ── EsignSigner ────────────────────────────────────────────────
-- One row per party (signer / cc / copy-only). `order` enforces
-- sequential or parallel signing per envelope.routingType (slice 2).
-- Slice 1 schema is sequential-only — parallel deferred.
CREATE TABLE "esign_signers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    /** 1-based signing order. UNIQUE per envelope. */
    "order" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    /** Role: signer (must sign) | cc (notify only) | copy (read-only). */
    "role" TEXT NOT NULL DEFAULT 'signer',
    /**
     * Lifecycle:
     *   pending → sent (envelope.sent triggers per-signer dispatch)
     *   sent → viewed (signer opened /sign/[token] page)
     *   sent/viewed → signed (submitted signature)
     *                → declined (clicked decline)
     *                → expired
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /**
     * HMAC of the canonical signing token (server-side opaque hash).
     * Slice-1 helper produces both the plaintext token (sent in email
     * link) AND the hash (stored here). Verifier re-computes from
     * payload + secret; equality check is constant-time.
     */
    "tokenHash" TEXT,
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    /** drawn | typed | uploaded — slice-2 portal UI offers all three. */
    "signatureMethod" TEXT,
    /**
     * Captured signature payload — JSONB with method-specific shape:
     *   drawn: { svgPath: string, widthPx, heightPx }
     *   typed: { typedName: string, font: string }
     *   uploaded: { fileRefId: string }
     * Validator slice-1 helper checks shape per method.
     */
    "signaturePayload" JSONB,
    /** Captured at signature time for audit / non-repudiation. */
    "signedIpAddress" TEXT,
    "signedUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "esign_signers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_status_check"
  CHECK ("status" IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'expired'));

ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_role_check"
  CHECK ("role" IN ('signer', 'cc', 'copy'));

ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_order_check"
  CHECK ("order" >= 1);

ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_method_check"
  CHECK ("signatureMethod" IS NULL OR "signatureMethod" IN ('drawn', 'typed', 'uploaded'));

-- Signing coherence: status 'signed' requires signedAt + signatureMethod + payload.
ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_sign_coherence_check"
  CHECK (
    "status" <> 'signed'
    OR (
      "signedAt" IS NOT NULL
      AND "signatureMethod" IS NOT NULL
      AND "signaturePayload" IS NOT NULL
    )
  );
ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_decline_coherence_check"
  CHECK ("status" <> 'declined' OR "declinedAt" IS NOT NULL);

CREATE UNIQUE INDEX "esign_signers_envelope_order_uniq"
  ON "esign_signers"("envelopeId", "order");
CREATE INDEX "esign_signers_org_envelope_idx" ON "esign_signers"("organizationId", "envelopeId");
CREATE INDEX "esign_signers_email_idx" ON "esign_signers"("email");

ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_signers"
  ADD CONSTRAINT "esign_signers_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "esign_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Signer terminal timestamps immutable once set.
--
-- Note on viewedAt: this trigger blocks ANY change to viewedAt after
-- first set — first-view is the audit-relevant snapshot. If slice-2
-- adds "last-viewed" tracking for cron-driven nudges ("hasn't visited
-- in N days"), it must use a SEPARATE column (e.g. `lastViewedAt`)
-- rather than UPDATE viewedAt, otherwise it'll hit check_violation.
CREATE OR REPLACE FUNCTION esign_signers_terminal_timestamps_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."signedAt" IS NOT NULL AND NEW."signedAt" <> OLD."signedAt" THEN
    RAISE EXCEPTION 'esign_signers.signedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."declinedAt" IS NOT NULL AND NEW."declinedAt" <> OLD."declinedAt" THEN
    RAISE EXCEPTION 'esign_signers.declinedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."viewedAt" IS NOT NULL AND NEW."viewedAt" <> OLD."viewedAt" THEN
    RAISE EXCEPTION 'esign_signers.viewedAt is immutable once set (signer %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER esign_signers_terminal_timestamps_immutable_trigger
  BEFORE UPDATE ON "esign_signers"
  FOR EACH ROW
  EXECUTE FUNCTION esign_signers_terminal_timestamps_immutable_fn();

-- ── EsignAuditEvent ────────────────────────────────────────────
-- Append-only audit trail. Every meaningful event on an envelope
-- or signer (create / send / view / sign / decline / void / expire)
-- writes a row here. Used for non-repudiation, dispute resolution,
-- and slice-2 admin timeline UI.
--
-- This table is NEVER UPDATEd in normal flow — only INSERTed. A
-- DB-level "no UPDATE" trigger enforces that.
CREATE TABLE "esign_audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    /** Nullable — envelope-scoped events (create/void/expire) have no signer. */
    "signerId" TEXT,
    /**
     * Event kinds. Enum is open enough for slice-2 additions
     * (delegate / reassign / remind) without DB churn.
     */
    "eventType" TEXT NOT NULL,
    /**
     * Who triggered the event:
     *   user   — internal CRM user (createdBy / voidedBy)
     *   signer — external party via /sign/[token]
     *   system — cron expiry / auto-progression
     */
    "actorType" TEXT NOT NULL,
    /** Actor reference — userId for type='user', signerId for type='signer', null for 'system'. */
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    /** Per-event payload — slice-1 helper produces structured records. */
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "esign_audit_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "esign_audit_events"
  ADD CONSTRAINT "esign_audit_events_actor_type_check"
  CHECK ("actorType" IN ('user', 'signer', 'system'));

ALTER TABLE "esign_audit_events"
  ADD CONSTRAINT "esign_audit_events_event_type_check"
  CHECK ("eventType" IN (
    'envelope_created', 'envelope_sent', 'envelope_voided', 'envelope_expired',
    'envelope_completed', 'signer_invited', 'signer_viewed', 'signer_signed',
    'signer_declined', 'signer_expired', 'token_issued', 'token_verified_ok',
    'token_verified_failed'
  ));

CREATE INDEX "esign_audit_events_envelope_idx" ON "esign_audit_events"("envelopeId", "createdAt");
CREATE INDEX "esign_audit_events_org_envelope_idx" ON "esign_audit_events"("organizationId", "envelopeId");
CREATE INDEX "esign_audit_events_signer_idx" ON "esign_audit_events"("signerId");

ALTER TABLE "esign_audit_events"
  ADD CONSTRAINT "esign_audit_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_audit_events"
  ADD CONSTRAINT "esign_audit_events_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "esign_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_audit_events"
  ADD CONSTRAINT "esign_audit_events_signerId_fkey"
  FOREIGN KEY ("signerId") REFERENCES "esign_signers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION esign_audit_events_no_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'esign_audit_events is append-only; UPDATE not allowed (event %)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER esign_audit_events_no_update_trigger
  BEFORE UPDATE ON "esign_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION esign_audit_events_no_update_fn();

-- ── Contract column additions ──────────────────────────────────
-- M6 slice-2 sets signedAt + signedBy on envelope.completed.
-- Slice 1 just adds the columns + a partial index for "show all
-- signed contracts" reporting query. No FK to envelopes (one
-- contract can have multiple envelopes — amendments / re-sign);
-- the envelope.contractId direction holds the canonical link.
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signedBy" TEXT;

-- Full index (no WHERE) to keep schema.prisma `@@index([signedAt])`
-- in sync — same drift-avoidance pattern as M5 architect pass 2.
CREATE INDEX IF NOT EXISTS "contracts_signed_at_idx" ON "contracts"("signedAt");
