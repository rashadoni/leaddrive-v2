# MTM5.4 — immutable closed month

Status: design before product code,2026-10-13. Fictional sample screens. Root owns5.5 report/table accounting; this task will not edit those helpers without coordination.

## Existing facts

- `WorkforceTimesheetApproval` stores final/completed calculation rows only; it cannot include MTM absences, holidays or missing days. Its routes remain withdrawn.
- Existing `workforce_time_corrections` and MTM request decision transaction already preserve request, approver, reason and before/after canonical facts. Do not create another workday, time calculator or correction mechanism.
- `readAttendanceProjectionInTransaction` reads one scoped report snapshot. `buildAttendanceTable` and existing Excel/PDF writers supply the exported representation. Current live exports re-read facts and are unsuitable for an old closed month.
- `lockMtmWorkdayTransitions` is the canonical agent write lock; completed day guards only permit ledger-backed updates/reopens. A new closed-period guard must additionally cover missing-day insertions and newly delayed events.

## Proposed behavior

A new page within MTM, reached from attendance without moving existing sections, lists closed monthly snapshots. A user chooses a finished month and an explicit current team/employee set, previews it, then closes that exact preview. The UI clearly identifies the frozen employee set and explains that missing attendance remains missing. Open or invalid canonical days must be resolved through existing employee requests before closing; the action never finishes a day.

Store an append-only close receipt and member records with the safe report and final MONTH table in az, ru and en. Freeze labels, names, legend, totals and closure metadata too. Validate/hash this stored payload when reading/exporting; never rebuild an old table from current rules, names, translations or corrected live facts. Excel/PDF are generated from the stored table (same contents; not necessarily identical container metadata bytes). The closed snapshot is never edited/reclosed. Subsequent approved time corrections appear separately, with before/after, reason, decision time and reviewer; link to the existing request. A live report may include those corrections, but the closed export remains its original contents.

## Permissions and races

Current session, active user, tenant capability, attendance feature and current role/team scope are reread inside every transaction. The HR all-employee grant stays read-only. Closing uses current write/reviewer scope; API keys cannot close. A full snapshot is visible/exportable only while the actor has current access to every member; do not silently remove former-team rows from a closed document. A duplicate client UUID repeats exactly, including after response loss; a different body with the same UUID is rejected. No second snapshot may overlap an already closed employee/accounting month.

Acquire existing canonical workday/request locks in sorted employee order before establishing the snapshot, plus a period/request idempotency lock. Preview content digest excludes variable request time but includes safe data; closing rejects changed facts instead of freezing an unseen report. Use database constraints and append-only tenant RLS. A deferred canonical-workday guard permits only a matching existing correction ledger for changes to covered dates; the existing correction transaction may insert a missing completed day before inserting its ledger. New events/returns against covered days must fail atomically while an exact already-accepted operation remains replayable.

The5.5 attribution projection is additive: root will provide accountingRows/sourceDate to MONTH tables. Store already prepared tables so frozen exports survive that extension. Closed-date coverage should use the included accounting rows' source dates when available, including the previous month's night shift, and retain canonical rows unchanged. Coordinate the precise row contract before product implementation.

## Validation

Focused unit/API/UI tests, locale parity, Prisma validate and actual RU/AZ/EN desktop/mobile renders. Real PostgreSQL CI must prove RLS, immutability, exact retry/mismatch, concurrent close versus events/corrections, rollback of failed audit, no direct edits/late marks, permitted ledger-backed missing-day correction, current access revocation, and unchanged exports after correction/config/name changes. Wire the migration-specific test into both PR and deploy database gates. No real email, push, GPS collection or production changes during implementation. Full semantic TypeScript/build and database tests run in CI, not on Contabo.
