-- Instant rollback: RLS off for this batch. No data movement.

DROP POLICY IF EXISTS tenant_isolation ON "abm_journey_enrollments";
ALTER TABLE "abm_journey_enrollments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "abm_journey_enrollments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "abm_journeys";
ALTER TABLE "abm_journeys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "abm_journeys" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "account_grade_config";
ALTER TABLE "account_grade_config" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_grade_config" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "account_intent_signals";
ALTER TABLE "account_intent_signals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_intent_signals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "account_score_snapshots";
ALTER TABLE "account_score_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_score_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "accounting_imports";
ALTER TABLE "accounting_imports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "accounting_imports" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "accounting_integrations";
ALTER TABLE "accounting_integrations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "accounting_integrations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "activities";
ALTER TABLE "activities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "activities" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ad_audience_syncs";
ALTER TABLE "ad_audience_syncs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ad_audience_syncs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ad_campaign_tracking";
ALTER TABLE "ad_campaign_tracking" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ad_campaign_tracking" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ad_providers";
ALTER TABLE "ad_providers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ad_providers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "additional_sales";
ALTER TABLE "additional_sales" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "additional_sales" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "advisor_playbooks";
ALTER TABLE "advisor_playbooks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "advisor_playbooks" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "advisor_signal_snapshots";
ALTER TABLE "advisor_signal_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "advisor_signal_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "agent_handoffs";
ALTER TABLE "agent_handoffs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_handoffs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "agent_sessions";
ALTER TABLE "agent_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_agent_configs";
ALTER TABLE "ai_agent_configs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_agent_configs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_alerts";
ALTER TABLE "ai_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_chat_sessions";
ALTER TABLE "ai_chat_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_chat_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_feedback";
ALTER TABLE "ai_feedback" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_feedback" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_guardrails";
ALTER TABLE "ai_guardrails" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_guardrails" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_interaction_logs";
ALTER TABLE "ai_interaction_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_interaction_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_pending_actions";
ALTER TABLE "ai_pending_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_pending_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_prediction_adjustments";
ALTER TABLE "ai_prediction_adjustments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_prediction_adjustments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_shadow_actions";
ALTER TABLE "ai_shadow_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_shadow_actions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "app_installations";
ALTER TABLE "app_installations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_installations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "applied_templates";
ALTER TABLE "applied_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "applied_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "attribution_calculation_runs";
ALTER TABLE "attribution_calculation_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "attribution_calculation_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "attribution_models";
ALTER TABLE "attribution_models" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "attribution_models" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
ALTER TABLE "audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "bank_accounts";
ALTER TABLE "bank_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "beneficiaries";
ALTER TABLE "beneficiaries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiaries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "bill_payments";
ALTER TABLE "bill_payments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "bill_payments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "bills";
ALTER TABLE "bills" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "bills" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "board_columns";
ALTER TABLE "board_columns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_columns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "board_permissions";
ALTER TABLE "board_permissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "board_permissions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_actuals";
ALTER TABLE "budget_actuals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_actuals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_approval_comments";
ALTER TABLE "budget_approval_comments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_approval_comments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_change_logs";
ALTER TABLE "budget_change_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_change_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_cost_types";
ALTER TABLE "budget_cost_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_cost_types" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_department_owners";
ALTER TABLE "budget_department_owners" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_department_owners" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_departments";
ALTER TABLE "budget_departments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_departments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_direction_templates";
ALTER TABLE "budget_direction_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_direction_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_forecast_entries";
ALTER TABLE "budget_forecast_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_forecast_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_lines";
ALTER TABLE "budget_lines" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_lines" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_plans";
ALTER TABLE "budget_plans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_plans" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_sections";
ALTER TABLE "budget_sections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget_sections" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "business_hours";
ALTER TABLE "business_hours" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "business_hours" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "buyer_accounts";
ALTER TABLE "buyer_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "buyer_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "buyer_orders";
ALTER TABLE "buyer_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "buyer_orders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "calculated_insight_defs";
ALTER TABLE "calculated_insight_defs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "calculated_insight_defs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "call_events";
ALTER TABLE "call_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "call_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "call_logs";
ALTER TABLE "call_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "call_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_influences";
ALTER TABLE "campaign_influences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "campaign_influences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_orchestration_runs";
ALTER TABLE "campaign_orchestration_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "campaign_orchestration_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaign_touchpoints";
ALTER TABLE "campaign_touchpoints" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "campaign_touchpoints" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "campaigns";
ALTER TABLE "campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "carts";
ALTER TABLE "carts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "carts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cash_flow_alerts";
ALTER TABLE "cash_flow_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cash_flow_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cash_flow_entries";
ALTER TABLE "cash_flow_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cash_flow_entries" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "channel_configs";
ALTER TABLE "channel_configs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_configs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "channel_connections";
ALTER TABLE "channel_connections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_connections" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "channel_messages";
ALTER TABLE "channel_messages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_messages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "channel_preferences";
ALTER TABLE "channel_preferences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_preferences" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "chatbot_rules";
ALTER TABLE "chatbot_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "chatbot_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "checkout_sessions";
ALTER TABLE "checkout_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "checkout_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "citizens";
ALTER TABLE "citizens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "citizens" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "claims";
ALTER TABLE "claims" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "claims" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "client_services";
ALTER TABLE "client_services" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_services" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cobrowse_sessions";
ALTER TABLE "cobrowse_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cobrowse_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "code_executions";
ALTER TABLE "code_executions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "code_executions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "code_modules";
ALTER TABLE "code_modules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "code_modules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "collector_runs";
ALTER TABLE "collector_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "collector_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "companies";
ALTER TABLE "companies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "companies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "complaint_meta";
ALTER TABLE "complaint_meta" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "complaint_meta" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "compliance_audit_log";
ALTER TABLE "compliance_audit_log" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audit_log" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contact_events";
ALTER TABLE "contact_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contact_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contact_segments";
ALTER TABLE "contact_segments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contact_segments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contacts";
ALTER TABLE "contacts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contacts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "content_scores";
ALTER TABLE "content_scores" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "content_scores" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_ai_extractions";
ALTER TABLE "contract_ai_extractions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_ai_extractions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_approval_escalation_events";
ALTER TABLE "contract_approval_escalation_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_approval_escalation_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_approval_rules";
ALTER TABLE "contract_approval_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_approval_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_approval_stages";
ALTER TABLE "contract_approval_stages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_approval_stages" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_clauses";
ALTER TABLE "contract_clauses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_clauses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_deviation_flags";
ALTER TABLE "contract_deviation_flags" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_deviation_flags" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_embeddings";
ALTER TABLE "contract_embeddings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_embeddings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_files";
ALTER TABLE "contract_files" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_files" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_intake_forms";
ALTER TABLE "contract_intake_forms" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_intake_forms" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_intake_submissions";
ALTER TABLE "contract_intake_submissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_intake_submissions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_milestones";
ALTER TABLE "contract_milestones" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_milestones" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_redlines";
ALTER TABLE "contract_redlines" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_redlines" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_renewal_alerts";
ALTER TABLE "contract_renewal_alerts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_renewal_alerts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_risk_scores";
ALTER TABLE "contract_risk_scores" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_risk_scores" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_tags";
ALTER TABLE "contract_tags" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_tags" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_templates";
ALTER TABLE "contract_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contract_versions";
ALTER TABLE "contract_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contract_versions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "contracts";
ALTER TABLE "contracts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "conversation_flow_runs";
ALTER TABLE "conversation_flow_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_flow_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "conversation_flows";
ALTER TABLE "conversation_flows" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_flows" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "conversation_notes";
ALTER TABLE "conversation_notes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_notes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "conversation_participants";
ALTER TABLE "conversation_participants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_participants" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cost_employees";
ALTER TABLE "cost_employees" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cost_employees" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cost_model_logs";
ALTER TABLE "cost_model_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cost_model_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cost_model_snapshots";
ALTER TABLE "cost_model_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "cost_model_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "currency_rate_history";
ALTER TABLE "currency_rate_history" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "currency_rate_history" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_domains";
ALTER TABLE "custom_domains" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custom_domains" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_field_values";
ALTER TABLE "custom_field_values" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "custom_fields";
ALTER TABLE "custom_fields" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custom_fields" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "customer_insights_snapshots";
ALTER TABLE "customer_insights_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_insights_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "dashboard_layouts";
ALTER TABLE "dashboard_layouts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_layouts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "data_cloud_segment_memberships";
ALTER TABLE "data_cloud_segment_memberships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_cloud_segment_memberships" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "data_cloud_segments";
ALTER TABLE "data_cloud_segments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_cloud_segments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "deal_velocity_metrics";
ALTER TABLE "deal_velocity_metrics" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "deal_velocity_metrics" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "deals";
ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "digest_subscriptions";
ALTER TABLE "digest_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "digest_subscriptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "discovery_auto_review_decisions";
ALTER TABLE "discovery_auto_review_decisions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_decisions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "discovery_auto_review_events";
ALTER TABLE "discovery_auto_review_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "discovery_auto_review_runs";
ALTER TABLE "discovery_auto_review_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "discovery_auto_review_runs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "discovery_leads";
ALTER TABLE "discovery_leads" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "discovery_leads" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "divisions";
ALTER TABLE "divisions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "divisions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "donations";
ALTER TABLE "donations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "donations" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "donors";
ALTER TABLE "donors" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "donors" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "dunning_attempts";
ALTER TABLE "dunning_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "dunning_attempts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "education_academic_terms";
ALTER TABLE "education_academic_terms" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "education_academic_terms" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "education_courses";
ALTER TABLE "education_courses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "education_courses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "education_enrollments";
ALTER TABLE "education_enrollments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "education_enrollments" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "education_faculty";
ALTER TABLE "education_faculty" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "education_faculty" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "education_students";
ALTER TABLE "education_students" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "education_students" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "email_logs";
ALTER TABLE "email_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "email_templates";
ALTER TABLE "email_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlement_audit_events";
ALTER TABLE "entitlement_audit_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_audit_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlement_milestone_definitions";
ALTER TABLE "entitlement_milestone_definitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_milestone_definitions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlement_milestone_template_rules";
ALTER TABLE "entitlement_milestone_template_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_milestone_template_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlement_milestone_templates";
ALTER TABLE "entitlement_milestone_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_milestone_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlement_ticket_milestones";
ALTER TABLE "entitlement_ticket_milestones" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlement_ticket_milestones" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "entitlements";
ALTER TABLE "entitlements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "entitlements" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "escalation_rules";
ALTER TABLE "escalation_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "escalation_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "esign_audit_events";
ALTER TABLE "esign_audit_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "esign_audit_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "esign_envelopes";
ALTER TABLE "esign_envelopes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "esign_envelopes" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "esign_provider_configs";
ALTER TABLE "esign_provider_configs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "esign_provider_configs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "esign_signers";
ALTER TABLE "esign_signers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "esign_signers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_stream_dead_letters";
ALTER TABLE "event_stream_dead_letters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_stream_dead_letters" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_stream_delivery_attempts";
ALTER TABLE "event_stream_delivery_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_stream_delivery_attempts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_stream_events";
ALTER TABLE "event_stream_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_stream_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_stream_subscriptions";
ALTER TABLE "event_stream_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_stream_subscriptions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_streams";
ALTER TABLE "event_streams" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_streams" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "events";
ALTER TABLE "events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "expense_forecasts";
ALTER TABLE "expense_forecasts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "expense_forecasts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "field_permissions";
ALTER TABLE "field_permissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "field_permissions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "financial_accounts";
ALTER TABLE "financial_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_accounts" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "financial_goals";
ALTER TABLE "financial_goals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_goals" DISABLE ROW LEVEL SECURITY;
