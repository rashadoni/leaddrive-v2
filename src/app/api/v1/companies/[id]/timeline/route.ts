import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("companies", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    // email/message are contact-level (no companyId column) — so the company timeline
    // aggregates THIS company's contacts' emails/messages (a company-360 rollup of the
    // CURRENT relationship; a contact that moves companies takes its comms with it). No
    // migration/backfill needed. Some email paths also write an Activity, but those
    // Activities aren't companyId-tagged, so they don't duplicate this timeline's
    // companyId Activity query. Deterministic + bounded (newest 500 contacts).
    const companyContacts = await prisma.contact.findMany({
      where: { companyId: id, organizationId: orgId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
    const contactIds = companyContacts.map((c: any) => c.id)

    const [activities, deals, tickets, calls, emails, messages, contactCalls] = await Promise.all([
      prisma.activity.findMany({
        where: { companyId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, type: true, subject: true, description: true, createdAt: true, createdBy: true },
      }),
      prisma.deal.findMany({
        where: { companyId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, stage: true, valueAmount: true, currency: true, createdAt: true },
      }),
      prisma.ticket.findMany({
        where: { companyId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, subject: true, status: true, priority: true, createdAt: true },
      }),
      // Slice 3b feature: calls placed from the company card (companyId on CallLog).
      // Only UN-MIRRORED calls (activityId: null): once a call completes, the provider
      // webhook (Twilio) creates a call Activity with the same companyId AND links it via
      // CallLog.activityId — that Activity is already in this timeline, so including the
      // linked CallLog would double-show the call. No Activity row is removed.
      prisma.callLog.findMany({
        where: { companyId: id, organizationId: orgId, activityId: null },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: { id: true, direction: true, fromNumber: true, toNumber: true, status: true, duration: true, startedAt: true, createdAt: true },
      }),
      // Company-360: this company's contacts' emails + channel messages.
      contactIds.length
        ? prisma.emailLog.findMany({
            where: { contactId: { in: contactIds }, organizationId: orgId },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, direction: true, subject: true, fromEmail: true, toEmail: true, createdAt: true },
          })
        : Promise.resolve([] as any[]),
      contactIds.length
        ? prisma.channelMessage.findMany({
            where: { contactId: { in: contactIds }, organizationId: orgId },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, direction: true, channelType: true, body: true, createdAt: true },
          })
        : Promise.resolve([] as any[]),
      // Company-360: this company's contacts' calls. companyId: null avoids overlap with
      // the company-direct call query above; NO activityId filter — a completed contact
      // call's mirror Activity is contactId-scoped (not in the companyId Activity query),
      // so the CallLog isn't a double-show here.
      // INVARIANT: a contact-call's mirror Activity must stay companyId:null (the call
      // webhooks copy Activity.companyId from CallLog.companyId, which is null here). If a
      // future writer derives Activity.companyId from contact.companyId, these would
      // double-show — revisit the dedup before doing that.
      contactIds.length
        ? prisma.callLog.findMany({
            where: { contactId: { in: contactIds }, organizationId: orgId, companyId: null },
            orderBy: { startedAt: "desc" },
            take: 20,
            select: { id: true, direction: true, fromNumber: true, toNumber: true, status: true, duration: true, startedAt: true, createdAt: true },
          })
        : Promise.resolve([] as any[]),
    ])

    type TimelineEntry = {
      id: string
      type: "activity" | "deal" | "ticket" | "call" | "email" | "message"
      title: string
      subtitle?: string
      date: string
      meta?: Record<string, any>
    }

    const timeline: TimelineEntry[] = [
      ...activities.map((a: any) => ({
        id: a.id,
        type: "activity" as const,
        title: a.subject || a.type,
        subtitle: a.description || undefined,
        date: a.createdAt.toISOString(),
        meta: { activityType: a.type, createdBy: a.createdBy },
      })),
      ...deals.map((d: any) => ({
        id: d.id,
        type: "deal" as const,
        title: d.name,
        subtitle: `${decimalToNumber(d.valueAmount).toLocaleString()} ${d.currency}`,
        date: d.createdAt.toISOString(),
        meta: { stage: d.stage },
      })),
      ...tickets.map((t: any) => ({
        id: t.id,
        type: "ticket" as const,
        title: t.subject,
        subtitle: t.status,
        date: t.createdAt.toISOString(),
        meta: { status: t.status, priority: t.priority },
      })),
      ...[...calls, ...contactCalls].map((c: any) => ({
        id: c.id,
        type: "call" as const,
        title: (c.direction === "inbound" ? c.fromNumber : c.toNumber) || "Call",
        subtitle: c.direction === "inbound" ? "Incoming call" : "Outgoing call",
        date: (c.startedAt ?? c.createdAt).toISOString(),
        meta: { direction: c.direction, status: c.status, duration: c.duration },
      })),
      ...emails.map((e: any) => ({
        id: e.id,
        type: "email" as const,
        title: e.subject || (e.direction === "inbound" ? e.fromEmail : e.toEmail) || "Email",
        subtitle: e.direction === "inbound" ? "Inbound email" : "Outbound email",
        date: e.createdAt.toISOString(),
        meta: { direction: e.direction },
      })),
      ...messages.map((m: any) => ({
        id: m.id,
        type: "message" as const,
        title: (m.body || "").slice(0, 80) || m.channelType || "Message",
        subtitle: `${m.channelType || "message"}${m.direction ? " · " + m.direction : ""}`,
        date: m.createdAt.toISOString(),
        meta: { channel: m.channelType, direction: m.direction },
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({ success: true, data: { timeline } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
