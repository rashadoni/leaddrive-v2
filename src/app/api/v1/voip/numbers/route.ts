import { NextResponse, type NextRequest } from "next/server"

import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/** The organization's phone numbers, read-only: LeadDrive assigns them. */
export const GET = withRlsAuth("voip", "read", async (_req: NextRequest, auth) => {
  const numbers = await prisma.voiceLineNumber.findMany({ where: { organizationId: auth.orgId }, orderBy: { createdAt: "asc" },
    select: { id: true, e164: true, label: true } })
  return NextResponse.json({ data: numbers })
})
