/**
 * E3 (Creatio 10X roadmap) — sequence unsubscribe / opt-out.
 *
 * Cold outreach without a working opt-out is spam. Every sequence email
 * carries an unsubscribe footer link + RFC 8058 List-Unsubscribe headers;
 * the suppression record is the org-global SurveyUnsubscribe row
 * (surveyId=null) — the SAME flag sendEmail's marketing path already honors,
 * so one opt-out silences campaigns AND cadences for that address.
 *
 * Opting out also STOPS every active enrollment of every contact/lead with
 * that email (exitReason "opted_out") — «отписка гасит все контакты с тем же
 * email». The send path re-checks suppression before every send: transactional
 * sendEmail bypasses the marketing check by design, so cadences enforce it
 * themselves here.
 *
 * Token: HMAC over (orgId, email) with a dedicated purpose — the link in the
 * email can't be forged into unsubscribing someone else.
 */
import crypto from "crypto"
import type { PrismaClient } from "@prisma/client"
import { hmacToken } from "./secure-token"

const UNSUB_PURPOSE = "seq-unsub"

export function signSequenceUnsubToken(organizationId: string, email: string): string {
  return hmacToken(`${organizationId}|${email.trim().toLowerCase()}`, UNSUB_PURPOSE)
}

export function verifySequenceUnsubToken(organizationId: string, email: string, token: string): boolean {
  const expected = signSequenceUnsubToken(organizationId, email)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function appBase(baseUrl?: string): string {
  return (baseUrl || process.env.NEXTAUTH_URL || process.env.APP_URL || "https://app.leaddrivecrm.org").replace(/\/$/, "")
}

function unsubParams(organizationId: string, email: string): string {
  return new URLSearchParams({
    o: organizationId,
    e: email.trim().toLowerCase(),
    t: signSequenceUnsubToken(organizationId, email),
  }).toString()
}

/** Human-facing unsubscribe PAGE url (footer link → branded confirmation). */
export function buildSequenceUnsubUrl(organizationId: string, email: string, baseUrl?: string): string {
  return `${appBase(baseUrl)}/unsubscribe?${unsubParams(organizationId, email)}`
}

/** Machine-facing one-click endpoint (RFC 8058 List-Unsubscribe POST target). */
export function buildSequenceUnsubOneClickUrl(organizationId: string, email: string, baseUrl?: string): string {
  return `${appBase(baseUrl)}/api/v1/public/sequence-unsubscribe?${unsubParams(organizationId, email)}`
}

/** Org-global suppression check — the send path calls this BEFORE every send. */
export async function isSequenceEmailSuppressed(
  client: Pick<PrismaClient, "surveyUnsubscribe">,
  organizationId: string,
  email: string,
): Promise<boolean> {
  const hit = await client.surveyUnsubscribe.findFirst({
    where: { organizationId, email: email.trim().toLowerCase(), surveyId: null },
    select: { id: true },
  })
  return !!hit
}

export interface SuppressResult {
  /** false when an identical suppression already existed (idempotent re-click). */
  created: boolean
  /** Active enrollments stopped across ALL contacts/leads sharing the email. */
  stoppedEnrollments: number
}

/**
 * Write the org-global opt-out and stop every active enrollment of every
 * contact/lead carrying this email. Idempotent. Caller owns the RLS scope.
 */
export async function suppressSequenceEmail(
  client: Pick<PrismaClient, "surveyUnsubscribe" | "contact" | "lead" | "sequenceEnrollment">,
  args: { organizationId: string; email: string; reason?: string },
): Promise<SuppressResult> {
  const { organizationId } = args
  const email = args.email.trim().toLowerCase()

  const existing = await client.surveyUnsubscribe.findFirst({
    where: { organizationId, email, surveyId: null },
    select: { id: true },
  })
  if (!existing) {
    await client.surveyUnsubscribe.create({
      data: { organizationId, email, surveyId: null, reason: args.reason ?? "sequence_unsubscribe" },
    })
  }

  // «гасит все контакты с тем же email»: resolve every entity on this address
  // (case-insensitive — Contact.email is stored as typed) and stop their
  // active enrollments.
  const [contacts, leads] = await Promise.all([
    client.contact.findMany({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),
    client.lead.findMany({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),
  ])
  const refs = [
    ...contacts.map((c) => ({ entityType: "contact", entityId: c.id })),
    ...leads.map((l) => ({ entityType: "lead", entityId: l.id })),
  ]
  let stopped = 0
  if (refs.length > 0) {
    const res = await client.sequenceEnrollment.updateMany({
      where: { organizationId, status: "active", OR: refs },
      data: { status: "stopped", stoppedAt: new Date(), nextStepAt: null, exitReason: "opted_out" },
    })
    stopped = res.count
  }
  return { created: !existing, stoppedEnrollments: stopped }
}

/**
 * Footer + headers for an outgoing sequence email. The footer is appended
 * before </body> (or at the end); headers implement RFC 8058 one-click.
 */
export function applyUnsubscribeToEmail(args: {
  organizationId: string
  email: string
  html: string
  headers: Record<string, string>
  /** Footer link label — caller passes the org-locale label. */
  label: string
  baseUrl?: string
}): { html: string; headers: Record<string, string> } {
  const pageUrl = buildSequenceUnsubUrl(args.organizationId, args.email, args.baseUrl)
  const oneClickUrl = buildSequenceUnsubOneClickUrl(args.organizationId, args.email, args.baseUrl)
  const footer = `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:12px;color:#8a8a8a;"><a href="${pageUrl}" style="color:#8a8a8a;">${args.label}</a></div>`
  const html = args.html.includes("</body>")
    ? args.html.replace("</body>", `${footer}</body>`)
    : args.html + footer
  return {
    html,
    headers: {
      ...args.headers,
      // RFC 8058: mailers POST to this URL for one-click unsubscribe.
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  }
}
