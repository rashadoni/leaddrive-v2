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
  parseSnapshot,
  reachableRoutes,
  reduceJourney,
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
import type { DemoSceneProps } from "./scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

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

export interface DemoJourneyPlayerProps {
  token: string
  manifest: DemoJourneyManifest
  identity: DemoProspectIdentity
  company: string
  watermark: string
  serverNow?: string
  sessionExpiresAt?: string
  idleExpiresAt?: string
  onAccessLost?: () => void
  previewMode?: boolean
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
  previewMode = false,
}: DemoJourneyPlayerProps) {
  const [snapshot, setSnapshot] = useState<DemoJourneySnapshot | null>(null)
  const [viewSectionId, setViewSectionId] = useState<string | null>(null)
  const [anchorMissing, setAnchorMissing] = useState(false)
  const [resultBanner, setResultBanner] = useState<string | null>(null)
  const liveRegionRef = useRef<HTMLParagraphElement>(null)

  // Restore the session's own progress; a stale or foreign snapshot is
  // discarded by parseSnapshot and the story starts over.
  useEffect(() => {
    let restored: DemoJourneySnapshot | null = null
    if (!previewMode && typeof window !== "undefined") {
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
  }, [token, previewMode])

  useEffect(() => {
    if (previewMode || !snapshot || typeof window === "undefined") return
    try {
      window.sessionStorage.setItem(storageKey(token), serializeSnapshot(snapshot))
    } catch {
      /* private mode / blocked storage: the story still runs in memory */
    }
  }, [previewMode, snapshot, token])

  /* ── session clock ── */
  const offset = useMemo(() => clockOffset(serverNow), [serverNow])
  const [remaining, setRemaining] = useState<number | null>(() =>
    secondsUntil(nearestDeadline(sessionExpiresAt, idleExpiresAt)?.value, clockOffset(serverNow)),
  )
  const [deadlineKind, setDeadlineKind] = useState<DemoDeadlineKind | null>(
    () => nearestDeadline(sessionExpiresAt, idleExpiresAt)?.kind ?? null,
  )
  useEffect(() => {
    const nearest = nearestDeadline(sessionExpiresAt, idleExpiresAt)
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
  }, [sessionExpiresAt, idleExpiresAt, offset, onAccessLost])

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

  const Scene = SCENES[viewSection.id]
  const sceneProps: DemoSceneProps = {
    manifest,
    snapshot,
    section: viewSection,
    step,
    reviewMode,
    previewMode,
    dispatch,
    hint,
  }

  const activeRoute = viewSection.navGroup === "demo" ? null : viewSection.route.replace(/\/\[[a-zA-Z]+\]$/, "")

  const navigate = (route: string) => {
    const target = [...manifest.sections]
      .reverse()
      .find((section) => section.navGroup !== "demo" && section.route.replace(/\/\[[a-zA-Z]+\]$/, "") === route && snapshot.visitedSections.includes(section.id))
    if (!target) return
    setViewSectionId(target.id === frontierSection.id ? null : target.id)
    setAnchorMissing(false)
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
                  {previewMode ? S.badgePreview : S.badgePrivate}
                </span>
                <p className="truncate text-xs text-muted-foreground">
                  {previewMode ? S.forCompanyPreview(company) : S.forCompany(company)}
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
          />
          <div className="grid min-w-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
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
              previewMode={previewMode}
              anchorMissing={anchorMissing}
              resultBanner={resultBanner}
              canBack={canBack}
              canSkip={canSkip}
              onNext={() => step && dispatch({ type: "complete-step", stepId: step.id })}
              onBack={goBack}
              onSkip={() => step && dispatch({ type: "skip-step", stepId: step.id })}
              onContinueFromGuide={() => {
                if (!step) return
                if (step.completion.kind === "viewed") dispatch({ type: "complete-step", stepId: step.id })
                else if (!step.required) dispatch({ type: "skip-step", stepId: step.id })
              }}
              onExitReview={() => setViewSectionId(null)}
            />
          </div>
        </div>

        <p ref={liveRegionRef} className="sr-only" role="status" aria-live="polite" />

        {step && Scene && (
          <DemoCoachMark
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
