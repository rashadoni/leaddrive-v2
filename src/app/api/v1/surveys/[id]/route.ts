import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

type SurveyResponseRow = Prisma.SurveyResponseGetPayload<true>
type ContactLite = Prisma.ContactGetPayload<{
  select: { id: true; fullName: true; email: true; phone: true }
}>
type TicketLite = Prisma.TicketGetPayload<{
  select: { id: true; ticketNumber: true; subject: true; source: true }
}>

export const GET = withRlsAuth("campaigns", "read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const survey = await prisma.survey.findFirst({ where: { id, organizationId: orgId } })
  if (!survey) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId: id },
    orderBy: { completedAt: "desc" },
    take: 500,
  })

  // Hydrate response rows with linked entity display data — cheap bulk
  // lookups so the detail page doesn't have to N+1 through contacts/tickets.
  const contactIds = [...new Set(responses.map((r: SurveyResponseRow) => r.contactId).filter(Boolean) as string[])]
  const ticketIds = [...new Set(responses.map((r: SurveyResponseRow) => r.ticketId).filter(Boolean) as string[])]
  const [contacts, tickets] = await Promise.all([
    contactIds.length > 0
      ? prisma.contact.findMany({
          where: { id: { in: contactIds }, organizationId: orgId },
          select: { id: true, fullName: true, email: true, phone: true },
        })
      : Promise.resolve([]),
    ticketIds.length > 0
      ? prisma.ticket.findMany({
          where: { id: { in: ticketIds }, organizationId: orgId },
          select: { id: true, ticketNumber: true, subject: true, source: true },
        })
      : Promise.resolve([]),
  ])
  const contactMap = new Map(contacts.map((c: ContactLite) => [c.id, c] as const))
  const ticketMap = new Map(tickets.map((t: TicketLite) => [t.id, t] as const))
  const hydrated = responses.map((r: SurveyResponseRow) => ({
    ...r,
    contact: r.contactId ? contactMap.get(r.contactId) : null,
    ticket: r.ticketId ? ticketMap.get(r.ticketId) : null,
  }))

  type R = { category: string | null; score: number | null }
  const total = responses.length
  const promoters = responses.filter((r: R) => r.category === "promoter").length
  const passives = responses.filter((r: R) => r.category === "passive").length
  const detractors = responses.filter((r: R) => r.category === "detractor").length
  const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null

  return NextResponse.json({
    success: true,
    data: {
      survey,
      responses: hydrated,
      stats: { total, promoters, passives, detractors, nps },
    },
  })
})

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  thankYouText: z.string().max(500).optional(),
  questions: z.array(z.any()).optional(),
  channels: z.array(z.string()).optional(),
  triggers: z.record(z.string(), z.any()).optional(),
})

export const PUT = withRlsAuth("campaigns", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const existing = await prisma.survey.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.survey.update({
    where: { id },
    data: parsed.data as any,
  })
  logAudit(orgId, "update", "survey", id, updated.name)
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRlsAuth("campaigns", "delete", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const existing = await prisma.survey.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.survey.delete({ where: { id } })
  logAudit(orgId, "delete", "survey", id, existing.name)
  return NextResponse.json({ success: true })
})
