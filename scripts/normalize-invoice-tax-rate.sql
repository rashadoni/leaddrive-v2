-- Normalize legacy percentage-form tax rates to the decimal multiplier.
--
-- NOT a Prisma migration on purpose: prisma/migrations/ is applied
-- automatically by scripts/server-deploy.sh, and this rewrites financial rows.
--
-- WHY
-- `calculateInvoiceTotals` uses taxRate raw — `taxAmount = afterDiscount *
-- taxRate` — so the contract is a decimal multiplier: 0.18 means 18%
-- (src/lib/tax/types.ts). Production disagrees. Counted per-organization on
-- 2026-08-28 as `leaddrive_migrator`:
--
--     invoices            84 rows, 43 with taxRate = 18
--     recurring_invoices  61 rows, 43 with taxRate = 18
--     invoice_items     1863 rows,  0
--
-- Those rows store 18 where they mean 0.18. Two consequences:
--   1. They render as "ƏDV 1800%" (src/lib/invoice-html.ts multiplies by 100;
--      the detail page carries a `taxRate <= 1 ? …` branch to paper over it).
--   2. Anything recomputing totals from the stored rate bills 1800%.
--
-- The application no longer does (2) — normalizeTaxRate() is applied at every
-- calculation site and a repricing PUT writes the normalized value back, so
-- rows heal as they are edited. This is the one-shot alternative.
--
-- PRE-CHECK RESULT (2026-08-28, read-only, before writing anything)
--   affected invoices with VAT ............................ 43
--   reconcile against taxRate/100 ......................... 43   ← all of them
--   reconcile against the raw taxRate ......................  0
--   would become inconsistent after normalizing ............  0
-- i.e. taxAmount was already computed at 18%, so this corrects the unit and
-- changes no money. Re-run the same queries before committing if in doubt.
--
-- APPLIED TO PRODUCTION 2026-08-29 by the owner, as leaddrive_migrator.
--   UPDATE 43 (invoices) + UPDATE 43 (recurring_invoices), committed.
-- Verified independently afterwards:
--   invoices with taxRate > 1 ................ 0 of 84
--   recurring_invoices with taxRate > 1 ...... 0 of 61
--   rows in _taxrate_backup_20260828 ......... 86
--   invoices whose taxAmount does not
--     reconcile against the stored rate ...... 0 of 60 with VAT
--   remaining distinct rates ................. 0, 0.18, 0.19, 0.23
-- The 0.19 and 0.23 rows were already in decimal form and were not touched.
-- Re-running is a no-op; the predicate is false for every row.
--
-- SAFETY
-- Idempotent (`"taxRate" > 1` is false after the first run). Snapshots every
-- row it changes into _taxrate_backup_20260828 first. Touches no money column.
--
-- HOW TO RUN, on the origin:
--   set -a; . /etc/leaddrive/migration.env; set +a
--   psql "$MIGRATION_DATABASE_URL" -f scripts/normalize-invoice-tax-rate.sql
--
-- MUST run as a BYPASSRLS role. `invoices` and `recurring_invoices` are FORCE
-- ROW LEVEL SECURITY, and the app role (`hermes`, rolbypassrls = f) sees zero
-- rows without app.org_id — the UPDATE would report success having changed
-- nothing. `leaddrive_migrator` in /etc/leaddrive/migration.env has bypassrls.
-- The first block below prints the role so a wrong one is obvious.
--
-- ROLLBACK
--   update invoices i set "taxRate" = b.old_taxrate
--     from _taxrate_backup_20260828 b
--    where b.source = 'invoices' and b.row_id = i.id;
--   update recurring_invoices r set "taxRate" = b.old_taxrate
--     from _taxrate_backup_20260828 b
--    where b.source = 'recurring_invoices' and b.row_id = r.id;

\set ON_ERROR_STOP on
\pset pager off

\echo '=== role (bypassrls must be t, or the UPDATE silently hits 0 rows) ==='
select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls;

begin;

create table if not exists _taxrate_backup_20260828 (
  source      text             not null,
  row_id      text             not null,
  old_taxrate double precision not null,
  taken_at    timestamptz      not null default now()
);

insert into _taxrate_backup_20260828 (source, row_id, old_taxrate)
select 'invoices', id, "taxRate" from invoices where "taxRate" > 1
union all
select 'recurring_invoices', id, "taxRate" from recurring_invoices where "taxRate" > 1;

\echo ''
\echo '=== rows snapshotted ==='
select source, count(*) from _taxrate_backup_20260828 group by source order by source;

update invoices           set "taxRate" = "taxRate" / 100 where "taxRate" > 1;
update recurring_invoices set "taxRate" = "taxRate" / 100 where "taxRate" > 1;

\echo ''
\echo '=== after (in transaction): remaining must be 0 ==='
select 'invoices' as t, count(*) as total,
       count(*) filter (where "taxRate" > 1) as pct_form_remaining
from invoices
union all
select 'recurring_invoices', count(*), count(*) filter (where "taxRate" > 1)
from recurring_invoices;

\echo ''
\echo '=== consistency: taxAmount vs (subtotal - discountAmount) * taxRate ==='
\echo '(mismatched must be 0 — if it is not, ROLLBACK instead of committing)'
select
  count(*) as vat_invoices,
  count(*) filter (
    where abs("taxAmount" - (("subtotal" - "discountAmount") * "taxRate")) > 0.02
  ) as mismatched
from invoices
where "includeVat";

commit;

\echo ''
\echo '=== committed — post-commit verification ==='
select 'invoices' as t, count(*) filter (where "taxRate" > 1) as pct_form from invoices
union all
select 'recurring_invoices', count(*) filter (where "taxRate" > 1) from recurring_invoices;

select "invoiceNumber", "taxRate", "subtotal", "taxAmount", "totalAmount"
from invoices where "includeVat" order by "invoiceNumber" limit 5;
