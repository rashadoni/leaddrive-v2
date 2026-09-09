/**
 * Tests for D6 Headless Commerce slice 1 — storefront-resolver +
 * product-filter + tenant-from-host pure helpers + 2 public route
 * handlers (storefront-info + product list).
 *
 * No DB. Resolver/tenant tests inject Prisma-shaped finder mocks;
 * route tests vi.mock the global `prisma`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    storefront: { findFirst: vi.fn() },
    product: { findMany: vi.fn() },
  },
}))

import {
  filterPublicProduct,
  filterPublicProducts,
  type ProductLike,
} from "@/lib/headless-commerce/product-filter"
import { resolveStorefrontBySlug } from "@/lib/headless-commerce/storefront-resolver"
import { resolveOrgIdFromHost } from "@/lib/headless-commerce/tenant-from-host"
import { GET as GET_storefront } from "@/app/api/v1/public/commerce/storefronts/[slug]/route"
import { GET as GET_products } from "@/app/api/v1/public/commerce/storefronts/[slug]/products/route"
import { prisma } from "@/lib/prisma"

const PRODUCT_FIXTURE: ProductLike = {
  id: "p_widget",
  name: "Widget",
  description: "Industrial-grade widget",
  category: "product",
  price: 19.99,
  currency: "USD",
  features: ["water-resistant", "lifetime warranty"],
  tags: ["bestseller"],
}

const ORG = "org_acme"

beforeEach(() => {
  vi.clearAllMocks()
})

/* ─── filterPublicProduct ─────────────────────────────────────────────── */

describe("D6 — filterPublicProduct", () => {
  const PUBLIC_PRODUCT_KEYS = [
    "category",
    "currency",
    "description",
    "features",
    "id",
    "name",
    "price",
    "tags",
  ]

  it("projects only the documented public fields", () => {
    const r = filterPublicProduct(PRODUCT_FIXTURE)
    expect(r).toEqual({
      id: "p_widget",
      name: "Widget",
      description: "Industrial-grade widget",
      category: "product",
      price: 19.99,
      currency: "USD",
      features: ["water-resistant", "lifetime warranty"],
      tags: ["bestseller"],
    })
    // Exhaustive key-set guard — a future field-leak regression
    // (adding e.g. createdAt to the filter) breaks this assertion.
    expect(Object.keys(r).sort()).toEqual(PUBLIC_PRODUCT_KEYS.sort())
  })

  it("ignores extra internal columns coming from the Prisma row", () => {
    const withExtras = {
      ...PRODUCT_FIXTURE,
      cost: 5.0,
      margin: 0.75,
      internalNotes: "Negotiated rate — do not share",
      organizationId: "org-leak",
      createdAt: new Date(),
    } as ProductLike & Record<string, unknown>
    const r = filterPublicProduct(withExtras)
    expect(r).not.toHaveProperty("cost")
    expect(r).not.toHaveProperty("margin")
    expect(r).not.toHaveProperty("internalNotes")
    expect(r).not.toHaveProperty("organizationId")
    expect(r).not.toHaveProperty("createdAt")
    expect(Object.keys(r).sort()).toEqual(PUBLIC_PRODUCT_KEYS.sort())
  })

  it("defensively-copies features + tags so caller mutations don't bleed into the response", () => {
    const tagsRef = PRODUCT_FIXTURE.tags as string[]
    const featuresRef = PRODUCT_FIXTURE.features as string[]
    const r = filterPublicProduct(PRODUCT_FIXTURE)
    expect(r.tags).not.toBe(tagsRef)
    expect(r.features).not.toBe(featuresRef)
    expect(r.tags).toEqual(["bestseller"])
    expect(r.features).toEqual(["water-resistant", "lifetime warranty"])
  })

  it("filterPublicProducts handles empty input", () => {
    expect(filterPublicProducts([])).toEqual([])
  })

  it("filterPublicProducts maps every input row", () => {
    const a: ProductLike = { ...PRODUCT_FIXTURE, id: "p_a", name: "A" }
    const b: ProductLike = { ...PRODUCT_FIXTURE, id: "p_b", name: "B" }
    const r = filterPublicProducts([a, b])
    expect(r).toHaveLength(2)
    expect(r[0].id).toBe("p_a")
    expect(r[1].id).toBe("p_b")
  })
})

