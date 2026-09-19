# CRM Voice Assistant: Canonical Command Layer Audit

Status: C1.1 complete; task create, lead create/update, and deal create commands implemented

Date: 2026-09-19

Scope: the existing task, lead, and deal write paths that must be made canonical
before the in-CRM voice assistant receives proposal tools.

This document is an implementation audit, not a claim that voice writes are
enabled. The assistant still has no CRM commit tool.

Implementation update:

- `createTaskCommand` now owns strict parsing, fail-closed field permissions,
  tenant checks, board policy, task-key retry, the task transaction, and current
  post-commit effects.
- `POST /api/v1/tasks` is an HTTP adapter over that command.
- Primary assignee and related-record tenant checks were added.
- Task, collaborator rows, and the created activity now commit atomically.
- Durable idempotency receipts and external-effect outbox delivery remain open
  under C1.12 and the action-intent phase. No voice caller can invoke commit.
- `createDealCommand` now owns strict parsing, fail-closed field permissions,
  pipeline/stage validation, tenant checks for all referenced records,
  duplicate warnings, and the existing deal-created effects.
- `POST /api/v1/deals` is an HTTP adapter over that command. Accepted tags are
  now persisted instead of being silently ignored.

## 1. Decision

Do not call the existing REST routes from the voice assistant and do not copy
their handlers into AI-specific endpoints. Extract one typed command per
business operation, then make both REST and the future confirmed voice action
call that command.

The first command slice is `createTaskCommand`. It has the smallest business
surface of the requested actions, but extraction must first close its missing
assignee and related-record tenant checks and make task plus collaborators one
transaction.

The implementation order is:

1. Shared command contracts, strict schemas, typed errors, and trusted actor
   context.
2. `createTaskCommand` and REST parity tests.
3. `createLeadCommand` and the existing field-permission fallback correction.
   Implemented: the REST route now shares the strict command, forbidden fields
   fail closed, tenant-owned assignees and pipelines are validated, and direct
   command callers receive possible-duplicate and assignment-state metadata.
4. `updateLeadCommand` with an explicit voice field allow-list and stale-write
   protection.
   Implemented: REST updates share the command, forbidden fields fail closed,
   assignee and pipeline references are tenant-validated, and voice updates
   require an atomically checked `expectedUpdatedAt`. Status, conversion,
   scoring, and qualification fields remain outside the generic voice update.
5. `createDealCommand` with complete pipeline/stage/user/campaign ownership
   validation.
   Implemented: the REST route now shares the strict command, forbidden fields
   fail closed, pipeline stages and referenced tenant records are validated,
   tags are persisted, and direct command callers receive possible-duplicate
   warnings.
6. `convertLeadToDealCommand` as its own atomic operation.
7. Durable effect delivery for side effects that cannot be part of the record
   transaction.

## 2. Current entry points

| Operation | Current route | Route authorization | Record visibility |
|---|---|---|---|
| Create task | `POST /api/v1/tasks` | `withRls`; method/path RBAC and tenant RLS | Board create/move checks when a division is selected |
| Update task | `PATCH /api/v1/tasks/:id` | `withRlsAuth("tasks", "write")` | Organization scope plus board edit/move checks |
| Create lead | `POST /api/v1/leads` | `withRlsAuth("leads", "write")` | New record; owner defaults to actor or selected seller |
| Update lead | `PUT/PATCH /api/v1/leads/:id` | `withRlsAuth("leads", "write")` | `applyRecordFilter` before mutation |
| Create deal | `POST /api/v1/deals` | `withRls`; method/path RBAC and tenant RLS | New record; owner defaults to actor |
| Update deal | `PUT/PATCH /api/v1/deals/:id` | `withRls`; method/path RBAC and tenant RLS | Organization scope only in the detail route |
| Convert lead | `POST /api/v1/leads/:id/convert` | `withRlsAuth("leads", "write")` | `applyRecordFilter` on the source lead |

`withRls` and `withRlsAuth` are not interchangeable. The extraction must make
the required module/action permission explicit in each command contract rather
than depending on an HTTP pathname lookup.

