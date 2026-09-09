import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Unified interaction timeline for a LEAD.
 *
 * Query-time UNION, org-scoped, normalized + i18n-clean (the client localizes all
 * labels). Sources:
 *   - Activity (relatedType="lead"), Task (relatedType="lead"), FormSubmission (leadId).
 *   - Channel sources via the `leadId` column, populated by Slice 3b writers (inbound
 *     match on calls/3CX, click-to-call from a lead, inbox + WhatsApp/Telegram webhooks):
 *     CallLog, EmailLog, ChannelMessage, Ticket.
 *
 * De-dup: Activity here intentionally KEEPS call/email types — for a lead they are
 * MANUAL records (a rep logging "called the lead"), distinct from the auto channel
 * logs. The webhooks/click-to-call write channel logs (kind=call/email/message), never
 * relatedType="lead" activities, so the same call never appears twice: a rep's MANUAL
 * call/email log shows as kind=activity, the auto channel log as kind=call — two
 * distinct representations, not a duplicate row. Excluding manual call/email activities
 * would hide legitimate rep logs, so both are kept — unlike the contact route, where the
 * auto channel logs are treated as canonical.
 */

const PER_SOURCE = 25

function snippet(s: string | null | undefined, n = 140): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return undefined
  return t.length > n ? t.slice(0, n) + "…" : t
}

function callInsightSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const summary = (value as { summary?: unknown }).summary
  return typeof summary === "string" ? snippet(summary) : undefined
}

type TimelineEntry = {
  id: string
  kind: "activity" | "task" | "form" | "call" | "email" | "message" | "ticket"
  channel?: string
  direction?: string
  title: string | null
  subtitle?: string
  date: string
  meta?: Record<string, unknown>
}

type ActivityTimelineRow = { id: string; type: string; subject: string | null; description: string | null; createdAt: Date; createdBy: string | null }
type TaskTimelineRow = { id: string; title: string; description: string | null; status: string; priority: string; createdAt: Date }
type FormTimelineRow = { id: string; source: string | null; createdAt: Date }
type CallTimelineRow = { id: string; direction: string; status: string; disposition: string | null; notes: string | null; transcription: string | null; insights: unknown; startedAt: Date | null; createdAt: Date }
type EmailTimelineRow = { id: string; direction: string; subject: string | null; body: string | null; status: string; createdAt: Date }
type MessageTimelineRow = { id: string; direction: string; channelType: string; subject: string | null; body: string | null; status: string; createdAt: Date }
type TicketTimelineRow = { id: string; ticketNumber: string; subject: string; description: string | null; status: string; priority: string; createdAt: Date }
type TimelineSources = [
  ActivityTimelineRow[],
  TaskTimelineRow[],
  FormTimelineRow[],
  CallTimelineRow[],
  EmailTimelineRow[],
  MessageTimelineRow[],
  TicketTimelineRow[],
]

export const GET = withRlsAuth("leads", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const visibleLeadWhere = await applyRecordFilter(
      auth.orgId,
      auth.userId,
      auth.role,
      "lead",
      { id, organizationId: auth.orgId },
    )
    const lead = await prisma.lead.findFirst({
      where: visibleLeadWhere,
      select: { id: true },
    })
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const [activities, tasks, forms, calls, emails, messages, tickets] = await Promise.all([
      prisma.activity.findMany({
        where: { organizationId: auth.orgId, relatedType: "lead", relatedId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, type: true, subject: true, description: true, createdAt: true, createdBy: true },
      }),
      prisma.task.findMany({
        where: { organizationId: auth.orgId, relatedType: "lead", relatedId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, title: true, description: true, status: true, priority: true, createdAt: true },
      }),
      prisma.formSubmission.findMany({
        where: { organizationId: auth.orgId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, source: true, createdAt: true },
      }),
      // Channel sources via the leadId column (populated by Slice 3b writers).
      prisma.callLog.findMany({
        where: { organizationId: auth.orgId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, status: true, disposition: true, notes: true, transcription: true, insights: true, startedAt: true, createdAt: true },
      }),
      prisma.emailLog.findMany({
        where: { organizationId: auth.orgId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, subject: true, body: true, status: true, createdAt: true },
      }),
      prisma.channelMessage.findMany({
        where: { organizationId: auth.orgId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, direction: true, channelType: true, subject: true, body: true, status: true, createdAt: true },
      }),
      prisma.ticket.findMany({
        where: { organizationId: auth.orgId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, ticketNumber: true, subject: true, description: true, status: true, priority: true, createdAt: true },
      }),
    ]) as TimelineSources

    const timeline: TimelineEntry[] = [
      ...activities.map((a): TimelineEntry => ({
        id: `activity:${a.id}`,
        kind: "activity",
        title: a.subject || null,
        subtitle: snippet(a.description),
        date: a.createdAt.toISOString(),
        meta: { activityType: a.type, createdBy: a.createdBy },
      })),
      ...tasks.map((t): TimelineEntry => ({
        id: `task:${t.id}`,
        kind: "task",
        title: t.title || null,
        subtitle: snippet(t.description),
        date: t.createdAt.toISOString(),
        meta: { status: t.status, priority: t.priority },
      })),
      ...forms.map((f): TimelineEntry => ({
        id: `form:${f.id}`,
        kind: "form",
        title: null,
        subtitle: snippet(f.source),
        date: f.createdAt.toISOString(),
        meta: { source: f.source },
      })),
      ...calls.map((c): TimelineEntry => ({
        id: `call:${c.id}`,
        kind: "call",
        channel: "phone",
        direction: c.direction,
        title: null,
        subtitle: callInsightSummary(c.insights) || snippet(c.disposition || c.notes || c.transcription),
        date: (c.startedAt || c.createdAt).toISOString(),
        meta: { status: c.status, disposition: c.disposition },
      })),
      ...emails.map((e): TimelineEntry => ({
        id: `email:${e.id}`,
        kind: "email",
        channel: "email",
        direction: e.direction,
        title: e.subject || null,
        subtitle: snippet(e.body),
        date: e.createdAt.toISOString(),
        meta: { status: e.status },
      })),
      ...messages.map((m): TimelineEntry => ({
        id: `message:${m.id}`,
        kind: "message",
        channel: m.channelType || "message",
        direction: m.direction,
        title: m.subject || null,
        subtitle: snippet(m.body),
        date: m.createdAt.toISOString(),
        meta: { status: m.status, channelType: m.channelType },
      })),
      ...tickets.map((t): TimelineEntry => ({
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