/* ─── resolveStorefrontBySlug ─────────────────────────────────────────── */

describe("D6 — resolveStorefrontBySlug", () => {
  function mkFinder(returns: unknown) {
    return { findFirst: vi.fn().mockResolvedValue(returns) }
  }
  type Finder = Parameters<typeof resolveStorefrontBySlug>[0]["finder"]

  it("returns null on empty organizationId WITHOUT DB hit (cross-tenant guard)", async () => {
    const finder = mkFinder(null)
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: "",
      slug: "shop",
    })
    expect(r).toBeNull()
    expect(finder.findFirst).not.toHaveBeenCalled()
  })

  it("returns null on empty slug WITHOUT DB hit", async () => {
    const finder = mkFinder(null)
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "",
    })
    expect(r).toBeNull()
    expect(finder.findFirst).not.toHaveBeenCalled()
  })

  it("returns null on oversized slug (>64) without DB hit", async () => {
    const finder = mkFinder(null)
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "a".repeat(65),
    })
    expect(r).toBeNull()
    expect(finder.findFirst).not.toHaveBeenCalled()
  })

  it("returns null on slug with consecutive separators (DB CHECK parity)", async () => {
    const finder = mkFinder(null)
    // DB CHECK at storefronts_slug_check forbids `--`, `__`, `-_`, `_-`.
    // Resolver regex parity must reject these BEFORE DB hit.
    for (const bad of ["a--b", "a__b", "a-_b", "a_-b"]) {
      finder.findFirst.mockClear()
      const r = await resolveStorefrontBySlug({
        finder: finder as Finder,
        organizationId: ORG,
        slug: bad,
      })
      expect(r).toBeNull()
      expect(finder.findFirst).not.toHaveBeenCalled()
    }
  })

  it("returns null on slug not starting/ending with alnum (DB CHECK parity)", async () => {
    const finder = mkFinder(null)
    for (const bad of ["-abc", "abc-", "_abc", "abc_"]) {
      finder.findFirst.mockClear()
      const r = await resolveStorefrontBySlug({
        finder: finder as Finder,
        organizationId: ORG,
        slug: bad,
      })
      expect(r).toBeNull()
      expect(finder.findFirst).not.toHaveBeenCalled()
    }
  })

  it("accepts single-char slug (DB CHECK first branch)", async () => {
    const finder = mkFinder({
      id: "sf_1",
      organizationId: ORG,
      slug: "a",
      name: "Shop A",
      description: null,
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: {},
    })
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "a",
    })
    expect(r).not.toBeNull()
    expect(finder.findFirst).toHaveBeenCalledTimes(1)
  })

  it("scopes findFirst to slug + organizationId + isActive=true (anti-enumeration + tenant isolation)", async () => {
    const finder = mkFinder(null)
    await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "leaddrive",
    })
    expect(finder.findFirst).toHaveBeenCalledTimes(1)
    const call = finder.findFirst.mock.calls[0][0]
    // Three-part WHERE — cross-tenant guard is non-negotiable.
    expect(call.where).toEqual({
      slug: "leaddrive",
      organizationId: ORG,
      isActive: true,
    })
  })

  it("with includeInactive=true, omits the isActive filter (slice-2 admin preview)", async () => {
    const finder = mkFinder(null)
    await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "draft-shop",
      includeInactive: true,
    })
    const call = finder.findFirst.mock.calls[0][0]
    expect(call.where).toEqual({ slug: "draft-shop", organizationId: ORG })
    // Crucially: NO isActive key.
    expect(call.where).not.toHaveProperty("isActive")
  })

  it("lowercases the slug before SELECT (case-insensitive lookup)", async () => {
    const finder = mkFinder(null)
    await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "LeadDrive",
    })
    expect(finder.findFirst.mock.calls[0][0].where.slug).toBe("leaddrive")
  })

  it("returns ResolvedStorefront with PublicStorefront projection on hit", async () => {
    const finder = mkFinder({
      id: "sf_1",
      organizationId: ORG,
      slug: "leaddrive",
      name: "LeadDrive Shop",
      description: "Demo store",
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: { primary: "#0176D3" },
    })
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "leaddrive",
    })
    expect(r).not.toBeNull()
    expect(r!.id).toBe("sf_1")
    expect(r!.organizationId).toBe(ORG)
    expect(r!.public).toEqual({
      slug: "leaddrive",
      name: "LeadDrive Shop",
      description: "Demo store",
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: { primary: "#0176D3" },
    })
  })

  it("coerces non-object theme to {} for shape stability", async () => {
    const finder = mkFinder({
      id: "sf_1",
      organizationId: ORG,
      slug: "leaddrive",
      name: "Shop",
      description: null,
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: "broken-string-theme",
    })
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "leaddrive",
    })
    expect(r!.public.theme).toEqual({})
  })

  it("coerces array theme to {} (Prisma JsonValue allows arrays)", async () => {
    const finder = mkFinder({
      id: "sf_1",
      organizationId: ORG,
      slug: "leaddrive",
      name: "Shop",
      description: null,
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: ["a", "b"],
    })
    const r = await resolveStorefrontBySlug({
      finder: finder as Finder,
      organizationId: ORG,
      slug: "leaddrive",
    })
    expect(r!.public.theme).toEqual({})
  })
})

