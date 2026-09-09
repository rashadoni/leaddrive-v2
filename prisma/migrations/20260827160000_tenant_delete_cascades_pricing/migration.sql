-- F-24, last part. Production went 83 → 10 → 3; this closes two of the three.
--
-- The two pricing tables were held back as needing a product decision: giving
-- pricing_categories / pricing_groups a cascade from organizations meant their
-- children's RESTRICT would refuse the delete, and turning THAT into a cascade
-- would mean deleting a pricing group also deletes its profiles. That is a
-- decision about pricing, not about tenant deletion, so it was left alone.
--
-- It turns out no such decision is needed. RESTRICT is checked immediately;
-- NO ACTION is checked at the end of the statement. Both children already carry
-- their own organizationId cascade (migration ...090000), so during a tenant
-- purge they are deleted in the same statement — with NO ACTION there is simply
-- nothing left to violate by the time the check runs.
--
-- Deleting a pricing group directly is still refused, exactly as before. Only
-- the ordering inside a cascade changes. The product behaviour is untouched,
-- which is why this needs no decision from anyone.
--
-- NOT VALID on the new organizations keys, consistent with the earlier parts:
-- they govern what comes after and claim nothing about existing rows.
--
-- RUNBOOK: a failed row wedges later deploys with P3009. Idempotent, so:
--   npx prisma migrate resolve --rolled-back 20260827160000_tenant_delete_cascades_pricing
-- then redeploy.

SET lock_timeout = '5s';

-- 1. Defer the child checks.
ALTER TABLE pricing_profile_categories
  DROP CONSTRAINT IF EXISTS "pricing_profile_categories_categoryId_fkey";
ALTER TABLE pricing_profile_categories
  ADD CONSTRAINT "pricing_profile_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES pricing_categories(id)
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE pricing_profiles
  DROP CONSTRAINT IF EXISTS "pricing_profiles_groupId_fkey";
ALTER TABLE pricing_profiles
  ADD CONSTRAINT "pricing_profiles_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES pricing_groups(id)
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 2. Now the parents can join the tenant cascade.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pricing_categories', 'pricing_groups']
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
