import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { withSignedRedirect } from "@/lib/tracking-link"
import { prisma } from "@/lib/prisma"
import { NOREPLY_EMAIL, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME_FALLBACK } from "@/lib/constants"
import { runtimePrivateUploadDirectory } from "@/lib/runtime-paths"
import {
  assertSafeMailHeaderValue,
  createSecureSmtpTransport,
  sanitizeMailHeaders,
} from "@/lib/secure-smtp"

interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpTls: boolean
  fromEmail: string
  fromName: string
}

async function getSmtpConfig(organizationId?: string): Promise<SmtpConfig | null> {
  // First try DB settings for the organization
  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true, name: true },
    })
    const settings = (org?.settings as { smtp?: Partial<SmtpConfig> } | null) || {}
    const smtp = settings.smtp
    if (smtp?.smtpHost && smtp?.smtpUser && smtp?.smtpPass) {
      return {
        smtpHost: smtp.smtpHost,
        smtpPort: smtp.smtpPort || 587,
        smtpUser: smtp.smtpUser,
        smtpPass: smtp.smtpPass,
        smtpTls: smtp.smtpTls !== false,
        fromEmail: smtp.fromEmail || smtp.smtpUser,
        fromName: smtp.fromName || org?.name || "LeadDrive CRM",
      }
    }
  }

  // Fallback to env vars
  if (process.env.SMTP_USER) {
    return {
      smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
      smtpPort: Number(process.env.SMTP_PORT || 587),
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS || "",
      smtpTls: true,
      fromEmail: process.env.SMTP_FROM || process.env.SMTP_USER,
      fromName: "LeadDrive CRM",
    }
  }

  return null
}

function createTransporter(config: SmtpConfig) {
  return createSecureSmtpTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    user: config.smtpUser,
    pass: config.smtpPass,
    tls: config.smtpTls,
  })
}

const MAX_SMTP_ATTACHMENT_BYTES = 25 * 1024 * 1024

function isWithinRoot(filePath: string, root: string): boolean {
  const relative = path.relative(root, filePath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function materializeLocalAttachments(attachments?: { filename: string; path: string }[]) {
  if (!attachments?.length) return undefined
  const configuredRoots = [
    runtimePrivateUploadDirectory("email-attachments"),
    path.resolve("/tmp"),
    path.resolve("/private/tmp"),
  ]
  const roots = await Promise.all(configuredRoots.map(async root => realpath(root).catch(() => root)))

  return Promise.all(attachments.map(async attachment => {
    const filename = assertSafeMailHeaderValue("Attachment filename", attachment.filename)
    const resolved = await realpath(path.resolve(attachment.path))
    if (!roots.some(root => isWithinRoot(resolved, root))) {
      throw new Error("Email attachment path is outside approved temporary roots")
    }
    const metadata = await stat(resolved)
    if (!metadata.isFile() || metadata.size > MAX_SMTP_ATTACHMENT_BYTES) {
      throw new Error("Email attachment is not a bounded regular file")
    }
    return { filename, content: await readFile(resolved) }
  }))
}

// Resend provider — transactional-email service with much better deliverability than
// self-hosted Gmail SMTP. Activated automatically when RESEND_API_KEY is set in env.
// Falls back to the SMTP path on any error.
async function sendViaResend(params: {
  from: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
}): Promise<{ messageId: string } | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      console.error("[email] Resend failed:", res.status, t)
      return null
    }
    const json = await res.json()
    return { messageId: json.id || "resend" }
  } catch (e) {
    console.error("[email] Resend exception:", e)
    return null
  }
}

// Postmark provider — transactional service used as automatic fallback if
// Resend rejects or errors. Activated when POSTMARK_SERVER_TOKEN is set.
// Converts our unified shape into Postmark's JSON schema (capitalized fields).
async function sendViaPostmark(params: {
  from: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
}): Promise<{ messageId: string } | null> {
  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) return null
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: params.from,
        To: params.to,
        Subject: params.subject,
        HtmlBody: params.html,
        ...(params.text ? { TextBody: params.text } : {}),
        ...(params.replyTo ? { ReplyTo: params.replyTo } : {}),
        ...(params.headers
          ? { Headers: Object.entries(params.headers).map(([Name, Value]) => ({ Name, Value })) }
          : {}),
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      console.error("[email] Postmark failed:", res.status, t)
      return null
    }
    const json = await res.json()
    return { messageId: json.MessageID || "postmark" }
  } catch (e) {
    console.error("[email] Postmark exception:", e)
    return null
  }
}

