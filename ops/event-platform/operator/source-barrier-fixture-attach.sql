-- TEST/STAGING INSTALLATION CONTRACT ONLY. Not a migration/runtime bootstrap.
-- Separate trusted table-owner installation after kernel. No production use.
BEGIN;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['funds','fund_transactions','domain_events','event_outbox','event_aggregate_heads','fund_balance_projections'] LOOP
 EXECUTE format('CREATE TRIGGER kafka_source_row_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION ld_kafka_operator.source_write_guard()',table_name);
 EXECUTE format('CREATE TRIGGER kafka_source_truncate_guard BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION ld_kafka_operator.source_write_guard()',table_name);
 EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER kafka_source_row_guard',table_name);
 EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER kafka_source_truncate_guard',table_name);
 END LOOP;
END $$;
COMMIT;
