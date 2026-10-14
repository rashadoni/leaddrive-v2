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
