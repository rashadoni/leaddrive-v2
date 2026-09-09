-- Trusted cross-tenant jobs use app.rls_bypass=on. PR3-PR6 originally created
-- tenant-only policies, which made background workers see zero rows under FORCE
-- RLS. Preserve tenant isolation while adding the explicit maintenance branch.

DO $rls$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'monitoring_subjects', 'monitoring_subject_aliases',
    'monitoring_subject_relations', 'monitoring_subject_sources',
    'social_reply_identities', 'social_mention_subject_matches',
    'visual_references', 'discovery_leads', 'media_observations',
    'media_signals', 'media_processing_runs', 'media_processing_policies',
    'social_legal_candidates', 'social_legal_evidences', 'social_legal_events',
    'social_legal_actions', 'social_legal_approvals', 'social_legal_policies',
    'manual_engagement_tasks', 'social_outbound_policies',
    'outbound_social_replies'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'') WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) OR current_setting(''app.rls_bypass'', true) = ''on'')',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $rls$;

DROP POLICY IF EXISTS "outbound_social_reply_approvals_tenant_select" ON "outbound_social_reply_approvals";
DROP POLICY IF EXISTS "outbound_social_reply_approvals_tenant_insert" ON "outbound_social_reply_approvals";
CREATE POLICY "outbound_social_reply_approvals_tenant_select" ON "outbound_social_reply_approvals"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "outbound_social_reply_approvals_tenant_insert" ON "outbound_social_reply_approvals"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS "outbound_social_reply_events_tenant_select" ON "outbound_social_reply_events";
DROP POLICY IF EXISTS "outbound_social_reply_events_tenant_insert" ON "outbound_social_reply_events";
CREATE POLICY "outbound_social_reply_events_tenant_select" ON "outbound_social_reply_events"
  FOR SELECT USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
CREATE POLICY "outbound_social_reply_events_tenant_insert" ON "outbound_social_reply_events"
  FOR INSERT WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
