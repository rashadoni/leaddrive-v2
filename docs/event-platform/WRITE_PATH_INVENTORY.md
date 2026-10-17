# Event-platform write-path inventory

Status: **K0.2 PARTIAL — Fund paths inspected; bounded non-Fund chains are
recorded in the [separate inventory](./NON_FUND_WRITE_PATH_INVENTORY.md).
Remaining domains and alternate writers are not inspected.**

Source reviewed: `origin/main` at
`9ead36ce7ef64cb16d521acad9bc3b210812a3c9` (2026-10-17).
This is a bounded source-code inventory, not proof of current production
configuration, a running Kafka worker, or completed all-module adoption.
Warehouse and Accounting implementation remains outside this inventory and
must follow their separate card-by-card process.

## 1. Fund command and read paths

All four Fund route files use `withRlsAuth("finance", action, ...)`.
The wrapper authenticates/authorizes the caller, then executes the handler in
the resolved tenant context. The Prisma transaction wrapper sets `app.org_id`
on the same transaction connection; a standalone worker must provide an
equivalent tenant-scoped transaction using its own restricted role.

- [Authorization wrapper](../../src/lib/with-rls.ts)
- [Tenant context](../../src/lib/rls-context.ts)
- [Prisma transaction wrapper](../../src/lib/prisma.ts)

| Path | Observed behavior | Event and recovery boundary |
|---|---|---|
| [`GET /api/finance/funds`](../../src/app/api/finance/funds/route.ts) | Reads tenant `Fund` rows, including rules; normalizes decimal fields for the response. | Reads `Fund.currentBalance`; does not resolve the generic projection activation pointer. |
| [`POST /api/finance/funds`](../../src/app/api/finance/funds/route.ts) | Requires `Idempotency-Key`; opens a Fund in a serializable transaction. | Receipt lookup, Fund creation, `finance.fund-opened.v1`, outbox, active balance projection v1 and command receipt commit together. |
| [`GET /api/finance/funds/[id]`](../../src/app/api/finance/funds/[id]/route.ts) | Reads one tenant Fund and its rules. | Same `Fund.currentBalance` read path; no projection pointer lookup. |
| [`PUT /api/finance/funds/[id]`](../../src/app/api/finance/funds/[id]/route.ts) | Updates changed metadata; rejects changing currency; no-op when requested values already match. | Serializable state/event/outbox/projection update with `finance.fund-metadata-updated.v1`. Does not use command receipts or an idempotency-key header. |
| [`DELETE /api/finance/funds/[id]`](../../src/app/api/finance/funds/[id]/route.ts) | Archives a Fund; an already archived Fund is a no-op. | Serializable state/event/outbox/projection update with `finance.fund-archived.v1`; no physical deletion. Does not use command receipts. |
| [`GET /api/finance/funds/[id]/transactions`](../../src/app/api/finance/funds/[id]/transactions/route.ts) | Reads tenant/fund ledger rows, newest first, with a page-size limit. | A display query, not a full-history replay source. |
| [`POST /api/finance/funds/[id]/transactions`](../../src/app/api/finance/funds/[id]/transactions/route.ts) | Requires `Idempotency-Key`; validates positive amounts to four decimal places and prevents overdraft. | Serializable receipt lookup, Fund balance update, immutable transaction row, `finance.fund-transaction-recorded.v1`, outbox, active projection v1 and receipt. |
| [`/api/finance/funds/[id]/rules`](../../src/app/api/finance/funds/[id]/rules/route.ts) | Tenant-scoped GET/POST/PUT/DELETE of Fund rules. | Rule writes do not append canonical events or command receipts. The rule execution paths have **NOT BEEN INSPECTED** here. |

Transaction credits are `deposit`, `transfer_in`, and `auto_allocation`;
debits are `withdrawal` and `transfer_out`. Amounts are converted to exact
four-decimal strings and `Prisma.Decimal`, not accumulated as JavaScript
floating-point values. Open/transaction commands reconcile a winning unique
receipt after a concurrent duplicate; serializable conflicts return a retryable
409. These behaviors are source findings, not a newly executed test result.

## 2. Canonical write boundary and compatibility writers

[`appendDomainEvent`](../../src/lib/event-platform/append.ts) validates the
implemented contract before advancing the aggregate head, allocates a stream
version, and inserts both `DomainEvent` and `EventOutbox` through the supplied
transaction. Callers must include their business mutation in that same
transaction. The returned outbox hash comes from PostgreSQL's canonical JSONB
boundary; it is not a hash of arbitrary re-serialized Kafka bytes.

[`findCommandReceipt` / `storeCommandReceipt`](../../src/lib/event-platform/command-receipt.ts)
scope identity to organization, command type and idempotency key. Reusing that
identity with a different request hash is rejected.

[`fund-contracts.ts`](../../src/lib/event-platform/fund-contracts.ts) validates
the five implemented Fund event/schema pairs, payload, aggregate identity and
classification. An unregistered Fund event is rejected. Non-Fund namespaces
still use the generic foundation path; this is not evidence that their domain
payloads have equivalent concrete validators.

