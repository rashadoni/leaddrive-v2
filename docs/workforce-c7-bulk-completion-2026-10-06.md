# WF-C7-007 — bulk schedules and sites

This candidate completes the existing future-effective bulk assignment path for
up to 200 named employees: review outcomes, discard a local draft, explicitly
confirm, and publish atomically. It does not introduce recurrence, overnight or
split shifts, cover rules, appeals, or any other undecided HR semantics.

The prior accepted candidate is `31d9eab5ea11e0eae3a0454efceae32af7f64ba4`.
Its immutable evidence remains at
`095ef3ef4b0de33e0170aca2766555e5c28d5632` on the recovery evidence branch.
Support and subsequent MTM main changes are integrated without changing their
behavior. Main integration is verified against exact repository bytes.

## Repairs

- A late preview cannot approve an edited draft. Switching organization,
  principal, role or authentication state discards sensitive draft state.
- Publishing freezes the exact confirmed request. An uncertain transport
  result retains its operation key for a safe retry and explains that local
  discard does not undo assignments the server may already have saved.
- An existing durable operation can replay after the effective-date boundary;
  every new operation still requires a future effective date.
- Bulk review and publish controls wrap within the available width while
  retaining visible keyboard focus and minimum target height. The original
  nowrap publish button overflowed the main viewport at 320 CSS pixels.
- The two publication controls use a darker orange background for readable
  normal-size white text. Actual computed colors are checked in normal/hover
  states under both light and dark root styles; the former default measured
  only 3.62:1 for 14px text.
- Site overlap preview reports bounded conflicts before publication, while
  retaining valid no-change and secondary-site behavior.
- The assignment guard allows narrowing an old team assignment after an
  employee transfer, with identity unchanged and all pinned workdays preserved.
  The migration changes a function only; it modifies no records or grants.

## Acceptance evidence

Local PostgreSQL 16 executes actual services, current selected migration guards,
non-owner FORCE RLS, concurrency, atomic rollback, receipt immutability,
200-person writes, transferred predecessors and pinned snapshots. The local
schema replaces two unrelated vector columns; this is explicitly not full
historical migration replay. Hosted acceptance uses unmodified candidate Prisma
schema on pgvector/pg16 and exact selected guard/receipt migrations.

Actual React tests exercise request races, confirmation, retry, scope changes
and conflicts. The browser workflow uses real credentials sessions and named
synthetic records with English, Russian and Azerbaijani UI, a phone viewport,
200-person selection boundaries and real native browser zoom in all three
languages, with keyboard publication, four-sided action geometry and 24 actual
text-contrast measurements requiring at least 4.5:1. It preserves only
minimized JSON metadata, outcomes and source hashes; no screenshots, credentials
or raw application/CI logs are acceptance artifacts.

The new workflow requires every expected PostgreSQL/React case and the entire
browser scenario to pass. A local Playwright browser download was rejected by
the environment network filter; no alternate download route was attempted.
Native zoom acceptance therefore requires the ordinary hosted Linux workflow.

Scoped TypeScript comparison retains the same six pre-existing TS7006 errors in
site-management; it adds no new diagnostic. Full required repository checks and
Linux production build must be evaluated for the published exact candidate.

## Roadmap and release boundary

The full 79-open-item audit selected C7 because its existing approved contract
can be implemented and tested without a new HR policy decision. Technical
evidence must not be counted as production activation, physical-device testing,
human assistive-technology acceptance, legal approval or full HRM acceptance.
Whole-item acceptance now closes C7-007 alone: 83/161 done, 78 open, C7 80%,
14/15 phase gates and 60% rounded weighted progress. No helper-level credit
or other task closure is added.

This document does not approve merge, deployment, tenant activation, credentials,
permissions, retention changes or production migration execution. Those remain
subject to the user's separate scoped release authorization.

The existing [rollback runbook, section 8](./workforce-pilot-rollback-retention-runbook-2026-08-28.md#8-rollback)
governs any later release rollback. Bulk assignments, immutable operation
receipts, audit entries and pinned snapshots must be preserved. Local draft
discard is not unpublish; a later corrected future assignment follows the
existing explicit publication rules. The function-only narrowing repair can
remain during a UI rollback. Restoring a prior function or disabling a live
capability requires separate scoped authorization; no destructive down migration
or reversal of saved employee facts is assumed.


## Accepted exact runtime checkpoint

Runtime head `d303ae3aac6a2ddb62439e433c08bca29c0befb9`, tree `d0b39cd92c5078b22438bc7249cde9701843ee35`, synthetic merge
`b59a81751fa811d419f2056f21348ea695d6bb47` on main
`d2fd13aab5c85841ccab723dfc9d784ca7c7fb09` passed all 15 applicable hosted jobs,
including the five mandatory checks and Linux production build. Independent
source and artifact review found no unresolved P0–P3 findings.

[Immutable evidence](https://github.com/rashadoni/leaddrive-v2/blob/f6a4d6ebf5d2326420d29eefc59eff627c218eaf/docs/evidence/workforce-c7-whole-item-2026-10-06/README.md) contains the original 52-case PostgreSQL/React,
26-case authenticated browser and 24-combination contrast receipts from run
37494712563, artifact 11427323359. All pass, no test is skipped, and minimum
measured text contrast is 5.223162711549741:1. Hashes bind the unmodified hosted
candidate schema, selected migration guards and actual sources. The archive
retains failed predecessors and local limitations; no current result is borrowed.

The subsequent documentation closure retains this exact runtime implementation;
its CI metadata is evaluated on its own published head. Next work is the separate
[C8-002 whole-item acceptance plan](./workforce-c8-whole-item-acceptance-plan-2026-10-06.md),
with no C8 completion credit or assumed external blocker.
