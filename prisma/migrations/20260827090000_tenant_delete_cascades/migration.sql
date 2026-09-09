-- F-24: tenant deletion left 83 tables behind because they carry an
-- organizationId with no foreign key to organizations, so the cascade
-- hardDeleteTenant relies on had nothing to follow. Confirmed on production
-- 2026-08-26 (docs/isms/evidence/2026-08-26-tenant-delete-cascade-gaps.txt).
--
-- This closes 73 of them. The other 10 are NOT an oversight:
--   * 9 have children whose own relation declares no onDelete, which Prisma
--     renders as RESTRICT for a required relation. Adding the parent cascade
--     first would make tenant deletion FAIL instead of complete — worse than
--     the bug. Their children have to be settled first.
--   * 1 is compliance_audit_log, where the missing key is deliberate and
--     documented: that log is meant to outlive the tenant it describes
--     (ISMS-12 §2).
--
-- The other four logs ARE included, on the owner's decision of 2026-08-27.
-- Their retention periods (1 or 3 years, ISMS-12 §1) govern how long a LIVE
-- tenant's entries are kept; they are not a reason to keep a terminated
-- tenant's data, which §1 says goes 30 days after termination. Only the
-- compliance log is exempt, and only because that exemption is written down.
--
-- Safe to run on a live database:
--   * NOT VALID and deliberately NOT validated. This is the correction after the
--     first attempt failed: additional_sales held a row whose organizationId
--     pointed at an organisation that no longer exists, and VALIDATE refused it
--     (23503). The audit on 2026-08-26 genuinely found no orphans — a tenant was
--     deleted between then and now, and because deletion was still broken it left
--     exactly this debris. Assuming yesterday's clean data is a promise no
--     migration can keep.
--
--     NOT VALID skips only the scan of EXISTING rows. The constraint is fully
--     live for everything after it, and — the part that matters here — ON DELETE
--     CASCADE fires regardless. So tenant deletion is fixed from the moment this
--     lands, while pre-existing orphans are tolerated rather than blocking it.
--     Cleaning them and running VALIDATE is a separate, owner-approved step:
--     deleting rows on production is not something a schema migration should do
--     on its own initiative.
--
--   * Skipping the scan also removes the long lock. On channel_messages that is
--     the difference between a blip and an outage.
--   * Idempotent: each key is added only if absent, so a retry after a
--     lock_timeout is safe. Prisma Migrate does not guarantee a per-file
--     transaction on Postgres.
--
-- RUNBOOK. A failed attempt is recorded in _prisma_migrations and wedges EVERY
-- later deploy with P3009 until it is cleared — that already happened once, on
-- the VALIDATE described above. The file is idempotent, so recovery is:
--   npx prisma migrate resolve --rolled-back 20260827090000_tenant_delete_cascades
-- then redeploy. Run it on the server, from /opt/leaddrive-v2, before the next
-- deployment — nothing else can ship until it is done.
--
-- FOLLOW-UP (not part of this migration). Once the owner has approved deleting
-- rows whose organisation is gone, they can be removed and the constraints
-- promoted with VALIDATE CONSTRAINT, which then costs only a scan. Until then
-- the keys are honest about what they do and do not guarantee: they govern
-- everything from now on, and make no claim about what was already there.

SET lock_timeout = '5s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'additional_sales',
    'advisor_playbooks',
    'ai_interaction_logs',
    'advisor_signal_snapshots',
    'agent_handoffs',
    'ai_agent_configs',
    'ai_alerts',
    'ai_chat_sessions',
    'ai_guardrails',
    'ai_pending_actions',
    'ai_shadow_actions',
    'applied_templates',
    'budget_actuals',
    'budget_change_logs',
    'budget_direction_templates',
    'budget_forecast_entries',
    'budget_sections',
    'campaigns',
    'channel_messages',
    'chatbot_rules',
    'client_services',
    'complaint_meta',
    'contact_events',
    'contact_segments',
    'contract_ai_extractions',
    'contract_clauses',
    'contract_deviation_flags',
    'contract_embeddings',
    'contract_files',
    'contract_milestones',
    'contract_risk_scores',
    'contract_versions',
    'conversation_flow_runs',
    'conversation_notes',
    'conversation_participants',
    'cost_employees',
    'cost_model_logs',
    'cost_model_snapshots',
    'currencies',
    'custom_field_values',
    'custom_fields',
    'dashboard_layouts',
    'email_logs',
    'email_templates',
    'escalation_rules',
    'events',
    'form_submissions',
    'inbox_customer_stage_events',
    'inbox_folders',
    'journey_enrollments',
    'journeys',
    'kb_articles',
    'kb_embeddings',
    'notifications',
    'otp_codes',
    'overhead_costs',
    'pipeline_stages',
    'pricing_parameters',
    'pricing_profile_categories',
    'pricing_profiles',
    'pricing_services',
    'products',
    'project_members',
    'project_milestones',
    'sales_quotas',
    'scheduled_actions',
    'sequence_steps',
    'sla_policies',
    'stage_validation_rules',
    'task_attachments',
    'ticket_queues',
    'whatsapp_templates',
    'workflow_rules'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass
        AND contype = 'f'
        AND confrelid = 'public.organizations'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId")
           REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE NOT VALID',
        t, t || '_organizationId_fkey'
      );
      RAISE NOTICE 'cascade added: %', t;
    END IF;
  END LOOP;
END $$;

-- Session-scoped, and migrate deploy reuses one connection across pending
-- migrations — do not leak the 5s budget into whatever runs next.
RESET lock_timeout;
