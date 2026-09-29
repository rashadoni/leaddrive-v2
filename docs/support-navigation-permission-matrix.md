# Support navigation and authorization matrix

This matrix is the implementation contract for the Support module navigation.
It deliberately separates discoverability from authorization: the sidebar,
search, mobile selector and page shell are UX gates; APIs remain the security
boundary. A hidden destination must never be treated as access control.

## Shared rules

- `src/lib/nav-items.ts` is the single destination catalog used by sidebar,
  search, App Launcher, command palette and the labeled mobile selector.
- The dashboard layout evaluates the matched catalog item before mounting a
  gated page. Unknown nested routes inherit the longest matching catalog base.
- `withRls` and `withRlsAuth` establish authenticated organization context for
  internal APIs. Every record lookup or mutation must also retain its explicit
  `organizationId` predicate or tenant-scoped execution.
- Support AI additionally requires the `ai` add-on and an `admin` or
  `superadmin` role. Support VoIP requires the `voip` add-on. Complaint Registry
  requires `complaints_register`. Those gates apply to direct page entry as
  well as every navigation projection.
- Customer portal routes are not part of this internal navigation. Their
  contact/tenant/token boundaries are documented in
  `docs/support-customer-portal-journey.md`.

## Destination matrix

| Task group | Destination and nested routes | Navigation/page gate | Primary API boundary |
| --- | --- | --- | --- |
| Work | Service Desk `/tickets`, `/tickets/[id]` | Support module | `/api/v1/tickets*`: authenticated RLS organization plus record/field sharing rules |
| Work | Complaint Registry `/complaints`, `/complaints/new`, `/complaints/import`, `/complaints/[id]` | Support module + `complaints_register` | `/api/v1/complaints*`: `tickets.read/write` permission and organization predicates |
| Work | Agent Desktop `/support/agent-desktop` | Support module | `/api/v1/support/agent-desktop`: `tickets.read`, organization and signed-in agent queue scope |
| Work | VoIP Calls `/support/voip` | Support module + `voip` add-on | `/api/v1/calls*`: authenticated RLS, organization and call-access scope; mutations retain provider/capability checks |
| Work | Knowledge Base `/knowledge-base`, `/knowledge-base/[id]` | Support module | `/api/v1/kb*`, `/api/v1/kb-categories*`: authenticated RLS and organization predicates |
| Team | Skill Routing `/support/skill-routing` | Support module | `/api/v1/ticket-queues*`, `/api/v1/skill-routing/agents`: organization scope plus routing read/write permission |
| Team | Agent Calendar `/support/calendar` | Support module | `/api/v1/calendar/agent`: authenticated organization scope; personal visibility is derived from the signed-in user |
| Team | Portal Users `/settings/portal-users` | Support module | `/api/v1/portal-users`: admin/superadmin only, organization/contact predicates and audited recovery actions |
| Rules & settings | Ticket Categories `/settings/ticket-categories` | Support module | `/api/v1/ticket-categories*`: `tickets.read/write`, organization-scoped parent/queue validation |
| Rules & settings | SLA Policies `/settings/sla-policies` | Support module | `/api/v1/sla-policies*`: authenticated RLS and organization-scoped conflict/use checks |
| Rules & settings | Support Entitlements `/support/entitlements` | Support module | `/api/v1/entitlements*`: explicit `entitlements.read/write`, organization-scoped company/policy/milestone checks |
| Rules & settings | Entitlement Templates `/settings/entitlement-templates` | Support module | `/api/v1/entitlement-templates`: explicit `entitlements.read/write` and organization scope |
| Rules & settings | Escalation Rules `/settings/escalation` | Support module | `/api/v1/escalation-rules*`: organization scope plus escalation read/write permission |
| Rules & settings | Macros `/settings/macros` | Support module | `/api/v1/ticket-macros*`: organization scope plus macro read/write permission; apply route rechecks ticket ownership |
| Rules & settings | Support AI Settings `/support/ai-settings` | Support module + `ai` add-on + admin/superadmin | `/api/v1/support/ai-settings` and `/api/v1/settings/ai-features` both recheck role and add-on state server-side |

## Required regression evidence

The following proofs must stay green whenever a Support destination is added,
removed, renamed or re-gated:

1. Catalog tests assert exactly 15 unique destinations in the 5/3/7 Work,
   Team and Rules ordering.
2. Agent/support, manager and admin projections prove Complaint, VoIP and
   Support AI visibility without weakening their existing gates.
3. Direct-route and API tests prove authentication, role/permission and tenant
   predicates independently of navigation visibility.
4. Desktop keyboard evidence covers Support group and subgroup expansion,
   active-route visibility, persisted state and search across closed groups.
5. The 375 px evidence covers a visible label, three native `optgroup` labels,
   all permitted destinations, physical-touch hit testing and zero horizontal
   overflow.
6. AZ, RU and EN must have identical navigation keysets; light/dark use the
   existing semantic shell tokens and one established active-route accent.

Route removal or merging is outside this redesign. It requires observed usage
evidence, stakeholder approval and a separately reversible migration; absent
that evidence, all current routes remain stable.
