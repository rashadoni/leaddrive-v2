# Workforce payroll and HRIS integration boundary

Decision for release 1: **LeadDrive Workforce is not a payroll engine and has
no external HRIS delivery contract**.

The released export is a direct-session, hash-verified review of one immutable
approved-timesheet revision. It contains operational time facts only. Overtime
is labelled `OPERATIONAL_DEVIATION_NOT_PAYABLE`; the file contains no wage,
premium, tax, benefit, deduction, disciplinary or physical-presence decision.
It is not a reusable integration artifact and has no external recipient retry
ledger.

This boundary implements the owner's 2026-08-28 choice to release approved
timesheet export only. WF-C11-010 remains conditional and unbuilt because no
external HRIS has been approved.

## Required separate project before integration

An external payroll/HRIS contract requires a separately approved project that
names:

- the accountable system of record for employee identity, schedule,
  approved time, pay and correction ownership;
- jurisdiction/collective-agreement rules, payable breaks/travel/overtime,
  rounding precision/order and period/calendar boundaries;
- explicit recipient, purpose, tenant/employee/period scope, encryption and
  key custody, artifact expiry, deletion and legal hold;
- a versioned signed schema, idempotency key, delivery state machine, ambiguous
  outcome reconciliation and immutable retry/custody audit;
- correction/supersession semantics that never edit a previously delivered
  revision; and
- staging reconciliation against the receiving system, rollback/freeze owner,
  privacy/security review and a human-approved go-live.

Until all items are approved, no attendance claim, evidence verdict, exception,
report or operational overtime figure may trigger payroll or disciplinary
action. New integration code must not reuse the ordinary direct-download route
as a background delivery channel.
