/**
 * DELETE /api/v1/territories/[id]/members/[userId]  — remove a user from a territory
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { withRls } from "@/lib/with-rls"

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string; userId: string }> }) => {
  const { id: territoryId, userId } = await params

  // Scope check: territory must belong to org
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, organizationId: orgId as string },
  })
  if (!territory) return NextResponse.json({ error: "Territory not found" }, { status: 404 })

  // Verify userId belongs to same org (cross-tenant guard)
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId as string },
  })
  if (!user) return NextResponse.json({ error: "User not found in this organization" }, { status: 404 })

  try {
    await prisma.territoryMembership.delete({
      where: { territoryId_userId: { territoryId, userId } },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    throw err
  }

  return NextResponse.json({ success: true })
})
