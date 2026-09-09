/**
 * Public storefront catalog — D6 Phase 6 Block A slice 1.
 *
 *   GET /api/v1/public/commerce/storefronts/[slug]/products
 *     ?limit=<1..100>&cursor=<lastProductId>
 *
 * Public, unauthenticated. Returns paginated `PublicProduct[]` for the
 * named storefront's tenant. 404 mirrors the storefront-info route's
 * anti-enumeration response (host mismatch, missing tenant, missing
 * slug, inactive storefront — all the same 404).
 *
 * Pagination: cursor-based on `Product.id` (cuid, lexicographically
 * time-ordered as a side-effect of the cuid spec — NOT a contract;
 * if Product.id is ever swapped to uuidv4 this code needs a
 * sort-key change. Slice 2 may add `(createdAt DESC, id DESC)`
 * compound cursor + opaque encoding).
 *
 * Visibility rule: only `isActive=true` products in the storefront's
 * organizationId. Note that D2 Storefront does NOT yet have a per-
 * storefront product allow-list — slice-1 exposes the whole tenant
 * catalog. Slice 2 will add `StorefrontProduct` join table for
 * per-storefront curation.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { resolveStorefrontBySlug } from "@/lib/headless-commerce/storefront-resolver"
import { resolveOrgIdFromHost } from "@/lib/headless-commerce/tenant-from-host"
import { filterPublicProducts } from "@/lib/headless-commerce/product-filter"
import type { PublicProductPage } from "@/lib/headless-commerce/types"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: z.string().min(1).max(120).optional(),
})

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const limit = parsed.data.limit ?? DEFAULT_LIMIT
  const cursor = parsed.data.cursor ?? null

  // 1. Host → tenant orgId. No subdomain / unknown tenant → 404.
  // RLS phase 1 — `organizations` is a global table (no policy), no bypass needed.
  const host = req.headers.get("host")
  const organizationId = await resolveOrgIdFromHost({
    finder: prisma.organization,
    host,
  })
  if (!organizationId) {
    return NextResponse.json({ error: "Storefront not found" }, { status: 404 })
  }

  // RLS phase 2 — storefront + catalog queries run tenant-scoped.
  // 2. (orgId, slug) → Storefront. Inactive / missing → 404.
  const resolved = await runWithTenant(organizationId, () =>
    resolveStorefrontBySlug({
      finder: prisma.storefront,
      organizationId,
      slug,
    })
  )
  if (!resolved) {
    return NextResponse.json({ error: "Storefront not found" }, { status: 404 })
  }

  // 3. Fetch products in the storefront's tenant. `take=limit+1` so
  // we can detect whether a NEXT page exists. The cursor + skip:1
  // is the canonical Prisma cursor-pagination idiom.
  const rows = await runWithTenant(resolved.organizationId, () =>
    prisma.product.findMany({
      where: {
        organizationId: resolved.organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        price: true,
        currency: true,
        features: true,
        tags: true,
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    })
  )

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const products = filterPublicProducts(sliced)
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null

  const page: PublicProductPage = {
    products,
    nextCursor,
    count: products.length,
  }

  // Cache-Control: see storefront-info route header — same cross-tenant
  // CDN-leak hazard applies here too. Two tenants can share the URL
  // path; Host is the differentiator. `private, no-store` until slice-2
  // adds tenant-keyed caching infrastructure.
  return NextResponse.json(page, {
    headers: { "Cache-Control": "private, no-store" },
  })
}
