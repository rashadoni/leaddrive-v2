import { NextRequest, NextResponse } from "next/server"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { calculateAiCost } from "@/lib/ai/budget"
import { noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { loadActiveDemoGrant } from "@/lib/demo-center/active-grant"
import { demoAnswerHash } from "@/lib/demo-center/assistant-voice"
import { demoAssistantVoiceEnabled } from "@/lib/demo-center/assistant-voice-switch"
import { buildAssistantGrounding } from "@/lib/demo-center/assistant/context"
import { routeDemoQuestion } from "@/lib/demo-center/demo-question-router"
import { demoVoiceUrl } from "@/lib/demo-center/guide-voice"
import { DEMO_NAVIGATION_INTENTS, isNavigationIntent, preparedAnswer, stepNarration } from "@/lib/demo-center/assistant/prepared-answers"
import type { DemoAssistantAction } from "@/lib/demo-center/assistant/actions"
import { PiiMasker } from "@/lib/ai/pii-masker"
import {
  DEMO_ASSISTANT_MAX_PREPARED,
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
  demoSourceChannelOf,
  findSection,
  findStep,
  getDemoJourneyModule,
  moduleFirstSectionId,
  moduleOfSection,
  rebuildRecordsAtState,
  type DemoJourneyManifest,
  type DemoJourneyState,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"
import { maskEmail, maskPhone } from "@/lib/demo-center/security"
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
 *
 * Owner, 2026-10-18: the guide should «redirect at once, open things for
 * him». An explicit request to go somewhere («sövdələşmələri göstərin»,
 * «покажите сделки») comes back with an `action` from the closed list in
 * assistant/actions.ts; the browser plans it again against its own position
 * and opens the module the way the sidebar does. «Where do I click» brings
 * the step's card back. Da Vinci's own answers carry no action.
 *
 * Owner, 2026-10-20: Da Vinci's answers are spoken too. While the voice is on
 * (`DEMO_ASSISTANT_VOICE`), such an answer comes with its id and a keyed hash
 * of exactly its text, and `./voice` speaks only a text that hash vouches
 * for — never one the browser made up. Prepared answers keep their
 * recordings.
 */

const ASKED = "ASSISTANT_ASKED"
/** An answer from prepared-answers.ts; free of the Da Vinci allowance. */
const PREPARED = "ASSISTANT_PREPARED"

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

  const state: DemoJourneyState = (DEMO_JOURNEY_STATES as readonly string[]).includes(String(body.state))
    ? (body.state as DemoJourneyState)
    : "STARTED"

  return runWithRlsBypass(async () => {
    const now = new Date()
    // An active grant in THIS browser's session, and its own story
    // (active-grant.ts — the voice routes check exactly the same way).
    const active = await loadActiveDemoGrant(request, token, now)
    if (!active.ok) return refuse("not_enabled", active.status)
    const { grant, manifest } = active

    // The claimed position must exist in the story; anything else is treated
    // as the start rather than trusted or echoed back.
    const sectionId = findSection(manifest, String(body.sectionId))?.id ?? manifest.sections[0].id
    const stepId = findStep(manifest, String(body.stepId))?.step.id ?? manifest.sections[0].steps[0].id

    const [count, preparedCount, previous] = await Promise.all([
      prisma.demoAccessEvent.count({ where: { grantId: grant.id, eventType: ASKED } }),
      prisma.demoAccessEvent.count({ where: { grantId: grant.id, eventType: PREPARED } }),
      // The pace applies to every question, whoever answers it.
      prisma.demoAccessEvent.findFirst({
        where: { grantId: grant.id, eventType: { in: [ASKED, PREPARED] } },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      }),
    ])
    const allowance = checkAssistantAllowance({ asked: count, lastAskedAt: previous?.occurredAt ?? null }, now)
    const refusal = (refused: DemoAssistantRefusal) =>
      NextResponse.json(
        { success: false, error: DEMO_ASSISTANT_REFUSAL_TEXT[refused], remaining: allowance.remaining },
        { status: 429, headers: noStoreHeaders() },
      )
    if (allowance.refusal === "too_fast") return refusal("too_fast")

    // A prepared answer first (assistant/prepared-answers.ts, demo-question-router.ts): approved
    // text, picked by a decision model in a fraction of a second for a
    // fraction of a cent. It does not spend the Da Vinci allowance, so it is
    // offered even after that runs out; it has its own cap because the model's
    // rate limit is shared with the social relevance judge.
    if (preparedCount < DEMO_ASSISTANT_MAX_PREPARED) {
      const located = findStep(manifest, stepId)
      const route = await routeDemoQuestion(asked.question!, {
        sectionTitle: findSection(manifest, sectionId)?.title ?? null,
        stepTitle: located?.step.title ?? null,
      })
      const reply = route ? guideReply(route.intent, manifest, sectionId, located?.step ?? null) : null
      if (route && reply) {
        const { answer, audio, action } = reply
        await prisma.demoAccessEvent.create({
          data: {
            grantId: grant.id,
            eventType: PREPARED,
            stepId,
            metadata: {
              sectionId,
              state,
              intent: route.intent,
              ...(action ? { action: action.kind, ...(action.kind === "open_module" ? { moduleId: action.moduleId } : {}) } : {}),
              confidence: route.confidence,
              model: "jev",
              inputTokens: route.inputTokens,
              costUsd: route.costUsd,
              latencyMs: route.latencyMs,
            },
          },
        })
        return NextResponse.json(
          // Every prepared answer and every step has a recording
          // (guide-voice.ts; the test fails while one is missing), so the guide
          // can say it aloud. A module's own introduction is read by its first
          // step once the module has opened, so a jump carries no audio here.
          {
            success: true,
            answer,
            remaining: allowance.remaining,
            source: isNavigationIntent(route.intent) ? "navigation" : "prepared",
            intent: route.intent,
            ...(audio ? { audio } : {}),
            ...(action ? { action } : {}),
          },
          { headers: noStoreHeaders() },
        )
      }
    }

    if (!allowance.ok) return refusal(allowance.refusal!)

    const identity: DemoProspectIdentity = {
      name: grant.request.name,
      company: grant.request.company,
      jobTitle: grant.request.jobTitle,
      emailMasked: maskEmail(grant.request.email),
      phoneMasked: grant.request.phone ? maskPhone(grant.request.phone) : null,
      sourceChannel: demoSourceChannelOf(grant.request.source),
    }
    const records = rebuildRecordsAtState(identity, state, now, DEMO_JOURNEY_HAPPY_PATH)
    const grounding = buildAssistantGrounding(
      {
        ...emptySnapshotShell(manifest, identity, state, sectionId, stepId, now),
        records,
      },
      manifest,
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
        // A prospect may type a phone number or an address into a question.
        messages: [{ role: "user", content: new PiiMasker().mask(asked.question!) }],
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

    // Neither the question nor the answer is stored — only where it was
    // asked and what it cost, so the admin timeline shows what the demo
    // actually cost.
    const recorded = await prisma.demoAccessEvent.create({
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

    // The answer's id is its event's; the hash covers the grant, that id and
    // the exact text, so the voice route speaks this answer once and nothing
    // else. Without the switch there is nothing to speak it with.
    const answerId = recorded?.id
    const voiced = demoAssistantVoiceEnabled() && answerId
      ? { answerId, answerHash: demoAnswerHash(grant.id, answerId, answer) }
      : {}
    return NextResponse.json(
      { success: true, answer, remaining: Math.max(0, DEMO_ASSISTANT_MAX_QUESTIONS - (count + 1)), source: "davinci", ...voiced },
      { headers: noStoreHeaders() },
    )
  })
}

/**
 * The grounding builder reads a whole snapshot; only these fields matter to
 * it, and every one of them is server-decided.
 */
function emptySnapshotShell(
  manifest: DemoJourneyManifest,
  identity: DemoProspectIdentity,
  state: DemoJourneyState,
  sectionId: string,
  stepId: string,
  now: Date,
) {
  const at = now.toISOString()
  return {
    version: 1 as const,
    scenarioId: manifest.scenarioId,
    scenarioVersion: manifest.version,
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

/**
 * What the guide says and does for a routed question. A request to open the
 * module the prospect is already in opens nothing and reads the current step
 * again; a request for a module this story does not have gets no route at all,
 * and Da Vinci answers it as any other question.
 */
function guideReply(
  intent: Parameters<typeof preparedAnswer>[0] | keyof typeof DEMO_NAVIGATION_INTENTS,
  manifest: DemoJourneyManifest,
  sectionId: string,
  step: Parameters<typeof stepNarration>[0] | null,
): { answer: string; audio: string | null; action: DemoAssistantAction | null } | null {
  if (isNavigationIntent(intent)) {
    const moduleId = DEMO_NAVIGATION_INTENTS[intent].moduleId
    const module = getDemoJourneyModule(moduleId)
    if (!module || !moduleFirstSectionId(manifest, moduleId)) return null
    if (moduleOfSection(sectionId)?.id === moduleId) {
      if (!step) return null
      const answer = stepNarration(step)
      return { answer, audio: demoVoiceUrl(answer), action: { kind: "point_step" } }
    }
    return { answer: `${module.title}. ${module.pitch}`, audio: null, action: { kind: "open_module", moduleId } }
  }
  const answer = preparedAnswer(intent, { step })
  if (!answer) return null
  return { answer, audio: demoVoiceUrl(answer), action: intent === "screen_help" ? { kind: "point_step" } : null }
}

function refuse(refusal: DemoAssistantRefusal, status: number) {
  return NextResponse.json(
    { success: false, error: DEMO_ASSISTANT_REFUSAL_TEXT[refusal] },
    { status, headers: noStoreHeaders() },
  )
}
