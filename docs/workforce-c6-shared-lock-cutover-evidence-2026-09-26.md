# Workforce C6 shared-lock cutover evidence — 2026-09-26

Status: **RED-review findings repaired; independent rereview and real-PostgreSQL CI pending**.

This slice started from deployed `main` SHA
`13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af`. Immediately before its frozen
review, current `origin/main` SHA `5ab179e524b3047132201eb5170a631fa9d0b63c`
was merged without conflict; its only intervening product paths are unrelated
MTM planner UI/i18n files. After the RED-review repairs, `origin/main` advanced
again to `a18728b2b2ef20d9ac5f6f568647a23263db51ce` through unrelated MTM and
delivery-policy PRs and was merged without conflict as integration commit
`c49911e751a59a192d4a5201bc2af9b4f090739d`. The slice closes the concurrency
prerequisite found during the scoped exception-workbench review; it does not
enable terminal resolution or reopen actions and adds no roadmap credit.

## Safety invariant

Every new mutation linked to a Workforce exception case must:

1. run inside the caller's existing database transaction;
2. acquire the canonical transaction-scoped advisory lock
   `workforce-exception-decision:<organizationId>:<caseId>`;
3. read the bounded immutable decision stream only after that lock;
4. fail closed if the stream is invalid, capacity-bound or resolved; and
5. keep the same lock until the linked write commits or rolls back.

An exact completed replay is resolved before the lifecycle guard. A client
retry therefore stays idempotent after later case resolution, while changed
content and every genuinely new post-resolution mutation are rejected.

## Covered writers

- employee acknowledgement/correction-response append;
- web self-service linked correction submission and cancellation;
- manager approval/rejection of a linked correction request;
- legacy mobile sync linked correction submission and cancellation.

The source inventory contains no other `MtmHrmRequest` or employee-response
writer for an exception-linked record. The mobile compatibility path returns a
generic unavailable conflict and does not turn a case id into an oracle.

## Terminal transaction isolation

The manager exception-decision service now uses explicit PostgreSQL
`READ COMMITTED`. This is deliberate: a repeatable/serializable snapshot can
be opened by authorization preflight before the transaction waits for the case
advisory lock, then remain older than a linked writer that commits while the
terminal transaction is waiting. Under `READ COMMITTED`, the post-lock
statement receives a fresh snapshot. Tenant capability, granular cutover,
live grant and bounded linked context are rechecked after the lock immediately
before the immutable decision append.

Terminal resolution/reopen remain absent from the offered action set. Their
separate follow-up may consume this foundation only after this cutover is
reviewed, merged, deployed and proven on PostgreSQL.

## Real PostgreSQL proof

`src/__tests__/lib-workforce-exception-lock-postgres.test.ts` uses independent
Prisma clients and five separate scratch tables (decision stream, linked
mutations, linked-request replay state, employee responses and decision
operation ids). It inspects `pg_stat_activity` to prove the second backend is
actually waiting on an advisory lock rather than relying on timing sleeps.

It covers both orders:

- terminal-first: the linked writer waits, reads the committed terminal stream
  after the lock, rejects as resolved and writes no linked mutation;
- linked-first: the terminal transaction sees `0` before waiting and `1` after
  acquiring the lock, then appends its terminal decision. This proves the
  post-lock `READ COMMITTED` snapshot observes the mutation in the other table;
- cross-domain order: two writers that need both fences take
  `workday -> exception case`, so the second waits on the workday advisory lock
  and completes without an opposite-order deadlock; and
- exact replay: a submit waiter sees no uncommitted row before the lock and the
  committed `PENDING` row after it; a cancellation waiter analogously sees
  `PENDING` before the lock and `CANCELLED` after it;
- employee response id: the real writer holds a response inserted for case A,
  a case-B writer is observed waiting on the employee-global response-id
  fence, then rejects the committed cross-case collision without a second
  create;
- HR request id: the waiter is observed on the employee-global request-key
  fence before choosing case B, then sees the committed case-A record and does
  not enter a second case stream; and
- decision operation id: writers hold different case locks, serialize on the
  organization-global operation fence and expose the case-A winner to the
  case-B waiter without a second insert.

