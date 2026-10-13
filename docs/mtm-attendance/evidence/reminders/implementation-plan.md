# Attendance reminders5.1 / notifications5.2

Confirmed scope: existing MTM only; both new switches defaultfalse and hidden while attendanceEnabled is off. The owner authorized autonomous continuation. QR and mobile CI remain separate. This document contains no private recipient or staff data.

## Product behavior

- Employee own inbox: remind about a missing START at planned start and a missing FINISH at planned end. One notice per employee/date/kind. Never close a day or manufacture time. Skip holidays/weekends, approved leave/sickness, currently excused hourly absence, invalid facts, inactive/nonparticipant employees and stale dates. Suppress finish prompts while the canonical pause reader says the day is paused.
- Manager bell: after the configured grace window, use neutral “arrival mark not received yet” rather than assert an unexplained absence. A later received arrival generates the separate late notice only when the existing report projection still has lateSeconds>0 after approved absence adjustment. Recipients are current active scoped reviewers, excluding self. Late offline delivery is not evidence of fraud.
- HR email: reuse1.10 DAILY schedule in the existing delivery editor,09:00 for the previous complete day, Excel/PDF and user-entered recipients. Empty by default; no second delivery system, no automatic recipient from profile, no real send during implementation/testing. Existing UNKNOWN provider handoff rule remains.

## Implementation boundaries

1. Settings keys attendanceEmployeeRemindersEnabled / attendanceManagerAlertsEnabled. Fresh active session admin, current MTM access, serialized policy lock and setting+audit transaction. Generic settings save preserves existing groups and other keys. Existing employee inbox uses the same switch at read/count/PATCH; no new mobile screen or independent permission storage.
2. Reuse attendance-report/rules/calendar/employment/request projection; extract only a transaction-scoped snapshot loader if necessary. Never fabricate an ADMIN actor to read a report for a background worker. Candidate inputs are explicit bounded employee ids inside tenant context. Existing pure report builder remains the source of planned instants, excused periods and deviation facts.
3. New append-only notice ledger stores organization, subject employee, work date, kind, recipient and safe observed facts. Unique organization+employee+date+kind+recipient prevents repeat after crash/re-enable/rule edits. Notice and own MtmNotification or reviewer createNotification commit together. No email/push transport inside the transaction. Tenant RLS, event-specific insert guard, immutable history.
4. Cron uses existing job lease plus bounded tenant-context batches and durable fair progress. SystemJobCursor forbids tenant/employee payload; use a numeric opaque global scan offset or tenant-scoped progress, not raw employee ids in that global table. Recheck current switches, active ownership and reviewer scope under locks just before creating notices. No historic catch-up burst. Cron smoke is read-only and returns processed0.
5. New notice kind maps to MTM taxonomy/link; active bell preference behavior uses the existing on-unless-explicitly-off mechanism. Own and web inbox counts/read updates apply the same current feature/scope filter as rows, so revocation cannot leave stale previews. Display wording does not disclose medical reasons or GPS.
6. Existing company settings gain one group with two switches. Existing delivery section gains a daily-summary preset or direct link; addresses remain empty and delivery disabled. No other settings section is moved or removed. RU/AZ/EN point inserts. Mock PNG precedes UI implementation.

## Meaningful gates

- Pure timing/projection: start/grace/end boundaries, weekends/public and company holidays, moved workday, full/partial approved absence, sickness, cancelled request, wrong timezone/DST ambiguity, employment interval, invalid facts, paused finish, already completed, delayed arrival and re-enable.
- Real PostgreSQL: parallel workers deduplicate; ledger+notification rollback together; OFF/revocation race; cross-tenant and manager scope/self; recipient changes; RLS/immutability; current inbox/count/PATCH filtering; bounded progress resumes after restart. No real provider sends.
- Settings API unauthorized mixed payload writes nothing; boolean validation and audit rollback. UI switches conditional and other company groups preserved; loss-of-response handling. Daily preset empty addresses/disabled/default format and existing1.10 delivery regression.
- Targeted sequential unit/lint/i18n/Prisma checks after RAM/disk/PSI preflight and coordinator slot. Full type/build/PG/production gates in GitHub CI. Fictional actual screenshots1440/390 and all3 languages after tests; physical phone NOT RUN unless separately exercised.
