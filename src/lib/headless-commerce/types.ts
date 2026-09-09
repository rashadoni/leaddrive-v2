/**
 * Headless Commerce API types — D6 Phase 6 Block A slice 1.
 *
 * Salesforce Commerce Cloud API-first analogue. Public, unauthenticated
 * REST surface for external frontends (Vue / React Native / partner
 * apps) consuming the tenant commerce stack built by D1–D4.
 *
 * Routes live under `/api/v1/public/commerce/` so the existing
 * middleware bypass (publicPaths) + rate-limiting apply automatically.
 *
 * Slice 1 ships READ-ONLY catalog + storefront-info endpoints. Slice 2
 * adds public cart mutations (guest sessionToken flow from D2) and
 * checkout submit. Slice 3 wires the customer order-status polling
 * endpoint (read-only via signed order token).
 *
 * Public-vs-internal field-projection rule:
 *   - PublicStorefront / PublicProduct expose ONLY fields safe for
 *     anonymous consumption.
 *   - createdAt / updatedAt / createdBy / internal sales-tags /
 *     cost / margin / supplier metadata STAY OUT of these types.
 *   - Adding a new field to the underlying Prisma model does NOT
 *     auto-expose it; the filter helper picks each field by name.
 */

/* ─── PublicStorefront ────────────────────────────────────────────────── */

/**
 * Anonymous-safe storefront summary. Returned by
 *   GET /api/v1/public/commerce/storefronts/[slug]
 */
export interface PublicStorefront {
  /**
   * Public id is the slug, NOT the internal cuid. External frontends
   * never see the internal storefront id — they address by slug, which
   * is already public per the URL.
   */
  slug: string
  name: string
  description: string | null
  primaryCurrency: string
  primaryLocale: string
  /** Theme JSON — colors, logo URL, hero copy. Slice-2 UI consumes. */
  theme: Record<string, unknown>
}

/* ─── PublicProduct ───────────────────────────────────────────────────── */

/**
 * Anonymous-safe product. Returned by
 *   GET /api/v1/public/commerce/storefronts/[slug]/products
 *
 * Internal Product columns intentionally NOT exposed: createdAt,
 * updatedAt, organizationId, isActive (already gated at SELECT —
 * inactive products simply don't appear).
 */
export interface PublicProduct {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  currency: string
  features: readonly string[]
  /**
   * Tags are exposed — they're customer-facing labels in the existing
   * stack (e.g. "bestseller", "new"). If a tenant uses tags for
   * INTERNAL sales notes, slice 2 will add a `tag.visibility` field
   * and filter here. For slice 1, all tags pass through.
   */
  tags: readonly string[]
}

/* ─── Paginated product list ──────────────────────────────────────────── */

/**
 * Cursor-paginated product page. The cursor is the LAST product id of
 * the previous page — slice-1 keeps the implementation simple by
 * deriving cursor from id; slice 2 may switch to opaque encoded cursors
 * if a richer sort key (e.g. price ASC then id) ships.
 */
export interface PublicProductPage {
  products: readonly PublicProduct[]
  /** Cursor for the NEXT page; null when there are no more. */
  nextCursor: string | null
  /** Page size actually returned (≤ requested limit). */
  count: number
}

/* ─── Resolver result types ───────────────────────────────────────────── */

/**
 * Storefront-resolution result. Returns the row the route needs to
 * look up downstream resources (organizationId for product SELECT)
 * plus the public-shape fields.
 *
 * `null` is the only failure mode at slice-1 — inactive storefronts
 * and missing slugs both look the same to the public API (no 403/404
 * distinction that would let an attacker probe slug existence).
 */
export interface ResolvedStorefront {
  /** Internal storefront id — never exposed in PublicStorefront, kept here for the route to query products by org. */
  id: string
  /** Internal org id — never exposed publicly, used for downstream product SELECT. */
  organizationId: string
  /** Public-safe projection. */
  public: PublicStorefront
}

/* ─── Pagination input ────────────────────────────────────────────────── */

export interface ProductListInput {
  organizationId: string
  /** Maximum products to return. Defaults + caps applied by the route. */
  limit: number
  /** Cursor from a previous response, null for first page. */
  cursor: string | null
}
