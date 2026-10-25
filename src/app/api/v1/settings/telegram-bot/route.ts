/**
 * Settings → «Telegram-bot»: the organization's own bot for its employees
 * (src/lib/telegram-staff). GET shows whether one is connected — never the
 * token; PUT checks a BotFather token with Telegram and connects it; DELETE
 * turns it off.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { connectStaffBot, disconnectStaffBot, staffBotView } from "@/lib/telegram-staff/bot-config"

const bodySchema = z.object({ token: z.string().max(200) }).strict()

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  return NextResponse.json({ success: true, data: await staffBotView(orgId) })
})

export const PUT = withRlsAuth("settings", "write", async (req, { orgId, userId }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Token is required", code: "INVALID_TOKEN" }, { status: 400 })
  if (!isTenantPiiMasterKeyConfigured()) return NextResponse.json({ error: "Encryption key is not configured", code: "NO_ENCRYPTION_KEY" }, { status: 503 })
  const result = await connectStaffBot(orgId, userId ?? null, parsed.data.token)
  if (!result.ok) return NextResponse.json({ error: result.code, code: result.code }, { status: result.code === "UNREACHABLE" ? 502 : 400 })
  return NextResponse.json({ success: true, data: await staffBotView(orgId) })
})

export const DELETE = withRlsAuth("settings", "write", async (_req, { orgId }) => {
  await disconnectStaffBot(orgId)
  return NextResponse.json({ success: true, data: await staffBotView(orgId) })
})
