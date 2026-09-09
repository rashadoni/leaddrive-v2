import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { sendSurveyInvite } from "@/lib/survey-triggers"

const schema = z.object({
  channel: z.enum(["email", "sms"]).default("email"),
  emails: z.array(z.string().email()).optional(),
  phones: z.array(z.string().min(6)).optional(),
  contactIds: z.array(z.string()).optional(),
  segmentId: z.string().optional(),
  allActiveContacts: z.boolean().optional(),
})

export const POST = withRlsAuth("campaigns", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const survey = await prisma.survey.findFirst({ where: { id, organizationId: orgId } })
  if (!survey) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (survey.status !== "active") {
    return NextResponse.json({ error: "Survey is not active" }, { status: 400 })
  }

  const channel = parsed.data.channel
  const recipients: Array<{ email?: string | null; phone?: string | null; contactId?: string | null }> = []

  if (channel === "email") {
    if (parsed.data.emails?.length) {
      for (const e of parsed.data.emails) recipients.push({ email: e })
    }
    if (parsed.data.contactIds?.length) {
      const contacts = await prisma.contact.findMany({
        where: { id: { in: parsed.data.contactIds }, organizationId: orgId, email: { not: null } },
        select: { id: true, email: true },
      })
      for (const c of contacts) if (c.email) recipients.push({ email: c.email, contactId: c.id })
    }
    if (parsed.data.allActiveContacts) {
      const contacts = await prisma.contact.findMany({
        where: { organizationId: orgId, isActive: true, email: { not: null } },
        select: { id: true, email: true },
        take: 5000,
      })
      for (const c of contacts) if (c.email) recipients.push({ email: c.email, contactId: c.id })
    }
  } else {
    // sms
    if (parsed.data.phones?.length) {
      for (const p of parsed.data.phones) recipients.push({ phone: p })
    }
    if (parsed.data.contactIds?.length) {
      const contacts = await prisma.contact.findMany({
        where: { id: { in: parsed.data.contactIds }, organizationId: orgId, phone: { not: null } },
        select: { id: true, phone: true },
      })
      for (const c of contacts) if (c.phone) recipients.push({ phone: c.phone, contactId: c.id })
    }
    if (parsed.data.allActiveContacts) {
      const contacts = await prisma.contact.findMany({
        where: { organizationId: orgId, isActive: true, phone: { not: null } },
        select: { id: true, phone: true },
        take: 5000,
      })
      for (const c of contacts) if (c.phone) recipients.push({ phone: c.phone, contactId: c.id })
    }
  }

  // De-duplicate by email/phone
  const seen = new Set<string>()
  const unique = recipients.filter(r => {
    const key = ((channel === "email" ? r.email : r.phone) || "").toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 0) {
    return NextResponse.json({ error: "No recipients resolved" }, { status: 400 })
  }

  // Skip recipients that already responded to this survey (dedup)
  const recipientKeys = unique
    .map((r: { email?: string | null; phone?: string | null }) => (channel === "email" ? r.email : r.phone))
    .filter(Boolean) as string[]
  const alreadyResponded = await prisma.surveyResponse.findMany({
    where: {
      surveyId: id,
      ...(channel === "email"
        ? { email: { in: recipientKeys } }
        : { phone: { in: recipientKeys } }),
    },
    select: { email: true, phone: true },
  })
  const respondedSet = new Set<string>(
    alreadyResponded
      .map((r: { email: string | null; phone: string | null }) => (channel === "email" ? r.email : r.phone))
      .filter((v: string | null): v is string => !!v)
      .map((v: string) => v.toLowerCase()),
  )

  let sent = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  for (const r of unique) {
    const key = ((channel === "email" ? r.email : r.phone) || "").toLowerCase()
    if (respondedSet.has(key)) {
      skipped++
      continue
    }
    const result = await sendSurveyInvite({
      surveyId: id,
      organizationId: orgId,
      email: r.email,
      phone: r.phone,
      contactId: r.contactId,
      channel,
    })
    if (result.ok) sent++
    else {
      failed++
      if (result.error && errors.length < 5) errors.push(`${key}: ${result.error}`)
    }
  }

  return NextResponse.json({
    success: true,
    data: { sent, failed, skipped, total: unique.length, errors },
  })
})