## 3. Operation matrix

### 3.1 Create task

Current validation and policy:

- Title, description, status, priority, type, event type, category, dates,
  estimates, recurrence, project, board, relation, custom fields, and up to 20
  collaborators are parsed by the route schema.
- Required task custom fields are validated.
- Task type and event type are validated against tenant configuration.
- Project and division are checked inside the organization.
- Department containers cannot own tasks.
- Effective inherited board permission gates create and initial downstream
  status placement.
- Recurrence syntax is validated.
- Collaborators are de-duplicated and required to be organization members.
- A division task key is generated with a bounded unique-race retry.

Current effects:

- Audit log.
- `TaskActivity` created activity.
- Project rollup recalculation.
- Task-created workflows.
- Assignee notification, push, and conditional email.

Extraction blockers:

- `assignedTo` is not explicitly verified as a member of the organization.
- `relatedType` and `relatedId` are accepted on create without the org-scoped
  `resolveRelated` validation already used by task update.
- Create does not enforce task field permissions, while task update does.
- The task row and collaborator rows are separate commits. A collaborator
  failure can leave a partially created task.
- Most effects are best effort and have no durable delivery receipt.
- The route's Zod object is not strict, so unknown input keys are stripped
  instead of rejected.

Required command behavior:

- Fail closed for forbidden and unknown fields.
- Validate primary assignee, collaborators, project, division, and related
  entity under the actor organization.
- Commit task, collaborators, activity, idempotency receipt, and durable domain
  event/effect intent in one transaction where the adopted infrastructure
  supports it.
- Preserve task-key collision retry and current board semantics.

### 3.2 Create lead

Current validation and policy:

- Contact name is required; phone and WhatsApp values receive plausibility
  checks; estimated value is bounded.
- Explicit assignee must be an active `sales` user in the organization.
- Explicit pipeline must be active and organization-owned.
- Sales users default to the Sales pipeline; ownership otherwise defaults to
  the actor before optional assignment rules run.
- Field permissions are loaded and `filterWritableFields` is called.

Current effects:

- Synchronous lead scoring before the response.
- Audit log.
- Optional automatic assignment rules.
- Lead-created workflows.
- CDP unified-profile refresh.
- Organization notification and direct assignee push/email.
- `lead.created` webhook.

Extraction blockers:

- The create payload restores many values from `parsed.data` when a value is
  missing from `writableData`. A field denied by field permissions can therefore
  be written anyway. The command must reject this request, not reproduce the
  fallback.
- No normalized duplicate check exists for email or phone.
- Assignment rules run after creation and can make the returned owner or
  preview stale unless the resulting assignment is represented explicitly.
- Database mutation, audit, scoring, assignment, workflow, CDP, notification,
  and webhook delivery do not share a recoverable command boundary.
- Unknown keys are stripped by the route schema rather than rejected.

Required command behavior:

- Required fields must themselves be writable; lack of field permission is a
  forbidden-field error, never a fallback to unfiltered input.
- Return structured duplicate candidates/warnings using normalized phone and
  case-insensitive email without automatically merging records.
- Make final assignment deterministic or surface a post-command assignment
  result in the receipt.
- Preserve scoring and all current effects through an explicit effect plan.

### 3.3 Update lead

Current validation and policy:

- The source lead is selected through `applyRecordFilter`.
- General field permissions are applied.
- A changed pipeline must be active and organization-owned.
- Qualification/call-outcome updates use a separate helper with assignee and
  compatibility rules and can synchronize linked Inbox conversations.
- Lead scoring is awaited after a successful update.

Current effects:

- Audit log.
- Updated or status-changed workflows.
- Assignment and status notifications.
- `lead.updated` webhook.
- Inbox qualification synchronization and score refresh.

Extraction blockers:

- `pipelineId` is explicitly copied back from parsed input after field
  filtering, which can bypass a denied field rule.
- A changed `assignedTo` is not explicitly checked as an active member of the
  same organization in the update route.
