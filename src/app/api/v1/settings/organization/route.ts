import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"

/**
 * GET /api/v1/settings/organization — load organization details
 */
export const GET = withRls(async (_req, { orgId }) => {

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        logo: true,
        slug: true,
        plan: true,
        maxUsers: true,
        maxContacts: true,
      },
    })

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: org })
  } catch (e) {
    console.error("Organization settings GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * PUT /api/v1/settings/organization — update organization name & logo
 */
export const PUT = withRlsAuth("settings", "write", async (req, auth) => {
  try {
    const body = await req.json()
    const { name, logo } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Organization name is required" }, { status: 400 })
    }

    // Generate slug from name
    const slug = name.trim().toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50)

    const updated = await prisma.organization.update({
      where: { id: auth.orgId },
      data: {
        name: name.trim(),
        slug,
        ...(logo !== undefined ? { logo } : {}),
      },
      select: {
        name: true,
        logo: true,
        slug: true,
        plan: true,
        maxUsers: true,
        maxContacts: true,
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("Organization settings PUT error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