/* ─── resolveOrgIdFromHost ────────────────────────────────────────────── */

describe("D6 — resolveOrgIdFromHost", () => {
  function mkOrgFinder(returns: unknown) {
    return { findFirst: vi.fn().mockResolvedValue(returns) }
  }
  type OrgFinder = Parameters<typeof resolveOrgIdFromHost>[0]["finder"]

  it("returns null on null host (no DB hit)", async () => {
    const finder = mkOrgFinder({ id: ORG })
    const r = await resolveOrgIdFromHost({ finder: finder as OrgFinder, host: null })
    expect(r).toBeNull()
    expect(finder.findFirst).not.toHaveBeenCalled()
  })

  it("returns null on host with no parseable subdomain", async () => {
    const finder = mkOrgFinder({ id: ORG })
    // `leaddrivecrm.org` itself (no subdomain) → null.
    const r = await resolveOrgIdFromHost({
      finder: finder as OrgFinder,
      host: "leaddrivecrm.org",
      baseDomain: "leaddrivecrm.org",
    })
    expect(r).toBeNull()
    expect(finder.findFirst).not.toHaveBeenCalled()
  })

  it("returns null on reserved subdomain (app/admin/api/...)", async () => {
    const finder = mkOrgFinder({ id: ORG })
    for (const reserved of ["app", "admin", "api", "www", "static"]) {
      finder.findFirst.mockClear()
      const r = await resolveOrgIdFromHost({
        finder: finder as OrgFinder,
        host: `${reserved}.leaddrivecrm.org`,
        baseDomain: "leaddrivecrm.org",
      })
      expect(r).toBeNull()
      expect(finder.findFirst).not.toHaveBeenCalled()
    }
  })

  it("resolves tenant subdomain → organizationId via DB lookup (scoped by isActive=true)", async () => {
    const finder = mkOrgFinder({ id: ORG })
    const r = await resolveOrgIdFromHost({
      finder: finder as OrgFinder,
      host: "acme.leaddrivecrm.org",
      baseDomain: "leaddrivecrm.org",
    })
    expect(r).toBe(ORG)
    // Suspended-tenant guard: WHERE must include isActive=true so
    // soft-deleted/suspended tenants cannot serve public storefronts.
    expect(finder.findFirst).toHaveBeenCalledWith({
      where: { slug: "acme", isActive: true },
      select: { id: true },
    })
  })

  it("returns null when tenant exists but is suspended (isActive=false filter)", async () => {
    // Finder returns null because of the isActive=true filter — the
    // tenant row exists in DB but doesn't match. Resolver sees only
    // "not found" — anti-enumeration symmetry.
    const finder = mkOrgFinder(null)
    const r = await resolveOrgIdFromHost({
      finder: finder as OrgFinder,
      host: "suspended-tenant.leaddrivecrm.org",
      baseDomain: "leaddrivecrm.org",
    })
    expect(r).toBeNull()
    const call = finder.findFirst.mock.calls[0][0]
    expect(call.where.isActive).toBe(true)
  })

  it("returns null when subdomain doesn't match any Organization (anti-enumeration)", async () => {
    const finder = mkOrgFinder(null)
    const r = await resolveOrgIdFromHost({
      finder: finder as OrgFinder,
      host: "fakecompany.leaddrivecrm.org",
      baseDomain: "leaddrivecrm.org",
    })
    expect(r).toBeNull()
  })
})

