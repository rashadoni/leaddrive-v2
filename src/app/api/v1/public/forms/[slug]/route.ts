import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

/**
 * P8 No-Code Form Builder — slice-2 public read.
 *
 * GET /api/v1/public/forms/[slug]?org=<organizationId>
 *
 * Public, unauthenticated. Only PUBLISHED forms are visible. The
 * org query parameter is required because slug is unique per-org
 * but not globally; without it the slug lookup is ambiguous on
 * shared infrastructure.
 *
 * Increments totalViews atomically. Slice-3 renderer page calls this
 * server-side at render time (so the count reflects page loads).
 *
 * Returns minimal projection — public-safe columns only.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("org") || ""

  if (!organizationId) {
    return NextResponse.json({ error: "org parameter is required" }, { status: 400 })
  }

  try {
    // RLS: org id arrives as a query param and the lookup is already
    // org-scoped — the whole handler runs tenant-scoped (the fire-and-forget
    // view-counter increment starts inside the scope and inherits it).
    return await runWithTenant(organizationId, async () => {
    const row = await prisma.formDefinition.findUnique({
      where: {
        organizationId_slug: { organizationId, slug },
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        fields: true,
        status: true,
        successMessage: true,
        redirectUrl: true,
      },
    })

    if (!row || row.status !== "published") {
      return NextResponse.json({ error: "Form not found" }, { status: 404 })
    }

    // Atomic view counter. Fire-and-forget — a count failure must not
    // block the renderer. Log a warn instead of silently swallowing
    // so analytics drift is grep-able later.
    prisma.formDefinition
      .update({ where: { id: row.id }, data: { totalViews: { increment: 1 } } })
      .catch((e: unknown) => {
        console.warn(`[public/forms/:slug] totalViews increment failed for ${row.id}:`, e)
      })

    return NextResponse.json({ success: true, data: row })
    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e) {
    console.error("[public/forms/:slug] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
