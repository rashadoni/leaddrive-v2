-- F-24, part 2. After 20260827090000 the production audit went 83 → 10.
-- Seven of those ten are closed here.
--
-- The first pass held back 9 tables as "children would block the cascade". That
-- classification was too crude, and re-reading the actual relations shows why:
--
--   * a back-relation (Ticket[] on ticket_categories, users.taskCollaborations)
--     declares no foreign key at all — the key lives on the other side, so it
--     cannot block anything;
--   * an OPTIONAL relation (channel_messages.channelConfig,
--     kb_articles.category) defaults to SET NULL in Prisma, which nulls the
--     column rather than refusing the delete.
--
-- Only a REQUIRED relation with no onDelete becomes RESTRICT, and exactly two
-- of those exist: pricing_profile_categories.category and
-- pricing_profiles.group. Those two remain open — turning them into a cascade
-- would mean deleting a pricing group also deletes its profiles, which is a
-- product decision about pricing, not a fix for tenant deletion.
--
-- compliance_audit_log stays out by design (ISMS-12 §2).
--
-- NOT VALID, same as part 1 and for the same reason: the keys govern everything
-- from now on and make no claim about rows that already exist. Pre-migration
-- debris is cleared separately, with the owner's approval, and the constraints
-- promoted with VALIDATE then.
--
-- RUNBOOK: a failed row wedges later deploys with P3009. This file is
-- idempotent, so recover with
--   npx prisma migrate resolve --rolled-back 20260827140000_tenant_delete_cascades_part2
-- and redeploy.

SET lock_timeout = '5s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'budget_lines',
    'channel_configs',
    'contract_redlines',
    'kb_categories',
    'project_tasks',
    'task_collaborators',
    'tickets'
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

RESET lock_timeout;
