/**
 * POST /api/v1/calls/[id]/analyze
 *
 * Run Conversation Intelligence on the call's transcript (or one supplied
 * in the request body — slice 2's Whisper pipeline supplies it). Persists
 * the resulting `ConversationInsight` into `CallLog.insights`.
 *
 * Slice 1 expects the caller to inject an LLM client at the application
 * level — this endpoint is the wiring point, not the model invoker.
 *
 * Body (all fields optional):
 *   { transcript?, expectedValueProps?, competitors?, context? }
 *
 * Part of A7 Conversation Intelligence (Phase 3 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { canReadCall } from "@/lib/calls/access"
import { analyzeTranscript } from "@/lib/conversation-intel/analyzer"
import { recordCallCommitment } from "@/lib/commitments/record-call-commitment"
import type { AnalyzerLLMClient } from "@/lib/conversation-intel/types"

const bodySchema = z.object({
  transcript: z.string().min(1).max(200_000).optional(),
  expectedValueProps: z.array(z.string()).max(20).optional(),
  competitors: z.array(z.string()).max(50).optional(),
  context: z.string().max(2000).optional(),
})

/**
 * Slice 1 placeholder LLM client. Returns a sentinel insight indicating
 * the actual LLM call hasn't been wired. Slice 2 swaps this with a real
 * Anthropic-SDK-backed client behind the same `AnalyzerLLMClient`
 * interface — no caller changes.
 */
const PLACEHOLDER_LLM: AnalyzerLLMClient = {
  async analyzeTranscript() {
    return {
      sentiment: "neutral",
      sentimentScore: 0.5,
      summary: "[A7 slice 1: LLM analysis not yet wired — slice 2 connects Anthropic SDK]",
      topics: [],
      actionItems: [],
    }
  },
}

export const POST = withRlsAuth("ai", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      transcription: true,
      duration: true,
      conversationId: true,
      ticketId: true,
      dealId: true,
      leadId: true,
      companyId: true,
      contactId: true,
      callMode: true,
      userId: true,
    },
  })
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canReadCall(auth.role, call, auth.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (call.callMode === "ai") {
    return NextResponse.json(
      { error: "AI-call analysis is written only by the correlated voice-agent callback" },
      { status: 409 },
    )
  }

  const transcript = parsed.data.transcript ?? call.transcription ?? ""
  if (!transcript) {
    return NextResponse.json(
      { error: "No transcript available — supply `transcript` in body or wait for Whisper pipeline" },
      { status: 400 }
    )
  }

  const insight = await analyzeTranscript({
    llm: PLACEHOLDER_LLM,
    transcript,
    competitors: parsed.data.competitors,
    expectedValueProps: parsed.data.expectedValueProps,
    durationSeconds: call.duration ?? undefined,
    context: parsed.data.context,
  })

  await prisma.callLog.update({
    where: { id },
    data: {
      insights: insight as unknown as Prisma.InputJsonValue,
      insightsAt: new Date(),
      // If transcript was supplied via body and CallLog hadn't stored one,
      // persist it for replay.
      ...(parsed.data.transcript && !call.transcription
        ? { transcription: parsed.data.transcript }
        : {}),
    },
  })

  // A promise made on the call becomes something that can be missed. Before
  // this, the extracted commitment was displayed on the lead card under a
  // heading that said "Tasks" while the same card reported zero tasks — the
  // product showing an obligation it had filed nowhere.
  const lead = call.leadId
    ? await prisma.lead.findFirst({
        where: { id: call.leadId, organizationId: auth.orgId },
        select: { assignedTo: true },
      })
    : null
  const commitment = await recordCallCommitment({
    organizationId: auth.orgId,
    callId: id,
    leadId: call.leadId ?? null,
    insight,
    callAt: new Date(),
    assigneeId: lead?.assignedTo ?? call.userId ?? null,
  })

  return NextResponse.json({ success: true, insight, commitment })
})
