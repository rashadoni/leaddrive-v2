import { timingSafeEqual } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { returnHandoffToAi, startHandoffRinging } from "@/lib/voip/inbound-handoff"
import { voiceOrganizationFor } from "@/lib/voip/line-numbers"
import { withStationTiming } from "@/lib/station-timing"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 1_024
const bodySchema = z.object({ callId: z.string().uuid(), action: z.enum(["start", "return"]) }).strict()

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN?.trim() || ""
  const received = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * The station, after the AI leg of an inbound call has ended (`start`): did
 * the agent hand this call to a person? If so the call rings the browsers as
 * an ordinary inbound call. After the ring time with nobody ready (`return`),
 * the AI takes it back. Any failure answers false: the station then ends the
 * call as before, or keeps a browser it already bridged.
 */
async function handlePost(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const raw = await request.text()
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { body = null }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { callId, action } = parsed.data
  const answer = (moved: boolean) => NextResponse.json(action === "start" ? { handoff: moved } : { returned: moved })
  try {
    const organizationId = (await voiceOrganizationFor({ callId }))?.organizationId
    if (!organizationId) return answer(false)
    return await runWithTenant(organizationId, async () => {
      const call = await prisma.callLog.findFirst({
        where: { organizationId, provider: "asterisk", direction: "inbound", providerCallId: callId, callSid: callId, endedAt: null },
        select: { id: true },
      })
      if (!call) return answer(false)
      const ref = { organizationId, callLogId: call.id, providerCallId: callId }
      return answer(action === "start" ? await startHandoffRinging(prisma, ref) : await returnHandoffToAi(prisma, ref))
    })
  } catch {
    return answer(false)
  }
}

export const POST = withStationTiming("inbound-handoff", handlePost)
