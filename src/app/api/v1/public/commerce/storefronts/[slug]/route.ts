/**
 * Public storefront info — D6 Phase 6 Block A slice 1.
 *
 *   GET /api/v1/public/commerce/storefronts/[slug]
 *
 * Public, unauthenticated. Returns the anonymous-safe `PublicStorefront`
 * shape for a single active storefront in the tenant whose subdomain
 * matches the request host. 404 on:
 *   - no parseable tenant subdomain in the host
 *   - tenant subdomain doesn't match any Organization
 *   - storefront slug not found OR inactive within that tenant
 * All four cases collapse to the same 404 to prevent enumeration of
 * either tenants or slugs.
 *
 * Middleware automatically:
 *   1. bypasses auth (publicPaths in src/middleware.ts)
 *   2. applies the public-GET rate limit
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { resolveStorefrontBySlug } from "@/lib/headless-commerce/storefront-resolver"
import { resolveOrgIdFromHost } from "@/lib/headless-commerce/tenant-from-host"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params
  const host = req.headers.get("host")

  // RLS phase 1 — org resolution from Host header. `organizations` is a
  // global table (no organizationId column → no policy), so no bypass needed.
  const organizationId = await resolveOrgIdFromHost({
    finder: prisma.organization,
    host,
  })
  if (!organizationId) {
    // Indistinguishable from "storefront not found" — see header.
    return NextResponse.json({ error: "Storefront not found" }, { status: 404 })
  }

  // RLS phase 2 — storefront lookup runs tenant-scoped.
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

  // Cache-Control: two tenants can share the SAME URL path (e.g. both
  // have a storefront with slug="shop"); the request differentiator is
  // the Host header. A naive CDN / edge cache that doesn't key on Host
  // would serve tenant-A's response to tenant-B's requester. `private,
  // no-store` makes this impossible at the cost of disabling caching;
  // slice-2 may add `Vary: Host` + tenant-aware cache keys if perf
  // demands real caching.
  return NextResponse.json(
    { storefront: resolved.public },
    { headers: { "Cache-Control": "private, no-store" } }
  )
}
