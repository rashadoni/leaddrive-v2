# Request API safe logging — bounded candidate accepted

Head `ef5d90010d9b317a493dfe7ae574b1863f3c83fb`, tree `5b94c2111dbe51ceb74b1e803e142fff74e66cbc`, parent `2c5a6a4b35cb96988f9f3c417b122d788498c3a7`. Main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`; synthetic `7b517816410e29d84a03f368954541ca180b79f6` has the same tree and exact main/head parents.

Four request API catches no longer inspect or forward private thrown values. Submit/decision/cancel use three fixed error labels; optional Route-entitlement failure uses a dedicated fixed warning label and continues HRM decision with Route preview disabled. Existing auth, schema, response/header, idempotency, notification, domain-service, Route and runtime behavior is preserved.

## Acceptance evidence

- Independent source proof verifies all8,762blobs/modes and2,809trees, six changed paths and8,756unchanged parent blobs; no unresolved findings. Independent57testsPASS, including27new handler cases and16privacy variants. Owner76focused and225regression/capability/isolation testsPASS; lint and boundedproductiontypecheckPASS.
- New handler tests run actual route catches/shared logger with mocked auth wrappers/domain services/Prisma. Separate existing domain tests also use mockedDB. No end-to-end authorization, production or actual localPG credit is inferred.
- Exact-head hosted:5mandatory+6additionalPASS;9workflows succeed on attempt1. Restore safeJSON confirms15uniquePASS,2cleanupPASS,10authentication records and34source bindings. Terminal receipts bind all checks, jobs/steps and artifacts to this head. Only the safe restore JSON is inspected; other five browser payloads remain metadata-only. Optional production build is SKIPPED.
- Hosted gates retain the unchanged64file/code typecheck baseline and18known failing test files. Success does not establish a globally clean compiler or zero failing suites. Test-inclusive bounded compilation retains exactly two historicalTS2737 in the sharedMTMmock, byte-identical to main/parent. Isolated reproduction proves1n fails atES2017 whileBigInt(1) compiles and preserves value; the separate sharedfixture correction is diagnosed, not silently applied here. No target/baseline edit.
- Initial new-test parse failure and the initial local-config omission of normal next-auth augmentation are preserved. Corrected actual reruns are separately bound. No raw CI logs or screenshots were read.

The source-only archive is `3cacbb4f6c273c22e55d258b0b0cb82f586ae05e` (31files independently verified). All originals in manifest.json are stored byte-exact; local receipt support paths map to archived basenames. Three explicitly local-only source/tree/mainmock responses remain recoverable from immutable Git identities and hash-bound in the source receipt. Prior safe-logging and eligible-roster archives, including historical failures, remain unchanged.

## Progress toward closing the canonical tasks

WF-C10-011 remains **PLANNED**: four request failure paths now have private-value canaries and a bounded log shape. Full schema/log scan coverage and analytics/dashboard destination review are still required.

WF-C12-002 remains **PARTIAL**: finite failure/warning labels advance the no-high-cardinality-data criterion. End-to-end cardinality/privacy, collection/dashboard ingestion, approved paging/SLO and delivery evidence remain outstanding. No telemetry destination is activated.

The finite remaining inventory is45raw thrown-value calls plus one error-name-derived call:4Today/timesheet/exceptions,9attendance,33configuration. Next preparation preserves the typed Today suppressed-log and timesheet409 branches. After these enumerated batches, consolidate alias/shared/framework/destination coverage once, then either evidence the complete criterion or name its exact blocker and move to independent fault/fairness and entitlement-matrix work. A reduced log count earns no automatic row closure.

Ledger remains82/161DONE,79open,weighted59%;C12-008PARTIAL. Historical api_keys baseline remains with the separately designated backup owner. Fullstaging/operational/load/physicalAndroid/pilot dependencies remain open. No applied migration/baseline, Support592, credentials/grants, Contabo/SSH/Mac, merge, deployment or activation change occurred.
