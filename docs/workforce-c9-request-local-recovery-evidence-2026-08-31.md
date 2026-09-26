# Workforce C9 — request delivery recovery status (2026-08-31)

## Scope

The employee Requests screen now distinguishes the accepted server request
history from local encrypted-outbox delivery metadata. It reads only aggregate
state for the `HRM_REQUEST` domain and shows counts for pending acknowledgement,
server-refresh conflict and recovery review.

An offline submit or cancellation receives the aggregate from the metadata
store immediately after its durable enqueue. A later request-history refresh
also reads the local summary independently before it asks the server for
accepted history. This means a network failure can explain that delivery still
needs attention without producing a false leave, absence or correction fact.

## Safety and privacy boundaries

- The local summary has no request ID, request type, date range, correction
  workday, exception case, reason, note, operation ID or decrypted payload.
- Only the accepted server response supplies the request list, lifecycle,
  decision note and cancellation availability. A local pending action cannot
  be rendered as a submitted request or a reviewer decision.
- The account-bound encrypted outbox still owns recovery. The Request screen
  links only to the generic Recovery refresh guidance; it neither retries an
  operation nor accesses its ciphertext.
- EN, RU and AZ copy explicitly describes the values as delivery metadata,
  rather than an accepted request or decision.

## Verification

Passed in this worktree:

```text
vitest: workforce-android-foundation plus attendance/mobile contract regression set
eslint: updated Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, Room/process-death queue
recovery, signed application, physical offline/conflict/accessibility exercise,
browser E2E, Prisma migration apply, staging, load/restore and pilot.
