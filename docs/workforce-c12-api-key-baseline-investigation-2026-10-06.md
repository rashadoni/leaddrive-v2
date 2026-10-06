# C12 historical staging baseline dependency

This read-only investigation is bound to main
`86cba428d39e3ce4be13245bdb8e34e49dccf8d4` (PR593) and the dormant HRM
candidate formerly at `6843cc24428a181cf80c57fe358a4944a9439ded`.
It does not authorize migration application, production access, merge,
deployment, activation, grants or changes to Support PR592.

## Verified gap

The prior isolated clean-history experiment completed 391 migrations before
`20260811150000_zapier_webhook_api_key_provenance` failed with
P3018 / SQLSTATE 42P01 because `api_keys` did not exist. That migration adds
an unconditional foreign key from `webhooks.createdByApiKeyId` to `api_keys.id`.
No migration was applied or marked resolved during this investigation.

The first public commit, `76994875a251e0956b56f8d300625b97eb098661`, has no
parents and is described as a sanitized public GitHub baseline. Its Prisma
schema already contains `ApiKey`, mapped to `api_keys`. All 440 SQL migration
blobs in that commit match the corresponding current files. None creates
`api_keys`; the Zapier foreign key is the only reference to that table in those
migrations. The initial migration creates `webhooks`, but not `api_keys`.
All 511 migration files in current main also match the inspected local source;
the dormant C12 candidate adds one unrelated migration.

RLS batch scripts assume that `api_keys` already exists. A comment about
historical `db push` for MTM is not evidence of how `ApiKey` was created.
The public repository therefore does not establish the missing creation or
complete bootstrap provenance. It cannot establish the production schema.

## Safe continuation

Obtain a reviewed, schema-only baseline and migration ledger from the
authoritative staging provisioner, or the original pre-public creation DDL
and its provenance. The package must identify the source revision, PostgreSQL
version and collation, table columns/defaults, constraints, indexes, triggers,
RLS policies, owners and ACLs. Exclude records, credential values and secrets.
Reconcile that evidence with the public migration sequence before preparing
any separately reviewed bootstrap or repair implementation.

A new migration appended after the failing migration cannot repair an empty
database replay that stops earlier. Editing an already-applied migration,
marking the failure applied, or inserting a guessed historical creation would
hide the gap. Generating today's table from Prisma can support a synthetic
fixture, but cannot prove historical defaults, ACLs or migration provenance.
For these reasons this commit records the diagnosis and dependency without
proposing executable repair SQL from incomplete evidence.

Once the baseline is established and application is separately authorized,
follow `docs/workforce-c12-dense-operations-2026-10-05.md` and the evidence
archive's `final/hrm-ops-next-staging-validation.md`: actual historical RLS,
ACLs and triggers, all schedule paths, density/churn/query plans, takeover
fences, eligible-roster monitoring and delivery need their own acceptance.

WF-C12-008 remains PARTIAL. The ledger remains 82/161 DONE, 79 open, weighted
59%. Successful synthetic fixtures and PR checks do not close this gap.
