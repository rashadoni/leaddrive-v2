import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

/**
 * Unified interaction timeline for a contact (Slice 1 — backend).
 *
 * Query-time UNION across canonical source tables (no materialized log, no
 * dual-write): every source is read directly by `contactId` + `organizationId`,
 * normalized to a common shape, merged and sorted desc. Mirrors the existing
 * company-level aggregator (`/api/v1/companies/[id]/timeline`).
 *
 * i18n: the API returns NO human chrome — `kind`/`channel`/`direction` + raw
 * content (email/ticket subject, message/call snippet) only. The client renders
 * localized labels (e.g. "Входящий звонок" from kind=call+direction=inbound,
 * enum labels from `meta.status`). Same reasonKey-style split used elsewhere.
 *
 * De-dup: calls/emails are sourced canonically from CallLog/EmailLog, so
 * Activity rows of type call/email (the auto-logged mirrors) are excluded to
 * avoid double entries. Task events (relatedType="contact") are included for
 * parity with the lead timeline. (Deferred: Deal events + cursor pagination.)
 */

const PER_SOURCE = 25

function snippet(s: string | null | undefined, n = 140): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return undefined
  return t.length > n ? t.slice(0, n) + "…" : t
}

type TimelineEntry = {
  id: string
  kind: "activity" | "task" | "call" | "email" | "message" | "ticket"
  channel?: string
  direction?: string
  title: string | null
  subtitle?: string
  date: string
  meta?: Record<string, unknown>
}

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const [activities, tasks, calls, emails, messages, tickets] = await Promise.all([
      prisma.activity.findMany({
        // call/email handled canonically by CallLog/EmailLog — exclude their mirrors
        where: { contactId: id, organizationId: orgId, type: { notIn: ["call", "email"] } },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, type: true, subject: true, description: true, createdAt: true, createdBy: true },
      }),
      // Task events related to this contact — parity with the lead timeline.
      prisma.task.findMany({
        where: { organizationId: orgId, relatedType: "contact", relatedId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, title: true, description: true, status: true, priority: true, createdAt: true },
      }),
      prisma.callLog.findMany({
        where: { contactId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, status: true, disposition: true, notes: true, transcription: true, startedAt: true, createdAt: true },
      }),
      prisma.emailLog.findMany({
        where: { contactId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, subject: true, body: true, status: true, createdAt: true },
      }),
      prisma.channelMessage.findMany({
        where: { contactId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, channelType: true, subject: true, body: true, status: true, createdAt: true },
      }),
      prisma.ticket.findMany({
        where: { contactId: id, organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, ticketNumber: true, subject: true, description: true, status: true, priority: true, createdAt: true },
      }),
    ])

    const timeline: TimelineEntry[] = [
      ...activities.map((a: any): TimelineEntry => ({
        id: `activity:${a.id}`,
        kind: "activity",
        title: a.subject || null,
        subtitle: snippet(a.description),
        date: a.createdAt.toISOString(),
        meta: { activityType: a.type, createdBy: a.createdBy },
      })),
      ...tasks.map((t: any): TimelineEntry => ({
        id: `task:${t.id}`,
        kind: "task",
        title: t.title || null,
        subtitle: snippet(t.description),
        date: t.createdAt.toISOString(),
        meta: { status: t.status, priority: t.priority },
      })),
      ...calls.map((c: any): TimelineEntry => ({
        id: `call:${c.id}`,
        kind: "call",
        channel: "phone",
        direction: c.direction,
        title: null, // UI: localized "{direction} call"
        subtitle: snippet(c.disposition || c.notes || c.transcription),
        date: (c.startedAt || c.createdAt).toISOString(),
        meta: { status: c.status, disposition: c.disposition },
      })),
      ...emails.map((e: any): TimelineEntry => ({
        id: `email:${e.id}`,
        kind: "email",
        channel: "email",
        direction: e.direction,
        title: e.subject || null,
        subtitle: snippet(e.body),
        date: e.createdAt.toISOString(),
        meta: { status: e.status },
      })),
      ...messages.map((m: any): TimelineEntry => ({
        id: `message:${m.id}`,
        kind: "message",
        channel: m.channelType || "message",
        direction: m.direction,
        title: m.subject || null,
        subtitle: snippet(m.body),
        date: m.createdAt.toISOString(),
        meta: { status: m.status, channelType: m.channelType },
      })),
      ...tickets.map((t: any): TimelineEntry => ({
        id: `ticket:${t.id}`,
        kind: "ticket",
        title: t.subject,
        subtitle: snippet(t.description),
        date: t.createdAt.toISOString(),
        meta: { status: t.status, priority: t.priority, ticketNumber: t.ticketNumber },
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({ success: true, data: { timeline } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
