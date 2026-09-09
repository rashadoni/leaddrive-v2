-- Instant rollback: RLS off for this batch. No data movement.

DROP POLICY IF EXISTS tenant_isolation ON "financial_household_members";
ALTER TABLE "financial_household_members" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_household_members" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "financial_households";
ALTER TABLE "financial_households" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_households" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "financial_life_events";
ALTER TABLE "financial_life_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_life_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "forecast_accuracy_reports";
ALTER TABLE "forecast_accuracy_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "forecast_accuracy_reports" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "forecast_snapshots";
ALTER TABLE "forecast_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "forecast_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "form_definitions";
ALTER TABLE "form_definitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "form_submissions";
ALTER TABLE "form_submissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_submissions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "formula_validation_rules";
ALTER TABLE "formula_validation_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "formula_validation_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "fund_rules";
ALTER TABLE "fund_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fund_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "fund_transactions";
ALTER TABLE "fund_transactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fund_transactions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "funds";
ALTER TABLE "funds" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "funds" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "grants";
ALTER TABLE "grants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "grants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_care_plans";
ALTER TABLE "health_care_plans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_care_plans" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_encounters";
ALTER TABLE "health_encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_encounters" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_medical_records";
ALTER TABLE "health_medical_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_medical_records" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_patients";
ALTER TABLE "health_patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_patients" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_providers";
ALTER TABLE "health_providers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_providers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "health_scores";
ALTER TABLE "health_scores" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_scores" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "inbox_customer_stage_events";
ALTER TABLE "inbox_customer_stage_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbox_customer_stage_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "inbox_folders";
ALTER TABLE "inbox_folders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbox_folders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ingest_envelopes";
ALTER TABLE "ingest_envelopes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ingest_envelopes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "insurance_rating_config";
ALTER TABLE "insurance_rating_config" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "insurance_rating_config" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "insurance_service_team_members";
ALTER TABLE "insurance_service_team_members" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "insurance_service_team_members" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "intent_signal_config";
ALTER TABLE "intent_signal_config" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "intent_signal_config" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "inventory_items";
ALTER TABLE "inventory_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "invoice_payments";
ALTER TABLE "invoice_payments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "invoices";
ALTER TABLE "invoices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "journey_enrollments";
ALTER TABLE "journey_enrollments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "journey_enrollments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "journeys";
ALTER TABLE "journeys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "journeys" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "kb_articles";
ALTER TABLE "kb_articles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "kb_articles" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "kb_categories";
ALTER TABLE "kb_categories" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "kb_categories" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "kb_embeddings";
ALTER TABLE "kb_embeddings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "kb_embeddings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "landing_pages";
ALTER TABLE "landing_pages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "landing_pages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lead_assignment_rules";
ALTER TABLE "lead_assignment_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lead_assignment_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "leaderboard_config";
ALTER TABLE "leaderboard_config" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leaderboard_config" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "leaderboard_snapshots";
ALTER TABLE "leaderboard_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leaderboard_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "leads";
ALTER TABLE "leads" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lightning_page_assignments";
ALTER TABLE "lightning_page_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lightning_page_assignments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lightning_page_regions";
ALTER TABLE "lightning_page_regions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lightning_page_regions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lightning_page_widgets";
ALTER TABLE "lightning_page_widgets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lightning_page_widgets" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lightning_pages";
ALTER TABLE "lightning_pages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lightning_pages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "low_stock_alerts";
ALTER TABLE "low_stock_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "low_stock_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_accounts";
ALTER TABLE "loyalty_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_earn_rules";
ALTER TABLE "loyalty_earn_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_earn_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_redemptions";
ALTER TABLE "loyalty_redemptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_redemptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_rewards";
ALTER TABLE "loyalty_rewards" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_rewards" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_tiers";
ALTER TABLE "loyalty_tiers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_tiers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "loyalty_transactions";
ALTER TABLE "loyalty_transactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_transactions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "manual_engagement_tasks";
ALTER TABLE "manual_engagement_tasks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "manual_engagement_tasks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "marketing_accounts";
ALTER TABLE "marketing_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketing_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "marketing_templates";
ALTER TABLE "marketing_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketing_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_ad_campaigns";
ALTER TABLE "media_ad_campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_ad_campaigns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_ad_placements";
ALTER TABLE "media_ad_placements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_ad_placements" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_consumption_events";
ALTER TABLE "media_consumption_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_consumption_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_content_inventory";
ALTER TABLE "media_content_inventory" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_content_inventory" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_observations";
ALTER TABLE "media_observations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_observations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_pacing_config";
ALTER TABLE "media_pacing_config" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_pacing_config" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_processing_policies";
ALTER TABLE "media_processing_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_processing_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_processing_runs";
ALTER TABLE "media_processing_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_processing_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_signals";
ALTER TABLE "media_signals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_signals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "media_subscribers";
ALTER TABLE "media_subscribers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_subscribers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mention_clusters";
ALTER TABLE "mention_clusters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mention_clusters" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mention_evidence";
ALTER TABLE "mention_evidence" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mention_evidence" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "message_snippets";
ALTER TABLE "message_snippets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "message_snippets" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "meter_readings";
ALTER TABLE "meter_readings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "meter_readings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "metering_points";
ALTER TABLE "metering_points" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "metering_points" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mobile_campaign_deliveries";
ALTER TABLE "mobile_campaign_deliveries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_campaign_deliveries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mobile_campaigns";
ALTER TABLE "mobile_campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_campaigns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mobile_message_templates";
ALTER TABLE "mobile_message_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_message_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_sources";
ALTER TABLE "monitoring_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_sources" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_subject_aliases";
ALTER TABLE "monitoring_subject_aliases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_aliases" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_subject_relations";
ALTER TABLE "monitoring_subject_relations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_relations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_subject_sources";
ALTER TABLE "monitoring_subject_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subject_sources" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_subjects";
ALTER TABLE "monitoring_subjects" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_subjects" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_locations";
ALTER TABLE "mtm_agent_locations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_locations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workday_events";
ALTER TABLE "mtm_agent_workday_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workday_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workdays";
ALTER TABLE "mtm_agent_workdays" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workdays" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_agents";
ALTER TABLE "mtm_agents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agents" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_alerts";
ALTER TABLE "mtm_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_audit_logs";
ALTER TABLE "mtm_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_audit_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_commitment_fulfillments";
ALTER TABLE "mtm_commitment_fulfillments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitment_fulfillments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_commitments";
ALTER TABLE "mtm_commitments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_agent_assignments";
ALTER TABLE "mtm_contact_agent_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_agent_assignments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_assignment_operations";
ALTER TABLE "mtm_contact_assignment_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_assignment_operations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_change_requests";
ALTER TABLE "mtm_contact_change_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_change_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_transfer_operations";
ALTER TABLE "mtm_contact_transfer_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_transfer_operations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_workplaces";
ALTER TABLE "mtm_contact_workplaces" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_workplaces" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_contacts";
ALTER TABLE "mtm_contacts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contacts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_customer_agent_assignments";
ALTER TABLE "mtm_customer_agent_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_agent_assignments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_customer_create_requests";
ALTER TABLE "mtm_customer_create_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_create_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_customers";
ALTER TABLE "mtm_customers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_doctor_assessments";
ALTER TABLE "mtm_doctor_assessments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_doctor_assessments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_doctor_scoring_formulas";
ALTER TABLE "mtm_doctor_scoring_formulas" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_doctor_scoring_formulas" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_document_assignments";
ALTER TABLE "mtm_document_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_document_assignments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_documents";
ALTER TABLE "mtm_documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_documents" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_external_sales_documents";
ALTER TABLE "mtm_external_sales_documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_external_sales_documents" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_external_sales_lines";
ALTER TABLE "mtm_external_sales_lines" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_external_sales_lines" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_field_potential_evidence";
ALTER TABLE "mtm_field_potential_evidence" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_field_potential_evidence" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_field_potentials";
ALTER TABLE "mtm_field_potentials" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_field_potentials" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_hrm_requests";
ALTER TABLE "mtm_hrm_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_hrm_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_import_jobs";
ALTER TABLE "mtm_import_jobs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_import_jobs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_import_row_errors";
ALTER TABLE "mtm_import_row_errors" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_import_row_errors" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_participants";
ALTER TABLE "mtm_message_participants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_participants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_receipts";
ALTER TABLE "mtm_message_receipts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_receipts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_threads";
ALTER TABLE "mtm_message_threads" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_threads" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_messages";
ALTER TABLE "mtm_messages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_messages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_notifications";
ALTER TABLE "mtm_notifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_notifications" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_onboarding";
ALTER TABLE "mtm_onboarding" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_onboarding" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_organization_assignment_operations";
ALTER TABLE "mtm_organization_assignment_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_organization_assignment_operations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_approval_policies";
ALTER TABLE "mtm_pharmacy_approval_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_approval_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_points_formulas";
ALTER TABLE "mtm_pharmacy_points_formulas" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_formulas" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_points_ledger_entries";
ALTER TABLE "mtm_pharmacy_points_ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_points_ledger_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_events";
ALTER TABLE "mtm_pharmacy_promotion_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_evidence";
ALTER TABLE "mtm_pharmacy_promotion_evidence" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_evidence" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_executions";
ALTER TABLE "mtm_pharmacy_promotion_executions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_executions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_operations";
ALTER TABLE "mtm_pharmacy_promotion_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_operations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_reviews";
ALTER TABLE "mtm_pharmacy_promotion_reviews" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_reviews" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_targets";
ALTER TABLE "mtm_pharmacy_promotion_targets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_targets" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_types";
ALTER TABLE "mtm_pharmacy_promotion_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_types" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotion_versions";
ALTER TABLE "mtm_pharmacy_promotion_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotion_versions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_promotions";
ALTER TABLE "mtm_pharmacy_promotions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_promotions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_reward_claims";
ALTER TABLE "mtm_pharmacy_reward_claims" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_reward_claims" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_pharmacy_rewards";
ALTER TABLE "mtm_pharmacy_rewards" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_pharmacy_rewards" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_photos";
ALTER TABLE "mtm_photos" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_photos" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_regions";
ALTER TABLE "mtm_regions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_regions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_assignments";
ALTER TABLE "mtm_route_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_assignments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_change_requests";
ALTER TABLE "mtm_route_change_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_change_requests" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_points";
ALTER TABLE "mtm_route_points" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_points" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_routes";
ALTER TABLE "mtm_routes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_routes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_sales_plan_lines";
ALTER TABLE "mtm_sales_plan_lines" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_sales_plan_lines" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_settings";
ALTER TABLE "mtm_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_settings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_sync_operations";
ALTER TABLE "mtm_sync_operations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_sync_operations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_task_events";
ALTER TABLE "mtm_task_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_task_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_tasks";
ALTER TABLE "mtm_tasks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_tasks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_teams";
ALTER TABLE "mtm_teams" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_teams" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_action_results";
ALTER TABLE "mtm_visit_action_results" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_action_results" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_participants";
ALTER TABLE "mtm_visit_participants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_participants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_policies";
ALTER TABLE "mtm_visit_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_policy_actions";
ALTER TABLE "mtm_visit_policy_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_policy_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_requirement_snapshots";
ALTER TABLE "mtm_visit_requirement_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_requirement_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_requirements";
ALTER TABLE "mtm_visit_requirements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_requirements" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_visits";
ALTER TABLE "mtm_visits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visits" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "mtm_work_calendar_days";
ALTER TABLE "mtm_work_calendar_days" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mtm_work_calendar_days" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "named_credentials";
ALTER TABLE "named_credentials" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "named_credentials" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "notifications";
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "offers";
ALTER TABLE "offers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "offers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "omni_studio_flex_cards";
ALTER TABLE "omni_studio_flex_cards" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "omni_studio_flex_cards" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "omni_studio_omni_scripts";
ALTER TABLE "omni_studio_omni_scripts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "omni_studio_omni_scripts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "omni_studio_run_sessions";
ALTER TABLE "omni_studio_run_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "omni_studio_run_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "orchestrated_deliveries";
ALTER TABLE "orchestrated_deliveries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orchestrated_deliveries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "orchestration_policies";
ALTER TABLE "orchestration_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orchestration_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "order_returns";
ALTER TABLE "order_returns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_returns" DISABLE ROW LEVEL SECURITY;
