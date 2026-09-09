-- T8 Cobrowse — slice-1 data layer.
--
-- Single session record per agent⇄customer cobrowse engagement.
-- Slice-1 only ships persistence + state-machine helpers; slice-2
-- adds the signaling layer; slice-3 builds the WebRTC client UIs.
--
-- Consent gate is enforced at the route layer via the state machine
-- in `src/lib/cobrowse/state-machine.ts` — the DB CHECK only gates
-- `status` + `endReason` values to mirror the COBROWSE_STATUSES /
-- COBROWSE_END_REASONS enums.

CREATE TABLE "cobrowse_sessions" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "agentUserId"      TEXT NOT NULL,
  "contactId"        TEXT,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "joinToken"        TEXT NOT NULL,
  "consentGivenAt"   TIMESTAMP(3),
  "endReason"        TEXT,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"          TIMESTAMP(3),
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cobrowse_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cobrowse_sessions_status_chk"
    CHECK ("status" IN ('pending', 'awaiting_consent', 'active', 'paused', 'ended')),
  CONSTRAINT "cobrowse_sessions_end_reason_chk"
    CHECK ("endReason" IS NULL OR "endReason" IN ('agent_ended', 'customer_left', 'timeout', 'error'))
);

-- Join tokens are short-lived single-use values; uniqueness is global
-- (not per-org) because they're presented by anonymous customers
-- before tenant context is known.
CREATE UNIQUE INDEX "cobrowse_sessions_joinToken_unique"
  ON "cobrowse_sessions"("joinToken");

-- Hot path: agent dashboard "my active sessions" + per-org analytics.
CREATE INDEX "cobrowse_sessions_org_status_started_idx"
  ON "cobrowse_sessions"("organizationId", "status", "startedAt");

CREATE INDEX "cobrowse_sessions_agent_started_idx"
  ON "cobrowse_sessions"("agentUserId", "startedAt");

ALTER TABLE "cobrowse_sessions"
  ADD CONSTRAINT "cobrowse_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- agentUserId → User: cascade on agent deletion, mirroring how
-- other user-foreign-keys behave in this schema. An orphan session
-- referencing a deleted agent is a stale audit row, not a
-- recoverable resource.
ALTER TABLE "cobrowse_sessions"
  ADD CONSTRAINT "cobrowse_sessions_agentUserId_fkey"
  FOREIGN KEY ("agentUserId")
  REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- contactId → Contact: SetNull preserves the audit row when the
-- contact is later deleted. Anonymous portal cobrowse already uses
-- NULL; the relation only constrains the non-null case.
ALTER TABLE "cobrowse_sessions"
  ADD CONSTRAINT "cobrowse_sessions_contactId_fkey"
  FOREIGN KEY ("contactId")
  REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
