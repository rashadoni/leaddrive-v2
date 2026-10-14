# Attendance acceptance evidence assembly

## 2026-10-14 — documentation candidate prepared

- The coordinator requested a dedicated documentation-only worktree from the
  reviewed and deployed main commit `8c54afe632181b15d4bb4cb88ee1953a6a72cd4f`.
  Branch: `codex/mtm-attendance-acceptance-evidence`. The existing continuation
  branch and its worktree remain unchanged.
- Seventeen explicitly listed documentation/evidence paths were imported from
  continuation commit `1d15532787ca848e8e427c0dff436b89c73e46d2`. No application
  code, workflow, private `/tmp` file, credential, or whole directory was copied.
- README assembly preserves the exact 1,342-line common prefix from
  `e4d799fdef1d0e17a579ca8c93091fb6cda33748`, then main's seven-line journal tail,
  then the continuation's 187-line journal tail. Entries keep their original
  timestamps and wording; neither branch's history is replaced by the other.
- Existing main-only phone access, sync diagnostic, mark timezone and formatter
  session logs, and the timezone evidence receipt, remain in place. The new
  device receipt does not move or delete the existing timezone receipt.
- Physical acceptance is still running under the coordinator's exclusive
  control. Historical failures and explicit NOT_RUN cases are retained. This
  candidate is not a final physical acceptance claim.
- No commit, push, pull request, merge, or additional deployment was performed.
  The coordinator must provide the final continuation checkpoint before the
  candidate is resynchronized and published. A documentation-only main merge
  still triggers the repository's normal production build and deployment.
- Preparation checks PASS: diff whitespace, parsing all 11 imported JSON files,
  exact bytes for the 16 non-README imports, exact preservation of both README
  tails, and preservation of the five main-only files named above. The candidate
  contains 18 documentation paths including this assembly journal, with no
  deletions or application changes. Both imported screenshots were visually
  reviewed and contain the fictional acceptance tenant's interface/data only.
  Full tests/build/browser checks are NOT_RUN for this documentation assembly;
  their existing exact-SHA receipts are imported without claiming a new run.

## 2026-10-14 — bounded risk-review date correction

- Supersedes the documentation-only scope above: after the coordinator observed
  `2026 M10 14 03:50:25` in the live fictional employee risk review, the
  coordinator explicitly authorized one presentation correction in this
  worktree. The risk table called native Azerbaijani Intl formatting directly,
  bypassing the existing `formatDateTime` helper that handles runtimes lacking
  Azerbaijani ICU month data.
- `attendance-risk-table.ts` now uses that existing helper with the same item
  timezone and medium date/time options for original, received and dismissal
  timestamps. The shared browser/export table retains its data, permissions,
  columns and other locales. No stored timestamps or timezone arithmetic change.
- Six new behavior tests PASS: original/received/dismissal clocks, local date
  rollover in Baku and New York, simulated missing Azerbaijani ICU data,
  unchanged Russian/English rendering, original facts and absent decision.
  Existing 14 date-helper tests PASS. Each suite ran separately with one worker
  and a 768 MiB heap cap; targeted lint for the two source/test paths and diff
  whitespace checks also PASS. Resource preflight showed about 14 GiB available
  memory, 231 GiB disk and zero current memory pressure.
- Existing dependency files were reused through an ignored `node_modules`
  symlink; no install, package or lockfile change occurred. Full typecheck,
  production build and browser/phone acceptance are NOT_RUN locally under the
  Contabo workload contract. Hosted gates and the coordinator's post-release
  visual check remain required; passing unit tests are not physical acceptance.
- The 17 previously imported evidence/document paths, including both README
  tails, retain their exact pre-edit hashes. Only the risk table, its new
  focused test and this append-only assembly journal enter the checkpoint.
  The other evidence remains uncommitted for the coordinator's final resync.
  No push, PR creation, merge, release, device action or production write was
  performed by this subtask.

## 2026-10-14 — intermediate evidence resync from f6e53256c

- The coordinator requested an intermediate resync from immutable continuation
  snapshot `f6e53256c9556cc36c330afa85053d08221d482c`, followed by a docs-only
  checkpoint. This is not the final acceptance snapshot; the coordinator will
  finish the physical scenarios and request one final resync.
- The same 17 explicit paths were refreshed, adding only these five reviewed
  fictional-tenant evidence files: `field-original-start-queue-empty.png`,
  `field-original-start-recovered.png`, `field-permission-loop-3.8.4.json`,
  `permission-repair-3.8.5.json`, and
  `physical-delayed-original-start-review.png`, all under `evidence/device/`.
  No private temporary file, raw system log, or entire directory was imported.
- README keeps the exact common 1,342-line prefix, main's seven-line tail and
  the continuation's complete 215-line tail. The previous continuation prefix
  is unchanged. The five main-only logs/receipts, both risk-date source/test
  files from `6aafd0d21`, and this journal's existing entries were preserved.
- Checks PASS: all 21 non-README imports match source bytes, all 13 imported
  JSON files parse, the protected files match their saved content, and diff
  whitespace checks pass. This resync runs no application tests, build,
  browser, device, or production action. Those checks are NOT_RUN here because
  this checkpoint changes only evidence and documentation.
