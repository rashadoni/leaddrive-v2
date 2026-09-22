"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import Image from "next/image"
import { Clock3 } from "lucide-react"
import { toast } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Progress } from "@/components/ui/progress"
import {
  activeSections,
  createJourneySnapshot,
  findSection,
  journeyProgress,
  journeyReportsBetween,
  parseSnapshot,
  reachableRoutes,
  reduceJourney,
  sectionJumpTarget,
  serializeSnapshot,
  type DemoJourneyAction,
  type DemoJourneyManifest,
  type DemoJourneyReduceResult,
  type DemoJourneySection,
  type DemoJourneySnapshot,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"
import {
  clockOffset,
  deadlineAnnouncement,
  formatRemaining,
  nearestDeadline,
  secondsUntil,
  type DemoDeadlineKind,
} from "@/lib/demo-center/session-clock"
import { cn } from "@/lib/utils"
import { DemoCoachMark } from "./demo-coach-mark"
import { DemoJourneyGuide } from "./demo-journey-guide"
import { createJourneyReporter, type JourneyReporter } from "./journey-reporter"
import { DemoJourneySidebar } from "./demo-journey-sidebar"
import { BoardScene } from "./scenes/board-scene"
import { CampaignScene } from "./scenes/campaign-scene"
import { DealScene } from "./scenes/deal-scene"
import { InboxScene } from "./scenes/inbox-scene"
import { LeadScene } from "./scenes/lead-scene"
import { OrientationScene } from "./scenes/orientation-scene"
import { QuoteScene } from "./scenes/quote-scene"
import { ScenePending } from "./scenes/scene-pending"
import { SummaryScene } from "./scenes/summary-scene"
import type { DemoJourneyVariant, DemoSceneProps } from "./scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import type { DemoLiveCallState } from "./demo-live-call"

/**
 * The guided journey renderer.
 *
 * Owns the snapshot, dispatches journey actions, and lays out the three
 * parts of the demo: LeadDrive's own (reduced) sidebar, the scene for the
 * current section, and the guide panel. The coach mark points at the real
 * control inside the scene.
 *
 * It never fetches: everything it shows comes from the snapshot. Session
 * lifecycle (start, OTP, expiry, revoke) stays with the access shell; this
 * component only counts the deadlines it is given and calls `onAccessLost`.
 */

const SCENES: Record<string, ComponentType<DemoSceneProps>> = {
  orientation: OrientationScene,
  source: CampaignScene,
  conversation: InboxScene,
  "ai-reply": InboxScene,
  "lead-created": LeadScene,
  "lead-qualified": LeadScene,
  "ai-call": LeadScene,
  task: BoardScene,
  deal: DealScene,
  quote: QuoteScene,
  "closed-won": DealScene,
  summary: SummaryScene,
}

/**
 * How this player was opened. Three paths behave differently in ways that
 * used to be spelled as loose booleans, which is how they drift:
 *
 *   granted — a prospect's issued, OTP-verified session. Progress persists,
 *             clips stream through the demo's own gated route, the assistant
 *             answers.
 *   preview — the authenticated superadmin looking at what will be sent.
 *             Nothing is stored and nothing is spent; clips play through the
 *             pipeline's normal route because the viewer is signed in.
 *   open    — the public demo anyone can start from /demo, with no email and
 *             no approval. Progress persists in this browser, but nothing
 *             that costs money or serves internal media is switched on.
 */
export type { DemoJourneyVariant }

export interface DemoJourneyPlayerProps {
  /** Capability token; meaningful only for the granted variant. */
  token: string
  variant?: DemoJourneyVariant
  manifest: DemoJourneyManifest
  identity: DemoProspectIdentity
  company: string
  watermark: string
  serverNow?: string
  sessionExpiresAt?: string
  idleExpiresAt?: string
  onAccessLost?: () => void
  /** A grant with a real AI call: pass `withLiveCall(manifest)` as `manifest` too. */
  liveCall?: DemoLiveCallState
}

function storageKey(token: string): string {
  return `ld_demo_journey_${token.slice(-16)}`
}

export function DemoJourneyPlayer({
  token,
  manifest,
  identity,
  company,
  watermark,
  serverNow,
  sessionExpiresAt,
  idleExpiresAt,
  onAccessLost,
  liveCall,
  variant = "granted",
}: DemoJourneyPlayerProps) {
  const persistProgress = variant !== "preview"
  const [snapshot, setSnapshot] = useState<DemoJourneySnapshot | null>(null)
  const [viewSectionId, setViewSectionId] = useState<string | null>(null)
  const [anchorMissing, setAnchorMissing] = useState(false)
  const [resultBanner, setResultBanner] = useState<string | null>(null)
  // The step whose coach card the prospect put away (× or Escape). A new step
  // brings its own card back; this one stays in the guide panel.
  const [hiddenCoachKey, setHiddenCoachKey] = useState<string | null>(null)
  const liveRegionRef = useRef<HTMLParagraphElement>(null)

  // Only a granted session tells the server how far it got (telemetry.ts):
  // the admin preview and the open demo have no session to report to. The
  // answers also carry the new idle deadline, so an active prospect is no
  // longer locked out by a countdown nothing refreshed.
  const [idleDeadline, setIdleDeadline] = useState(idleExpiresAt)
  useEffect(() => setIdleDeadline(idleExpiresAt), [idleExpiresAt])
  const accessLostRef = useRef(onAccessLost)
  useEffect(() => {
    accessLostRef.current = onAccessLost
  }, [onAccessLost])
  const reporterRef = useRef<JourneyReporter | null>(null)
  useEffect(() => {
    reporterRef.current = variant === "granted"
      ? createJourneyReporter(token, { onIdleExpiresAt: setIdleDeadline, onAccessLost: () => accessLostRef.current?.() })
      : null
  }, [token, variant])
  const frontierRef = useRef<{ sectionId: string; stepId: string } | null>(null)
  useEffect(() => {
    frontierRef.current = snapshot ? { sectionId: snapshot.sectionId, stepId: snapshot.stepId } : null
  }, [snapshot])
  useEffect(() => {
    if (variant !== "granted") return
    const onActivity = () => {
      const at = frontierRef.current
      if (at) reporterRef.current?.activity(at.sectionId, at.stepId)
    }
    const kinds = ["pointerdown", "keydown", "wheel", "touchstart"] as const
    for (const kind of kinds) window.addEventListener(kind, onActivity, { passive: true })
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, onActivity)
    }
  }, [variant])

  // Restore the session's own progress; a stale or foreign snapshot is
  // discarded by parseSnapshot and the story starts over.
  useEffect(() => {
    let restored: DemoJourneySnapshot | null = null
    if (persistProgress && typeof window !== "undefined") {
      try {
        restored = parseSnapshot(window.sessionStorage.getItem(storageKey(token)), manifest)
      } catch {
        restored = null
      }
    }
    setSnapshot(restored ?? createJourneySnapshot(manifest, identity, new Date()))
    setViewSectionId(null)
    // identity/manifest are stable per grant; token identifies the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, variant])

  useEffect(() => {
    if (!persistProgress || !snapshot || typeof window === "undefined") return
    try {
      window.sessionStorage.setItem(storageKey(token), serializeSnapshot(snapshot))
    } catch {
      /* private mode / blocked storage: the story still runs in memory */
    }
  }, [persistProgress, snapshot, token])

  /* ── session clock ── */
  const offset = useMemo(() => clockOffset(serverNow), [serverNow])
  const [remaining, setRemaining] = useState<number | null>(() =>
    secondsUntil(nearestDeadline(sessionExpiresAt, idleExpiresAt)?.value, clockOffset(serverNow)),
  )
  const [deadlineKind, setDeadlineKind] = useState<DemoDeadlineKind | null>(
    () => nearestDeadline(sessionExpiresAt, idleExpiresAt)?.kind ?? null,
  )
  useEffect(() => {
    const nearest = nearestDeadline(sessionExpiresAt, idleDeadline)
    setDeadlineKind(nearest?.kind ?? null)
    if (!nearest) {
      setRemaining(null)
      return
    }
    const tick = () => {
      const left = secondsUntil(nearest.value, offset)
      setRemaining(left)
      if (left === 0) onAccessLost?.()
    }
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [sessionExpiresAt, idleDeadline, offset, onAccessLost])

  const hint = useCallback((message: string) => {
    toast.info(message)
  }, [])

  const dispatch = useCallback(
    (action: DemoJourneyAction): DemoJourneyReduceResult => {
      if (!snapshot) return { ok: false, snapshot: snapshot as unknown as DemoJourneySnapshot, error: "not ready" }
      const result = reduceJourney(snapshot, action, manifest, new Date())
      if (!result.ok) {
        if (action.type !== "ui") hint(result.error ?? "")
        return result
      }
      setSnapshot(result.snapshot)
      const reporter = reporterRef.current
      if (reporter) {
        for (const report of journeyReportsBetween(snapshot, result.snapshot, { jumped: action.type === "open-section" })) reporter.report(report)
        reporter.activity(result.snapshot.sectionId, result.snapshot.stepId)
      }
      if (result.completedStep) {
        const completed = manifest.sections.flatMap((section) => section.steps).find((step) => step.id === result.completedStep)
        setResultBanner(completed?.result ?? null)
        setAnchorMissing(false)
        if (completed?.result && liveRegionRef.current) liveRegionRef.current.textContent = completed.result
      }
      return result
    },
    [snapshot, manifest, hint],
  )

  const reachable = useReachableRoutes(snapshot, manifest)

  if (!snapshot) return null

  const sections = activeSections(manifest)
  const frontierSection = findSection(manifest, snapshot.sectionId) ?? sections[0]
  const viewSection: DemoJourneySection =
    (viewSectionId ? findSection(manifest, viewSectionId) : null) ?? frontierSection
  const reviewMode = viewSection.id !== frontierSection.id
  const frontierStep = frontierSection.steps.find((step) => step.id === snapshot.stepId) ?? null
  const stepIndex = frontierSection.steps.findIndex((step) => step.id === snapshot.stepId)
  const step = reviewMode ? null : frontierStep
  const progress = journeyProgress(snapshot, manifest)

  const frontierIndex = sections.findIndex((section) => section.id === frontierSection.id)

  // Any section, any time (owner, 2026-09-22). Ahead of the story it jumps
  // there and stages what lies between; behind it, it opens read-only.
  const openSection = (sectionId: string) => {
    const jump = sectionJumpTarget(snapshot, manifest, sectionId)
    if (!jump.ok) {
      hint(snapshot.state === "CALL_QUEUED" || snapshot.state === "CALLING" ? S.jumpCallInFlight : S.jumpRefused)
      return
    }
    const result = dispatch({ type: "open-section", sectionId })
    if (!result.ok) return
    setViewSectionId(null)
    setAnchorMissing(false)
    setResultBanner(S.jumpedTo(jump.section.title, jump.section.id !== sectionId))
  }

  const openChapter = (sectionId: string) => {
    const index = sections.findIndex((section) => section.id === sectionId)
    setAnchorMissing(false)
    if (index === frontierIndex) setViewSectionId(null)
    else if (index >= 0 && index < frontierIndex) setViewSectionId(sectionId)
    else openSection(sectionId)
  }

  const Scene = SCENES[viewSection.id]
  const sceneProps: DemoSceneProps = {
    manifest,
    snapshot,
    section: viewSection,
    step,
    reviewMode,
    variant,
    dispatch,
    hint,
    openSection,
  }

  const activeRoute = viewSection.navGroup === "demo" ? null : viewSection.route.replace(/\/\[[a-zA-Z]+\]$/, "")

  const navigate = (route: string) => {
    const matching = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => section.navGroup !== "demo" && section.route.replace(/\/\[[a-zA-Z]+\]$/, "") === route)
    if (matching.some(({ index }) => index === frontierIndex)) return openChapter(frontierSection.id)
    // Behind the story first: a route that is both behind and ahead (the deal
    // card) shows what was done rather than jumping past the steps between.
    const behind = matching.filter(({ index }) => index < frontierIndex)
    if (behind.length) return openChapter(behind[behind.length - 1].section.id)
    const ahead = matching.find(({ index }) => index > frontierIndex)
    if (ahead) openSection(ahead.section.id)
  }

  const goBack = () => {
    if (stepIndex <= 0) return
    // Stepping back is a reading aid: the frontier does not move, so no
    // effect can be replayed. It only re-points the coach mark.
    const previous = frontierSection.steps[stepIndex - 1]
    hint(previous.instruction)
  }

  const canBack = !reviewMode && stepIndex > 0
  const canSkip = !reviewMode && !!step && !step.required
  const coachKey = step ? `${snapshot.sectionId}:${step.id}` : null
  const coachShown = Boolean(step && Scene) && hiddenCoachKey !== coachKey

  return (
    <TooltipProvider delayDuration={200}>
      <section aria-label={S.sectionAria} className="relative isolate flex min-h-dvh flex-col bg-background text-foreground">
        <div
          aria-hidden="true"
          data-tour-id="demo-watermark"
          className="pointer-events-none fixed inset-x-0 bottom-0 top-[73px] z-20 grid select-none grid-cols-2 grid-rows-3 place-items-center overflow-hidden opacity-[0.04] sm:grid-cols-3 sm:grid-rows-2"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="-rotate-12 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-foreground sm:text-sm">
              {watermark}
            </span>
          ))}
        </div>

        <header className="relative z-30 shrink-0 border-b border-border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Image src="/logo.svg" alt="LeadDrive CRM" width={132} height={32} priority className="h-8 w-auto shrink-0" />
              <div className="min-w-0">
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-800">
                  {variant === "preview" ? S.badgePreview : variant === "open" ? S.badgeOpen : S.badgePrivate}
                </span>
                <p className="truncate text-xs text-muted-foreground">
                  {variant === "preview" ? S.forCompanyPreview(company) : variant === "open" ? S.openIntro : S.forCompany(company)}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-md">
              <Progress value={progress.requiredDone} max={Math.max(progress.requiredTotal, 1)} className="h-1.5" aria-label={S.progressAria} />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{S.steps(progress.requiredDone, progress.requiredTotal)}</span>
              {remaining !== null && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
                    remaining <= 60 ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground",
                  )}
                  title={deadlineKind === "idle" ? S.sessionIdleTitle : S.sessionAbsoluteTitle}
                >
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  {deadlineKind === "idle" ? S.sessionIdle : S.sessionAbsolute} · {formatRemaining(remaining)}
                </span>
              )}
              <span className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
                {deadlineAnnouncement(remaining, deadlineKind)}
              </span>
            </div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1">
          <DemoJourneySidebar
            visibleRoutes={manifest.visibleRoutes}
            reachableRoutes={reachable}
            activeRoute={activeRoute}
            onNavigate={navigate}
            onLocked={(label) => hint(S.sectionLater(label))}
          />
          {/* One shrinkable column below lg: without it the implicit auto column
              took the guide panel's min-content width (343px on a 375px
              phone) and the whole demo scrolled sideways, text cut off. */}
          <div className="grid min-w-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
            <main id="demo-scene" className="min-w-0 overflow-y-auto p-4 sm:p-6">
              {Scene ? <Scene {...sceneProps} /> : <ScenePending section={viewSection} />}
            </main>
            <DemoJourneyGuide
              manifest={manifest}
              snapshot={snapshot}
              token={token}
              section={viewSection}
              step={step}
              stepIndex={Math.max(0, stepIndex)}
              progress={progress}
              reviewMode={reviewMode}
              variant={variant}
              anchorMissing={anchorMissing}
              sceneHasCoachMark={coachShown}
              onShowCoach={step && Scene && !coachShown ? () => setHiddenCoachKey(null) : undefined}
              resultBanner={resultBanner}
              canBack={canBack}
              canSkip={canSkip}
              onClipEvent={(name) => reporterRef.current?.report({ eventType: "JOURNEY", name, sectionId: viewSection.id })}
              onNext={() => step && dispatch({ type: "complete-step", stepId: step.id })}
              onBack={goBack}
              onSkip={() => step && dispatch({ type: "skip-step", stepId: step.id })}
              onContinueFromGuide={() => {
                if (!step) return
                if (step.completion.kind === "viewed") dispatch({ type: "complete-step", stepId: step.id })
                else if (!step.required) dispatch({ type: "skip-step", stepId: step.id })
              }}
              onExitReview={() => setViewSectionId(null)}
              onOpenChapter={openChapter}
              onGuideAction={() => {
                if (step?.completion.kind === "transition") dispatch({ type: "transition", stepId: step.id, to: step.completion.to })
              }}
              liveCall={liveCall}
              onOutcome={(to) => step && dispatch({ type: "outcome", stepId: step.id, to })}
            />
          </div>
        </div>

        <p ref={liveRegionRef} className="sr-only" role="status" aria-live="polite" />

        {/* Put away (× or Escape), the card collapses to the ring and the arrow on
            the control instead of disappearing: the owner could not tell what
            to press once the card was closed (2026-09-22). */}
        {step && Scene && !reviewMode && (
          <DemoCoachMark
            collapsed={!coachShown}
            targetStepId={step.action === "observe" || step.action === "wait" ? undefined : step.id}
            targetLabel={step.targetLabel}
            stepKey={`${snapshot.sectionId}:${step.id}`}
            anchor={step.anchor}
            placement={step.placement}
            title={step.title}
            instruction={step.instruction}
            counter={S.stepOf(stepIndex + 1, frontierSection.steps.length)}
            mode={step.action === "observe" || step.action === "wait" ? "observe" : "action"}
            canBack={canBack}
            canSkip={canSkip}
            onNext={() => dispatch({ type: "complete-step", stepId: step.id })}
            onBack={goBack}
            onSkip={() => dispatch({ type: "skip-step", stepId: step.id })}
            onClose={() => setHiddenCoachKey(coachKey)}
            onMissing={setAnchorMissing}
          />
        )}
      </section>
    </TooltipProvider>
  )
}

/** Routes the story has reached, memoised so the sidebar does not rebuild
 *  its item list on every tick of the session clock. */
function useReachableRoutes(snapshot: DemoJourneySnapshot | null, manifest: DemoJourneyManifest): readonly string[] {
  const key = snapshot ? `${snapshot.state}|${snapshot.visitedSections.join(",")}` : ""
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (snapshot ? reachableRoutes(snapshot, manifest) : []), [key, manifest])
}
