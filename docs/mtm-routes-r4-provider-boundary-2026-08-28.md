# MTM Routes R4 — Google Routes boundary

On 2026-08-29, the owner selected Google Routes API `Compute Routes
Essentials`, with a cost-minimizing bounded pilot. This checkpoint keeps the
existing provider-neutral boundary, but adds a default-off Google adapter and
an explicit user interface around it. It does not put a credential in source,
enable provider traffic, change a route state machine, or add a background
job.

## Safe calculation contract

`src/lib/mtm/route-travel.ts` defines the provider interface and produces a
version-bound `NOT_CONFIGURED` or `READY` travel-plan projection for the
existing scoped route-detail endpoint. The projection:

- preserves the exact manually chosen point order;
- records the route version and deterministic source fingerprint a later
  provider result must match;
- reports only coordinate coverage;
- returns no stored distance, ETA, road geometry, or provider navigation
  target; and
- never calls a provider, changes manual order, or changes route state.

`POST /api/v1/mtm/routes/:id/travel/preview` is a browser-only, DRAFT-only
action. Before a call it checks RLS scope, canonical draft permission, route
version, deterministic source fingerprint, coordinate coverage, a per-actor
rate limit, Redis single-flight/idempotency protection, and a tenant daily
ceiling. It reads the route again after the provider response and drops a
stale answer. The response is `Cache-Control: private, no-store` and contains
only a transient distance/time estimate for the bound route version.

Google Routes content is intentionally neither put in Prisma nor copied to
the existing Leaflet/OSM map. This follows the Google Maps Platform terms and
[Routes API policies](https://developers.google.com/maps/documentation/routes/policies):
the current integration requests only distance and duration, requests no
traffic, geometry, alternatives, or optimization, and does not persist the
provider response. This is why R4 has no migration, RLS table, or rollback
migration for a travel-result model.

The optional Google Maps visual preview is a separate, click-to-open Maps
Embed iframe with an independently restricted public Embed key. It shows the
product-owned manually selected order only; it never receives a Compute Routes
response. The direct "next stop" link is also explicit and does not calculate,
persist, publish, or reorder a route.

The route aggregate, optimistic version checks, RLS, canonical permission
checks, compatibility endpoints, schema, sync, and migrations remain
unchanged. The new preview endpoint is protected by the existing `route-field`
read gate plus the exact same scoped actor resolution as route detail reads.
It rejects mobile/API-key mutation paths; mobile navigation remains an ordinary
user-selected URL rather than a paid server call in this slice.

## Detail hydration

Opening an existing route now enriches the already visible list projection by
calling the existing scoped route-detail endpoint. It does not add coordinates
to the broad list response. Stale requests are aborted; if enrichment fails,
the existing route facts remain usable. The pre-existing detail map therefore
receives coordinates only from an authorized detail response, while this
checkpoint neither selects nor configures its tile, routing, or ETA provider.

## Enablement and rollback

Production traffic remains disabled until all of the following are supplied
outside source control:

1. A server-only Routes API key, restricted to the Routes API.
2. `GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED=true`, a finite positive
   `GOOGLE_MAPS_ROUTES_DAILY_LIMIT`, and an explicit organization allowlist.
   The approved initial pilot value is `50`, with exactly one organization in
   that allowlist. Runtime rejects a configured value above `50` or an
   allowlist with more than one unique organization; a lower value remains
   valid for a still smaller pilot. The Redis guard counts that ceiling per
   organization and
   UTC day; 50 calls/day for one 31-day month is at most 1,550 calls. This is
   deliberately below the current 10,000 monthly free Compute Routes
   Essentials requests, but shared billing-account usage and future Google
   price changes mean it is a budget bound, not a promise of zero cost.
3. A tenant administrator deliberately enables route calculation in MTM
   settings. That toggle alone cannot enable a provider call.
4. A working Redis protection path. If it is unavailable, the endpoint fails
   closed before contacting Google.
5. If the iframe is wanted, a separately restricted public Maps Embed key and
   the required product privacy/terms review.

Rollback is immediate and does not need data cleanup: disable the tenant
toggle or set `GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED=false`; no calculation
result is stored. The owner decision is recorded above; applying it still
requires a separately authorized deployment of the secret and environment
configuration. Road/traffic ETA, automatic optimization, durable
provider-result storage, and provider-driven route reordering are deliberately
out of scope until separately approved and designed against Google terms.
