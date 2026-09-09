import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"
import { MAX_TOOL_CALLS } from "@/lib/ai/voice/config"
import { VOICE_TOOL_NAMES, type VoiceToolName } from "@/lib/ai/voice/read-tools"
import { executeVoiceReadTool } from "@/lib/ai/voice/execute-read-tool"

/**
 * The single door between the voice agent and CRM data.
 *
 * The request arrives from the USER'S OWN TAB (same-origin fetch, session
 * cookie), not from the voice provider. That is the whole security design: the agent
 * decides *what* to ask for, the browser decides *who is asking*, and the two
 * cannot be swapped. A stolen conversation token therefore buys a chatbot, not
 * data — its tool calls would run in the thief's browser under the thief's
 * session and get a 401 here.
 *
 * Consequently nothing in the request body is trusted to identify anyone: the
 * body carries a tool name and a filter, and both orgId and userId are
 * re-derived from the session on every call.
 *
 * Read-only by design. None of the write tools are reachable: an LLM whose
 * arguments can be steered by CRM content it just read aloud (an inbound
 * WhatsApp message, a lead name from a web form) must not be one keystroke
 * away from send_email.
 */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { voiceSessionId, tool, filter } = (body ?? {}) as {
    voiceSessionId?: unknown
    tool?: unknown
    filter?: unknown
  }

  if (typeof voiceSessionId !== "string" || !voiceSessionId) {
    return NextResponse.json({ error: "voiceSessionId required" }, { status: 400 })
  }
  if (typeof tool !== "string" || !VOICE_TOOL_NAMES.includes(tool as VoiceToolName)) {
    return NextResponse.json({ error: "Unknown voice tool" }, { status: 400 })
  }
  const toolName = tool as VoiceToolName

  // Count the call against the session's ceiling BEFORE doing any work, with the
  // ceiling in the UPDATE's WHERE. An agent that loops is the cheapest way to
  // burn minutes and LLM tokens, and it looks exactly like normal traffic.
  const claimed = await prisma.voiceSession.updateMany({
    where: voiceScopedWhere(auth.orgId, {
      id: voiceSessionId,
      userId: auth.userId,
      status: "active",
      toolCallCount: { lt: MAX_TOOL_CALLS },
    }),
    data: { toolCallCount: { increment: 1 }, lastHeartbeatAt: new Date() },
  })
  if (claimed.count !== 1) {
    return NextResponse.json(
      { error: "Session is not active or has reached its tool-call limit" },
      { status: 409 },
    )
  }

  const out = await executeVoiceReadTool({
    toolName,
    filter,
    auth: { orgId: auth.orgId, userId: auth.userId, role: auth.role },
    logTurn: (entry) => {
      void prisma.voiceSessionTurn
        .create({
          data: {
            organizationId: auth.orgId,
            voiceSessionId,
            role: "tool",
            text: JSON.stringify(entry).slice(0, 300),
            toolName,
          },
        })
        .catch(() => {
          // A failed log must never cost the user their answer.
        })
    },
  })
  return NextResponse.json(out.body, out.status ? { status: out.status } : undefined)
})