- Reporting correction to the retained 04:06 root journal entry: the private
  helper comparator controls totaled **five positive and 17 negative** cases,
  not six positives. Excel, correction and PDF had one positive each; the two
  endpoint mapping snippets had one positive each. All passed. This does not
  change any physical scenario outcome or rewrite the original journal.
- The imported repair receipt faithfully remains `RELEASE_IN_PROGRESS` with
  physical acceptance `NOT_RUN` at its snapshot time. Later release/device
  results will supersede that state only in the coordinator's final snapshot.
  No push, pull request, merge or release was performed by this resync.

## 2026-10-14 — existing risk table and export regressions

- At the coordinator's request, discovered existing tests that exercise the
  modified shared risk table and ran only the directly relevant suites. The
  six new date cases and 14 previously passing formatter cases were not rerun.
- `mtm-attendance-risk-review.test.ts`: **18 PASS**, 9.97 s. Covers scoped
  report/reviewer permissions, stale/invalid evidence and decisions, and real
  in-memory Excel/PDF generation using the same table for az/ru/en. Database
  access is mocked in this suite; this is not a real-Postgres or browser claim.
- `mtm-attendance-risk-review-ui.test.ts`: **12 PASS**, 2.22 s. Exercises the
  actual React risk screen in its DOM harness: three locales, decision retry,
  access removal, read-only scope, stale actions, unapplied filters, empty state
  and unmount cancellation. Network responses are mocked; no live browser or
  production request occurred.
- `mtm-date-formatting-contract.test.ts`: **6 PASS**, 327 ms. The existing
  display/machine-format source contract remains satisfied. No lint exception,
  contract, baseline or machine timestamp formatter was changed; prior targeted
  lint for the changed builder and new test also remains PASS.
- Resource preflight: approximately 14 GiB available memory, 231 GiB disk,
  zero current memory pressure. Each suite ran separately with one worker and
  a 768 MiB heap cap. Full suite, Postgres, full typecheck, build and browser
  E2E are NOT_RUN locally under the host workload contract; hosted verification
  remains the release gate. No source change was needed. This checkpoint
  appends only this journal; no push, device action or production mutation.

## 2026-10-14 — intermediate physical acceptance resync from 56f2aaf3d

- The coordinator authorized this docs-only checkpoint from immutable continuation
  `56f2aaf3d4253237e62b699a48a08ca8cbe4037a`. The acceptance branch stays based on
  reviewed main `8c54afe632181b15d4bb4cb88ee1953a6a72cd4f`; its reviewed
  risk-date source/test change remains byte-for-byte unchanged. No push or PR
  was authorized for this checkpoint.
- Refreshed 31 explicitly named documentation/evidence paths from committed Git
  blobs only. New imports since the previous assembly are the fictional FIELD
  corrected PDF/render, stable denied-location and offline-restart screens;
  OFFICE initial/completed screens and corrected PDF/render; and the actual
  shared-phone risk screen explicitly named `before-date-fix`. The coordinator
  inspected these published binary artifacts. No private temporary file, raw
  UI/system log, credential or entire directory was copied.
- README preserves the exact 1,342-line common prefix, main's seven-line tail,
  and all 280 continuation lines. Its full previous bytes remain a prefix;
  65 new continuation lines are appended. The five main-only session logs/
  timezone receipt and every older entry in this assembly journal are retained.
  Both copies of the non-UTC receipt remain in their distinct original paths.
- The imported S23 receipt remains IN_PROGRESS at 2026-10-14T05:28:06.615115+00:00:
  118 historical assertions, comprising 107 PASS, seven FAIL and four NOT_RUN.
  These are historical observations, not 118 independent completed scenarios.
  The previous 58-case prefix is unchanged. Later PASS receipts now demonstrate
  both physical workday chains, all eight request types per role, their exact
  payloads/final decisions, correction history, Excel/PDF, OFFICE inbox and six
  actual shared-installation findings. The earlier request-verifier failure was
  a local harness premise (15 logged attempts for 16 real requests), resolved
  by one explicitly evidenced first-FIELD-annual exception; no history was
  backfilled and that FAIL is preserved beside the actual 16-request PASS.
- The coordinator's twenty-minute five-cycle OFFICE functional endurance is
  still running. Its completion, final OFFICE logout and saved phone-state
  restoration are NOT_RUN at this snapshot. No all-night functional acceptance
  is claimed. Physical camera QR/document capture, external email sends and a
  300-employee load test remain NOT_RUN. Full OFFICE private queue counts remain
  NOT_OBSERVABLE; canonical covered actions do not establish a hidden zero count.
- Checks PASS: 13 imported JSON files parse; all 30 non-README imports match
  immutable source bytes; both README tails and the old S23 case prefix remain;
  the five main-only files and two reviewed date source/test files match their
  saved hashes. Diff whitespace is checked before commit. No tests, typecheck,
  build, browser or device action was repeated for this evidence-only resync;
  these are NOT_RUN here under the host contract. The final source-bearing PR
  still requires hosted exact-head gates and the date-format visual check after
  its release. A final coordinator snapshot is required after endurance and
  restoration before publication.
