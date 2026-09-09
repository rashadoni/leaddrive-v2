import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const addSchema = z.object({
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().default("attendee"),
  status: z.string().default("registered"),
  source: z.string().default("invited"),
  notes: z.string().optional(),
})

export const GET = withRls(async (
  _req: NextRequest,
  { orgId },
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params

  const event = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId: id },
    orderBy: { registeredAt: "desc" },
  })

  return NextResponse.json({ success: true, data: participants })
})

export const POST = withRlsAuth("events", "write", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  const event = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const body = await req.json()

  // Support bulk add (array of participants)
  const items = Array.isArray(body) ? body : [body]
  const created = []
  const errors: string[] = []

  for (const item of items) {
    const parsed = addSchema.safeParse(item)
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")
      console.error("[PARTICIPANTS] Validation failed:", msg, "input:", JSON.stringify(item))
      errors.push(msg)
      continue
    }

    try {
      const participant = await prisma.eventParticipant.create({
        data: { ...parsed.data, eventId: id },
      })
      created.push(participant)
    } catch (err: any) {
      console.error("[PARTICIPANTS] Prisma create error:", err?.message || err)
      // #14 unique(eventId, email): a duplicate email for this event is skipped
      // with a friendly note instead of the raw Prisma constraint string. Other
      // rows in the bulk request still succeed.
      errors.push(
        err?.code === "P2002"
          ? `${parsed.data.email || parsed.data.name} is already a participant of this event`
          : err?.message || "Database error",
      )
    }
  }

  if (created.length === 0) {
    return NextResponse.json({
      success: false,
      error: errors.length > 0 ? errors.join("; ") : "No participants were added",
    }, { status: 400 })
  }

  // Update registered count
  const count = await prisma.eventParticipant.count({ where: { eventId: id } })
  await prisma.event.updateMany({
    where: { id, organizationId: orgId },
    data: { registeredCount: count },
  })

  return NextResponse.json({ success: true, data: created }, { status: 201 })
})

