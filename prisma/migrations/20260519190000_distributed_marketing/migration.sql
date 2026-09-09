-- C7: Distributed Marketing (Phase 6 / Marketing Cloud).
--
-- Salesforce Marketing Cloud Engagement Distributed Marketing analogue.
-- Solves the "corporate + local" problem: corporate marketing team
-- authors brand-approved templates with LOCKED content (legal copy,
-- brand voice, product details) and UNLOCKED variables (rep name,
-- signature, local CTA URL, photo). Per-rep view fills the unlocked
-- variables and sends — the locked parts stay corporate-authored.
--
-- Slice-1 ships schema + 5 pure helpers (types + template-variable-
-- validator + personalization-renderer + distribution-resolver +
-- state-machine). NO send runtime — slice-2 wires the route that
-- accepts a personalization + delegates to existing channel senders
-- (sendEmail / sendSms / etc.) and writes audit rows.
--
-- Slice-2 wires:
--   • Per-rep template gallery UI (list templates user has access to).
--   • Personalization editor: render preview as user fills unlocked vars.
--   • Send route → channel sender + append send-record.
--   • Admin UI for template authoring + distribution assignment.
--   • IMPORTANT slice-2 concern (architect C7 pass-1): lockedVariables
--     and unlockedVariables on marketing_templates are mutable while
--     status=active. A corporate edit can desync existing personaliz-
--     ations (validated against old slot set). Slice-2 admin UI must
--     EITHER gate edits to draft-only OR re-validate all dependent
--     personalizations on save. Slice-1 doesn't enforce because the
--     pull-back-to-draft transition is the supported workflow.
-- Slice-3 wires:
--   • AI-assisted variable fill suggestions (Claude proposes per-contact
--     personalized fills based on contact profile).
--   • Localization: per-rep locale variants of locked content.

