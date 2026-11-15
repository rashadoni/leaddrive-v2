import { NextResponse } from "next/server"
import { z } from "zod"
import { isAdmin } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { generateChannelAiReply } from "@/lib/social/ai-autoreply"
import { LEARNING_CHANNEL_TYPES } from "@/lib/inbox/learning/service"

type Ctx = { params: Promise<{ channelId: string }> }

const schema = z.object({ question: z.string().trim().min(1).max(1000) }).strict()

/**
 * «Проверить, как ответит ИИ»: one question, answered the way a customer on this channel would be
 * answered now — the same reply code, character, learned knowledge and price rule — and sent nowhere.
 * One paid call per press, under the organization's AI budget like every other.
 */
export const POST = withRlsSessionAuth<Ctx>(async (req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId } = await params
  const body = await readJsonRequestWithinLimit(req, 4 * 1024)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelId, organizationId: auth.orgId, channelType: { in: [...LEARNING_CHANNEL_TYPES] } },
    select: { id: true, channelType: true },
  })
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  const question = parsed.data.question
  const ai = await generateChannelAiReply({
    orgId: auth.orgId,
    channel: channel.channelType,
    externalId: `learning-try:${auth.userId}`,
    userMessage: question,
    senderName: "",
    channelConfigId: channel.id,
    shadow: { history: [{ role: "user", content: question }], asOf: new Date() },
  })
  return NextResponse.json({ data: { reply: ai.reply, handedOff: ai.escalate, skipped: ai.skipped ?? null } })
})