// Plain-text fallback derived from HTML — reduces spam score: text/html multipart
// messages that carry both versions are trusted more than HTML-only ones.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  headers,
  organizationId,
  campaignId,
  templateId,
  contactId,
  variantId,
  sentBy,
  sequenceId,
  attachments,
  transactional = false,
}: {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
  organizationId?: string
  campaignId?: string
  templateId?: string
  contactId?: string
  variantId?: string
  sentBy?: string
  /** E4/E5 — tags cadence emails on the EmailLog (daily-limit count + step stats). */
  sequenceId?: string
  attachments?: { filename: string; path: string }[]
  /**
   * When true, skips the global SurveyUnsubscribe check. Use for registration
   * emails, password reset, ticket replies — anything a customer can't opt out
   * of without losing access to their own data. Defaults to false (= marketing).
   */
  transactional?: boolean
}) {
  let safeHeaders: Record<string, string> | undefined
  try {
    to = assertSafeMailHeaderValue("Recipient", to)
    subject = assertSafeMailHeaderValue("Subject", subject)
    if (replyTo) replyTo = assertSafeMailHeaderValue("Reply-To", replyTo)
    safeHeaders = sanitizeMailHeaders(headers)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Invalid email header" }
  }

  // Respect global opt-out unless this is a transactional email. We look up by
  // (organizationId, email) — if any row has surveyId=null we treat it as a
  // universal "do not send" flag.
  if (!transactional && organizationId) {
    const optedOut = await prisma.surveyUnsubscribe.findFirst({
      where: { organizationId, email: to.toLowerCase(), surveyId: null },
      select: { id: true },
    })
    if (optedOut) {
      console.log(`[EMAIL] Skipping — ${to} globally unsubscribed from ${organizationId}`)
      await prisma.emailLog.create({
        data: {
          organizationId,
          direction: "outbound",
          fromEmail: process.env.EMAIL_FROM_ADDRESS || NOREPLY_EMAIL,
          toEmail: to,
          subject,
          body: html,
          status: "skipped_unsubscribed",
          campaignId,
          templateId,
          contactId,
          variantId,
          sentBy,
          sequenceId,
        },
      }).catch(() => {})
      return { success: false, error: "Recipient unsubscribed" }
    }
  }

  const config = await getSmtpConfig(organizationId)

  // When at least one transactional provider (Resend or Postmark) is enabled
  // AND EMAIL_FROM_ADDRESS is explicitly set, we use a single technical sender
  // address for ALL tenants and swap the friendly name to the organization's
  // display name. Postmark serves as automatic fallback for Resend.
  //
  // EMAIL_FROM_ADDRESS MUST be explicitly set: without it we'd try to send from
  // the constants default which won't be a verified domain → every email would
  // 400 from both APIs.
  let centralFromStr: string | null = null
  const explicitFrom = process.env.EMAIL_FROM_ADDRESS
  const hasTransactionalProvider = !!(process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN)
  if (hasTransactionalProvider && explicitFrom) {
    let orgName = EMAIL_FROM_NAME_FALLBACK
    if (organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      })
      orgName = org?.name || orgName
    }
    centralFromStr = `"${orgName}" <${explicitFrom}>`
  }

  const fromEmail = centralFromStr
    ? EMAIL_FROM_ADDRESS
    : config?.fromEmail || NOREPLY_EMAIL

  // If neither Resend nor SMTP is configured, log and bail.
  if (!config && !centralFromStr) {
    console.log(`[EMAIL] SMTP not configured | To: ${to} | Subject: ${subject}`)

    if (organizationId) {
      await prisma.emailLog.create({
        data: {
          organizationId,
          direction: "outbound",
          fromEmail,
          toEmail: to,
          subject,
          body: html,
          status: "failed",
          errorMessage: "SMTP not configured",
          campaignId,
          templateId,
          contactId,
          variantId,
          sentBy,
          sequenceId,
        },
      }).catch(() => {})
    }

    return { success: false, error: "SMTP not configured" }
  }

  try {
    const transporter = config ? createTransporter(config) : null
    const smtpFromStr = config
      ? (config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail)
      : null
    // Resend path gets the centralized sender; SMTP path keeps per-tenant from.
    const fromStr = centralFromStr || smtpFromStr || NOREPLY_EMAIL
    const textBody = text || htmlToPlainText(html)

    // Create log first to get ID for tracking pixel
    let logId: string | undefined
    if (organizationId && campaignId) {
      try {
        const log = await prisma.emailLog.create({
          data: {
            organizationId,
            direction: "outbound",
            fromEmail,
            toEmail: to,
            subject,
            body: html,
            status: "pending",
            campaignId,
            templateId,
            contactId,
            variantId,
            sentBy,
            sequenceId,
          },
        })
        logId = log.id
      } catch {}
    }

    // Inject tracking pixel and rewrite links for campaign emails
    let finalHtml = html
    if (logId && campaignId) {
      const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"
      // Inject open tracking pixel before </body> or at the end
      const trackingPixel = `<img src="${baseUrl}/api/v1/tracking/open?logId=${logId}" width="1" height="1" style="display:none" alt="" />`
      if (finalHtml.includes("</body>")) {
        finalHtml = finalHtml.replace("</body>", `${trackingPixel}</body>`)
      } else {
        finalHtml += trackingPixel
      }
      // Rewrite links for click tracking (only http/https links in href)
      finalHtml = finalHtml.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
        // F-29: sign the redirect target so this domain cannot be borrowed to
        // front someone else's page. See src/lib/tracking-link.ts.
        return `href="${withSignedRedirect(`${baseUrl}/api/v1/tracking/click?logId=${logId}&url=${encodeURIComponent(url)}`, url)}"`
      })
    }

    // Provider fallback chain: Resend → Postmark → per-tenant SMTP. First
    // provider that returns a messageId wins. Postmark only fires if Resend
    // returned null (= no key OR API rejected). The SMTP branch only fires if
    // both transactional services are unavailable.
    const resendResult = await sendViaResend({
      from: fromStr,
      to,
      subject,
      html: finalHtml,
      text: textBody,
      replyTo,
      headers: safeHeaders,
    })

    const postmarkResult = resendResult
      ? null
      : await sendViaPostmark({
          from: fromStr,
          to,
          subject,
          html: finalHtml,
          text: textBody,
          replyTo,
          headers: safeHeaders,
        })

    let info: { messageId: string }
    if (resendResult) {
      info = { messageId: resendResult.messageId }
    } else if (postmarkResult) {
      info = { messageId: postmarkResult.messageId }
    } else if (transporter) {
      info = await transporter.sendMail({
        from: fromStr,
        to,
        subject,
        html: finalHtml,
        text: textBody,
        ...(replyTo ? { replyTo } : {}),
        ...(safeHeaders ? { headers: safeHeaders } : {}),
        ...(attachments?.length ? { attachments: await materializeLocalAttachments(attachments) } : {}),
      })
    } else {
      throw new Error("Email delivery failed: Resend + Postmark rejected and no SMTP fallback configured")
    }

    // Update log with success
    if (logId) {
      await prisma.emailLog.update({
        where: { id: logId },
        data: { status: "sent", messageId: info.messageId },
      }).catch(() => {})
    } else if (organizationId) {
      await prisma.emailLog.create({
        data: {
          organizationId,
          direction: "outbound",
          fromEmail,
          toEmail: to,
          subject,
          body: html,
          status: "sent",
          messageId: info.messageId,
          campaignId,
          templateId,
          contactId,
          variantId,
          sentBy,
          sequenceId,
        },
      }).catch(() => {})
    }

    return { success: true, messageId: info.messageId }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    // Log failure
    if (organizationId) {
      await prisma.emailLog.create({
        data: {
          organizationId,
          direction: "outbound",
          fromEmail,
          toEmail: to,
          subject,
          body: html,
          status: "failed",
          errorMessage,
          campaignId,
          templateId,
          contactId,
          variantId,
          sentBy,
          sequenceId,
        },
      }).catch(() => {})
    }

    return { success: false, error: "Failed to send email" }
  }
}

function escapeHtmlValue(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function renderTemplate(htmlBody: string, variables: Record<string, string>): string {
  let rendered = htmlBody
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${key}}}`, escapeHtmlValue(value))
  }
  return rendered
}
