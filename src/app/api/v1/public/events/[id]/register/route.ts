import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { sanitizeLog } from "@/lib/sanitize"
import { NOREPLY_EMAIL } from "@/lib/constants"
import { recordTouchpointsSafe, touchpointSourceKey } from "@/lib/marketing-attribution/touchpoint-recorder"
import { clientIp } from "@/lib/request-ip"
import { publicEmailAbuseKey } from "@/lib/public-email-abuse-key"
import {
  consumePublicRateLimit,
  releasePublicActionReservation,
  reservePublicAction,
} from "@/lib/public-abuse-guard"

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Generate ICS calendar file content
function generateICS(event: any): string {
  const start = new Date(event.startDate)
  const end = event.endDate ? new Date(event.endDate) : new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const appDomain = (process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org").replace(/^https?:\/\//, "")
  const uid = `${event.id}@${appDomain}`

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadDrive CRM//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${event.name}`,
    event.location ? `LOCATION:${event.location}` : "",
    event.description ? `DESCRIPTION:${event.description.replace(/\n/g, "\\n").slice(0, 500)}` : "",
    event.meetingUrl ? `URL:${event.meetingUrl}` : "",
    "STATUS:CONFIRMED",
    `ORGANIZER;CN=LeadDrive CRM:mailto:${NOREPLY_EMAIL}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n")
}

// Send confirmation email with .ics attachment
async function sendConfirmationEmail(event: any, participantName: string, participantEmail: string) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: event.organizationId },
      select: { settings: true, name: true },
    })
    const smtp = (org?.settings as any)?.smtp
    if (!smtp?.smtpHost || !smtp?.smtpUser || !smtp?.smtpPass) return

    const nodemailer = await import("nodemailer").catch(() => null)
    if (!nodemailer) return

    const transport = nodemailer.createTransport({
      host: smtp.smtpHost,
      port: smtp.smtpPort || 587,
      secure: (smtp.smtpPort || 587) === 465,
      auth: { user: smtp.smtpUser, pass: smtp.smtpPass },
    })

    const icsContent = generateICS(event)
    const startDate = new Date(event.startDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
    const endDate = event.endDate ? new Date(event.endDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : ""

    await transport.sendMail({
      from: smtp.fromEmail ? `${(smtp.fromName || org?.name || "").replace(/[\r\n]/g, "")} <${smtp.fromEmail.replace(/[\r\n]/g, "")}>` : smtp.smtpUser,
      to: participantEmail,
      subject: `Confirmed: ${event.name.replace(/[\r\n]/g, "")}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td style="background:#059669;padding:35px 40px;text-align:center;">
    <div style="font-size:40px;margin-bottom:10px;">&#10003;</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">You're Confirmed!</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${String(event.name).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:25px 40px 10px;">
    <p style="margin:0;font-size:15px;color:#1F2937;">Hello <strong>${escHtml(participantName)}</strong>,</p>
    <p style="margin:8px 0 0;font-size:14px;color:#4B5563;line-height:1.6;">
      Your attendance is confirmed! The event has been attached to this email — open the attachment to add it to your calendar automatically.
    </p>
  </td></tr>

  <!-- Event Details -->
  <tr><td style="padding:15px 40px;">
    <table width="100%" style="background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0;">
      <tr><td style="padding:20px;">
        <table width="100%">
          <tr><td style="padding:6px 0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#EEF2FF;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128197;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">When</div><div style="font-size:14px;color:#1F2937;font-weight:600;">${startDate}${endDate ? ` — ${endDate}` : ""}</div></td>
            </tr></table>
          </td></tr>
          ${event.location ? `<tr><td style="padding:6px 0;border-top:1px solid #E2E8F0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#FEF2F2;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128205;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">Where</div><div style="font-size:14px;color:#1F2937;font-weight:600;">${escHtml(event.location)}</div></td>
            </tr></table>
          </td></tr>` : ""}
          ${event.isOnline && event.meetingUrl ? `<tr><td style="padding:6px 0;border-top:1px solid #E2E8F0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#F0FDF4;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128279;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">Join Online</div><div style="font-size:14px;"><a href="${event.meetingUrl}" style="color:#4F46E5;font-weight:600;">${escHtml(event.meetingUrl)}</a></div></td>
            </tr></table>
          </td></tr>` : ""}
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Calendar note -->
  <tr><td style="padding:10px 40px 25px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#6B7280;background:#FFFBEB;border-radius:8px;padding:12px;border:1px solid #FDE68A;">
      &#128197; <strong>Calendar attachment included</strong> — open the .ics file attached to this email to add the event to your calendar.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 40px 25px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="margin:0;font-size:12px;color:#9CA3AF;">Sent by <strong style="color:#4F46E5;">${escHtml(org?.name || "LeadDrive CRM")}</strong></p>
  </td></tr>

</table>
<table width="600"><tr><td style="padding:15px 0;text-align:center;"><p style="margin:0;font-size:11px;color:#9CA3AF;">Powered by LeadDrive CRM</p></td></tr></table>
</td></tr></table>
</body></html>`,
      icalEvent: {
        filename: "event.ics",
        method: "REQUEST",
        content: icsContent,
      },
    })
    console.log(`[CONFIRM] Sent confirmation + .ics to ${sanitizeLog(participantEmail)} for ${sanitizeLog(event.name)}`)
  } catch (e: any) {
    console.error(`[CONFIRM] Failed to send to ${sanitizeLog(participantEmail)}:`, sanitizeLog(String(e?.message)))
  }
}

// GET — public event info (no auth required)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // RLS phase 1 — org resolution: public event id arrives with no tenant
  // context, so the lookup runs bypass-scoped. Only DB access in GET.
  const event = await runWithRlsBypass(() =>
    prisma.event.findFirst({
      where: { id },
      select: {
        id: true, name: true, description: true, type: true, status: true,
        startDate: true, endDate: true, location: true, isOnline: true,
        meetingUrl: true, maxParticipants: true, registeredCount: true, tags: true,
      },
    })
  )
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const canRegister = ["planned", "registration_open"].includes(event.status)
  const isFull = event.maxParticipants ? event.registeredCount >= event.maxParticipants : false

  return NextResponse.json({ success: true, data: { ...event, canRegister, isFull } })
}

// POST — self-register for event (no auth required)
const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  company: z.string().optional(),
  role: z.string().default("attendee"),
  notes: z.string().optional(),
})

// Unauthenticated write with no ceiling until the 2026-08 re-test. A repeat
// POST with the same address hits the "already registered" branch below, but
// plus-addressing (a+1@…, a+2@…) sidesteps that: every variant took a seat,
// inflated registeredCount, and — for a tenant that configured its own SMTP —
// sent a confirmation email. Two gates, matching public/portal-auth/register:
// per-IP for volume, per-recipient so rotating proxies cannot turn a public
// event into a mail cannon aimed at one inbox.
const REGISTER_IP_LIMIT = { maxRequests: 10, windowSeconds: 60 }
const REGISTER_RECIPIENT_POLICY = {
  cooldownSeconds: 60,
  maxActions: 5,
  windowSeconds: 60 * 60,
}

function registrationRateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Fail closed, like every other public write guard here: a limiter that opens
  // when its backing store blinks is the first thing an attacker takes down.
  const ip = clientIp(req)
  const ipLimit = await consumePublicRateLimit("event-register:ip", ip, REGISTER_IP_LIMIT)
  if (ipLimit.unavailable) {
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Retry-After": "1" } },
    )
  }
  if (!ipLimit.allowed) return registrationRateLimited(ipLimit.retryAfterSeconds)

  // RLS phase 1 — org resolution: public event id, bypass-scoped lookup only.
  const event = await runWithRlsBypass(() => prisma.event.findFirst({ where: { id } }))
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  if (!["planned", "registration_open"].includes(event.status)) {
    return NextResponse.json({ error: "Registration is closed for this event" }, { status: 400 })
  }

  if (event.maxParticipants && event.registeredCount >= event.maxParticipants) {
    return NextResponse.json({ error: "Event is full" }, { status: 400 })
  }

  const body = await req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // RLS phase 2 — all remaining registration work runs tenant-scoped
  // (the fire-and-forget confirmation email starts inside this scope
  // and inherits the tenant context).
  return await runWithTenant(event.organizationId, async () => {
  // Check if already exists (invited or registered)
  const existing = await prisma.eventParticipant.findFirst({
    where: { eventId: id, email: parsed.data.email },
  })
  // The 409 costs nothing and sends nothing, so it is answered before the
  // recipient gate — otherwise a legitimate double-submit would come back as
  // "too many requests" instead of "you are already registered", and would
  // spend an allowance on a request that was never going to write anything.
  if (existing && existing.status !== "registered" && existing.inviteStatus !== "sent") {
    return NextResponse.json({ error: "You are already registered for this event" }, { status: 409 })
  }

  // Everything below here either takes a seat or sends mail to the address the
  // caller named. The abuse-only identity collapses plus tags (and Gmail dot
  // aliases) while storage and delivery keep the exact validated address. That
  // prevents rotating IPs plus victim+1/victim+2 variants from buying extra
  // sends to the same inbox.
  const recipientReservation = await reservePublicAction(
    "event-register:recipient",
    publicEmailAbuseKey(parsed.data.email),
    REGISTER_RECIPIENT_POLICY,
  )
  if (!recipientReservation.allowed) {
    return registrationRateLimited(recipientReservation.retryAfterSeconds)
  }

  if (existing) {
    await prisma.eventParticipant.update({
      where: { id: existing.id },
      data: {
        status: "confirmed",
        name: parsed.data.name || existing.name,
        phone: parsed.data.phone || existing.phone,
        notes: parsed.data.company ? `Company: ${parsed.data.company}` : existing.notes,
      },
    })
    // Send confirmation email with calendar
    sendConfirmationEmail(event, parsed.data.name || existing.name, parsed.data.email)
    return NextResponse.json({ success: true, data: { id: existing.id, message: "Attendance confirmed!" } })
  }

  const contact = await prisma.contact.findFirst({
    where: { organizationId: event.organizationId, email: parsed.data.email },
  })

  // Use transaction to prevent race condition on capacity check
  let participant: any
  try {
    participant = await prisma.$transaction(async (tx: any) => {
      // Re-check capacity inside transaction (serializable read)
      const currentCount = await tx.eventParticipant.count({ where: { eventId: id } })
      if (event.maxParticipants && currentCount >= event.maxParticipants) {
        throw new Error("EVENT_FULL")
      }

      const p = await tx.eventParticipant.create({
        data: {
          eventId: id,
          contactId: contact?.id,
          companyId: contact?.companyId || undefined,
          name: parsed.data.name,
          email: parsed.data.email,
          phone: parsed.data.phone || undefined,
          role: parsed.data.role,
          status: "confirmed",
          source: "self_registered",
          notes: parsed.data.company ? `Company: ${parsed.data.company}` : parsed.data.notes,
        },
      })

      await tx.event.updateMany({ where: { id }, data: { registeredCount: currentCount + 1 } })
      return p
    })
  } catch (e: any) {
    // Nothing was written and no mail was sent on any of these paths, so give
    // the recipient's allowance back — as public/leads does. Without this, the
    // cheapest attack on the gate is to aim it at a victim: pick a full event,
    // POST their address five times, and every one of those 400s burns an hour
    // of the address's budget while costing us nothing to serve. It also
    // punishes the honest case, where someone tries a full event and then finds
    // they cannot register for a different one.
    await releasePublicActionReservation(recipientReservation)

    if (e.message === "EVENT_FULL") {
      return NextResponse.json({ error: "Event is full" }, { status: 400 })
    }
    // Lost a race to the (eventId, email) unique constraint (#14): a concurrent
    // request registered this email between our findFirst and create. Treat as
    // already-registered rather than surfacing a 500.
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "You are already registered for this event" }, { status: 409 })
    }
    throw e
  }

  // C9 attribution touchpoint — event participation (channel "event"). Needs
  // the event tied to a campaign + a known contact (anonymous registrants
  // have no contactId, so they don't produce a touchpoint).
  if (event.campaignId && contact?.id) {
    void recordTouchpointsSafe(event.organizationId, [{
      contactId: contact.id,
      campaignId: event.campaignId,
      channel: "event",
      touchpointType: "event_registered",
      occurredAt: participant.registeredAt ?? new Date(),
      sourceKey: touchpointSourceKey.eventRegistered(participant.id),
      metadata: { eventId: event.id, role: participant.role },
    }])
  }

  // Send confirmation email with calendar
  sendConfirmationEmail(event, parsed.data.name, parsed.data.email)

  return NextResponse.json({
    success: true,
    data: { id: participant.id, message: "Registration successful!" },
  }, { status: 201 })
  }) // end runWithTenant (tenant-scoped handler body)
}
