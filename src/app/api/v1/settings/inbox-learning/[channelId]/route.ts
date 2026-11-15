import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/constants"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { channelLearningDetail } from "@/lib/inbox/learning/service"

type Ctx = { params: Promise<{ channelId: string }> }

/** One channel's training: readiness, where the AI would have answered differently, character, knowledge. */
export const GET = withRlsSessionAuth<Ctx>(async (_req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId } = await params
  const detail = await channelLearningDetail(auth.orgId, channelId)
  if (!detail) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  return NextResponse.json({ data: detail })
})
