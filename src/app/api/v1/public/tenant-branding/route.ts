import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

// GET /api/v1/public/tenant-branding?slug=acme
// Public endpoint: returns org name, branding, logo for login page
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug")
  if (!slug) {
    return NextResponse.json({ data: null })
  }

  // RLS: pre-org login-page lookup. `organizations` is a global table (no
  // policy) so this works either way — the explicit bypass classifies the
  // route for the totality classifier and documents intent.
  const org = await runWithRlsBypass(() =>
    prisma.organization.findUnique({
      where: { slug },
      select: {
        name: true,
        slug: true,
        logo: true,
        branding: true,
        isActive: true,
      },
    })
  )

  if (!org) {
    return NextResponse.json({ data: null })
  }

  if (!org.isActive) {
    return NextResponse.json({
      data: { name: org.name, suspended: true },
    })
  }

  return NextResponse.json({
    data: {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      branding: org.branding,
      suspended: false,
    },
  })
}