The test is wired as a blocking step in both `.github/workflows/pr-checks.yml`
and `.github/workflows/deploy.yml`, using their disposable PostgreSQL service.
It skips locally unless the dedicated opt-in scratch URL is present.

## Independent review findings and repairs

The first frozen independent review used base
`5ab179e524b3047132201eb5170a631fa9d0b63c`, fingerprint
`496c3914d6091a91134b8a2b96ea9e372e3d8990c462d6d145002d1e62c52238`
and a `74,164`-byte upper bound. It correctly returned RED with three P2
findings; that fingerprint is superseded and cannot authorize a checkpoint or
merge:

1. manager correction approval took `case -> workday`, opposite the existing
   timesheet path;
2. the post-lock decision grant recheck reused the pre-lock historical
   resource; and
3. linked submit/cancel did not repeat their exact idempotency read after
   waiting for the case lock.

The repair establishes one `workday -> case` order whenever both fences are
needed, re-reads the correction request under the workday lock, rebuilds the
historical team/site resource from the post-lock case row, and resolves exact
web/mobile submit and cancellation replays before the lifecycle guard. Unit
regressions and the expanded real-PostgreSQL proof cover all three findings.

The second complete-diff review used base
`a18728b2b2ef20d9ac5f6f568647a23263db51ce`, head
`31c9ba28587e7ce6831551782d43c659c54ab6b1`, binary-diff SHA-256
`d8232e78547a69c2cce55cc1e74134f458ed2688df811a3032ebcdbb40d34eff`
and a `115,161`-byte / 20-file scope. It also correctly returned RED with three
P2 findings; that receipt is superseded:

1. employee response uniqueness is global to organization/employee/response
   id but the replay read was protected only by a case fence;
2. HR request uniqueness is global to organization/employee/client request id
   but linked web/mobile submission could race through different cases; and
3. decision operation ids are organization-global but replay reads were
   protected only by the selected case fence.

Each path now takes its exact database-uniqueness advisory fence before the
replay read. Both decision writers and the employee-response writer treat any
residual `P2002` as a controlled rollback conflict and never issue a query in
an already-aborted PostgreSQL transaction. Web and mobile HR request writers
take the request-key fence before either an initial replay read or a case
choice. Unit regressions and the three new observed-wait PostgreSQL races cover
these findings. A new complete-tree independent rereview remains mandatory.

## Delivery-gate reconciliation

The integrated current `main` intentionally retires the GitHub
`agent-review` status and its publisher under the owner's repository-wide
delivery contract. This slice does not restore that status, alter branch
protection or add a paid review workflow. The active task nevertheless
requires a separate author-independent read-only review, so a zero-finding
complete-diff rereview remains a process prerequisite in addition to all five
required GitHub checks.

## Local evidence in this tree

- PASS — 8 focused Vitest files: 173 tests passed.
- SKIPPED — 7 real-PostgreSQL race tests because no approved local scratch URL
  was supplied; the new blocking PR/deploy steps must run them.
- PASS — targeted ESLint for every changed TypeScript and test file.
- PASS — recursive RLS context scan: 552 organization-scoped models, 0 gaps.
- PASS — event-platform/delivery asset contract: 27 domains, 86 topics,
  5 concrete schemas.
- PASS — GitHub runner policy across 37 workflow files.
- PASS — `git diff --check` before the documentation checkpoint.
- PASS — these repaired focused tests, ESLint, RLS scan, delivery asset
  contract, runner policy and diff whitespace on the tree based on
  `a18728b2b2ef20d9ac5f6f568647a23263db51ce`. The successful repeat used an
  existing dependency cache whose package-lock SHA-256 exactly matched this
  tree (`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`).

Current `origin/main` advanced afterward to
`13277465d731cdfc106e7942c0a2b97ffa38d0b5` through an unrelated demo-request
CORS slice. It was merged without conflict as local integration commit
`47c3d55a56e9755e7893a58a431fc5ce582aeaef`; the same 173-passed / 7-skipped
focused suite, targeted ESLint, RLS scan, delivery assets, runner policy and
diff whitespace all passed again on that exact integrated source tree.

`NOT RUN` locally by Contabo workload policy: full typecheck, production build,
browser E2E, Android/Gradle, load, physical-device and pilot checks. Exact-head
GitHub gates, the opt-in PostgreSQL proof and an independent read-only review
remain mandatory before merge.
