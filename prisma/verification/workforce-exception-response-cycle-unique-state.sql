-- Aggregate-only global precondition and catalog/ledger postcondition for
-- 20260928123000_workforce_exception_response_cycle_unique_index.
--
-- The caller must use the validated migration role inside a REPEATABLE READ,
-- READ ONLY transaction with row_security=off and bounded local resources.
-- No tenant, case, response, employee or operation identifier is emitted.
--
-- Output fields:
--   duplicate groups | duplicate rows | excess rows | legacy NULL rows |
--   exact successful ledger rows | any successful ledger rows |
--   unresolved ledger rows | exact unresolved 23505 rows |
--   named index artifacts | exact ready indexes | exact invalid indexes |
--   incompatible named artifacts

WITH grouped_cycles AS (
  SELECT "organizationId", "caseId", "observedCaseRevision", COUNT(*)::bigint AS response_count
    FROM "workforce_exception_employee_responses"
   GROUP BY "organizationId", "caseId", "observedCaseRevision"
), duplicate_cycles AS (
  SELECT response_count
    FROM grouped_cycles
   WHERE "observedCaseRevision" IS NOT NULL
     AND response_count > 1
), response_counts AS (
  SELECT COUNT(*)::bigint AS duplicate_groups,
         COALESCE(SUM(response_count), 0)::bigint AS duplicate_rows,
         COALESCE(SUM(response_count - 1), 0)::bigint AS excess_rows,
         (SELECT COALESCE(SUM(response_count), 0)::bigint
            FROM grouped_cycles
           WHERE "observedCaseRevision" IS NULL) AS legacy_null_rows
    FROM duplicate_cycles
), ledger AS (
  SELECT COUNT(*) FILTER (
           WHERE migration_name = '20260928123000_workforce_exception_response_cycle_unique_index'
             AND checksum = 'bc9c3346fd44151634990b9f7df93ccd4cd313384873029b3901d71608fe91f8'
             AND finished_at IS NOT NULL
             AND rolled_back_at IS NULL
         )::bigint AS exact_successful,
         COUNT(*) FILTER (
           WHERE migration_name = '20260928123000_workforce_exception_response_cycle_unique_index'
             AND finished_at IS NOT NULL
             AND rolled_back_at IS NULL
         )::bigint AS any_successful,
         COUNT(*) FILTER (
           WHERE migration_name = '20260928123000_workforce_exception_response_cycle_unique_index'
             AND finished_at IS NULL
             AND rolled_back_at IS NULL
         )::bigint AS unresolved,
         COUNT(*) FILTER (
           WHERE migration_name = '20260928123000_workforce_exception_response_cycle_unique_index'
             AND checksum = 'bc9c3346fd44151634990b9f7df93ccd4cd313384873029b3901d71608fe91f8'
             AND finished_at IS NULL
             AND rolled_back_at IS NULL
             AND COALESCE(logs, '') LIKE '%23505%'
             AND COALESCE(logs, '') LIKE '%workforce_exception_employee_responses_org_case_revision_key%'
         )::bigint AS exact_unresolved_23505
    FROM "_prisma_migrations"
), named_indexes AS (
  SELECT table_relation.relname AS table_name,
         index_state.indisunique,
         index_state.indisvalid,
         index_state.indisready,
         index_state.indnullsnotdistinct,
         index_state.indpred IS NULL AND index_state.indexprs IS NULL AS is_plain,
         ARRAY(
           SELECT attribute.attname
             FROM unnest(index_state.indkey::smallint[])
               WITH ORDINALITY AS indexed_column(attnum, ordinality)
             JOIN pg_attribute attribute
               ON attribute.attrelid = table_relation.oid
              AND attribute.attnum = indexed_column.attnum
            ORDER BY indexed_column.ordinality
         )::text[] AS columns
    FROM pg_index index_state
    JOIN pg_class index_relation ON index_relation.oid = index_state.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_state.indrelid
    JOIN pg_namespace namespace ON namespace.oid = index_relation.relnamespace
   WHERE namespace.nspname = current_schema()
     AND index_relation.relname = 'workforce_exception_employee_responses_org_case_revision_key'
), index_counts AS (
  SELECT COUNT(*)::bigint AS artifacts,
         COUNT(*) FILTER (
           WHERE table_name = 'workforce_exception_employee_responses'
             AND indisunique
             AND indisvalid
             AND indisready
             AND NOT indnullsnotdistinct
             AND is_plain
             AND columns = ARRAY['organizationId', 'caseId', 'observedCaseRevision']::text[]
         )::bigint AS exact_ready,
         COUNT(*) FILTER (
           WHERE table_name = 'workforce_exception_employee_responses'
             AND indisunique
             AND NOT indisvalid
             AND NOT indnullsnotdistinct
             AND is_plain
             AND columns = ARRAY['organizationId', 'caseId', 'observedCaseRevision']::text[]
         )::bigint AS exact_invalid,
         COUNT(*) FILTER (
           WHERE NOT (
             table_name = 'workforce_exception_employee_responses'
             AND indisunique
             AND NOT indnullsnotdistinct
             AND is_plain
             AND columns = ARRAY['organizationId', 'caseId', 'observedCaseRevision']::text[]
           )
         )::bigint AS incompatible
    FROM named_indexes
)
SELECT response_counts.duplicate_groups::text,
       response_counts.duplicate_rows::text,
       response_counts.excess_rows::text,
       response_counts.legacy_null_rows::text,
       ledger.exact_successful::text,
       ledger.any_successful::text,
       ledger.unresolved::text,
       ledger.exact_unresolved_23505::text,
       index_counts.artifacts::text,
       index_counts.exact_ready::text,
       index_counts.exact_invalid::text,
       index_counts.incompatible::text
  FROM response_counts
 CROSS JOIN ledger
 CROSS JOIN index_counts;
