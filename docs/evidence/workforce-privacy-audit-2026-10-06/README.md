# Workforce privacy audit: tested-base pass, fresh-main blocker

Exact source `8053702bbde2a43da537e263630f8a81ded2b659`, tree `678503f2dc2a5a5d0c52d41156caee8bf100494b`, parent `ef5d90010d9b317a493dfe7ae574b1863f3c83fb`.
Main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`; synthetic `e6beed0ed5f5960d427ace1678775f6473983d1e` has the same tree.

FRESHNESS BLOCKER: main advanced to0562b7ceb56b256b5fd9728b44dc17c4a4617865
through PR594 during CI. It changes Workforce teammembership cascade/immutability
semantics; cumulative PR589 overlaps prisma/schema.prisma. The latest42 logging
paths are disjoint, but textual mergeability does not prove roster/retention
compatibility. No active writer on PR589 is proven; a concurrent main/domain write
is observed. The user's stop/report rule is honored: no further GitHub mutation.
This prepared archive is LOCAL_ONLY and has not been published. New-base readiness
is BLOCKED until ownership/scope clearance and fresh compatibility checks.

The remaining 4/9/33 route batches and seven HRM authorization-wrapper logs
are complete: 53 fixed-operation replacements, domain behavior preserved.
Three equivalent Play Integrity BigInt substitutions remove three owned TS2737.

Owner regression: 2307 PASS, zero FAIL, 163 opt-in PostgreSQL SKIP across265 files;
251 new cases are included, not added twice. Targeted lint and whitespace PASS.
Independent exact-source review binds8768 blobs/modes,2809 trees and42 changed paths.
Five mandatory checks and six additional suites PASS on this exact head/tested base,
nine workflow runs attempt1; optional production build SKIPPED.
Restore attempt1:15 scenarios,2 cleanup,10 authorization assertions PASS,
34 source bindings checked against the exact head and synthetic tree.
Only allowlisted sanitized restore JSON and metadata inspected, no rawCIlogs/screenshots.

Production compiler remains exit2 with23 historical diagnostics (parent26).
Test-inclusive scope has25, including two untouched historical MTM fixture TS2737.
Hosted baseline gates passing is not a globally clean compiler or full-suite claim.
Original initial fixture/scanner failures are preserved alongside final successful runs.

Whole privacy/telemetry acceptance remains OPEN: source-to-synthetic-sink probes
characterize shared Sentry/Pino/RLS retention and version/principal cardinality.
InvalidJS library labels do not prove adversarial route reachability. No production
collector, live delivery, credentials or activation were used. No whole-program
privacy/taint, all-device, accessibility, high-load or production acceptance claim.

WF-C10-011 PLANNED, WF-C12-002 PARTIAL;82/161DONE,79open,weighted59%,14/15gates,
C12-008 PARTIAL. No completion-credit or baseline change. Eight next fault/fairness
scenarios are PREPARED ONLY, not newly implemented or executed.

65 original evidence files plus manifest and this README. The manifest maps
workspace paths to exact archived bytes, SHA256 and Git blob identity. Explicit
LOCAL_ONLY entries are transport/content copies recoverable through the cited immutable
source/evidence commits; they are not represented as archived originals. This entire
prepared collection is LOCAL_ONLY; no final archive commit exists. Earlier40-file
source evidence remains immutable at3e3c; its38 originals are conserved here. Earlier
request/safe-logging/roster archives remain unchanged. Final archive durability has
NOT been performed because stop/report prevents publishing this prepared collection.

No merge, deploy, activation, database application, permission or credential changes.
Support is untouched. Tested-base evidence is preserved; current-main and complete
HRM acceptance are NOT claimed.
