import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        plan: true,
        maxUsers: true,
        maxContacts: true,
        name: true,
        addons: true,
      },
    })

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        plan: org.plan,
        maxUsers: org.maxUsers,
        maxContacts: org.maxContacts,
        organizationName: org.name,
        addons: org.addons || [],
      },
    })
  } catch (e) {
    console.error("Organization plan GET error:", e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
