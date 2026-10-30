/** GET — the employees linked to the organization's Telegram bot, for the admin's list. */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { listLinks } from "@/lib/telegram-staff/linking"

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  return NextResponse.json({ success: true, data: await listLinks(orgId) })
})