-- ═══════════════════════════════════════════════════════════════
-- 1. marketing_templates — corporate template definitions
-- ═══════════════════════════════════════════════════════════════
-- Corporate marketing authors these. Content uses `{{variable_name}}`
-- placeholders. Each variable is declared in EITHER lockedVariables OR
-- unlockedVariables — never both. Locked variables are filled by
-- corporate at authoring time; unlocked variables are filled by reps
-- at send time.
CREATE TABLE "marketing_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    /**
     * Channel (DB CHECK):
     *   email | sms | push | telegram | whatsapp
     * Matches the C12 channel taxonomy minus voice/postal (no template
     * model for those in slice-1).
     */
    "channel" TEXT NOT NULL,
    /**
     * Subject template (email/push only). May contain {{vars}}.
     * NULL for SMS/whatsapp/telegram (body-only channels).
     */
    "subjectTemplate" TEXT,
    /**
     * Body template — contains {{var_name}} placeholders. The
     * placeholders refer to variables defined in lockedVariables[]
     * or unlockedVariables[] below.
     */
    "bodyTemplate" TEXT NOT NULL,
    /**
     * Corporate-defined variable values. Shape:
     *   {
     *     "company_name": "LeadDrive",
     *     "legal_disclaimer": "© 2026 ...",
     *     "product_url": "https://leaddrivecrm.org/product"
     *   }
     * Validator ensures every key here corresponds to a {{placeholder}}
     * in subject/body. Reps CANNOT override these.
     */
    "lockedVariables" JSONB NOT NULL DEFAULT '{}',
    /**
     * Variable slots reps fill at send time. Array of slot definitions:
     *   [
     *     { "name": "rep_name", "label": "Your name", "type": "string", "required": true },
     *     { "name": "signature", "label": "Email signature", "type": "string" },
     *     { "name": "local_cta_url", "label": "Your CTA link", "type": "url" }
     *   ]
     * Validator ensures every slot name corresponds to a {{placeholder}}
     * and is NOT in lockedVariables.
     */
    "unlockedVariables" JSONB NOT NULL DEFAULT '[]',
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft     — authoring (reps can't see)
     *   active    — reps can use (gallery + send)
     *   archived  — terminal; historical sends preserved
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    /** Set on transition to archived; immutable thereafter. */
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "marketing_templates"
  ADD CONSTRAINT "marketing_templates_channel_check"
  CHECK ("channel" IN ('email', 'sms', 'push', 'telegram', 'whatsapp'));

ALTER TABLE "marketing_templates"
  ADD CONSTRAINT "marketing_templates_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived'));

ALTER TABLE "marketing_templates"
  ADD CONSTRAINT "marketing_templates_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

-- Subject required for email + push; not allowed for SMS/whatsapp/telegram.
ALTER TABLE "marketing_templates"
  ADD CONSTRAINT "marketing_templates_subject_coherence_check"
  CHECK (
    ("channel" IN ('email', 'push') AND "subjectTemplate" IS NOT NULL)
    OR ("channel" NOT IN ('email', 'push') AND "subjectTemplate" IS NULL)
  );

CREATE UNIQUE INDEX "marketing_templates_org_name_uniq"
  ON "marketing_templates"("organizationId", "name");
CREATE INDEX "marketing_templates_org_channel_status_idx"
  ON "marketing_templates"("organizationId", "channel", "status");

ALTER TABLE "marketing_templates"
  ADD CONSTRAINT "marketing_templates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status transitions: draft → active|archived, active → draft|archived
-- (active → draft = pull back for re-edit), archived terminal. channel
-- immutable (changing channel would invalidate body shape). archivedAt
-- immutable once set.
CREATE OR REPLACE FUNCTION marketing_templates_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."channel" IS DISTINCT FROM OLD."channel" THEN
    RAISE EXCEPTION 'marketing_templates.channel is immutable (template %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'marketing_templates.archivedAt is immutable once set (template %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'marketing_templates status: archived is terminal (template %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'marketing_templates status: draft → % is invalid (template %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('draft', 'archived') THEN
      RAISE EXCEPTION 'marketing_templates status: active → % is invalid (template %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    -- Defense-in-depth (per architect C5 pass-1 pattern).
    IF OLD."status" NOT IN ('draft', 'active', 'archived') THEN
      RAISE EXCEPTION 'marketing_templates status: OLD status "%" is unknown — refusing transition (template %, data corruption suspected)',
        OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_templates_lifecycle_trigger
  BEFORE UPDATE ON "marketing_templates"
  FOR EACH ROW
  EXECUTE FUNCTION marketing_templates_lifecycle_fn();

-- ═══════════════════════════════════════════════════════════════
-- 2. template_distributions — who can use which template
-- ═══════════════════════════════════════════════════════════════
-- One row per template + distribution-target tuple. distributionType
-- specifies the scope (all users / specific user / role / team).
CREATE TABLE "template_distributions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    /**
     * Distribution scope (DB CHECK):
     *   all       — every user in org can see + use
     *   user      — specific user (targetUserId required)
     *   role      — users with a specific role (targetRole required)
     *   team      — slice-2 team membership (targetTeamRef required)
     */
    "distributionType" TEXT NOT NULL,
    /** Required when distributionType = 'user'. */
    "targetUserId" TEXT,
    /** Required when distributionType = 'role'. */
    "targetRole" TEXT,
    /**
     * Required when distributionType = 'team'. Free-form team identifier
     * (slice-2 will FK to a teams table; slice-1 keeps opaque string).
     */
    "targetTeamRef" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "template_distributions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_type_check"
  CHECK ("distributionType" IN ('all', 'user', 'role', 'team'));

-- Coherence: each type requires the matching target column set, others NULL.
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_user_target_check"
  CHECK (
    ("distributionType" = 'user' AND "targetUserId" IS NOT NULL AND "targetRole" IS NULL AND "targetTeamRef" IS NULL)
    OR "distributionType" <> 'user'
  );
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_role_target_check"
  CHECK (
    ("distributionType" = 'role' AND "targetRole" IS NOT NULL AND "targetUserId" IS NULL AND "targetTeamRef" IS NULL)
    OR "distributionType" <> 'role'
  );
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_team_target_check"
  CHECK (
    ("distributionType" = 'team' AND "targetTeamRef" IS NOT NULL AND "targetUserId" IS NULL AND "targetRole" IS NULL)
    OR "distributionType" <> 'team'
  );
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_all_target_check"
  CHECK (
    "distributionType" <> 'all'
    OR ("targetUserId" IS NULL AND "targetRole" IS NULL AND "targetTeamRef" IS NULL)
  );

-- One row per (template, type, target) — defends duplicate assignments.
CREATE UNIQUE INDEX "template_distributions_unique_assignment_idx"
  ON "template_distributions"(
    "templateId",
    "distributionType",
    COALESCE("targetUserId", ''),
    COALESCE("targetRole", ''),
    COALESCE("targetTeamRef", '')
  );
CREATE INDEX "template_distributions_org_template_idx"
  ON "template_distributions"("organizationId", "templateId");
CREATE INDEX "template_distributions_org_user_idx"
  ON "template_distributions"("organizationId", "targetUserId")
  WHERE "targetUserId" IS NOT NULL;

ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "marketing_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_distributions"
  ADD CONSTRAINT "template_distributions_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Distributions are essentially append-only — no UPDATE needed since
-- the natural key is (template, type, target). To re-assign, delete +
-- insert. Trigger blocks UPDATE.
CREATE OR REPLACE FUNCTION template_distributions_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'template_distributions is append-only (distribution % cannot be updated; delete + re-insert)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_distributions_append_only_trigger
  BEFORE UPDATE ON "template_distributions"
  FOR EACH ROW
  EXECUTE FUNCTION template_distributions_append_only_fn();

-- Cross-table coherence: template same org; targetUser (if set) same org.
CREATE OR REPLACE FUNCTION template_distributions_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  template_org_id TEXT;
  user_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO template_org_id
    FROM "marketing_templates" WHERE "id" = NEW."templateId";
  IF template_org_id IS NULL THEN
    RAISE EXCEPTION 'template_distributions.templateId "%" does not resolve', NEW."templateId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF template_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_distributions: template "%" belongs to org "%" but distribution references org "%"',
      NEW."templateId", template_org_id, NEW."organizationId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."targetUserId" IS NOT NULL THEN
    SELECT "organizationId" INTO user_org_id
      FROM "users" WHERE "id" = NEW."targetUserId";
    IF user_org_id IS NULL THEN
      RAISE EXCEPTION 'template_distributions.targetUserId "%" does not resolve', NEW."targetUserId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF user_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'template_distributions: user "%" belongs to org "%" but distribution references org "%"',
        NEW."targetUserId", user_org_id, NEW."organizationId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_distributions_coherence_trigger
  BEFORE INSERT ON "template_distributions"
  FOR EACH ROW
  EXECUTE FUNCTION template_distributions_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 3. template_personalizations — per-rep filled variable sets
-- ═══════════════════════════════════════════════════════════════
-- Each row = one rep's saved personalization of a template. Reps can
-- save multiple personalizations of the same template (e.g. "warm
-- intro" vs "follow-up after demo"). Per-send the rep picks which
-- personalization + which contact.
CREATE TABLE "template_personalizations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    /** Human label — "warm intro", "after demo follow-up", etc. */
    "name" TEXT NOT NULL,
    /**
     * Variable values for the template's unlockedVariables slots.
     * Validator (template-variable-validator.ts) ensures keys are a
     * subset of the template's unlocked slot names + required slots
     * are filled. Locked variable keys here are rejected — reps can't
     * override locked corporate content.
     */
    "variableValues" JSONB NOT NULL DEFAULT '{}',
    /**
     * Lifecycle (DB CHECK + transition trigger):
     *   draft     — being authored / incomplete fills
     *   active    — ready to send
     *   archived  — terminal
     */
    "status" TEXT NOT NULL DEFAULT 'draft',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "template_personalizations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_personalizations"
  ADD CONSTRAINT "template_personalizations_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived'));

ALTER TABLE "template_personalizations"
  ADD CONSTRAINT "template_personalizations_archived_coherence_check"
  CHECK ("status" <> 'archived' OR "archivedAt" IS NOT NULL);

-- (template, user, name) unique only among NON-archived rows. Architect
-- pass-1 suggestion: lets a rep archive a personalization and recreate
-- with the same name later (common iterative-naming pattern). Archived
-- rows remain in the table for send-record audit but don't block the
-- name slot. Prisma's @@unique can't express WHERE — this index is
-- SQL-only.
CREATE UNIQUE INDEX "template_personalizations_template_user_name_uniq"
  ON "template_personalizations"("templateId", "userId", "name")
  WHERE "status" <> 'archived';
CREATE INDEX "template_personalizations_org_user_idx"
  ON "template_personalizations"("organizationId", "userId");
CREATE INDEX "template_personalizations_template_status_idx"
  ON "template_personalizations"("templateId", "status");

ALTER TABLE "template_personalizations"
  ADD CONSTRAINT "template_personalizations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_personalizations"
  ADD CONSTRAINT "template_personalizations_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "marketing_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_personalizations"
  ADD CONSTRAINT "template_personalizations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lifecycle: draft ↔ active, either → archived. templateId + userId
-- immutable. archivedAt set-once.
CREATE OR REPLACE FUNCTION template_personalizations_lifecycle_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."templateId" IS DISTINCT FROM OLD."templateId" THEN
    RAISE EXCEPTION 'template_personalizations.templateId is immutable (personalization %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'template_personalizations.userId is immutable (personalization %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION 'template_personalizations.archivedAt is immutable once set (personalization %)', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'archived' THEN
      RAISE EXCEPTION 'template_personalizations status: archived is terminal (personalization %)', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'draft' AND NEW."status" NOT IN ('active', 'archived') THEN
      RAISE EXCEPTION 'template_personalizations status: draft → % is invalid (personalization %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'active' AND NEW."status" NOT IN ('draft', 'archived') THEN
      RAISE EXCEPTION 'template_personalizations status: active → % is invalid (personalization %)', NEW."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    -- Defense-in-depth (per C5 pass-1 pattern + architect C7 pass-1):
    -- if OLD.status is somehow corrupted to a value outside the FSM,
    -- refuse the transition. CHECK constraint should prevent, but the
    -- trigger is a second line of defense.
    IF OLD."status" NOT IN ('draft', 'active', 'archived') THEN
      RAISE EXCEPTION 'template_personalizations status: OLD status "%" is unknown — refusing transition (personalization %, data corruption suspected)',
        OLD."status", OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_personalizations_lifecycle_trigger
  BEFORE UPDATE ON "template_personalizations"
  FOR EACH ROW
  EXECUTE FUNCTION template_personalizations_lifecycle_fn();

-- Coherence: template + user same org.
CREATE OR REPLACE FUNCTION template_personalizations_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  template_org_id TEXT;
  user_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO template_org_id
    FROM "marketing_templates" WHERE "id" = NEW."templateId";
  IF template_org_id IS NULL OR template_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_personalizations: template "%" does not resolve or org mismatch', NEW."templateId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO user_org_id
    FROM "users" WHERE "id" = NEW."userId";
  IF user_org_id IS NULL OR user_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_personalizations: user "%" does not resolve or org mismatch', NEW."userId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_personalizations_coherence_trigger
  BEFORE INSERT ON "template_personalizations"
  FOR EACH ROW
  EXECUTE FUNCTION template_personalizations_coherence_fn();

-- ═══════════════════════════════════════════════════════════════
-- 4. template_send_records — append-only audit
-- ═══════════════════════════════════════════════════════════════
-- Slice-2 send route inserts one row per successful send (or failed
-- attempt). Captures who sent what, to whom, via which channel, with
-- which personalization. Append-only — sends are historical fact.
CREATE TABLE "template_send_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "personalizationId" TEXT,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    /** Channel at send time — denormalized for fast reporting. */
    "channel" TEXT NOT NULL,
    /**
     * Send outcome (DB CHECK):
     *   sent      — handed off to channel sender successfully
     *   failed    — channel sender rejected (errorMessage required)
     *   bounced   — channel reported bounce after handoff
     */
    "outcome" TEXT NOT NULL DEFAULT 'sent',
    "errorMessage" TEXT,
    /** Snapshot of rendered subject + body (audit trail). */
    "renderedSubject" TEXT,
    "renderedBody" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "template_send_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_channel_check"
  CHECK ("channel" IN ('email', 'sms', 'push', 'telegram', 'whatsapp'));
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_outcome_check"
  CHECK ("outcome" IN ('sent', 'failed', 'bounced'));
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_failed_coherence_check"
  CHECK ("outcome" <> 'failed' OR "errorMessage" IS NOT NULL);

CREATE INDEX "template_send_records_org_template_sent_idx"
  ON "template_send_records"("organizationId", "templateId", "sentAt");
CREATE INDEX "template_send_records_org_user_sent_idx"
  ON "template_send_records"("organizationId", "userId", "sentAt");
CREATE INDEX "template_send_records_org_contact_sent_idx"
  ON "template_send_records"("organizationId", "contactId", "sentAt");

ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "marketing_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_personalizationId_fkey"
  FOREIGN KEY ("personalizationId") REFERENCES "template_personalizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_send_records"
  ADD CONSTRAINT "template_send_records_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only: send records are immutable history.
CREATE OR REPLACE FUNCTION template_send_records_append_only_fn()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'template_send_records is append-only (record % cannot be updated)', OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_send_records_append_only_trigger
  BEFORE UPDATE ON "template_send_records"
  FOR EACH ROW
  EXECUTE FUNCTION template_send_records_append_only_fn();

-- Coherence: template + (personalization if set) + user + contact same org.
-- Plus personalization's templateId must match record's templateId (split-
-- brain prevention, mirrors C12 deliveries pattern).
CREATE OR REPLACE FUNCTION template_send_records_coherence_fn()
RETURNS TRIGGER AS $$
DECLARE
  template_org_id TEXT;
  pers_org_id TEXT;
  pers_template_id TEXT;
  user_org_id TEXT;
  contact_org_id TEXT;
BEGIN
  SELECT "organizationId" INTO template_org_id
    FROM "marketing_templates" WHERE "id" = NEW."templateId";
  IF template_org_id IS NULL OR template_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_send_records: template "%" does not resolve or org mismatch', NEW."templateId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."personalizationId" IS NOT NULL THEN
    SELECT "organizationId", "templateId" INTO pers_org_id, pers_template_id
      FROM "template_personalizations" WHERE "id" = NEW."personalizationId";
    IF pers_org_id IS NULL OR pers_org_id <> NEW."organizationId" THEN
      RAISE EXCEPTION 'template_send_records: personalization "%" does not resolve or org mismatch', NEW."personalizationId"
        USING ERRCODE = 'check_violation';
    END IF;
    IF pers_template_id <> NEW."templateId" THEN
      RAISE EXCEPTION 'template_send_records: personalization "%" is for template "%" but record references template "%"',
        NEW."personalizationId", pers_template_id, NEW."templateId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT "organizationId" INTO user_org_id
    FROM "users" WHERE "id" = NEW."userId";
  IF user_org_id IS NULL OR user_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_send_records: user "%" does not resolve or org mismatch', NEW."userId"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "organizationId" INTO contact_org_id
    FROM "contacts" WHERE "id" = NEW."contactId";
  IF contact_org_id IS NULL OR contact_org_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'template_send_records: contact "%" does not resolve or org mismatch', NEW."contactId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_send_records_coherence_trigger
  BEFORE INSERT ON "template_send_records"
  FOR EACH ROW
  EXECUTE FUNCTION template_send_records_coherence_fn();
