/**
 * GET  /api/v1/mtm/onboarding  — read agent's onboarding progress
 * PUT  /api/v1/mtm/onboarding  — mark a step complete
 *
 * M4-4: First-time onboarding wizard for field agents. Tracks 5 key actions
 * (see ONBOARDING_STEPS) so the mobile app and web dashboard can display a
 * progress indicator and contextual guidance.
 *
 * Auth: mobile JWT (getMobileAuth). agentId is required — the endpoint is
 * only meaningful for agent users. Supervisors/admins don't have an
 * onboarding record. Returns 401 for unauthenticated requests.
 *
 * Onboarding steps (canonical IDs):
 *   profile_complete       — agent saved name + avatar
 *   first_checkin          — agent completed first customer check-in
 *   first_photo            — agent took first visit photo
 *   first_task             — agent completed first field task
 *   tutorial_video_watched — agent watched the intro video (any of the 5)
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMobileAuth } from "@/lib/mobile-auth"
import { withRls } from "@/lib/with-rls"

/** All valid step IDs — order is the suggested progression.
 *  Local (not exported): route.ts may only export route handlers per Next's
 *  route-type constraint; nothing outside this file imports it. */
const ONBOARDING_STEPS = [
  "profile_complete",
  "first_checkin",
  "first_photo",
  "first_task",
  "tutorial_video_watched",
] as const

type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]

const TOTAL_STEPS = ONBOARDING_STEPS.length
const STEP_SET = new Set<string>(ONBOARDING_STEPS)

// ── Safe JSON parse ────────────────────────────────────────────────────────

/**
 * Parse the `completedSteps` TEXT column as a JSON string array.
 * Treats corrupted rows (manual DB edits, truncated writes) as empty rather
 * than propagating a 500 — the agent simply re-completes any lost steps on
 * next interaction.
 */
function safeParseSteps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Drop unknown ids (e.g. the retired "first_order" persisted before the
    // rename to "first_task") — a stale id would otherwise inflate pctDone
    // past 100% and make completedAt/pendingSteps contradict each other.
    return parsed.filter((s): s is string => typeof s === "string" && STEP_SET.has(s))
  } catch {
    console.warn("[mtm/onboarding] corrupted completedSteps, treating as empty:", raw)
    return []
  }
}

// ── Response shape helper ──────────────────────────────────────────────────

function buildProgress(completedSteps: string[], completedAt: Date | null) {
  const pctDone = Math.round((completedSteps.length / TOTAL_STEPS) * 100)
  const completedSet = new Set(completedSteps)
  return {
    completedSteps,
    pendingSteps: ONBOARDING_STEPS.filter(s => !completedSet.has(s)),
    totalSteps: TOTAL_STEPS,
    pctDone,
    completedAt: completedAt?.toISOString() ?? null,
  }
}

// ── GET ────────────────────────────────────────────────────────────────────

export const GET = withRls(async (req, { orgId }) => {
  const mobileAuth = getMobileAuth(req)
  const agentId = mobileAuth?.agentId
  if (!agentId) {
    // Supervisors/admins don't have agent onboarding records — return a
    // discriminating field so the mobile/web UI can hide the wizard cleanly
    // rather than rendering a confusing 0% progress indicator.
    return NextResponse.json({ applicable: false })
  }

  try {
    const row = await prisma.mtmOnboarding.findUnique({
      where: { agentId },
    })

    if (!row) {
      return NextResponse.json(buildProgress([], null))
    }

    const completedSteps = safeParseSteps(row.completedSteps)
    return NextResponse.json(buildProgress(completedSteps, row.completedAt))
  } catch (e) {
    console.error("[mtm/onboarding GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ── PUT ────────────────────────────────────────────────────────────────────

export const PUT = withRls(async (req, { orgId }) => {
  const mobileAuth = getMobileAuth(req)
  const agentId = mobileAuth?.agentId
  if (!agentId) {
    return NextResponse.json(
      { error: "Onboarding progress is only tracked for field agents" },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let { step } = body as { step?: string }
  // Legacy mobile clients (pre-slim builds) still report the retired
  // "first_order" step; accept it as the renamed "first_task" so an old
  // app version doesn't hit a 400 mid-onboarding.
  if (step === "first_order") step = "first_task"
  if (!step || !STEP_SET.has(step)) {
    return NextResponse.json(
      {
        error: `Invalid or missing 'step'. Valid values: ${ONBOARDING_STEPS.join(", ")}`,
      },
      { status: 400 },
    )
  }

  try {
    // Read current progress to merge (idempotent)
    const existing = await prisma.mtmOnboarding.findUnique({ where: { agentId } })
    const currentSteps: string[] = existing ? safeParseSteps(existing.completedSteps) : []

    // Deduplicate — idempotent re-completion
    const newSteps = currentSteps.includes(step)
      ? currentSteps
      : [...currentSteps, step]

    // Set completedAt when all steps done. Preserves prior completedAt — never
    // re-clears even if a future schema change adds more steps and old rows
    // have only the original 5 complete.
    const allDone = newSteps.length >= TOTAL_STEPS && ONBOARDING_STEPS.every(s => newSteps.includes(s))
    const completedAt = allDone ? (existing?.completedAt ?? new Date()) : (existing?.completedAt ?? null)

    const row = await prisma.mtmOnboarding.upsert({
      where: { agentId },
      create: {
        agentId,
        organizationId: orgId,
        completedSteps: JSON.stringify(newSteps),
        completedAt,
      },
      update: {
        completedSteps: JSON.stringify(newSteps),
        completedAt,
      },
    })

    const updated = JSON.parse(row.completedSteps) as string[]
    return NextResponse.json(buildProgress(updated, row.completedAt))
  } catch (e) {
    console.error("[mtm/onboarding PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
