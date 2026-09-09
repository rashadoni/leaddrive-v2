import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { verifySvixSignature } from "@/lib/svix-verify"

// POST /api/v1/public/resend-webhook
//   Receives Resend delivery events (delivered, bounced, complained, opened,
//   clicked, etc.) and updates the matching email_logs row by messageId.
//
// Security:
//   - Resend signs each webhook with HMAC-SHA256. We verify the signature
//     header against RESEND_WEBHOOK_SECRET before trusting the payload.
//   - Without the secret env var, the endpoint returns 503 (not configured)
//     so a rogue caller can't spray fake "bounced" events before we're ready.
//
// Configure in Resend dashboard:
//   https://resend.com/webhooks → Add endpoint → URL:
//   https://app.leaddrivecrm.org/api/v1/public/resend-webhook
//   Events: email.delivered, email.bounced, email.complained, email.delivery_delayed
//   Signing secret → paste into .env as RESEND_WEBHOOK_SECRET.

type ResendEvent = {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    from?: string
    subject?: string
    bounce?: { type?: string; message?: string }
  }
}

export async function POST(req: NextRequest) {
  const expected = process.env.RESEND_WEBHOOK_SECRET
  if (!expected) {
    return NextResponse.json({ error: "Resend webhook not configured" }, { status: 503 })
  }

  // Basic IP rate-limit so a stray load-test can't overwhelm us.
  // clientIp(), not a bare cf-connecting-ip read. The origin is reachable
  // directly on its public address, so a caller that bypasses Cloudflare can
  // set cf-connecting-ip to anything and mint a fresh bucket per request.
  // clientIp() only honours that header when the connecting peer is inside a
  // published Cloudflare range.
  const ip = clientIp(req)
  if (!checkRateLimit(`resend-webhook:${ip}`, RATE_LIMIT_CONFIG.webhook)) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
  }

  const rawBody = await req.text()
  const ok = verifySvixSignature({
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    rawBody,
    secret: expected,
  })
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const type = event.type || ""
  const emailId = event.data?.email_id
  if (!emailId) {
    return NextResponse.json({ success: true, skipped: "no email_id" }, { status: 202 })
  }

  // Map Resend event type → status we store in email_logs.
  const status = (() => {
    if (type.endsWith(".delivered")) return "delivered"
    if (type.endsWith(".bounced")) return "bounced"
    if (type.endsWith(".complained")) return "complained"
    if (type.endsWith(".opened")) return "opened"
    if (type.endsWith(".clicked")) return "clicked"
    if (type.endsWith(".delivery_delayed")) return "delayed"
    return null
  })()

  if (!status) {
    return NextResponse.json({ success: true, skipped: `unknown type: ${type}` }, { status: 202 })
  }

  try {
    // RLS phase 1 — org resolution: the provider message id is a cross-tenant
    // external identifier, so the lookup runs bypass-scoped (resolution only).
    const log = await runWithRlsBypass(() =>
      prisma.emailLog.findFirst({
        where: { messageId: emailId },
        select: { id: true, organizationId: true, toEmail: true },
      })
    )
    if (!log) {
      return NextResponse.json({ success: true, skipped: "email_log not found" }, { status: 202 })
    }

    // RLS phase 2 — status update + auto-unsubscribe run tenant-scoped.
    return await runWithTenant(log.organizationId, async () => {
    const data: Record<string, unknown> = { status }
    if (status === "opened") data.openedAt = new Date()
    if (status === "clicked") data.clickedAt = new Date()
    if (status === "bounced" || status === "complained") {
      data.errorMessage = event.data?.bounce?.message || type
    }

    await prisma.emailLog.update({ where: { id: log.id }, data })

    // Auto-unsubscribe on hard bounce or complaint so we stop sending to this address.
    if (status === "bounced" || status === "complained") {
      const existing = await prisma.surveyUnsubscribe.findFirst({
        where: { organizationId: log.organizationId, email: log.toEmail, surveyId: null },
      })
      if (!existing) {
        await prisma.surveyUnsubscribe.create({
          data: {
            organizationId: log.organizationId,
            email: log.toEmail,
            surveyId: null,
            reason: status === "complained" ? "complaint_via_resend" : "hard_bounce_via_resend",
          },
        })
      }
    }

    return NextResponse.json({ success: true, status, logId: log.id })
    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e) {
    console.error("[resend-webhook] processing failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Resend sends a GET on the URL during setup to probe reachability.
export async function GET() {
  return NextResponse.json({ ok: true, service: "resend-webhook" })
}
