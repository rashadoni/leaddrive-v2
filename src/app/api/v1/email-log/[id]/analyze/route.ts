/**
 * POST /api/v1/email-log/[id]/analyze
 *
 * Run Email Insights on a persisted `EmailLog` row — produces sentiment,
 * intent, urgency, deterministic signals, and a 1-sentence summary
 * suitable for inbox preview. Persists the resulting `EmailInsight`
 * onto `EmailLog.insights` (+ `insightsAt`).
 *
 * Slice 1 ships a PLACEHOLDER_LLM that returns a sentinel payload — the
 * deterministic signal sweep + urgency-reconciliation still produce
 * useful output even with the placeholder, so the route is wire-able
 * before the real LLM lands. Slice 2 swaps the placeholder for an
 * Anthropic-SDK-backed client behind the same DI interface — no caller
 * changes required.
 *
 * Body (all fields optional):
 *   { subject?, body?, context?, toneHints? }
 * Caller-supplied subject/body override the EmailLog row — useful for
 * re-analysing with refined context without first persisting.
 *
 * Part of H6 Einstein Email Insights (Phase 3 slice 1).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { analyzeEmail } from "@/lib/email-insights/analyzer"
import type { EmailAnalyzerLLMClient } from "@/lib/email-insights/types"

const bodySchema = z.object({
  subject: z.string().max(2000).optional(),
  body: z.string().max(200_000).optional(),
  context: z.string().max(2000).optional(),
  toneHints: z.array(z.string().max(200)).max(20).optional(),
})

/**
 * Slice 1 placeholder LLM. Returns a neutral sentinel — slice 2 swaps
 * with a real Anthropic-SDK client behind the same interface.
 */
const PLACEHOLDER_LLM: EmailAnalyzerLLMClient = {
  async analyzeEmail() {
    return {
      sentiment: "neutral",
      sentimentScore: 0.5,
      intent: "other",
      urgency: "normal",
      summary: "[H6 slice 1: LLM analysis not yet wired — slice 2 connects Anthropic SDK]",
      topics: [],
      suggestedActions: [],
    }
  },
}

export const POST = withRlsAuth("ai", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // Distinguish "no body" from "malformed JSON" without relying on
  // Content-Length (chunked-encoded clients skip the header entirely).
  // Read the raw text, treat empty-or-whitespace as "no body" (200 with
  // placeholder analysis — all fields are optional), parse JSON
  // otherwise; parse failure is a 400 so a caller doesn't silently fall
  // through to placeholder analysis when slice 2's real LLM cost lands.
  let body: unknown = {}
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
    }
  }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const email = await prisma.emailLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, subject: true, body: true },
  })
  if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const subject = parsed.data.subject ?? email.subject ?? ""
  const body_ = parsed.data.body ?? email.body ?? ""
  if (!subject && !body_) {
    return NextResponse.json(
      { error: "No subject or body available — supply either in body or wait for ingest hook" },
      { status: 400 }
    )
  }

  const insight = await analyzeEmail({
    llm: PLACEHOLDER_LLM,
    subject,
    body: body_,
    context: parsed.data.context,
    toneHints: parsed.data.toneHints,
  })

  await prisma.emailLog.update({
    where: { id },
    data: {
      insights: insight as unknown as Prisma.InputJsonValue,
      insightsAt: new Date(),
      // Persist caller-supplied subject/body when the row had none —
      // keeps replay deterministic when the analyzer is re-invoked.
      // "None" here means null OR empty string (treated equivalently
      // for backfill); never overwrites a row that already has content.
      ...(parsed.data.subject && !email.subject ? { subject: parsed.data.subject } : {}),
      ...(parsed.data.body && !email.body ? { body: parsed.data.body } : {}),
    },
  })

  return NextResponse.json({ success: true, insight })
})
