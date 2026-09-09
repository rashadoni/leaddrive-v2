import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { aiCallOwnershipWhere } from "@/lib/calls/access"
import { withRls } from "@/lib/with-rls"

// PATCH — save notes on a call log
export const PATCH = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const { notes } = await req.json()
  if (typeof notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 400 })
  }

  try {
    const result = await prisma.callLog.updateMany({
      where: {
        id,
        organizationId: orgId,
        ...aiCallOwnershipWhere(session?.role || "viewer", session?.userId),
      },
      data: { notes },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Save call notes error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
