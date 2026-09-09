import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const memberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["manager", "member", "viewer"]).optional(),
  hourlyRate: nonNegativeFinancialAmountSchema.optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRlsAuth(undefined, undefined, async (_req: NextRequest, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params

  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId, organizationId: orgId },
    })
    return NextResponse.json({ success: true, data: members })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req: NextRequest, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const parsed = memberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const member = await prisma.projectMember.create({
      data: {
        organizationId: orgId,
        projectId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: member }, { status: 201 })
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ error: "User is already a member" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const updateMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["manager", "member", "viewer"]).optional(),
  hourlyRate: nonNegativeFinancialAmountSchema.optional(),
})

export const PUT = withRlsAuth(undefined, undefined, async (req: NextRequest, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const parsed = updateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { memberId, ...data } = parsed.data

  try {
    const member = await prisma.projectMember.update({
      where: { id: memberId, projectId, organizationId: orgId },
      data,
    })
    return NextResponse.json({ success: true, data: member })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth(undefined, undefined, async (req: NextRequest, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const { searchParams } = new URL(req.url)
  const memberId = searchParams.get("memberId")

  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 })
  }

  try {
    await prisma.projectMember.delete({
      where: { id: memberId, projectId, organizationId: orgId },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