- There is no expected `updatedAt` check, so a confirmed voice draft could
  overwrite changes made after preview.
- Ordinary fields and qualification updates can commit through separate paths.
- Audit currently records parsed input, including fields that may not have been
  written.

Voice v1 allow-list:

- Allow only the fields approved in Phase 0, expected initially to be contact
  name, company name, email, phone, WhatsApp phone, Telegram handle, source
  detail, interest, brand, category, priority, estimated value, notes,
  assignee, and pipeline.
- Keep status, conversion, score, score details, qualification/system fields,
  deletion, and bulk changes outside the initial generic update command.
- Require `expectedUpdatedAt` at commit and return `stale` if it no longer
  matches.

### 3.4 Create deal

Current validation and policy:

- Name is required; value, probability, expected close, and basic scalar
  fields are parsed.
- Contact, company, and explicit active pipeline are checked inside the
  organization.
- Without a pipeline, the active default pipeline is selected.
- When probability is omitted, it is derived from a matching pipeline stage.
- Field permissions are applied before schema parsing.

Current effects:

- Audit log.
- Deal-created workflows.
- Organization notification.
- `deal.created` webhook.
- Contact timeline event.
- Slack notification to active Slack channel configurations.

Extraction blockers:

- A supplied stage is not required to belong to the selected pipeline. When
  probability is supplied, no stage lookup is needed by the current route at
  all.
- `assignedTo` and `campaignId` are not explicitly organization-validated.
- `tags` is accepted by the schema but is not written by the create mutation.
- No duplicate policy exists.
- Forbidden fields are silently removed before validation rather than reported.
- External effects are fire-and-forget.

Required command behavior:

- Resolve pipeline first, then require an active stage in that exact pipeline.
- Validate assignee, campaign, contact, and company under the organization.
- Either persist supported tags or remove them from the command schema; never
  acknowledge data that was ignored.
- Return possible duplicate warnings without blocking an explicitly confirmed
  create unless product policy says otherwise.

### 3.5 Convert lead to deal

Current validation and policy:

- The source lead is record-filtered and must not already be converted.
- Inbox-origin leads are forced into the active SMM pipeline when available.
- Otherwise the lead/requested/default active pipeline is selected.
- The requested stage is matched inside that pipeline; an open-stage fallback
  is selected when necessary.
- Company lookup/create, contact lookup/create, contact-company association,
  deal create, and lead conversion are in one database transaction.
- Contact matching is exact case-insensitive email or exact phone.

Current effects:

- Lead-converted survey trigger only.

Extraction blockers:

- Conversion does not emit the audit records, workflows, webhook,
  notification, contact event, or Slack behavior associated with canonical
  lead/deal mutations.
- Repeated conversion is rejected, but there is no durable idempotent receipt
  that can return the first successful result after a network failure.
- The operation needs its own permission and effect contract; it must not be
  implemented as an uncoordinated `updateLead` plus `createDeal` pair.

Required command behavior:

- Keep company/contact/deal/lead mutation atomic.
- Store and replay the successful response by command idempotency key.
- Emit explicit `lead.converted` and `deal.created` domain facts and map all
  approved downstream effects once.

## 4. Cross-cutting findings

### 4.1 Field permissions must fail closed

`filterWritableFields` intentionally drops fields marked visible-only or
hidden. That is suitable for some legacy form flows but unsafe for a confirmed
AI action: the receipt could say that five fields will change while the server
silently writes three.

The command adapter must compare supplied keys with writable keys and raise a
typed `FORBIDDEN_FIELD` error containing only safe field names. Administrators
retain their existing all-fields behavior. REST compatibility changes require
targeted tests and release notes.

### 4.2 Tenant checks must be explicit

RLS remains defense in depth, but every referenced identifier must be resolved
with `organizationId` in the query. This includes users, collaborators,
contacts, companies, campaigns, projects, divisions, pipelines, stages, and
related records. A model-provided raw database ID is never trusted; future
voice resolution produces server-bound candidate tokens.

### 4.3 Idempotency is part of the command transaction

