# CRM voice action execution boundary

Status: internal foundation implemented; commit remains disabled.

## Purpose

The five canonical CRM commands can now participate in the same database
transaction as the terminal `AiActionIntent` result. This closes the dangerous
window where a lead, deal or task could be committed but the action receipt
could remain unknown and a retry could create a duplicate.

The internal executor accepts only an action already claimed with an execution
lease. It is deliberately not exposed by an API route and is not available to
the model.

## Atomic boundary

For `create_task`, `create_lead`, `update_lead`, `create_deal` and
`convert_lead_to_deal`, one interactive database transaction now contains:

1. the tenant/user-owned intent read and lease validation;
2. normalized-payload integrity validation;
3. the canonical CRM record mutation;
4. compare-and-swap of the intent from `executing` to `succeeded`;
5. the minimal stored result (`entityType` and `entityId`);
6. the immutable `succeeded` event.

If command validation fails, the lease is lost, the terminal compare-and-swap
loses, or the process/database fails before commit, all database changes in
this boundary roll back. If the transaction commits but the response is lost,
a retry with the same lease returns the stored result without invoking the CRM
command again.

## Side effects

Notifications, workflows, webhooks, scoring, audit helpers and rollups cannot
run before this wider transaction commits. Canonical commands collect those
effects when they receive a transaction context; the executor dispatches the
collection only after the transaction resolves successfully.

This is a crash-safety boundary for the CRM record and receipt, not yet a
durable-delivery guarantee for external effects. A transactional outbox and
retriable delivery remain required by roadmap item C1.12.

## Safety boundary

There is still no commit route. This slice does not consume confirmation proof,
claim an action, recover expired leases, expose a write tool to the model or
enable voice-created CRM records. The future commit slice must first recheck
tenant, role, module, field and target permissions, atomically consume the
single-use proof and claim an execution lease before calling this executor.
