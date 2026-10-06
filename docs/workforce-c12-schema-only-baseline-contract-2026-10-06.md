# C12 schema-only baseline contract

Scope: PR589, source checkpoint `5f87cc94a684d5083804f0dae23116384dda24b4`, main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`. This contract requests evidence; it does not authorize backup access, historical migration changes, restore, production queries, merge or activation.

## Minimal first package from an already restored isolated copy

Do not upload a raw dump. Supply only:

1. SHA-256 of the existing backup artifact and restore receipt, restored-at UTC timestamp, and the 40-hex source revision recorded by the restore operator. No storage URL, host address, credential, tenant name or dump contents. The script labels these claims `OPERATOR_SUPPLIED_NOT_VERIFIED`; a reviewer must verify the receipts separately.
2. PostgreSQL numeric version, encoding, recovery state, observation time and opaque database/collation fingerprints.
3. `public.api_keys` existence, column shape and safe column-only DDL where representable, direct outgoing/incoming foreign-key structure, referenced primary-key structure, indexes, RLS state, and policy/trigger/function/ACL fingerprints. Unknown identifiers, types, defaults and bodies are withheld.
4. Every `_prisma_migrations` record up to a hard ceiling of 5,000: migration name if known to the repository, checksum, start/finish/rollback times, applied-step count. Preserve duplicates, incomplete and rolled-back records. Never select `logs`, raw application rows, token hashes/prefixes, role names or credentials. Over-ceiling or RLS-filtered ledger refuses the entire export.

The exporter accepts only ordinary tables for the target and ledger; views, foreign and partitioned relations are refused. Policy target roles are included as sorted opaque OID fingerprints as well as role count.

The first package is `PARTIAL_SCHEMA_EVIDENCE` (or `API_KEYS_ABSENT`). It cannot establish an executable or historical baseline. An empty successful ledger also requires operator provenance and completeness review; it does not prove that no migrations ever ran. A database-name or role-OID fingerprint is a correlation handle, not anonymization or identity proof. Do not publish evidence automatically; review before sharing.

## Prepared read-only exporter

Files: `scripts/workforce-baseline-schema-export.sql`, `.mjs`, and `.test.mjs`.

The SQL is fixed, limited to PostgreSQL catalogs and the explicit migration metadata columns. It uses one repeatable-read, read-only transaction, 10-second statement and 2-second lock timeouts, then rolls back. The CLI uses `psql -X --no-password`, a preconfigured `PGSERVICE`, a 30-second process timeout and a 2-MiB output ceiling. No connection URI or password is accepted in command arguments. A nonsuperuser role with catalog visibility and SELECT on the migration ledger suffices for the synthetic fixture; the exporter never creates roles, grants or services. Actual service resolution and privileges must be validated by the authorized operator.

Provenance input has exactly these keys:

```json
{
  "sourceKind": "ISOLATED_RESTORED_COPY",
  "backupArtifactSha256": "<64 lowercase hex>",
  "restoreReceiptSha256": "<64 lowercase hex>",
  "sourceRevision": "<40 lowercase hex>",
  "restoredAt": "<UTC restore timestamp>"
}
```

After separate approval for one identified restored copy, its operator can run:

```sh
PGSERVICE=approved_restored_copy node scripts/workforce-baseline-schema-export.mjs \
  /private/provenance.json /private/baseline-minimized.json /approved/source-checkout
```

The output is created exclusively with mode 0600; existing files are refused. CLI errors are a fixed code, without SQL errors or connection details. The script neither restores a dump nor executes repository migrations. `repositoryRoot` must be the approved exact source checkout: ledger comparisons are useful only when that source identity is independently verified.

## Required supplement before historical replay acceptance

Review the minimized package first. Then request only missing schema definitions, after inspecting them within the authorized restored environment for embedded literal secrets or private identifiers:

- Exact original `CREATE TABLE api_keys` DDL, all defaults, collations, constraints, indexes and sequence/identity state definitions (no sequence values), and dependency order.
- Transitive schema dependency closure: referenced columns and unique keys, custom types/domains, extensions, functions, policies, triggers and their dependencies. The prepared exporter covers only direct foreign keys and cannot certify this closure.
- Ownership and privilege intent mapped to approved staging roles; no passwords or production grants copied. RLS and trigger semantics must remain equivalent. Fingerprints alone are insufficient to reconstruct those semantics.
- Ledger row multiset, migration-file checksums, source revision, backup/restore receipt and the source event explaining how `api_keys` existed before `20260811150000_zapier_webhook_api_key_provenance`. A current restored schema can establish current shape; it does **not** by itself establish that historical ordering.
- A reviewer-approved baseline definition and reproducible isolated replay procedure bound to these hashes, with mismatches and missing provenance left unresolved explicitly.

Never replace a withheld definition with a guessed Prisma-generated equivalent. Never mark migrations applied, edit historical SQL/checksums, or call `db push` to turn a partial export into baseline acceptance. Missing pre-public provenance remains a concrete evidence gap even if a later backup contains the table.

## Isolated validation and authorization boundary

The disposable PostgreSQL 16 fixture contains synthetic DDL only. Tests verify catalog collection under a nonsuperuser with ledger-only SELECT while SELECT on `api_keys` is denied; row/default/function/comment/log canaries remain absent; ledger checksum and incomplete state survive; output is private, non-overwriting and data fingerprints do not change; a filtered ledger is refused. Local CLI testing used a temporary `psql` wrapper routing to this disposable container. External PGSERVICE resolution was not tested.

Next external substage requires authorization identifying **one already restored isolated copy**, its approved operator/read-only service, and permission to execute only the committed catalog-plus-ledger export and inspect the resulting minimized JSON. No raw backup transfer, restore operation, production database access or permission change is included. Until then, source work and synthetic tests continue independently.
