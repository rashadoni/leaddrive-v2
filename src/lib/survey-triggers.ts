import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { sendSms } from "@/lib/sms"
import crypto from "crypto"

interface SendInviteInput {
  surveyId: string
  organizationId: string
  email?: string | null
  phone?: string | null
  contactId?: string | null
  ticketId?: string | null
  channel?: "email" | "sms" | "link" | "whatsapp" | "web_chat"
  // For channel=web_chat — the session the bot should post into
  webChatSessionId?: string | null
  baseUrl?: string
}

function signUnsubToken(orgId: string, surveyId: string, email: string): string {
  const secret = process.env.NEXTAUTH_SECRET || "ld-survey-unsub"
  return crypto
    .createHmac("sha256", secret)
    .update(`${orgId}:${surveyId}:${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32)
}

export function verifyUnsubToken(orgId: string, surveyId: string, email: string, token: string): boolean {
  const expected = signUnsubToken(orgId, surveyId, email)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

export async function sendSurveyInvite({
  surveyId,
  organizationId,
  email,
  phone,
  contactId,
  ticketId,
  channel = "email",
  webChatSessionId,
  baseUrl,
}: SendInviteInput): Promise<{ ok: boolean; error?: string }> {
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, organizationId, status: "active" },
  })
  if (!survey) return { ok: false, error: "survey not active" }

  const appUrl = baseUrl || process.env.NEXTAUTH_URL || process.env.APP_URL || ""
  // Include email/phone as query params so the survey form can pre-fill with
  // the recipient's prior response (if any) and let them edit instead of
  // hitting "already submitted".
  const qs = new URLSearchParams()
  if (email) qs.set("e", email)
  if (phone) qs.set("p", phone)
  // Carry the ticket so the response links back to it (sets ticket.satisfactionRating) — else a
  // WhatsApp/SMS rating lands in survey_responses with ticketId=null and the ticket shows "not rated".
  if (ticketId) qs.set("t", ticketId)
  const qsStr = qs.toString()
  const link = `${appUrl.replace(/\/$/, "")}/s/${survey.publicSlug}${qsStr ? `?${qsStr}` : ""}`

  if (channel === "whatsapp") {
    if (!phone) return { ok: false, error: "no phone" }
    try {
      // Survey invites go out via a pre-approved Meta template when the
      // tenant has configured ChannelConfig.settings.whatsappSurveyTemplate.
      // Without a template, fall back to plain text inside the 23h session
      // window — the library itself blocks free-form text outside the
      // window, so this is safe (no policy violation).
      const waConfig = await prisma.channelConfig.findFirst({
        where: { organizationId, channelType: "whatsapp", isActive: true },
        select: { settings: true },
      })
      const templateName = (waConfig?.settings as any)?.whatsappSurveyTemplate
      const { sendWhatsAppMessage } = await import("@/lib/whatsapp")

      const fallbackText = `${survey.name}\n${link}`

      const r = templateName
        ? await sendWhatsAppMessage({
            to: phone,
            message: `[template:${templateName}]`,
            templateName,
            templateVariables: {
              "1": survey.name,
              "2": link,
              survey_name: survey.name,
              survey_link: link,
            },
            organizationId,
            contactId: contactId || undefined,
          })
        : await sendWhatsAppMessage({
            to: phone,
            message: fallbackText,
            organizationId,
            contactId: contactId || undefined,
          })

      if (!(r as { success?: boolean }).success) return { ok: false, error: (r as { error?: string })?.error || "whatsapp send failed" }
      await prisma.survey.update({ where: { id: survey.id }, data: { totalSent: { increment: 1 } } })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || "whatsapp error" }
    }
  }

  if (channel === "web_chat") {
    if (!webChatSessionId) return { ok: false, error: "no web-chat session" }
    try {
      const body = `${survey.name}\n${link}`
      await prisma.webChatMessage.create({
        data: {
          organizationId,
          sessionId: webChatSessionId,
          fromRole: "bot",
          text: body,
        },
      })
      await prisma.survey.update({ where: { id: survey.id }, data: { totalSent: { increment: 1 } } })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || "web-chat error" }
    }
  }

  if (channel === "sms") {
    if (!phone) return { ok: false, error: "no phone" }

    // Check phone-level unsubscribe (STOP reply or manual suppression)
    const suppressedSms = await prisma.surveyUnsubscribe.findFirst({
      where: { organizationId, phone, OR: [{ surveyId: null }, { surveyId }] },
      select: { id: true },
    }).catch(() => null)
    if (suppressedSms) return { ok: false, error: "unsubscribed" }

    // Some SMS providers strip newlines, which glues the URL to whatever
    // comes after it (e.g. "...747Reply STOP"). Put the link at the very
    // end and leave a period + space after the STOP text so the URL stays
    // the last token and keeps its boundary.
    const smsMessage = `${survey.name}. Reply STOP to unsubscribe. ${link}`
    const result = await sendSms({ to: phone, message: smsMessage, organizationId })
    if (!result.success) return { ok: false, error: result.error || "sms send failed" }
    await prisma.survey.update({
      where: { id: survey.id },
      data: { totalSent: { increment: 1 } },
    })
    return { ok: true }
  }

  if (!email) return { ok: false, error: "no email" }

  // Check unsubscribe list
  const suppressed = await prisma.surveyUnsubscribe.findFirst({
    where: { organizationId, email: email.toLowerCase(), OR: [{ surveyId: null }, { surveyId }] },
    select: { id: true },
  }).catch(() => null)
  if (suppressed) return { ok: false, error: "unsubscribed" }

  const unsubToken = signUnsubToken(organizationId, survey.id, email)
  const unsubUrl = `${appUrl.replace(/\/$/, "")}/s/unsubscribe?s=${survey.id}&e=${encodeURIComponent(email)}&t=${unsubToken}`

  const subject = `${survey.name}`
  const title = htmlEscape(survey.name)
  const desc = survey.description ? htmlEscape(survey.description) : "We'd love to hear your feedback."
  const html = `
<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial;margin:0;padding:24px;background:#f5f5f5;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.05)">
    <h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
    <p style="color:#555;line-height:1.5">${desc}</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#EA580C;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:500">Take the survey</a>
    </p>
    <p style="color:#888;font-size:12px;margin:0">Or paste this link in your browser: <a href="${link}">${link}</a></p>
    <p style="color:#bbb;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
      Don't want to receive these? <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>
    </p>
  </div>
</body></html>`

  try {
    const result = await sendEmail({ to: email, subject, html, organizationId, contactId: contactId || undefined })
    if (!result?.success) return { ok: false, error: (result as any)?.error || "smtp send failed" }

    await prisma.survey.update({
      where: { id: survey.id },
      data: { totalSent: { increment: 1 } },
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || "send error" }
  }
}

/**
 * Pick the best closed-loop channel for a survey invite based on the
 * ticket's original source. Mirrors the per-source logic used by both the
 * immediate `triggerSurveysOnTicketResolved` path and the catch-up cron
 * — keep them in sync via this helper.
 *
 * Returns null when no usable channel exists for the contact.
 */
/** Type guard: does this unknown value look like `{ sessionId: string }`? */
function hasSessionId(v: unknown): v is { sessionId: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "sessionId" in v &&
    typeof (v as { sessionId: unknown }).sessionId === "string" &&
    (v as { sessionId: string }).sessionId.length > 0
  )
}

export function pickInviteChannel(input: {
  source: string | null | undefined
  sourceMeta: unknown
  contact: { email: string | null; phone: string | null }
  skipWhatsApp?: boolean
}): { channel: "email" | "whatsapp" | "web_chat" | "sms"; webChatSessionId: string | null } | null {
  const { source, sourceMeta, contact, skipWhatsApp } = input
  if (source === "whatsapp" && contact.phone && !skipWhatsApp) {
    return { channel: "whatsapp", webChatSessionId: null }
  }
  if (source === "web_chat" && hasSessionId(sourceMeta)) {
    return { channel: "web_chat", webChatSessionId: sourceMeta.sessionId }
  }
  if (contact.email) return { channel: "email", webChatSessionId: null }
  if (contact.phone) return { channel: "sms", webChatSessionId: null }
  return null
}

/**
 * Fire when a ticket transitions into "resolved".
 * Finds all active surveys in this org that have trigger `afterTicketResolve = true`
 * and sends invites to the linked contact's email.
 */
export async function triggerSurveysOnTicketResolved(
  orgId: string,
  ticket: { id: string; contactId: string | null; ticketNumber: string; source?: string | null; sourceMeta?: unknown },
  opts: { skipWhatsAppChannel?: boolean } = {},
): Promise<void> {
  if (!ticket.contactId) return

  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, organizationId: orgId },
    select: { email: true, phone: true, id: true },
  })
  if (!contact || (!contact.email && !contact.phone && !ticket.source)) return

  // Pick the best channel via the shared helper — single source of truth
  // with the catch-up cron (`/api/cron/post-resolution-survey`). The
  // skipWhatsAppChannel flag is set when the ticket's resolve-notification
  // already embedded the survey link into the same WhatsApp message, so
  // we don't send a duplicate.
  const picked = pickInviteChannel({
    source: ticket.source,
    sourceMeta: ticket.sourceMeta,
    contact,
    skipWhatsApp: opts.skipWhatsAppChannel,
  })
  if (!picked) return // nothing we can do
  const preferredChannel = picked.channel
  const webChatSessionId = picked.webChatSessionId

  const surveys = await prisma.survey.findMany({
    where: { organizationId: orgId, status: "active" },
  })

  for (const s of surveys) {
    const triggers = (s.triggers as any) || {}
    if (!triggers.afterTicketResolve) continue

    const already = await prisma.surveyResponse.findFirst({
      where: { surveyId: s.id, ticketId: ticket.id },
      select: { id: true },
    })
    if (already) continue

    const result = await sendSurveyInvite({
      surveyId: s.id,
      organizationId: orgId,
      email: contact.email,
      phone: contact.phone,
      contactId: contact.id,
      ticketId: ticket.id,
      channel: preferredChannel,
      webChatSessionId,
    })

    // Fallback to email if primary channel failed and email is available.
    if (!result.ok && preferredChannel !== "email" && contact.email) {
      await sendSurveyInvite({
        surveyId: s.id,
        organizationId: orgId,
        email: contact.email,
        contactId: contact.id,
        ticketId: ticket.id,
        channel: "email",
      })
    }

    // Optional SMS duplicate — when the survey's triggers flag smsBackup and
    // the contact has a phone, always send an SMS too (even on top of a
    // successful primary channel). Lets operators guarantee reach.
    if (triggers.smsBackup && contact.phone && preferredChannel !== "sms") {
      await sendSurveyInvite({
        surveyId: s.id,
        organizationId: orgId,
        phone: contact.phone,
        contactId: contact.id,
        ticketId: ticket.id,
        channel: "sms",
      }).catch(() => {})
    }
  }
}

/**
 * Generic trigger runner used by deal-won / invoice-paid / lead-converted
 * hooks. Skips contacts that already responded to the same survey for the
 * same source entity (deduped via SurveyResponse.contactId match).
 */
async function runSurveyTrigger(
  orgId: string,
  triggerKey: "afterDealWon" | "afterInvoicePaid" | "afterLeadConverted",
  contactId: string | null,
): Promise<void> {
  if (!contactId) return
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: orgId },
    select: { email: true, phone: true, id: true },
  })
  if (!contact?.email && !contact?.phone) return

  const surveys = await prisma.survey.findMany({
    where: { organizationId: orgId, status: "active" },
  })

  for (const s of surveys) {
    const triggers = (s.triggers as any) || {}
    if (!triggers[triggerKey]) continue

    // Don't re-survey the same contact for the same survey twice.
    const already = await prisma.surveyResponse.findFirst({
      where: { surveyId: s.id, contactId: contact.id },
      select: { id: true },
    })
    if (already) continue

    const channel: "email" | "sms" = (s.channels as string[]).includes("email") && contact.email ? "email" : "sms"
    await sendSurveyInvite({
      surveyId: s.id,
      organizationId: orgId,
      email: contact.email,
      phone: contact.phone,
      contactId: contact.id,
      channel,
    })
    if (triggers.smsBackup && contact.phone && channel !== "sms") {
      await sendSurveyInvite({
        surveyId: s.id,
        organizationId: orgId,
        phone: contact.phone,
        contactId: contact.id,
        channel: "sms",
      }).catch(() => {})
    }
  }
}

export async function triggerSurveysOnDealWon(orgId: string, contactId: string | null): Promise<void> {
  return runSurveyTrigger(orgId, "afterDealWon", contactId)
}

export async function triggerSurveysOnInvoicePaid(orgId: string, contactId: string | null): Promise<void> {
  return runSurveyTrigger(orgId, "afterInvoicePaid", contactId)
}

export async function triggerSurveysOnLeadConverted(orgId: string, contactId: string | null): Promise<void> {
  return runSurveyTrigger(orgId, "afterLeadConverted", contactId)
}
