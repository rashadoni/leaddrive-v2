# Workforce C7 — delegation and manager-absence contract

**Task:** `WF-C7-009`  
**Status:** definition accepted; implementation and rollout remain separate work  
**Recorded:** 2026-09-13

## Release contract

Delegation is a temporary, explicit authorization record. It is never account
sharing, impersonation, a copied CRM role or a rewrite of historical team/site
ownership. Every action continues to identify the human who performed it and
the delegation record that made the action eligible.

A delegation record must contain:

- one tenant, delegator and delegate;
- an allow-list of Workforce operations and the exact team/site scope;
- a future `startsAt`, a finite `endsAt`, the business timezone and a bounded
  reason code;
- the approving HR/tenant-admin actor, creation time and immutable policy
  version; and
- append-only activation, revocation and expiry events.

Recommended release-one defaults are a maximum duration of 14 calendar days,
no retroactive activation, no automatic renewal and no re-delegation. A shorter
tenant policy may tighten the duration. Extending scope or time creates a new
approval; it never mutates the old record.

## What may and may not be delegated

Release one may delegate only ordinary manager operations already authorized
for the delegator: viewing the bounded team/site roster, deciding employee
leave/absence/correction requests and reviewing non-sensitive exception
status. The delegate receives the intersection of:

1. the delegator's effective historical Workforce scope;
2. the approved delegation allow-list; and
3. the delegate's own compatible active employment and tenant membership.

The following remain non-delegable: raw-evidence access, device/QR
administration, timesheet export custody, retention/legal hold, tenant
administration, privilege assignment, pilot activation and emergency
break-glass access. A delegation cannot satisfy an incompatible-role rule or
expand authority through Route & Field.

## Planned absence workflow

1. The manager selects a named active substitute, exact scope, start/end and
   reason before the absence.
2. The server previews conflicts, incompatible roles and uncovered teams/sites.
3. An accountable HR administrator approves or rejects the bounded request.
4. At `startsAt`, authorization becomes effective without copying a permanent
   role. The delegator may retain read access but cannot create two independent
   final decisions for the same pending item.
5. The system attributes every read/write to the actual delegate and records
   the delegation reference in immutable audit metadata.
6. Revocation, employment termination, tenant removal, incompatible-role
   activation or `endsAt` disables the delegation immediately for new actions.
7. Open work returns to the normal accountable queue; it is not silently
   reassigned or auto-decided.

If no substitute is approved, the bounded queue remains available to the
tenant's existing accountable HR role. The system must show uncovered scope;
it must not infer a replacement from CRM ownership or Route assignment.

## Emergency path

Unexpected absence uses a separately labelled emergency request with a short
maximum window, bounded reason and immediate notification to HR/security. It
does not grant any non-delegable permission. A second accountable actor reviews
the use after the fact within one business day; review can revoke future access
but cannot erase actions already taken.

## Audit, privacy and lifecycle

- Ordinary queue screens show named business scope and expiry, not raw proof,
  exact coordinates, device identifiers or employee free-text evidence.
- Audit retains delegator, delegate, approver, requested/effective scope,
  policy version, lifecycle event and actual action actor.
- Expired/revoked records remain append-only history and are excluded from
  current authorization.
- A daily stale-access review reports only bounded counts and delegation
  references; it never auto-deletes history.

## Acceptance for later implementation

The implementation is acceptable only when tests prove tenant isolation,
historical team/site scope, future activation, expiry/revocation, termination,
incompatible-role rejection, no re-delegation, idempotent concurrent decisions,
actual-actor attribution and Route independence. Browser evidence must cover
request, approval, active, revoked, expired and uncovered-scope states in
AZ/RU/EN.

No database row, production role, tenant flag or current authorization behavior
is changed by this definition.
