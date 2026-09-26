# Workforce C6 — scoped exception-workbench backend evidence

**Status:** WF-C6-002 / WF-C6-005 partial, non-terminal backend slice
**Date:** 2026-09-26

## Delivered boundary

`GET /api/v1/workforce/exceptions` now uses a two-phase read after the explicit
granular-access cutover:

1. read at most 1,000 tenant-scoped metadata candidates without employee
   names, decision reasons, response content or proof;
2. resolve the immutable event/workday-time team membership in one bounded
   query and combine it with the persisted segment site;
3. apply `TEAM_EXCEPTION_READ` and `TEAM_EXCEPTION_DECIDE` per case;
4. load the raw-proof-free queue details only for at most 250 authorized ids.

A schedule-only no-show never gains a team from the employee's mutable current
directory assignment. It can match only an organization grant or its persisted
segment-site scope. Before granular cutover, the established tenant-admin read
boundary remains available but deliberately receives no mutation action.

The queue returns no database case id. A caller with an exact scoped decision
grant receives one AES-GCM token per currently offered action. Each five-minute
token is bound to version, organization, principal, encrypted case locator,
decision code, exact immutable decision count, issue time and expiry. Parsing
requires `isEncrypted()` before decryption and rejects plaintext, tampering,
another principal, stale/expired tokens, non-canonical ciphertext and a
lifetime over ten minutes.

`POST /api/v1/workforce/exception-decisions` accepts the token, operation id
and bounded reason. The caller cannot substitute a decision code or put a case
id in the URL/body. Inside one serializable transaction it re-reads the case,
historical scope and live grant, acquires the existing per-case decision lock,
checks exact replay before revision validation, rechecks the grant, then
validates bounded lifecycle/response/correction status before appending the
immutable decision and metadata-only audit. The earlier database-id decision
route is now a non-oracular tombstone.

The workbench understands a linked `TIME_CORRECTION` request as an employee
response signal without reading its reason or returning its id. It classifies
only bounded status context and accepts an applied correction only when the
same-case request is approved and owns exactly one immutable
`WorkforceTimeCorrection`. Existing `ESCALATE_TO_HR` history remains valid,
but escalation is not offered as a v1 action.

## Deliberate terminal-action fence

This slice offers only safe non-terminal actions (`ACKNOWLEDGE`,
`REQUEST_EMPLOYEE_RESPONSE`, `REQUEST_TIME_CORRECTION`). It does **not** offer
resolution or reopen tokens.

Independent review found that request submission, request approval/cancellation
and employee-response append do not yet all acquire the exception decision
lock. PostgreSQL serializable isolation alone can serialize disjoint-table
writes in an order that leaves `RESOLVE_NO_CHANGE` beside a concurrently
applied correction. Terminal actions therefore remain unavailable until a
separate reviewed cutover gives every linked writer the same lock order,
current-cycle visibility validation and a disposable-PostgreSQL two-writer
race proof. No completion credit is claimed by this partial slice.

## Independent-review repairs

The first frozen-diff review returned RED with six concrete findings. The
repair keeps the slice non-terminal and strengthens its existing boundaries:

- the fixed write endpoint now uses a session/capability/granular boundary
  without a legacy CRM-role pre-gate; the exact historical-resource grant is
  still re-read by the transaction service;
- Workforce capability and `workforce-granular-access-v1` are rechecked in the
  serializable write transaction, so a token issued before rollback cannot
  preserve the old authority mode;
- a complete 64-decision stream remains readable and exactly replayable, but
  the queue offers no token and the writer refuses a 65th append;
- top-level queue response state is derived from the same current-cycle
  visibility as offered actions, so an old response before the latest
  request/reopen is not shown as received;
- the deny-before-scan precheck now uses the pure access evaluator against each
  grant, including active time, revocation, known role and valid role/scope;
- action-token parsing requires exact base64url decode/re-encode equality, so
  alternate unused trailing pad bits cannot create a second textual token.

Independent rereview of the repaired complete frozen diff returned GREEN with
zero remaining findings. Its receipt fingerprint is
`a9227b49d1ff9799b06dea4c3e73e1e301110e3c88d9f4cd0e65bfd4899e1115` over
the base marker, binary tracked diff and sorted untracked path/hash/content
tuples; the measured upper bound was 136,811 bytes.

## Verification

Passed in this worktree using an existing dependency tree with the exact
current `package-lock.json` hash:

```text
PASS  13 focused Vitest files / 94 tests
      - token, per-row access and workbench context
      - decision writer and fixed decision API
      - scoped queue API and existing queue/policy/report contracts
      - per-case auth-wrapper deferral without CRM-role/organization-grant fallback
      - RLS route coverage and recovery-playbook source contracts
PASS  targeted ESLint for all changed TypeScript/test files
PASS  python3 scripts/rls/find-context-gaps.py (552 org models; 0 gaps)
PASS  git diff --check
PASS  independent repaired-diff rereview (0 findings)
```

`NOT RUN`: full local typecheck/build, browser E2E, Android, load, migration
apply, disposable-PostgreSQL RLS/concurrency and physical/staging pilot.
Contabo is limited to small sequential targeted checks; the exact-SHA GitHub
gates and an independent review remain mandatory before merge.