Every command accepts a stable `idempotencyKey` and a hash of its normalized
request. The same tenant, command type, and key returns the stored result. The
same key with a different request hash is a conflict.

The repository already contains `EventCommandReceipt`, domain-event, event
outbox, and effect-outbox primitives. CRM is still marked `planned` in the
event-domain catalog, so adopting those primitives requires an explicit CRM
implementation boundary, contracts, migrations if necessary, and tests. Their
existence alone does not make current CRM effects durable.

### 4.4 Side effects need an explicit plan

Each command returns an internal effect plan generated from the committed
result, not from raw request input. Database-local audit/activity/event rows
belong in the command transaction. Provider-facing email, push, Slack,
webhooks, and similar calls require a durable outbox with a deterministic
effect key and a worker that records delivered, retryable, terminal, and
unknown outcomes.

Until that worker exists, extracted REST commands may preserve current
post-commit best-effort behavior behind one dispatcher, but this is an
intermediate compatibility state and does not satisfy C1.12.

### 4.5 Record sharing is command policy

Update commands must receive and apply the same record filter as their REST
caller. The deal detail/update route currently differs from the deal list by
using only organization scope; the voice layer must not silently broaden that
behavior. Resolve the desired parity as a separate permission correction with
tests before exposing deal updates. Deal update is therefore outside voice v1.

## 5. Target command contracts

```ts
type CrmCommandSource = "rest" | "voice"

interface ActorContext {
  organizationId: string
  userId: string
  role: Role
  source: CrmCommandSource
  requestId: string
  idempotencyKey: string
  voiceSessionId?: string
  actionIntentId?: string
  providerToolCallId?: string
}

interface CommandResult<TEntity, TEffectSummary> {
  entity: TEntity
  created: boolean
  receiptId: string
  warnings: CommandWarning[]
  effectSummary: TEffectSummary
}
```

Rules:

- `ActorContext` is constructed only after server authentication. The request
  body cannot override it.
- Commands are transport-agnostic and throw typed domain errors. REST and
  action-intent adapters map those errors to their own response envelopes.
- Schemas use strict objects and reject unknown fields.
- Dates are normalized once, before request hashing.
- Money retains its canonical decimal representation; command results do not
  derive hashes from JavaScript floating-point serialization.
- Command functions accept a transaction/dependency boundary for deterministic
  tests and never import an HTTP request or response type.
- A voice draft may validate and preview, but commit always reloads permissions,
  referenced entities, duplicate state, and the target version.

Proposed module boundary:

```text
src/lib/crm-commands/
  actor-context.ts
  errors.ts
  idempotency.ts
  field-permissions.ts
  effects.ts
  task/create-task.ts
  lead/create-lead.ts
  lead/update-lead.ts
  lead/convert-lead-to-deal.ts
  deal/create-deal.ts
  schemas/
```

## 6. Parity test contract

For each extracted operation, tests must run the REST adapter and direct
command with equivalent authenticated input and assert parity for:

- normalized mutation data and defaults;
- required module and board permissions;
- record-sharing visibility;
- field-permission rejection;
- cross-tenant identifiers;
- custom fields and dynamic tenant configuration;
- duplicate warnings;
- audit/activity/domain-event rows;
- planned workflow, notification, webhook, CDP, contact-event, survey, and
  Slack effects;
- idempotent retry and changed-payload conflict;
- transaction rollback after injected failures.

The existing route suites provide useful baseline coverage in
`api-tasks.test.ts`, `api-leads.test.ts`, and `api-deals.test.ts`, but they do
not currently cover all blockers listed above.

## 7. First implementation slice exit gate

`createTaskCommand` is ready to merge only when:

- the REST route calls the command;
- route response/default behavior remains compatible;
- assignee and related entity are tenant-validated;
- task and collaborators commit atomically;
- unknown and forbidden fields fail closed at the command boundary;
- board, custom-field, recurrence, project, notification, workflow, activity,
  and audit behavior has parity tests;
- idempotent retry cannot create a second task;
- the voice assistant still has no commit tool.
