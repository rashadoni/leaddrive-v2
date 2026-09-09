/**
 * POST /api/v1/territories/[id]/members  — add a user to a territory
 *
 * Body: { userId: string }
 * Returns 201 on add, 409 if already a member, 404 if territory not found.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { z } from "zod"

const addSchema = z.object({
  userId: z.string().min(1),
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: territoryId } = await params

  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, organizationId: orgId as string },
  })
  if (!territory) return NextResponse.json({ error: "Territory not found" }, { status: 404 })

  const body = await req.json()
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { userId } = parsed.data

  // Cross-tenant guard: userId must belong to same org
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId as string },
  })
  if (!user) {
    return NextResponse.json(
      { error: "User not found in this organization" },
      { status: 404 }
    )
  }

  // Check already member
  const existing = await prisma.territoryMembership.findUnique({
    where: { territoryId_userId: { territoryId, userId } },
  })
  if (existing) {
    return NextResponse.json(
      { error: "User is already a member of this territory" },
      { status: 409 }
    )
  }

  const membership = await prisma.territoryMembership.create({
    data: { territoryId, userId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  return NextResponse.json({ success: true, data: membership }, { status: 201 })
})
