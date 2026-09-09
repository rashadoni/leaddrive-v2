import { prisma } from "@/lib/prisma"
import { generateOneTimeToken } from "@/lib/one-time-token"
import { sendEmail } from "@/lib/email"
import { buildReplyTo } from "@/lib/email-reply-address"

type PortalPasswordLinkContact = {
  id: string
  organizationId: string
  fullName: string
  email: string | null
  portalPasswordHash: string | null
  portalVerificationToken: string | null
  portalVerificationExpires: Date | null
  organization?: { name: string } | null
}

export type PortalPasswordLinkMode = "reset" | "activation"

export type PortalPasswordLinkResult =
  | { ok: true; mode: PortalPasswordLinkMode }
  | { ok: false; reason: "ineligible" | "delivery_failed" }

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Creates one password link for a portal contact and sends it transactionally.
 *
 * This is shared by public self-service recovery and authenticated portal
 * administrators. The stored value is always a digest; the plaintext exists
 * only in the URL sent to the customer.
 */
export async function issuePortalPasswordLink(contact: PortalPasswordLinkContact): Promise<PortalPasswordLinkResult> {
  if (!contact.email) return { ok: false, reason: "ineligible" }

  const { token, tokenHash } = generateOneTimeToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const mode: PortalPasswordLinkMode = contact.portalPasswordHash ? "reset" : "activation"
  let tokenPersisted = false
  let deliveryOutcomeAmbiguous = false

  try {
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        portalVerificationToken: tokenHash,
        portalVerificationExpires: expires,
      },
    })
    tokenPersisted = true

    const organization = await prisma.organization.findUnique({
      where: { id: contact.organizationId },
      select: { name: true, settings: true },
    })
    const organizationName = organization?.name || contact.organization?.name || "LeadDrive CRM"
    const orgSettings = organization?.settings as { smtp?: { fromEmail?: string; replyTo?: string } } | null
    const replyTo = (process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN)
      ? buildReplyTo({ kind: "contact", id: contact.id })
      : orgSettings?.smtp?.replyTo || orgSettings?.smtp?.fromEmail
    const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"
    const passwordUrl = `${baseUrl}/portal/set-password?token=${encodeURIComponent(token)}&mode=${mode === "reset" ? "reset" : "registration"}`
    const customerName = escapeHtml(contact.fullName)
    const safeOrganizationName = escapeHtml(organizationName)
    const reset = mode === "reset"
    const subject = reset
      ? `${organizationName} — сброс пароля портала`
      : `${organizationName} — настройте доступ к порталу`
    const actionLabel = reset ? "Сбросить пароль" : "Настроить пароль"
    const actionIntro = reset
      ? "Чтобы задать новый пароль для клиентского портала"
      : "Чтобы настроить доступ к клиентскому порталу"

    deliveryOutcomeAmbiguous = true
    const result = await sendEmail({
      to: contact.email,
      subject,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
          <p style="font-size: 15px;">Здравствуйте, <strong>${customerName}</strong>!</p>
          <p style="font-size: 15px;">${actionIntro} <strong>${safeOrganizationName}</strong>, перейдите по ссылке:</p>
          <p style="margin: 24px 0;"><a href="${passwordUrl}" style="color: #2563eb; text-decoration: underline; font-size: 15px;">${actionLabel}</a></p>
          <p style="color: #6b7280; font-size: 13px;">Ссылка действительна 24 часа и может быть использована только один раз.</p>
          <p style="color: #6b7280; font-size: 13px;">Если вы не запрашивали это действие, просто проигнорируйте письмо.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">— ${safeOrganizationName}</p>
        </div>
      `,
      text: [
        `Здравствуйте, ${contact.fullName}!`,
        "",
        `${actionIntro} ${organizationName}, перейдите по ссылке:`,
        passwordUrl,
        "",
        "Ссылка действительна 24 часа и может быть использована только один раз.",
        "Если вы не запрашивали это действие, просто проигнорируйте письмо.",
        "",
        `— ${organizationName}`,
      ].join("\n"),
      replyTo,
      organizationId: contact.organizationId,
      contactId: contact.id,
      transactional: true,
    })
    if (!result.success) {
      deliveryOutcomeAmbiguous = false
      throw new Error("portal_password_link_not_accepted")
    }
  } catch {
    // A provider timeout can still mean the message was accepted. Retain that
    // token in the ambiguous case, but restore the previous token after a
    // definite provider rejection.
    if (tokenPersisted && !deliveryOutcomeAmbiguous) {
      try {
        await prisma.contact.updateMany({
          where: { id: contact.id, portalVerificationToken: tokenHash },
          data: {
            portalVerificationToken: contact.portalVerificationToken,
            portalVerificationExpires: contact.portalVerificationExpires,
          },
        })
      } catch { /* best-effort rollback */ }
    }
    return { ok: false, reason: "delivery_failed" }
  }

  return { ok: true, mode }
}