/* ─── GET /api/v1/public/commerce/storefronts/[slug] ─────────────────── */

describe("GET /api/v1/public/commerce/storefronts/[slug]", () => {
  function ctx(slug: string) {
    return { params: Promise.resolve({ slug }) }
  }
  function req(host = "acme.leaddrivecrm.org") {
    return new NextRequest(
      new URL("http://localhost:3000/api/v1/public/commerce/storefronts/leaddrive"),
      { headers: { host } }
    )
  }

  it("returns 404 when no tenant subdomain (anti-enumeration)", async () => {
    // No subdomain → resolveOrgIdFromHost returns null → 404.
    // org.findFirst should NOT have been called downstream.
    const res = await GET_storefront(req("leaddrivecrm.org"), ctx("leaddrive"))
    expect(res.status).toBe(404)
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when tenant subdomain doesn't match any Organization", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    const res = await GET_storefront(req("nonexistent.leaddrivecrm.org"), ctx("leaddrive"))
    expect(res.status).toBe(404)
    // Storefront lookup MUST NOT happen — tenant resolution failed.
    expect(prisma.storefront.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 on missing/inactive storefront slug (same shape — no enumeration)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(null)
    const res = await GET_storefront(req(), ctx("inactive-shop"))
    expect(res.status).toBe(404)
  })

  it("scopes storefront SELECT to (organizationId, slug, isActive=true)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(null)
    await GET_storefront(req(), ctx("leaddrive"))
    const sfCall = vi.mocked(prisma.storefront.findFirst).mock.calls[0][0]!
    // Cross-tenant guard regression test: WHERE includes organizationId.
    expect(sfCall.where).toMatchObject({
      slug: "leaddrive",
      organizationId: ORG,
      isActive: true,
    })
  })

  it("returns 200 + PublicStorefront on hit (no internal ids leaked) + Cache-Control private,no-store", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue({
      id: "sf_1",
      organizationId: ORG,
      slug: "leaddrive",
      name: "LeadDrive Shop",
      description: "Demo",
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: { primary: "#0176D3" },
    } as never)
    const res = await GET_storefront(req(), ctx("leaddrive"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.storefront).toEqual({
      slug: "leaddrive",
      name: "LeadDrive Shop",
      description: "Demo",
      primaryCurrency: "USD",
      primaryLocale: "en-US",
      theme: { primary: "#0176D3" },
    })
    expect(json.storefront).not.toHaveProperty("id")
    expect(json.storefront).not.toHaveProperty("organizationId")
    // Cache-Control regression guard: two tenants can share the same
    // URL path (differentiated only by Host). A CDN that doesn't key on
    // Host would cross-tenant-leak without this header. The route MUST
    // emit `private, no-store` until tenant-keyed caching ships in
    // slice 2.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  })
})

/* ─── GET /api/v1/public/commerce/storefronts/[slug]/products ─────────── */

describe("GET /api/v1/public/commerce/storefronts/[slug]/products", () => {
  const PUBLIC_PRODUCT_KEYS = [
    "category",
    "currency",
    "description",
    "features",
    "id",
    "name",
    "price",
    "tags",
  ]

  function ctx(slug: string) {
    return { params: Promise.resolve({ slug }) }
  }
  function req(qs = "", host = "acme.leaddrivecrm.org") {
    return new NextRequest(
      new URL(
        `http://localhost:3000/api/v1/public/commerce/storefronts/leaddrive/products${qs}`
      ),
      { headers: { host } }
    )
  }

  const ACTIVE_STOREFRONT = {
    id: "sf_1",
    organizationId: ORG,
    slug: "leaddrive",
    name: "Shop",
    description: null,
    primaryCurrency: "USD",
    primaryLocale: "en-US",
    theme: {},
  }

  it("returns 404 when no tenant subdomain", async () => {
    const res = await GET_products(req("", "leaddrivecrm.org"), ctx("leaddrive"))
    expect(res.status).toBe(404)
  })

  it("returns 404 when storefront slug is missing/inactive", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(null)
    const res = await GET_products(req(), ctx("missing"))
    expect(res.status).toBe(404)
  })

  it("returns 400 on invalid limit (>100)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    const res = await GET_products(req("?limit=999"), ctx("leaddrive"))
    expect(res.status).toBe(400)
  })

  it("returns 400 on invalid limit (=0)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    const res = await GET_products(req("?limit=0"), ctx("leaddrive"))
    expect(res.status).toBe(400)
  })

  it("scopes findMany to storefront's organizationId AND isActive=true, column-restricted SELECT", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never)
    await GET_products(req(), ctx("leaddrive"))
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      isActive: true,
    })
    const select = call.select as Record<string, true> | undefined
    expect(select).toBeDefined()
    expect(Object.keys(select!).sort()).toEqual(PUBLIC_PRODUCT_KEYS.sort())
  })

  it("emits nextCursor when more rows are available", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    const rows = Array.from({ length: 25 }, (_, i) => ({
      ...PRODUCT_FIXTURE,
      id: `p_${i.toString().padStart(3, "0")}`,
      name: `Product ${i}`,
    }))
    vi.mocked(prisma.product.findMany).mockResolvedValue(rows as never)
    const res = await GET_products(req(), ctx("leaddrive"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(24)
    expect(json.products).toHaveLength(24)
    expect(json.nextCursor).toBe("p_023")
  })

  it("emits null nextCursor on the last page (fewer rows than limit+1)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    const rows = [
      { ...PRODUCT_FIXTURE, id: "p_001", name: "A" },
      { ...PRODUCT_FIXTURE, id: "p_002", name: "B" },
    ]
    vi.mocked(prisma.product.findMany).mockResolvedValue(rows as never)
    const res = await GET_products(req(), ctx("leaddrive"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(2)
    expect(json.nextCursor).toBeNull()
  })

  it("forwards cursor to Prisma findMany with skip:1 (Prisma cursor-pagination idiom)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never)
    await GET_products(req("?cursor=p_010&limit=5"), ctx("leaddrive"))
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0]!
    expect(call.cursor).toEqual({ id: "p_010" })
    expect(call.skip).toBe(1)
    expect(call.take).toBe(6)
  })

  it("response body — each product has EXACTLY the 8 public keys (exhaustive field-leak guard)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    const leakyRow = {
      ...PRODUCT_FIXTURE,
      id: "p_001",
      cost: 5,
      organizationId: "org_leak",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ProductLike & Record<string, unknown>
    vi.mocked(prisma.product.findMany).mockResolvedValue([leakyRow] as never)
    const res = await GET_products(req(), ctx("leaddrive"))
    const json = await res.json()
    expect(Object.keys(json.products[0]).sort()).toEqual(PUBLIC_PRODUCT_KEYS.sort())
  })

  it("emits Cache-Control private,no-store on success (cross-tenant CDN-leak guard)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: ORG } as never)
    vi.mocked(prisma.storefront.findFirst).mockResolvedValue(ACTIVE_STOREFRONT as never)
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never)
    const res = await GET_products(req(), ctx("leaddrive"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  })
})
