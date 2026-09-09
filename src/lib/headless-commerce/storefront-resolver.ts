/**
 * Storefront slug resolver — D6 Phase 6 Block A slice 1.
 *
 * Maps `(organizationId, slug)` → the internal Storefront row needed
 * to serve the headless-commerce API. The org scoping is critical:
 * D2 `@@unique([organizationId, slug])` allows two tenants to BOTH
 * register `slug="shop"`; callers MUST resolve the tenant first
 * (see tenant-from-host.ts) before invoking this helper.
 *
 * Failure semantics: inactive storefronts AND non-existent (org,
 * slug) pairs BOTH return null. This is intentional — distinguishing
 * them via response status would let an attacker enumerate active vs
 * not-active slugs by probing.
 *
 * Slice-2 admin preview UI may want to resolve INACTIVE storefronts
 * (the admin sees them in the "Drafts" tab); pass `includeInactive:
 * true` to bypass the active-only gate. The default keeps the
 * anti-enumeration invariant for the public path.
 *
 * Helper takes a Prisma-like client interface (testability), not the
 * concrete global `prisma`.
 */
import type { ResolvedStorefront } from "./types"

/**
 * Minimal Prisma surface we need. `where.isActive` is typed as
 * optional so the slice-2 admin caller can pass `false` (or omit
 * entirely) to see inactive storefronts. Public callers MUST always
 * pass `true`.
 */
export interface StorefrontFinder {
  findFirst(args: {
    where: {
      slug: string
      organizationId: string
      isActive?: boolean
    }
    select: {
      id: true
      organizationId: true
      slug: true
      name: true
      description: true
      primaryCurrency: true
      primaryLocale: true
      theme: true
    }
  }): Promise<{
    id: string
    organizationId: string
    slug: string
    name: string
    description: string | null
    primaryCurrency: string
    primaryLocale: string
    theme: unknown
  } | null>
}

export interface ResolveStorefrontInput {
  finder: StorefrontFinder
  /** Tenant org id — caller derives from `resolveOrgIdFromHost` for public routes. */
  organizationId: string
  slug: string
  /**
   * Public path passes `false` (default) → resolver scopes to isActive=true.
   * Slice-2 admin preview passes `true` → no isActive filter.
   */
  includeInactive?: boolean
}

/**
 * Slug regex aligned with the D2 DB CHECK constraint at
 * `storefronts_slug_check` (migration 20260517170000_b2c_commerce):
 *
 *   length(slug) = 1
 *   OR (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND slug !~ '[_-]{2}')
 *
 * Both branches enforced here so a slug that the DB would reject is
 * caught at the helper boundary — no round-trip on obviously-invalid
 * input. A future relaxation of the DB CHECK must also relax this regex.
 *
 * KNOWN ASYMMETRY (helper-stricter, safe-direction): the DB CHECK's
 * length=1 branch accepts ANY single character including "-" / "_"
 * (it only verifies length, not charset). The helper requires alnum.
 * A future migration may tighten the DB to match; until then, this
 * is the only known parity gap and it can only REJECT writes the DB
 * would have accepted (never the other way).
 */
function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 64) return false
  if (slug.length === 1) return /^[a-z0-9]$/.test(slug)
  if (!/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(slug)) return false
  // Forbid consecutive separators (`--`, `__`, `-_`, `_-`).
  if (/[_-]{2}/.test(slug)) return false
  return true
}

export async function resolveStorefrontBySlug(
  input: ResolveStorefrontInput
): Promise<ResolvedStorefront | null> {
  const { finder, organizationId, slug, includeInactive } = input

  if (!organizationId) return null
  const normalized = slug?.toLowerCase() ?? ""
  if (!isValidSlug(normalized)) return null

  const where: { slug: string; organizationId: string; isActive?: boolean } = {
    slug: normalized,
    organizationId,
  }
  if (!includeInactive) {
    where.isActive = true
  }

  const row = await finder.findFirst({
    where,
    select: {
      id: true,
      organizationId: true,
      slug: true,
      name: true,
      description: true,
      primaryCurrency: true,
      primaryLocale: true,
      theme: true,
    },
  })
  if (!row) return null

  // Coerce the JSON theme to a Record. Prisma types it as
  // `JsonValue` which includes primitives, arrays, etc.; we want a
  // plain object at the public surface. Non-object themes collapse
  // to {} so the consumer always gets a stable shape.
  const theme =
    row.theme && typeof row.theme === "object" && !Array.isArray(row.theme)
      ? (row.theme as Record<string, unknown>)
      : {}

  return {
    id: row.id,
    organizationId: row.organizationId,
    public: {
      slug: row.slug,
      name: row.name,
      description: row.description,
      primaryCurrency: row.primaryCurrency,
      primaryLocale: row.primaryLocale,
      theme,
    },
  }
}
