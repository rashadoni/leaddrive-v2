import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { trackContactEvent } from "@/lib/contact-events"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"
import { PAGE_SIZE } from "@/lib/constants"

const createActivitySchema = z.object({
  type: z.string().min(1),
  subject: z.string().min(1).max(500),
  description: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
  scheduledAt: z.string().optional(),
})

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get("companyId")
  const contactId = searchParams.get("contactId")
  const relatedType = searchParams.get("relatedType")
  const relatedId = searchParams.get("relatedId")

  try {
    const where: any = {
      organizationId: orgId,
      ...(companyId ? { companyId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(relatedType ? { relatedType } : {}),
      ...(relatedId ? { relatedId } : {}),
    }

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.DEFAULT,
      include: {
        contact: { select: { fullName: true } },
        company: { select: { name: true } },
      },
    })

    // Resolve createdBy user names
    const userIds = [...new Set(activities.map((a: any) => a.createdBy).filter(Boolean))] as string[]
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : []
    const userMap = Object.fromEntries(users.map((u: any) => [u.id, u.name]))

    const enriched = activities.map((a: any) => ({
      ...a,
      createdByName: a.createdBy ? userMap[a.createdBy] || null : null,
    }))

    return NextResponse.json({ success: true, data: { activities: enriched } })
  } catch (e) {
    console.error("[activities GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth) => {
  const body = await req.json()
  const parsed = createActivitySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const activity = await prisma.activity.create({
      data: {
        organizationId: auth.orgId,
        createdBy: auth.userId,
        ...parsed.data,
        ...(parsed.data.scheduledAt ? { scheduledAt: new Date(parsed.data.scheduledAt) } : {}),
      },
    })
    // Track contact event for engagement scoring
    if (activity.contactId) {
      const eventType = activity.type === "meeting" ? "meeting_scheduled"
        : activity.type === "call" ? "call_logged"
        : "note_added"
      trackContactEvent(auth.orgId, activity.contactId, eventType, { activityId: activity.id, type: activity.type }).catch(() => {})
    }
    // Cadence auto-exit: a logged meeting means the outreach worked — stop the
    // person's active sequence enrollments (never throws).
    if (activity.type === "meeting" && (activity.contactId || activity.relatedType === "lead")) {
      await autoExitSequenceEnrollments({
        organizationId: auth.orgId,
        trigger: "meeting_booked",
        contactId: activity.contactId,
        leadId: activity.relatedType === "lead" ? activity.relatedId : null,
      })
    }
    return NextResponse.json({ success: true, data: activity }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
