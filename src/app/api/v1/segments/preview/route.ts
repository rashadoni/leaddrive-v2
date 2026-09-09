import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { buildContactWhere } from "@/lib/segment-conditions"

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const conditions = body.conditions || {}

  try {
    const where = buildContactWhere(orgId, conditions)
    const count = await prisma.contact.count({ where })
    return NextResponse.json({ success: true, data: { count } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
