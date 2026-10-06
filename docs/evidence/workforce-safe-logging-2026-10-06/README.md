# PR589 safe logging — accepted source checkpoint

Head `2c5a6a4b35cb96988f9f3c417b122d788498c3a7`, tree `1bdd3a8c6a8b222cb9dbf193e9c019ef55460aa5`, parent `dc91bd039cf25f9f30b9580471e0f409ebf6eb2e`. Main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`; synthetic `aabc561784979d9867d5b35c370135e58792c8fe` has the candidate tree.

Exact-source review accepted: 8,760 blobs/modes, 11-path delta, 8,749 unchanged parent blobs. Only four caught-value logging calls/imports and four helper union labels changed in production; existing response/access/write/fence/scheduler behavior is preserved. Independent42 tests PASS, including16 privacy cases. Owner50 focused and225 regression/capability/isolation tests PASS; production bounded typecheck and lint PASS. Test-inclusive compiler has exactly the two pre-existing TS2737 mock diagnostics also present on accepted parent; configs/outputs are archived, no global clean compiler claim or baseline/target change.

Hosted checks on this new head are pending separately. Parent hosted results are not substituted. Initial wrong Today header expectation and correction remain in the independent test history. Source exposures do not prove a runtime leak; AST inventory records49 other raw thrown-value calls and one name-derived call, not a complete transitive logging audit.

All original receipts listed in manifest.json are archived byte-exact. Absolute local support paths map to these basenames. The two explicitly local-only large source/tree responses remain hash-bound in the source receipt and recoverable from immutable Git identities. Next request-API logging slice is prepared only; warning severity and optional Route enrichment behavior must remain intact.

Ledger82/161DONE,79open,weighted59%; C12-008 PARTIAL. Authentic historical api_keys baseline is handled on the separate backup-owner track. No Contabo operation, migration/baseline edit, Support592 change, merge, deployment or activation occurs in this slice.
