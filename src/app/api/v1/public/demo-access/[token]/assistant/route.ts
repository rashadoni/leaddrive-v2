import { NextRequest, NextResponse } from "next/server"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { calculateAiCost } from "@/lib/ai/budget"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { buildAssistantGrounding } from "@/lib/demo-center/assistant/context"
import {
  DEMO_ASSISTANT_MAX_QUESTIONS,
  DEMO_ASSISTANT_MAX_TOKENS,
  DEMO_ASSISTANT_MODEL,
  DEMO_ASSISTANT_REFUSAL_TEXT,
  buildAssistantSystemPrompt,
  checkAssistantAllowance,
  checkAssistantQuestion,
  type DemoAssistantRefusal,
} from "@/lib/demo-center/assistant/policy"
import {
  DEMO_JOURNEY_HAPPY_PATH,
  DEMO_JOURNEY_STATES,
  PROSPECT_TO_CLOSED_WON,
  findSection,
  findStep,
  rebuildRecordsAtState,
  type DemoJourneyState,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"
import { demoSessionCookieName, maskEmail, maskPhone, secureHashMatches } from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The guided demo's assistant.
 *
 * Answers questions about the screen the prospect is on and the story they
 * are walking. It has no tools, no tenant access and no commercial mandate —
 * see `assistant/policy.ts` for why price, integrations and SLA questions are
 * refused rather than answered.
 *
 * Two things the browser is NOT trusted with:
 *
 *   - **The records.** The client says which state it reached; the server
 *     rebuilds the synthetic records from the DemoRequest's own identity, so
 *     no string from the request body ever reaches the model's context.
 *   - **The quota.** The 50-question cap guards a paid model call, so it is
 *     counted from append-only DemoAccessEvent rows rather than a
 *     process-local limiter that a restart or a second instance would reset.
 */

const SCENARIO = PROSPECT_TO_CLOSED_WON
const ASKED = "ASSISTANT_ASKED"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return refuse("not_enabled", 404)

  const body = await request.json().catch(() => ({})) as {
    question?: unknown
    state?: unknown
    sectionId?: unknown
    stepId?: unknown
  }

  const asked = checkAssistantQuestion(body.question)
  if (!asked.ok) return refuse(asked.refusal!, 400)

  // The claimed position must exist in the scenario; anything else is treated
  // as the start rather than trusted or echoed back.
  const state: DemoJourneyState = (DEMO_JOURNEY_STATES as readonly string[]).includes(String(body.state))
    ? (body.state as DemoJourneyState)
    : "STARTED"
  const sectionId = findSection(SCENARIO, String(body.sectionId))?.id ?? SCENARIO.sections[0].id
  const stepId = findStep(SCENARIO, String(body.stepId))?.step.id ?? SCENARIO.sections[0].steps[0].id

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({
      where: { tokenHash: hashOneTimeToken(token) },
      include: { request: { select: { name: true, company: true, jobTitle: true, email: true, phone: true, source: true } } },
    })
    if (!grant) return refuse("not_enabled", 404)

    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) return refuse("not_enabled", 410)
    if (grant.status !== "ACTIVE") return refuse("not_enabled", 401)
    if (!secureHashMatches(request.cookies.get(demoSessionCookieName(token))?.value, grant.sessionHash)) {
      return refuse("not_enabled", 401)
    }
    if (!SCENARIO.capabilities.assistant) return refuse("not_enabled", 403)

    const [count, previous] = await Promise.all([
      prisma.demoAccessEvent.count({ where: { grantId: grant.id, eventType: ASKED } }),
      prisma.demoAccessEvent.findFirst({
        where: { grantId: grant.id, eventType: ASKED },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
    ])
    const allowance = checkAssistantAllowance({ asked: count, lastAskedAt: previous?.occurredAt ?? null }, now)
    if (!allowance.ok) {
      return NextResponse.json(
        { success: false, error: DEMO_ASSISTANT_REFUSAL_TEXT[allowance.refusal!], remaining: allowance.remaining },
        { status: 429, headers: noStoreHeaders() },
      )
    }

    const identity: DemoProspectIdentity = {
      name: grant.request.name,
      company: grant.request.company,
      jobTitle: grant.request.jobTitle,
      emailMasked: maskEmail(grant.request.email),
      phoneMasked: grant.request.phone ? maskPhone(grant.request.phone) : null,
      sourceChannel: "website",
    }
    const records = rebuildRecordsAtState(identity, state, now, DEMO_JOURNEY_HAPPY_PATH)
    const grounding = buildAssistantGrounding(
      {
        ...emptySnapshotShell(identity, state, sectionId, stepId, now),
        records,
      },
      SCENARIO,
    )

    const started = Date.now()
    let answer: string
    let promptTokens = 0
    let completionTokens = 0
    try {
      const response = await getAnthropicClient().messages.create({
        model: DEMO_ASSISTANT_MODEL,
        max_tokens: DEMO_ASSISTANT_MAX_TOKENS,
        system: buildAssistantSystemPrompt(grounding),
        messages: [{ role: "user", content: asked.question! }],
      })
      answer = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim()
      promptTokens = response.usage.input_tokens
      completionTokens = response.usage.output_tokens
    } catch {
      return refuse("unavailable", 502)
    }
    if (!answer) return refuse("unavailable", 502)

    // The question and the answer are the prospect's own words about their own
    // synthetic session; the spend is recorded next to them so the admin
    // timeline shows what the demo actually cost.
    await prisma.demoAccessEvent.create({
      data: {
        grantId: grant.id,
        eventType: ASKED,
        stepId,
        metadata: {
          sectionId,
          state,
          model: DEMO_ASSISTANT_MODEL,
          promptTokens,
          completionTokens,
          costUsd: calculateAiCost(DEMO_ASSISTANT_MODEL, promptTokens, completionTokens),
          latencyMs: Date.now() - started,
        },
      },
    })

    return NextResponse.json(
      { success: true, answer, remaining: Math.max(0, DEMO_ASSISTANT_MAX_QUESTIONS - (count + 1)) },
      { headers: noStoreHeaders() },
    )
  })
}

/**
 * The grounding builder reads a whole snapshot; only these fields matter to
 * it, and every one of them is server-decided.
 */
function emptySnapshotShell(
  identity: DemoProspectIdentity,
  state: DemoJourneyState,
  sectionId: string,
  stepId: string,
  now: Date,
) {
  const at = now.toISOString()
  return {
    version: 1 as const,
    scenarioId: SCENARIO.scenarioId,
    scenarioVersion: SCENARIO.version,
    identity,
    state,
    sectionId,
    stepId,
    completedSteps: [] as string[],
    skippedSteps: [] as string[],
    visitedSections: [sectionId],
    ui: {},
    startedAt: at,
    updatedAt: at,
    completedAt: null,
  }
}

function refuse(refusal: DemoAssistantRefusal, status: number) {
  return NextResponse.json(
    { success: false, error: DEMO_ASSISTANT_REFUSAL_TEXT[refusal] },
    { status, headers: noStoreHeaders() },
  )
}
