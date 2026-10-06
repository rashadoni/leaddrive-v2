# Current-main integration for PR #605

This continuation preserves immutable checkpoint `00ec36a55df55672a912ad72765a1b07db041878`, its independent receipts, original 100-test result, 14 independent adversarial tests, actual Orca 54/54 (ALSA null qualification), and both original ZIP archives. No remote binary ZIP readback is claimed.

Incoming main `da6d8e5c7d6d6a231af508bf0b243fe507094067` contributes only the two MTM map/test paths from #603. All 8,830 prior blobs were verified before writing; the C8 runtime source and evidence remain byte-identical. [Source proof](source-proof.json). Accepted PR #589 stays at `a856a9e533c4f3cec6f2313e69f5be0d5b4d4226` and remains a required dependency.

[The repeated targeted suite](targeted-tests.json) passes **102/102**, 13 files, no skipped tests, including two incoming MTM regressions. The prior AT full-source manifest belongs to the original checkpoint; this integration adds only unrelated MTM files and preserves its exact C8 runtime and test content. New full-tree hosted validation remains required.

The authorized test route is a separate validation-only PR to main at the same integrated head, with the existing production-build label. PR #605 keeps its dependency base. This uses existing hosted Linux PR checks and sandbox browser/PostgreSQL fixtures without changing workflow gates, production, credentials or permissions. The validation PR is not a release candidate to merge and does not replace #589 or #605.

Full TypeScript, production build and applicable browser jobs are PENDING for the new head. SKIPPED draft jobs are not passes. The local environment has a 16 GiB cgroup with existing shared-memory files; the project's full compiler requires its measured hosted 18 GiB RAM+swap preflight and bounded 14 GiB heap. Full compiler checks will run there instead of repeating the known local 4 GiB OOM.

WF-C8-002 and the ledger remain unchanged until the finite acceptance matrix and independent exact-head review are satisfied. No merge, deployment or activation is authorized by this record.
