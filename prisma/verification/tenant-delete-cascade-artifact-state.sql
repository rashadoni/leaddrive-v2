-- Aggregate-only structural state for the 73 tenant cascade keys installed by
-- 20260827090000_tenant_delete_cascades. This reads PostgreSQL catalogs only;
-- it never selects tenant rows or emits table, constraint, row, or tenant IDs.
--
-- Output fields:
--   target count | complete metadata count | exact key count |
--   incompatible target count | exact keys still NOT VALID

WITH targets(table_name) AS (
  SELECT unnest(ARRAY[
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
  ]::text[])
), organization_key AS (
  SELECT r.oid AS relation_id, a.attnum AS id_attnum
    FROM pg_class r
    JOIN pg_namespace n
      ON n.oid = r.relnamespace
     AND n.nspname = 'public'
    JOIN pg_attribute a
      ON a.attrelid = r.oid
     AND a.attname = 'id'
     AND a.attnum > 0
     AND NOT a.attisdropped
   WHERE r.relname = 'organizations'
), target_metadata AS (
  SELECT t.table_name,
         r.oid AS relation_id,
         a.attnum AS organization_attnum,
         o.relation_id AS organization_relation_id,
         o.id_attnum,
         t.table_name || '_organizationId_fkey' AS expected_name
    FROM targets t
    LEFT JOIN pg_namespace n
      ON n.nspname = 'public'
    LEFT JOIN pg_class r
      ON r.relnamespace = n.oid
     AND r.relname = t.table_name
     AND r.relkind IN ('r', 'p')
    LEFT JOIN pg_attribute a
      ON a.attrelid = r.oid
     AND a.attname = 'organizationId'
     AND a.attnum > 0
     AND NOT a.attisdropped
    LEFT JOIN organization_key o ON true
), classified AS (
  SELECT m.*,
         (
           SELECT count(*)
             FROM pg_constraint c
            WHERE c.conrelid = m.relation_id
              AND c.contype = 'f'
              AND c.conname = m.expected_name
              AND c.confrelid = m.organization_relation_id
              AND c.conkey = ARRAY[m.organization_attnum]::smallint[]
              AND c.confkey = ARRAY[m.id_attnum]::smallint[]
              AND c.confdeltype = 'c'
              AND c.confupdtype = 'c'
              AND c.confmatchtype = 's'
              AND NOT c.condeferrable
              AND NOT c.condeferred
              AND (
                SELECT count(*) = 4
                   AND count(*) FILTER (
                     WHERE tr.tgisinternal
                       AND tr.tgenabled IN ('O', 'A')
                       AND p.proname::text = ANY (ARRAY[
                         'RI_FKey_check_ins',
                         'RI_FKey_check_upd',
                         'RI_FKey_cascade_del',
                         'RI_FKey_cascade_upd'
                       ]::text[])
                   ) = 4
                   AND count(DISTINCT p.proname) = 4
                  FROM pg_trigger tr
                  JOIN pg_proc p ON p.oid = tr.tgfoid
                 WHERE tr.tgconstraint = c.oid
              )
         ) AS exact_count,
         (
           SELECT count(*)
             FROM pg_constraint c
            WHERE c.conrelid = m.relation_id
              AND (
                c.conname = m.expected_name
                OR (
                  c.contype = 'f'
                  AND m.organization_attnum = ANY (c.conkey)
                )
              )
         ) AS candidate_count,
         (
           SELECT count(*)
             FROM pg_constraint c
            WHERE c.conrelid = m.relation_id
              AND c.contype = 'f'
              AND c.conname = m.expected_name
              AND c.confrelid = m.organization_relation_id
              AND c.conkey = ARRAY[m.organization_attnum]::smallint[]
              AND c.confkey = ARRAY[m.id_attnum]::smallint[]
              AND c.confdeltype = 'c'
              AND c.confupdtype = 'c'
              AND c.confmatchtype = 's'
              AND NOT c.condeferrable
              AND NOT c.condeferred
              AND (
                SELECT count(*) = 4
                   AND count(*) FILTER (
                     WHERE tr.tgisinternal
                       AND tr.tgenabled IN ('O', 'A')
                       AND p.proname::text = ANY (ARRAY[
                         'RI_FKey_check_ins',
                         'RI_FKey_check_upd',
                         'RI_FKey_cascade_del',
                         'RI_FKey_cascade_upd'
                       ]::text[])
                   ) = 4
                   AND count(DISTINCT p.proname) = 4
                  FROM pg_trigger tr
                  JOIN pg_proc p ON p.oid = tr.tgfoid
                 WHERE tr.tgconstraint = c.oid
              )
              AND NOT c.convalidated
         ) AS unvalidated_count
    FROM target_metadata m
)
SELECT count(*)::text,
       count(*) FILTER (
         WHERE relation_id IS NOT NULL
           AND organization_attnum IS NOT NULL
           AND organization_relation_id IS NOT NULL
           AND id_attnum IS NOT NULL
       )::text,
       coalesce(sum(exact_count), 0)::text,
       count(*) FILTER (
         WHERE candidate_count <> exact_count
            OR exact_count > 1
       )::text,
       coalesce(sum(unvalidated_count), 0)::text
  FROM classified;
