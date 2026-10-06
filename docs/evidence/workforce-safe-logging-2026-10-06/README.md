# PR589 safe logging — bounded candidate accepted

Head `2c5a6a4b35cb96988f9f3c417b122d788498c3a7`, tree `1bdd3a8c6a8b222cb9dbf193e9c019ef55460aa5`, parent `dc91bd039cf25f9f30b9580471e0f409ebf6eb2e`. Main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`; synthetic `aabc561784979d9867d5b35c370135e58792c8fe` has the candidate tree and exact main/head parents.

Four caught-value logging boundaries now emit fixed literal operations: Today grants, timesheet grants, request-decision grants and the dormant no-show-review endpoint. Existing access, response, write, Route, scheduler and rollout behavior is preserved. This advances bounded source work under WF-C12-002/WF-C10-011 without closing either whole requirement.

## Evidence

- Independent source review: all 8,760 blobs/modes verified, 11-path delta, 8,749 unchanged parent blobs; 42 independent tests PASS, including 16 privacy cases. Production transform proof limits changes to four catch/import replacements and four helper operation labels. No unresolved P0–P3 finding.
- Owner validation: 50 focused and 225 regression/capability/isolation tests PASS; targeted lint and bounded production typecheck PASS. Test-inclusive compiler retains exactly the two existing TS2737 diagnostics in unchanged test mocks, byte-identical to the accepted parent. Initial wrong Today header expectations and their test-only correction remain preserved.
- Hosted exact-head acceptance: 5 mandatory and 6 additional checks PASS; 9 workflows succeed on attempt 1. Optional production build SKIPPED. Restore safe JSON confirms 15 unique cases, 2 cleanup checks, 10 authentication records and 34 exact source bindings. Root verifies the ZIP digest and reads only the safe JSON; independent review verifies metadata, safe JSON and source bindings. Other five browser artifact payloads remain metadata-only.
- Hosted typecheck/test gates remain baseline-qualified: unchanged 64 file/code pairs and 18 known failing files. Success does not establish a clean global compiler, zero failed suites, whole-page visual/accessibility acceptance, representative load, physical Android or pilot acceptance. No raw CI logs or screenshots were read.

All originals listed in manifest.json are archived byte-exact; local paths in receipts map to archived basenames. The prior source-only archive is `542e22351963f4e3b2d17f42fa7b3fd399ca69e2` (23 files independently verified). The previous eligible-roster archive and its historical failed restore attempt/retry remain unchanged. Current head passed restore on its first attempt. Two large source/tree responses remain explicitly local-only and recoverable by immutable Git identities.

## Remaining scope

The scoped AST inventory still records 49 raw thrown-value calls and one error-name-derived call. It is a syntactic inventory, not a complete transitive privacy audit or evidence of an actual runtime leak. The next request-API slice is source-bound and prepared only: four logs, preserving the existing warning severity and optional Route-enrichment behavior.

Ledger remains 82/161 DONE, 79 open, weighted 59%; C12-008 PARTIAL. Authentic historical api_keys baseline provenance remains with the separate backup owner. Applied migrations/baselines, Support PR592 and runtime settings are unchanged. No Contabo action, grant/credential change, merge, deployment or activation was performed. Full staging, operational delivery/SLO and the remaining acceptance dependencies remain open.
