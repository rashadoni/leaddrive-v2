import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/constants"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { listLearningChannels } from "@/lib/inbox/learning/service"

/**
 * «Обучение ИИ» (owner 2026-11-15): the channels training can run on, each with its mode, readiness
 * and how many learned rows wait for a person. Admins only — the same people who choose who answers
 * on a channel (api/v1/settings/channel-reply).
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  return NextResponse.json({ data: { channels: await listLearningChannels(auth.orgId) } })
})
