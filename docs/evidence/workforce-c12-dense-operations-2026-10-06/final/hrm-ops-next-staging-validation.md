# Next C12 staging validation slice

Prepared against PR589 head `6843cc24428a181cf80c57fe358a4944a9439ded`.
This plan does not authorize production access, grants, a migration repair,
merge, deployment, cron registration, alert delivery, or activation.

## Entry dependency

The clean historical chain is blocked after 391 successful migrations by
`20260811150000_zapier_webhook_api_key_provenance` / missing `api_keys`.
Obtain an approved reproducible staging baseline with its schema/migration
provenance, or separately scope a repair of that historical dependency.
Do not mark the failed migration applied or invent an undocumented table.
The existing generated-schema fixture cannot supply this missing acceptance.

## Once the baseline is available

1. Bind baseline, candidate, database version, collation, and applied migration
   identities. Apply the literal C12 operations migration in isolated staging.
   Inspect actual FK update/delete actions, timestamp defaults, CHECK constraints,
   19 selected FORCE RLS tables and nine C-collated indexes. Record historic
   triggers and ACLs that the synthetic generated-schema experiment omitted.
2. Exercise all eight root families and both schedule paths under the actual
   non-superuser/NOBYPASSRLS application role. Cover pinned schedule snapshots,
   effective assignments, employee/team/default fallbacks, wrong/unset tenant
   context, foreign references, missing facts and forbidden writes. Preserve
   source fingerprints and prove no checkpoint on incomplete/mismatched input.
3. Measure query plans and bounded completion using representative dense roots,
   many approval groups, sparse audit matches and large rosters. Include cold
   and warm runs, sustained concurrent traffic, statement/transaction deadlines,
   adaptive projection overflow, and indivisible history/root ceilings. Synthetic
   three-repetition timings are not a production SLO; establish an explicit
   workload and acceptance threshold before claiming one.
4. Rehearse lease takeover and expiry across lease/state/cursor lock waits,
   process loss, uncertain commit acknowledgement, same-owner attempt replacement,
   repeated failures and continuous tenant churn. Verify other due eligible
   tenants continue to run and no stale attempt advances global progress.
5. Prepare a separate monitoring-coverage extension for eligible but never
   attempted tenants, disabled/inactive transitions, roster overflow and alert
   delivery. Current health explicitly measures tracked attempts only. Keep
   delivery and scheduler activation behind their separately approved scope.

## Evidence contract

Use source-bound sanitized JSON: exact SHAs and schema provenance, finite case
outcomes/counts, role flags, query-plan projections, source-fingerprint equality,
lease/cursor outcomes and explicit not-run cases. Do not include raw CI logs,
credentials, personal records, identifiers in operational output, or screenshots
containing unreviewed data. Retain original failures and separate rerun receipts.
Independent review must bind the exact candidate and fresh-main synthetic tree.

WF-C12-008 remains PARTIAL until the missing acceptance is actually demonstrated.
The ledger remains 82/161 DONE, 79 open, weighted 59%.
