/**
 * Profile → «Telegram»: link the signed-in employee's Telegram to the
 * organization's bot. POST issues a one-time t.me link (15 minutes), DELETE
 * unlinks. Every employee manages only their own link, from a browser
 * session: an API key is the organization's credential, not a person.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { issueLinkToken, linkView, unlinkTelegram } from "@/lib/telegram-staff/linking"

export const GET = withRlsAuth(undefined, undefined, async (_req, { orgId, userId, principalType }) => {
  if (!userId || principalType !== "session") return NextResponse.json({ error: "User session required" }, { status: 403 })
  return NextResponse.json({ success: true, data: await linkView(orgId, userId) })
})

export const POST = withRlsAuth(undefined, undefined, async (_req, { orgId, userId, role, principalType }) => {
  if (!userId || principalType !== "session" || role === "reviewer") return NextResponse.json({ error: "Not available", code: "NOT_ALLOWED" }, { status: 403 })
  const link = await issueLinkToken(orgId, userId)
  if (!link) return NextResponse.json({ error: "No bot connected", code: "NO_BOT" }, { status: 409 })
  return NextResponse.json({ success: true, data: { url: link.url, expiresAt: link.expiresAt.toISOString() } })
})

export const DELETE = withRlsAuth(undefined, undefined, async (_req, { orgId, userId, principalType }) => {
  if (!userId || principalType !== "session") return NextResponse.json({ error: "User session required" }, { status: 403 })
  await unlinkTelegram(orgId, userId)
  return NextResponse.json({ success: true, data: await linkView(orgId, userId) })
})
