/**
 * Tenant-from-host resolver — D6 Phase 6 Block A slice 1.
 *
 * The headless commerce API is multi-tenant: each tenant's storefronts
 * live under its own subdomain (e.g. `acme.leaddrivecrm.org/api/v1/
 * public/commerce/storefronts/shop`). Two tenants can both register
 * `slug="shop"` — D2's `@@unique([organizationId, slug])` allows it.
 *
 * For PUBLIC unauthenticated routes there's no JWT to carry tenant
 * context, so we derive `organizationId` from the request host's
 * subdomain. The middleware already exposes the parsing via
 * `getOrgSubdomain` (src/lib/tenant-domain.ts); this module wraps it
 * with the DB lookup (subdomain → Organization.id).
 *
 * Anti-enumeration: when the host has no parseable subdomain OR the
 * subdomain doesn't match any active Organization, returns `null`.
 * The route emits a 404 indistinguishable from "storefront not found"
 * so an attacker can't probe for valid tenant subdomains.
 */
import { getOrgSubdomain } from "@/lib/tenant-domain"

/** Loose Prisma surface for testability. */
export interface OrganizationFinder {
  findFirst(args: {
    where: { slug: string; isActive: true }
    select: { id: true }
  }): Promise<{ id: string } | null>
}

export interface ResolveOrgFromHostInput {
  finder: OrganizationFinder
  /** Request `host` header — `tenant.leaddrivecrm.org` or `app.leaddrivecrm.org`. */
  host: string | null
  /** Optional override — defaults to NEXT_PUBLIC_BASE_DOMAIN. Mostly for tests. */
  baseDomain?: string
}

export async function resolveOrgIdFromHost(
  input: ResolveOrgFromHostInput
): Promise<string | null> {
  const { finder, host, baseDomain } = input
  if (!host) return null

  const subdomain = getOrgSubdomain(host, baseDomain)
  if (!subdomain) return null

  // Lowercase before DB lookup. Currently `getOrgSubdomain`'s regex
  // rejects mixed-case hosts so this is defensive — but architect-
  // flagged: when slice 2 fixes the host-case bug in tenant-domain.ts
  // (RFC 3986 makes hosts case-insensitive), this lowercase call is
  // what keeps the slug lookup correct here. One-line preemptive guard.
  // ALSO: scopes by `isActive: true` so a suspended tenant can no
  // longer serve its public storefronts. Organization.isActive defaults
  // to true (schema.prisma:32), so existing tenants are unaffected.
  const org = await finder.findFirst({
    where: { slug: subdomain.toLowerCase(), isActive: true },
    select: { id: true },
  })
  return org?.id ?? null
}
