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
languages, with keyboard publication and four-sided action geometry. It preserves only
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
The canonical ledger remains 82/161 done, 79 open and 59% weighted until the
whole item has exact-source acceptance; no helper-level percentage increment.

This document does not approve merge, deployment, tenant activation, credentials,
permissions, retention changes or production migration execution. Those remain
subject to the user's separate scoped release authorization.
