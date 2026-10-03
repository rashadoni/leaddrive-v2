import { NextRequest, NextResponse } from "next/server"
import { parseMetaSignedRequest, signedRequestUserId } from "@/lib/social/meta-signed-request"
import { revokeInstagramLoginAccount } from "@/lib/social/instagram-revoke"
import { makeDeletionConfirmationCode, readDeletionConfirmationCode } from "@/lib/social/meta-deletion-code"
import { APP_URL } from "@/lib/domains"
import { COMPANY_LEGAL_NAME, COMPANY_PRIVACY_EMAIL } from "@/lib/constants"

/**
 * Data Deletion Request callback of the Instagram-Login app ("Business login settings" → "Data
 * deletion request URL").
 *
 * POST — Meta forwards an Instagram user's deletion request as a signed request and expects
 * `{ url, confirmation_code }` back: a page where the person can check the request, and a code to
 * quote. What happens, exactly as the published data-deletion page describes it:
 *   - at once: every Instagram-Login channel of that account is switched off, its token wiped and
 *     its handle removed (lib/social/instagram-revoke);
 *   - within 30 days: the remaining data tied to the account (conversations in the business's CRM)
 *     is deleted from active systems after review — so the request is mailed to the privacy
 *     address, which is what puts a person on it.
 *
 * GET ?code= — that status page. The code is self-verifying (lib/social/meta-deletion-code), so a
 * made-up code is answered as unknown rather than as "received".
 */
const DAY_MS = 24 * 60 * 60 * 1000

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const signed = form?.get("signed_request")
  const payload = parseMetaSignedRequest(typeof signed === "string" ? signed : null, process.env.INSTAGRAM_APP_SECRET)
  const userId = signedRequestUserId(payload)
  if (!payload || !userId) {
    return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 })
  }

  const issuedAt = Date.now()
  const code = makeDeletionConfirmationCode(issuedAt)
  const revoked = await revokeInstagramLoginAccount(userId, "data_deletion", code)
  console.log(`[ig-data-deletion] Instagram user ${userId}: ${revoked.length} channel(s) revoked, code ${code}`)

  try {
    const { sendEmail } = await import("@/lib/email")
    const rows = revoked.map((r) => `<li>channel ${escapeHtml(r.id)} in workspace ${escapeHtml(r.organizationId)}</li>`).join("")
    await sendEmail({
      to: COMPANY_PRIVACY_EMAIL,
      subject: `Meta data deletion request ${code}`,
      html: `<p>Meta forwarded a data deletion request from Instagram user ${escapeHtml(userId)} on ${new Date(issuedAt).toISOString()}.</p>`
        + (rows
          ? `<p>Done automatically: these Instagram-Login channels were switched off and their tokens deleted:</p><ul>${rows}</ul>`
          : `<p>No LeadDrive channel was connected to this account.</p>`)
        + `<p>Still to do by ${new Date(issuedAt + 30 * DAY_MS).toISOString().slice(0, 10)} (published policy): review and delete the remaining data tied to this account. Confirmation code: ${escapeHtml(code)}.</p>`,
      transactional: true,
    })
  } catch (e) {
    console.error("[ig-data-deletion] privacy mailbox notification failed", e)
  }

  return NextResponse.json({
    url: `${APP_URL}/api/v1/webhooks/instagram/data-deletion?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  })
}

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("code") || ""
  const issuedAt = readDeletionConfirmationCode(code)
  const policy = `${APP_URL}/legal/data-deletion?lang=en`
  const body = issuedAt !== null
    ? `<h1>Data deletion request ${escapeHtml(code)}</h1>`
      + `<p><strong>Received:</strong> ${escapeHtml(new Date(issuedAt).toUTCString())}</p>`
      + `<p><strong>Done at once:</strong> LeadDrive's access to your Instagram account was revoked. Any LeadDrive connection of the account was switched off and its access token deleted.</p>`
      + `<p><strong>In progress:</strong> the remaining data linked to your account is deleted from our active systems by ${escapeHtml(new Date(issuedAt + 30 * DAY_MS).toUTCString())}. Backup copies expire as described in our <a href="${policy}">data deletion instructions</a>.</p>`
      + `<p>Questions: ${escapeHtml(COMPANY_PRIVACY_EMAIL)} (quote the code above).</p>`
    : `<h1>Unknown request</h1><p>This confirmation code was not issued by LeadDrive. Our data deletion instructions are at <a href="${policy}">${policy}</a>; questions: ${escapeHtml(COMPANY_PRIVACY_EMAIL)}.</p>`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data deletion request - LeadDrive CRM</title>`
    + `<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#001E3C;line-height:1.5}h1{font-size:1.4rem}</style></head>`
    + `<body>${body}<p style="color:#667;font-size:.85rem">LeadDrive CRM - operated by ${escapeHtml(COMPANY_LEGAL_NAME)}</p></body></html>`
  return new NextResponse(html, { status: issuedAt !== null ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" } })
}