The [Fund pilot migration](../../prisma/migrations/20260901100000_fund_event_source_pilot/migration.sql)
also contains SQL writers that must remain in the inventory:

- Legacy-history bootstrap emits one opening event followed by ordered ledger
  events and builds the active v1 balance projection.
- `fund_append_compat_event` and the `funds_compat_*` triggers canonicalize
  supported old-artifact Fund creation and metadata/archive/reactivation writes.
- `fund_transactions_event_source_guard_fn` canonicalizes supported legacy
  INSERT-first ledger writes. Deferred checks require the corresponding Fund
  balance mutation in the same transaction.
- Modern Fund APIs set transaction-local `app.event_source_write` and
  `app.event_projection_write` while explicitly writing the event/projection.
  Deferred coherence constraints still require the matching event, source
  balance, aggregate head and active projection at commit.
- Ledger updates/deletes and unsupported hard deletion are fenced. The
  [foundation migration](../../prisma/migrations/20260901090000_event_platform_foundation/migration.sql)
  enforces immutable events/outbox, hashes, stream coherence and canonical RLS.

[`scripts/seed-tenant-demo.mjs`](../../scripts/seed-tenant-demo.mjs) is another
production-capable writer: it creates Funds and writes demo ledger rows through
the legacy INSERT-first transaction sequence. It flushes deferred constraints
between successive entries while preserving one outer transaction. Preserve
this compatibility behavior during a later migration; do not run the seed as
a Kafka smoke test. The
[legacy-client probe](../../scripts/event-platform-legacy-client-probe.mjs)
also exercises these writes as a rollback compatibility check.

This search covered Fund route/model calls and relevant SQL, SDK, seed and test
paths. It does not claim that every dynamic/raw SQL writer in the entire
repository has been exhaustively classified.

## 3. Projections: implemented primitives versus application adoption

The [Prisma models](../../prisma/schema.prisma) and Fund migration define:

- `Fund.currentBalance` and `FundTransaction.amount` as `NUMERIC(18,4)`.
- `FundBalanceProjection` identified by tenant, Fund, projection version and
  build key; statuses include `shadow`, `active`, `retired`, and `failed`.
- One active Fund projection per tenant/Fund, with deferred checks requiring
  it to equal the Fund balance and latest aggregate head.
- Generic `ProjectionBuild`, `ProjectionCheckpoint`, `ProjectionActivation`
  and immutable promotion evidence.

[`projection.ts`](../../src/lib/event-platform/projection.ts) implements build
creation, lifecycle compare-and-swap, monotonic checkpoints and an atomic generic
activation pointer. The inspected source has pointer access in this SDK and
its tests, not in the Fund GET routes. A successful generic promotion therefore
does not currently change the balance returned by the Fund API.

Modern Fund writes and legacy compatibility triggers explicitly maintain
`projectionVersion = 1` with `status = active`. Retiring that row to activate
a Kafka-built v2 row would break this writer contract. The initial Kafka worker
must therefore write a separate **shadow** version/build key while v1 and the
current read path continue operating. Connecting the read pointer and changing
the writer/compatibility contract is a subsequent reviewed migration with its
own tests and rollback design.

## 4. Safe first Fund rebuild integration

1. Create a tenant-scoped shadow build with a distinct build key, reducer SHA
   and consumer identity/version; never reuse the live inbox identity for a
   rebuild that must process historical events again.
2. Consume the canonical opening and subsequent events in aggregate-version
   order. Require version 1 to be the single opening; reject gaps, unknown
   schemas, tenant/Fund/currency mismatches and conflicting duplicate hashes.
3. Compute balance from `openingBalance + sum(signedDelta)` using exact
   arithmetic. Metadata/archive/reactivation advance the version but contribute
   zero balance. Check non-negative/range bounds at every prefix. When present,
   `resultingBalance` is a consistency assertion, not the reducer's authority.
4. Commit shadow mutation, inbox receipt and checkpoint in one restricted
   tenant transaction. Acknowledge Kafka only after commit; retry conflicts
   safely. Validate actual broker rebalance/commit behavior in the integration
   harness rather than relying on SDK mocks.
5. At a defined consistent cutoff, compare each Fund's events, head, ledger,
   active v1 row and shadow balance; tenant totals alone are insufficient. Keep
   live writes/catch-up and the cutoff explicit so a moving head is not mistaken
   for corruption. Record counts/hashes rather than tenant payloads.
6. Keep all external effects fenced. Do not update `Fund.currentBalance`,
   promote the shadow or reset the active consumer group during this first
   integration step.

The [deep postconditions](../../scripts/event-platform-postconditions.sql)
already supply useful SQL checks for opening/prefix correctness, exact rebuild,
ledger linkage, event/outbox identity and contiguous streams. Reuse their
invariants; their current executable checks validate the existing active
projection, not a complete Kafka shadow-worker lifecycle.

## 5. Standalone test-stack integration map