export const PATCH = withRlsAuth("events", "write", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  // Verify event belongs to this org
  const eventCheck = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  if (!eventCheck) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const body = await req.json()
  const { participantId, action, participantIds } = body

  // Bulk send invitations
  if (action === "send_invites") {
    const ids = participantIds || []
    if (ids.length === 0) return NextResponse.json({ error: "No participants selected" }, { status: 400 })

    // Get event + participants
    const event = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    const participants = await prisma.eventParticipant.findMany({
      where: { id: { in: ids }, eventId: id },
    })

    // Try to send via SMTP (stored in organization.settings.smtp)
    let sentCount = 0
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true, name: true } })
    const smtpSettings = (org?.settings as any)?.smtp
    const smtpConfigured = !!(smtpSettings?.smtpHost && smtpSettings?.smtpUser && smtpSettings?.smtpPass)

    // Load invitation email template if exists
    const template = await prisma.emailTemplate.findFirst({
      where: { organizationId: orgId, name: "Event Invitation", isActive: true },
    }).catch(() => null)

    if (smtpConfigured) {
      const nodemailer = await import("nodemailer").catch(() => null)
      if (nodemailer) {
        const transport = nodemailer.createTransport({
          host: smtpSettings.smtpHost,
          port: smtpSettings.smtpPort || 587,
          secure: (smtpSettings.smtpPort || 587) === 465,
          auth: { user: smtpSettings.smtpUser, pass: smtpSettings.smtpPass },
        })

        const registrationUrl = `${process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"}/events/${id}/register`

        for (const p of participants) {
          if (!p.email) continue
          try {
            // Use template if available, otherwise fallback
            let html: string
            let subject: string

            if (template?.htmlBody) {
              html = template.htmlBody
                .replace(/\{\{event_name\}\}/g, escHtml(event.name))
                .replace(/\{\{event_date\}\}/g, new Date(event.startDate).toLocaleString(undefined))
                .replace(/\{\{event_location\}\}/g, escHtml(event.location || "Online"))
                .replace(/\{\{event_description\}\}/g, escHtml(event.description || ""))
                .replace(/\{\{participant_role\}\}/g, escHtml(p.role || "attendee"))
                .replace(/\{\{confirm_url\}\}/g, registrationUrl)
                .replace(/\{\{client_name\}\}/g, escHtml(p.name))
                .replace(/\{\{company_name\}\}/g, escHtml(org?.name || ""))
              subject = (template.subject || "Invitation: {{event_name}}")
                .replace(/\{\{event_name\}\}/g, event.name.replace(/[\r\n]/g, ""))
            } else {
              subject = `You're Invited: ${event.name.replace(/[\r\n]/g, "")}`
              const startDate = new Date(event.startDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
              const endDate = event.endDate ? new Date(event.endDate).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : ""
              html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
  <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:40px;text-align:center;">
    <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">${escHtml(event.name)}</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${escHtml(event.type || "Event")}</p>
  </td></tr>
  <tr><td style="padding:30px 40px 10px;">
    <p style="margin:0;font-size:15px;color:#1F2937;">Hello <strong>${escHtml(p.name)}</strong>,</p>
    <p style="margin:10px 0 0;font-size:14px;color:#4B5563;line-height:1.6;">
      You are invited to join us! Please confirm your attendance by clicking the button below.
    </p>
  </td></tr>
  <tr><td style="padding:15px 40px;">
    <table width="100%" style="background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0;">
      <tr><td style="padding:20px;">
        <table width="100%">
          <tr><td style="padding:8px 0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#EEF2FF;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128197;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">Date & Time</div><div style="font-size:14px;color:#1F2937;font-weight:600;">${startDate}${endDate ? ` — ${endDate}` : ""}</div></td>
            </tr></table>
          </td></tr>
          ${event.location ? `<tr><td style="padding:8px 0;border-top:1px solid #E2E8F0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#FEF2F2;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128205;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">Location</div><div style="font-size:14px;color:#1F2937;font-weight:600;">${escHtml(event.location)}</div></td>
            </tr></table>
          </td></tr>` : ""}
          ${event.isOnline && event.meetingUrl ? `<tr><td style="padding:8px 0;border-top:1px solid #E2E8F0;">
            <table><tr>
              <td style="width:36px;vertical-align:middle;"><div style="width:32px;height:32px;background:#F0FDF4;border-radius:8px;text-align:center;line-height:32px;font-size:16px;">&#128279;</div></td>
              <td style="padding-left:12px;"><div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:700;">Join Online</div><div style="font-size:14px;"><a href="${event.meetingUrl}" style="color:#4F46E5;font-weight:600;">${escHtml(event.meetingUrl)}</a></div></td>
            </tr></table>
          </td></tr>` : ""}
        </table>
      </td></tr>
    </table>
  </td></tr>
  ${event.description ? `<tr><td style="padding:5px 40px 15px;"><p style="margin:0;font-size:13px;color:#6B7280;line-height:1.5;background:#FEFCE8;border-radius:8px;padding:12px;border:1px solid #FDE68A;">${escHtml(event.description?.slice(0, 300))}</p></td></tr>` : ""}
  <tr><td style="padding:10px 40px 25px;text-align:center;">
    <a href="${registrationUrl}" style="display:inline-block;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;padding:14px 40px;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;box-shadow:0 4px 12px rgba(79,70,229,0.4);">Confirm My Attendance</a>
  </td></tr>
  <tr><td style="padding:0 40px 20px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9CA3AF;">Or copy this link: <a href="${registrationUrl}" style="color:#4F46E5;">${registrationUrl}</a></p>
  </td></tr>
  <tr><td style="padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="margin:0;font-size:12px;color:#9CA3AF;">Sent by <strong style="color:#4F46E5;">${escHtml(org?.name || "LeadDrive CRM")}</strong></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
            }

            await transport.sendMail({
              from: smtpSettings.fromEmail ? `${(smtpSettings.fromName || "").replace(/[\r\n]/g, "")} <${smtpSettings.fromEmail.replace(/[\r\n]/g, "")}>` : smtpSettings.smtpUser,
              to: p.email,
              subject,
              html,
            })
            sentCount++
            console.log(`[INVITE] Sent to ${p.email} for event ${event.name}`)
          } catch (emailErr: any) {
            console.error(`[INVITE] Failed to send to ${p.email}:`, emailErr?.message || emailErr)
          }
        }
      }
    } else {
      console.log(`[INVITE] SMTP not configured. smtpHost=${smtpSettings?.smtpHost}, smtpUser=${smtpSettings?.smtpUser}`)
    }

    // Mark all as sent regardless (so UI shows status)
    await prisma.eventParticipant.updateMany({
      where: { id: { in: ids }, eventId: id },
      data: { inviteStatus: "sent", invitedAt: new Date() },
    })

    return NextResponse.json({
      success: true,
      data: { sent: sentCount, total: participants.length, smtpConfigured },
    })
  }

  // Single participant update (status, role, inviteStatus)
  if (participantId) {
    // Verify participant belongs to this event (event already verified via orgId above)
    const existingParticipant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId: id },
    })
    if (!existingParticipant) return NextResponse.json({ error: "Participant not found" }, { status: 404 })

    const updateData: any = {}
    if (body.status) updateData.status = body.status
    if (body.role) updateData.role = body.role
    if (body.inviteStatus) updateData.inviteStatus = body.inviteStatus

    await prisma.eventParticipant.update({
      where: { id: participantId },
      data: updateData,
    })

    // Recalculate attended count
    const attendedCount = await prisma.eventParticipant.count({
      where: { eventId: id, status: "attended" },
    })
    await prisma.event.updateMany({
      where: { id, organizationId: orgId },
      data: { attendedCount },
    })

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
})

export const DELETE = withRlsAuth("events", "delete", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  const { participantId } = await req.json()
  if (!participantId) return NextResponse.json({ error: "participantId required" }, { status: 400 })

  // Verify event belongs to org before deleting participant
  const event = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId: id },
  })
  if (!participant) return NextResponse.json({ error: "Participant not found" }, { status: 404 })

  await prisma.eventParticipant.delete({ where: { id: participantId } })

  const count = await prisma.eventParticipant.count({ where: { eventId: id } })
  const attendedCount = await prisma.eventParticipant.count({ where: { eventId: id, status: "attended" } })
  await prisma.event.updateMany({
    where: { id, organizationId: orgId },
    data: { registeredCount: count, attendedCount },
  })

  return NextResponse.json({ success: true, data: { remaining: count } })
})
