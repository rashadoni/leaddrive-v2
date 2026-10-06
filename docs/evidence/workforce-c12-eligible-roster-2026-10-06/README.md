# PR589 — accepted bounded source and hosted checks

Exact head `dc91bd039cf25f9f30b9580471e0f409ebf6eb2e`, tree `6f0779e839c6c684107a17314798dbcb0ac1b339`, parent `5f87cc94a684d5083804f0dae23116384dda24b4`. Main remains `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`; synthetic `e6d9e7a1fe1245a7009e9bd0a01c3dc00473ec1a` has the same tree. PR589 is the sole HRM candidate; Support is untouched. No merge, deployment or activation performed.

## Accepted evidence

- Independent source review verifies 8,758 blobs/modes, the exact nine-path delta and 8,749 unchanged parent files. All preliminary findings were fixed; original findings and resolutions remain archived.
- Owner validation: 138 HRM tests (87 synthetic PostgreSQL +51 pure), nine exporter pure tests, eleven synthetic PostgreSQL exporter checks, 191 MTM regressions, bounded typecheck and targeted lint PASS. The disposable container, volumes, password file and local psql wrapper were removed.
- Independent local tests: nine exporter and one roster guard PASS; fourteen optional roster PostgreSQL tests SKIP. Owner PostgreSQL execution is not independent or automatic hosted credit.
- Exact-head hosted metadata: five mandatory and six additional checks SUCCESS; optional production build SKIP. All nine workflows succeeded. Tests and typecheck remain baseline-qualified (64 compiler pairs, 18 known test files); global clean compiler/full-suite/build is not claimed.
- Restore attempt 1: initial query-locator TimeoutError before any of fifteen cases; cleanup two PASS. Cause UNKNOWN. The sanitized failed receipt and independent review are preserved.
- Restore attempt 2, unchanged head: fifteen unique cases PASS, two cleanup PASS, ten authentication records and all 34 source bindings verified. Only `restore-rendered-ui-receipt.json` was read from each downloaded ZIP. Raw logs and screenshots were not opened. The five other browser artifact payloads are metadata-only.

`hrm-monitor-independent-hosted-terminal-dc91-20261006.json` is the final independent acceptance receipt. `manifest.json` binds all original receipts byte-for-byte. Local absolute paths in receipts identify supporting originals archived here by basename. The large remote-tree response remains local and hash-bound in the source receipt; immutable Git tree/blob identities allow recovery. Earlier archive receipts describe their historical checkpoint and are not rewritten to pretend they included later evidence.

## Remaining scope and next work

Ledger remains 82/161 DONE, 79 open, weighted 59%; C12-008 PARTIAL. The roster reader is dormant; collection cadence, alert delivery, operational SLO and full historical staging remain separate. The schema export is deliberately partial and non-executable, with direct FK scope rather than transitive dependency closure. No actual backup/restored copy was accessed, and authentic pre-public api_keys creation provenance remains unresolved.

The exact source contains the schema-only baseline contract, exporter and 79-item dependency plan. The next finite telemetry/redaction slice is prepared in `hrm-monitor-next-slice-preparation.json`; it has no implementation or activation credit. User coordinates the existing backup owner and the already isolated restored copy. Ordinary already-authorized read needs no new blanket approval; the agent must not initiate parallel Contabo operations. The exporter creates no access, queries no application rows, and emits no credential values. No raw dump is requested.