| Existing component | Reuse and boundary |
|---|---|
| [Migration harness](../../scripts/ci/test-event-platform-migrations.mjs) | Creates minimal synthetic organizations/Fund tables, `org-a`/`org-b`, restricted app and separate migration/operator roles; applies real foundation, Fund and replay-control migrations. Uses disposable `event_platform_test`. Extend through an explicit test-stack setup rather than using production schemas or data. |
| [RLS test client factory](../../scripts/_rls.mjs) | `makeRlsTestPrisma` binds test connections to `EVENT_PLATFORM_TEST_DATABASE_URL`. Do not adopt the separate default `makeScriptPrisma` bypass path for the canonical worker. |
| [PostgreSQL SDK tests](../../src/__tests__/lib-event-platform-postgres.test.ts) | Real optimistic/concurrent append coverage gated by `EVENT_PLATFORM_TEST_DATABASE_URL`; this admin-connected fixture is not evidence of a correctly restricted worker. |
| [Fund API tests](../../src/__tests__/api-finance-funds.test.ts) | Request and receipt fixtures plus mocked atomic call expectations. Add real DB/transport tests for the integration; mocks cannot prove commits or RLS. |
| [Foundation tests](../../src/__tests__/lib-event-platform-foundation.test.ts), [projection tests](../../src/__tests__/lib-event-platform-projection.test.ts) | Reuse envelope, duplicate, effect-fence and lifecycle cases. Broker crash/rebalance behavior remains to be exercised. |
| [Consumer SDK](../../src/lib/event-platform/consumer.ts) | `processKafkaEvent` and `consumeIdempotently` provide transport validation and transaction/acknowledgement boundaries. No production broker adapter call site was found in the inspected source. |
| [CDC preparation](../../ops/event-platform/postgres/prepare-cdc.sql) | Restricts publication to INSERTs on `public.event_outbox`, establishes a dedicated CDC role/policy, requires logical WAL and finite slot retention. Test real snapshot and replication under this role; a successful SQL template check is insufficient. |
| [Debezium template](../../ops/event-platform/debezium/event-outbox-connector.template.json) | Routes the immutable envelope using tenant/aggregate key and origin headers; snapshot ordering is explicit. Render a disposable test target with separate credentials and TLS; never reuse production slot/endpoint values. |
| [Registry contracts](../../ops/event-platform/schema-registry/subjects.v1.json) | Govern schema identity/evolution. The schemaless connector does not invoke Registry validation; writer and consumer validation remain explicit. |

The first transport fixture should cover two synthetic tenants, Fund open and
credit/debit/metadata/archive events, duplicate delivery, restart after DB
commit before offset commit, and a deliberately incorrect shadow reducer.
Source/v1 checks must remain correct while the faulty shadow is rejected.

## 6. Remaining inventory and convergence work

These are inventory queues, not inspected implementations or completed Kafka
migrations. Each needs named command/writer/ingress/dispatcher/effect paths,
authority profile, identifiers, transaction boundary and recovery tests.

| Priority | Scope | Inventory status |
|---|---|---|
| Next Fund work | Rule execution, reversal/correction commands, all client retry behavior, promotion/read-pointer adoption | **NOT INSPECTED / NOT IMPLEMENTED by this inventory** |
| High consequence | Payments/refunds, invoices/bills, loyalty/points, entitlements, approvals/e-sign, tenant provisioning and security-sensitive configuration | **NOT INSPECTED**; Warehouse/Accounting cards are separately governed. |
| External effects and ingress | Email/SMS/push/webhook, telephony/social sends, provider receipts, AI billable calls, integration imports | **NOT INSPECTED**; catalogue stable business keys, reconciliation and direct-send paths before adoption. |
| Core operations | CRM, sales, support, marketing, omnichannel, MTM/workforce/mobile sync, automation and builders | **NOT INSPECTED** |
| Industry and derived domains | Health, insurance, public sector, media, energy, commerce, education, financial services, nonprofit, revenue recognition, TPM, analytics/Data Cloud | **NOT INSPECTED**; overlap with money/effect/ERP controls must be resolved before implementation. |

[`InMemoryEventBus`](../../src/lib/platform-events/event-bus.ts) is still a
per-process fire-and-forget bus: listener failures are caught/logged, and its
subscriber set is in memory. It is not durable Kafka delivery. Its callers and
`EventStream*` dispatch/retry paths have **NOT BEEN EXHAUSTIVELY INSPECTED** in
this pass; preserve their existing IDs and semantics until an adapter and
parity tests justify retiring them.

[`effects.ts`](../../src/lib/event-platform/effects.ts) provides the shared
effect request/fence helpers, but inspected call sites are foundation tests.
This does not prove existing provider senders use the shared state machine.
Their leases, business dedupe keys, ambiguous outcomes and direct calls remain
an explicit inventory task. The
[module catalogue](./MODULE_EVENT_CATALOG.md) is the coverage checklist, not
evidence that those paths are already migrated.

## Verification scope

This document records static reads at the source SHA above. No application,
broker, database, backup, replay or production operation was executed for this
inventory. Runtime/integration gates are **NOT RUN** here and remain work for
the isolated test-stack phase. K0.2 remains open for non-Fund domains and
exhaustive writer/dispatcher/effect mapping.
