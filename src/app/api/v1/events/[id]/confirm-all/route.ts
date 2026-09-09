import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

function generateICS(event: any, organizerEmail: string): string {
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
    `SUMMARY:${(event.name || "").replace(/[,;\\]/g, " ")}`,
    event.location ? `LOCATION:${(event.location || "").replace(/[,;\\]/g, " ")}` : "",
    event.description ? `DESCRIPTION:${(event.description || "").replace(/\n/g, "\\n").replace(/[,;\\]/g, " ").slice(0, 500)}` : "",
    event.meetingUrl ? `URL:${event.meetingUrl}` : "",
    "STATUS:CONFIRMED",
    `ORGANIZER;CN=LeadDrive CRM:mailto:${organizerEmail}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n")
}

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export const POST = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const event = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  // Get participants that are not yet confirmed
  const unconfirmed = await prisma.eventParticipant.findMany({
    where: { eventId: id, status: { not: "confirmed" } },
  })

  // Confirm all participants
  const result = await prisma.eventParticipant.updateMany({
    where: { eventId: id, status: { not: "confirmed" } },
    data: { status: "confirmed" },
  })

  // Send ICS calendar invites to confirmed participants who have email
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true, name: true } })
  const smtpSettings = (org?.settings as any)?.smtp
  const smtpConfigured = !!(smtpSettings?.smtpHost && smtpSettings?.smtpUser && smtpSettings?.smtpPass)

  let sentICS = 0

  if (smtpConfigured && unconfirmed.length > 0) {
    const nodemailer = await import("nodemailer").catch(() => null)
    if (nodemailer) {
      const transport = nodemailer.createTransport({
        host: smtpSettings.smtpHost,
        port: smtpSettings.smtpPort || 587,
        secure: (smtpSettings.smtpPort || 587) === 465,
        auth: { user: smtpSettings.smtpUser, pass: smtpSettings.smtpPass },
      })

      const fromEmail = smtpSettings.fromEmail || smtpSettings.smtpUser
      const icsContent = generateICS(event, fromEmail)

      const startDate = new Date(event.startDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
      const endDate = event.endDate ? new Date(event.endDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : ""

      for (const p of unconfirmed) {
        if (!p.email) continue
        try {
          const subject = `📅 Confirmed: ${event.name.replace(/[\r\n]/g, "")}`
          const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
  <tr><td style="background:linear-gradient(135deg,#059669,#10B981);padding:36px;text-align:center;">
    <div style="font-size:48px;margin-bottom:10px;">✅</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">You're Confirmed!</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${escHtml(event.name)}</p>
  </td></tr>
  <tr><td style="padding:28px 36px 10px;">
    <p style="margin:0;font-size:15px;color:#1F2937;">Hello <strong>${escHtml(p.name)}</strong>,</p>
    <p style="margin:10px 0 0;font-size:14px;color:#4B5563;line-height:1.6;">
      Your attendance has been confirmed. This email contains a calendar invitation — please accept it to add the event to your calendar.
    </p>
  </td></tr>
  <tr><td style="padding:15px 36px;">
    <table width="100%" style="background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0;">
      <tr><td style="padding:18px;">
        <table width="100%">
          <tr><td style="padding:6px 0;">
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;margin-bottom:4px;">📅 Date & Time</div>
            <div style="font-size:14px;color:#1F2937;font-weight:600;">${startDate}${endDate ? ` — ${endDate}` : ""}</div>
          </td></tr>
          ${event.location ? `<tr><td style="padding:6px 0;border-top:1px solid #D1FAE5;">
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;margin-bottom:4px;">📍 Location</div>
            <div style="font-size:14px;color:#1F2937;font-weight:600;">${escHtml(event.location)}</div>
          </td></tr>` : ""}
          ${(event as any).isOnline && (event as any).meetingUrl ? `<tr><td style="padding:6px 0;border-top:1px solid #D1FAE5;">
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;font-weight:700;margin-bottom:4px;">🔗 Join Online</div>
            <div style="font-size:14px;"><a href="${(event as any).meetingUrl}" style="color:#059669;font-weight:600;">${escHtml((event as any).meetingUrl)}</a></div>
          </td></tr>` : ""}
        </table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="margin:0;font-size:12px;color:#9CA3AF;">Sent by <strong style="color:#059669;">${escHtml(org?.name || "LeadDrive CRM")}</strong></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

          await transport.sendMail({
            from: smtpSettings.fromEmail
              ? `${(smtpSettings.fromName || "").replace(/[\r\n]/g, "")} <${smtpSettings.fromEmail.replace(/[\r\n]/g, "")}>`
              : smtpSettings.smtpUser,
            to: p.email,
            subject,
            html,
            icalEvent: {
              filename: "invite.ics",
              method: "REQUEST",
              content: icsContent,
            },
          })
          sentICS++
          console.log(`[CONFIRM] Sent ICS to ${p.email} for event ${event.name}`)
        } catch (err: any) {
          console.error(`[CONFIRM] Failed to send ICS to ${p.email}:`, err?.message || err)
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: { confirmed: result.count, sentICS },
  })
})
