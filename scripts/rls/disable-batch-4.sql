-- Instant rollback: RLS off for this batch. No data movement.

DROP POLICY IF EXISTS tenant_isolation ON "order_shipments";
ALTER TABLE "order_shipments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_shipments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "outages";
ALTER TABLE "outages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "outages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "outbound_social_replies";
ALTER TABLE "outbound_social_replies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbound_social_replies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "outbound_social_reply_approvals";
ALTER TABLE "outbound_social_reply_approvals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbound_social_reply_approvals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "outbound_social_reply_events";
ALTER TABLE "outbound_social_reply_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbound_social_reply_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "overhead_costs";
ALTER TABLE "overhead_costs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "overhead_costs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_intents";
ALTER TABLE "payment_intents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_intents" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_orders";
ALTER TABLE "payment_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_orders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_providers";
ALTER TABLE "payment_providers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_providers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_refunds";
ALTER TABLE "payment_refunds" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_refunds" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_registry_entries";
ALTER TABLE "payment_registry_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_registry_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "payment_webhook_events";
ALTER TABLE "payment_webhook_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_webhook_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "performance_obligations";
ALTER TABLE "performance_obligations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "performance_obligations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "personalization_decisions";
ALTER TABLE "personalization_decisions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "personalization_decisions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "personalization_experiences";
ALTER TABLE "personalization_experiences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "personalization_experiences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "personalization_variants";
ALTER TABLE "personalization_variants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "personalization_variants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pipeline_stage_transitions";
ALTER TABLE "pipeline_stage_transitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stage_transitions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pipeline_stages";
ALTER TABLE "pipeline_stages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pipelines";
ALTER TABLE "pipelines" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "plan_requests";
ALTER TABLE "plan_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "plan_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "platform_event_definitions";
ALTER TABLE "platform_event_definitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_event_definitions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "platform_event_logs";
ALTER TABLE "platform_event_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_event_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "policies";
ALTER TABLE "policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "policy_holders";
ALTER TABLE "policy_holders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "policy_holders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "prediction_models";
ALTER TABLE "prediction_models" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "prediction_models" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "prediction_runs";
ALTER TABLE "prediction_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "prediction_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_categories";
ALTER TABLE "pricing_categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_categories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_groups";
ALTER TABLE "pricing_groups" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_groups" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_parameters";
ALTER TABLE "pricing_parameters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_parameters" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_profile_categories";
ALTER TABLE "pricing_profile_categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_profile_categories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_profiles";
ALTER TABLE "pricing_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_profiles" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "pricing_services";
ALTER TABLE "pricing_services" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pricing_services" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "proactive_alerts";
ALTER TABLE "proactive_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "proactive_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "products";
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "profile_insights";
ALTER TABLE "profile_insights" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "profile_insights" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "profile_merge_candidates";
ALTER TABLE "profile_merge_candidates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "profile_merge_candidates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "profile_sources";
ALTER TABLE "profile_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "profile_sources" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "programs";
ALTER TABLE "programs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "programs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "project_members";
ALTER TABLE "project_members" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_members" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "project_milestones";
ALTER TABLE "project_milestones" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_milestones" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "project_tasks";
ALTER TABLE "project_tasks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_tasks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "projects";
ALTER TABLE "projects" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "promo_code_redemptions";
ALTER TABLE "promo_code_redemptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "promo_code_redemptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "promo_codes";
ALTER TABLE "promo_codes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "promo_codes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "public_sector_cases";
ALTER TABLE "public_sector_cases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public_sector_cases" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "public_sector_grants";
ALTER TABLE "public_sector_grants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public_sector_grants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "public_sector_licenses";
ALTER TABLE "public_sector_licenses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public_sector_licenses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "public_sector_officials";
ALTER TABLE "public_sector_officials" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public_sector_officials" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "push_subscriptions";
ALTER TABLE "push_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "quotes";
ALTER TABLE "quotes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "record_embeddings";
ALTER TABLE "record_embeddings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "record_embeddings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "recurring_invoices";
ALTER TABLE "recurring_invoices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recurring_invoices" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "rejected_observation_fingerprints";
ALTER TABLE "rejected_observation_fingerprints" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rejected_observation_fingerprints" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "reply_policies";
ALTER TABLE "reply_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reply_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "request_for_quotes";
ALTER TABLE "request_for_quotes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "request_for_quotes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "retail_execution_audits";
ALTER TABLE "retail_execution_audits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "retail_execution_audits" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "revenue_recognition_entries";
ALTER TABLE "revenue_recognition_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "revenue_recognition_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "revenue_recognition_schedules";
ALTER TABLE "revenue_recognition_schedules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "revenue_recognition_schedules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "rolling_forecast_months";
ALTER TABLE "rolling_forecast_months" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rolling_forecast_months" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "rollup_fields";
ALTER TABLE "rollup_fields" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rollup_fields" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "rollup_values";
ALTER TABLE "rollup_values" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rollup_values" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sales_forecasts";
ALTER TABLE "sales_forecasts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sales_forecasts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sales_quotas";
ALTER TABLE "sales_quotas" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sales_quotas" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sales_sequences";
ALTER TABLE "sales_sequences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sales_sequences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "saved_reports";
ALTER TABLE "saved_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "saved_reports" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "saved_views";
ALTER TABLE "saved_views" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "saved_views" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "scheduled_actions";
ALTER TABLE "scheduled_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "segment_activation_runs";
ALTER TABLE "segment_activation_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "segment_activation_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "segment_activations";
ALTER TABLE "segment_activations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "segment_activations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sequence_enrollments";
ALTER TABLE "sequence_enrollments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sequence_enrollments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sequence_steps";
ALTER TABLE "sequence_steps" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sequence_steps" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "service_calls";
ALTER TABLE "service_calls" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_calls" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sharing_rules";
ALTER TABLE "sharing_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sharing_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_accounts";
ALTER TABLE "social_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_comment_checkpoints";
ALTER TABLE "social_comment_checkpoints" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_comment_checkpoints" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_connection_cursors";
ALTER TABLE "social_connection_cursors" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_connection_cursors" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_conversations";
ALTER TABLE "social_conversations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_conversations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_deletion_ledger_entries";
ALTER TABLE "social_deletion_ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_deletion_ledger_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_actions";
ALTER TABLE "social_legal_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_approvals";
ALTER TABLE "social_legal_approvals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_approvals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_candidates";
ALTER TABLE "social_legal_candidates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_candidates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_cases";
ALTER TABLE "social_legal_cases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_cases" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_events";
ALTER TABLE "social_legal_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_evidences";
ALTER TABLE "social_legal_evidences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_evidences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_policies";
ALTER TABLE "social_legal_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_legal_reports";
ALTER TABLE "social_legal_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_legal_reports" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_mention_ai_drafts";
ALTER TABLE "social_mention_ai_drafts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_ai_drafts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_mention_subject_matches";
ALTER TABLE "social_mention_subject_matches" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_subject_matches" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_mention_versions";
ALTER TABLE "social_mention_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_versions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_mentions";
ALTER TABLE "social_mentions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_mentions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_metric_snapshots";
ALTER TABLE "social_metric_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_metric_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_monitoring_run_job_items";
ALTER TABLE "social_monitoring_run_job_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_job_items" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_monitoring_run_jobs";
ALTER TABLE "social_monitoring_run_jobs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_monitoring_run_jobs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_outbound_policies";
ALTER TABLE "social_outbound_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_outbound_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_provider_capability_proofs";
ALTER TABLE "social_provider_capability_proofs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_provider_capability_proofs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_provider_runs";
ALTER TABLE "social_provider_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_provider_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_relevance_feedback";
ALTER TABLE "social_relevance_feedback" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_relevance_feedback" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_reply_channel_settings";
ALTER TABLE "social_reply_channel_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_reply_channel_settings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_reply_identities";
ALTER TABLE "social_reply_identities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_reply_identities" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "source_route_plans";
ALTER TABLE "source_route_plans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "source_route_plans" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "stage_validation_rules";
ALTER TABLE "stage_validation_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stage_validation_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "stock_movements";
ALTER TABLE "stock_movements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "storefronts";
ALTER TABLE "storefronts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "storefronts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subscription_events";
ALTER TABLE "subscription_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscription_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subscription_plans";
ALTER TABLE "subscription_plans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscription_plans" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";
ALTER TABLE "subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "survey_responses";
ALTER TABLE "survey_responses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "survey_responses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "survey_unsubscribes";
ALTER TABLE "survey_unsubscribes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "survey_unsubscribes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "surveys";
ALTER TABLE "surveys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "surveys" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_activities";
ALTER TABLE "task_activities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_activities" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_attachments";
ALTER TABLE "task_attachments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_attachments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_checklists";
ALTER TABLE "task_checklists" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_checklists" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_collaborators";
ALTER TABLE "task_collaborators" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_collaborators" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_comments";
ALTER TABLE "task_comments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_comments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tasks";
ALTER TABLE "tasks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "team_queues";
ALTER TABLE "team_queues" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "team_queues" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "template_distributions";
ALTER TABLE "template_distributions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "template_distributions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "template_personalizations";
ALTER TABLE "template_personalizations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "template_personalizations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "template_send_records";
ALTER TABLE "template_send_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "template_send_records" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenant_master_keys";
ALTER TABLE "tenant_master_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_master_keys" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenant_provider_entitlements";
ALTER TABLE "tenant_provider_entitlements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_provider_entitlements" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenant_provisioning_runs";
ALTER TABLE "tenant_provisioning_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_provisioning_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenant_provisioning_steps";
ALTER TABLE "tenant_provisioning_steps" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_provisioning_steps" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "territories";
ALTER TABLE "territories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "territories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_categories";
ALTER TABLE "ticket_categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_categories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_closure_requests";
ALTER TABLE "ticket_closure_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_closure_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_macros";
ALTER TABLE "ticket_macros" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_macros" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ticket_queues";
ALTER TABLE "ticket_queues" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_queues" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tickets";
ALTER TABLE "tickets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tickets" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tiktok_publication_revisits";
ALTER TABLE "tiktok_publication_revisits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_publication_revisits" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "trade_promotions";
ALTER TABLE "trade_promotions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trade_promotions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "trade_spends";
ALTER TABLE "trade_spends" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trade_spends" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "unified_profiles";
ALTER TABLE "unified_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "unified_profiles" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "user_approval_delegates";
ALTER TABLE "user_approval_delegates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_approval_delegates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "user_preferences";
ALTER TABLE "user_preferences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "utility_customers";
ALTER TABLE "utility_customers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "utility_customers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "visual_references";
ALTER TABLE "visual_references" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "visual_references" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "volunteer_activities";
ALTER TABLE "volunteer_activities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "volunteer_activities" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "warehouses";
ALTER TABLE "warehouses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_actions";
ALTER TABLE "web_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_chat_messages";
ALTER TABLE "web_chat_messages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_chat_messages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_chat_sessions";
ALTER TABLE "web_chat_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_chat_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_chat_widgets";
ALTER TABLE "web_chat_widgets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_chat_widgets" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_sessions";
ALTER TABLE "web_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "web_tracking_configs";
ALTER TABLE "web_tracking_configs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "web_tracking_configs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "webhooks";
ALTER TABLE "webhooks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_call_permissions";
ALTER TABLE "whatsapp_call_permissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_call_permissions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_templates";
ALTER TABLE "whatsapp_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "workflow_rules";
ALTER TABLE "workflow_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_rules" DISABLE ROW LEVEL SECURITY;
