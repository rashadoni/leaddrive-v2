"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, PlayCircle, SkipForward, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { getHelpVideoAsset, getHelpVideoForSlug } from "@/content/help/video-assets"
import {
  activeSections,
  sectionStatus,
  type DemoJourneyManifest,
  type DemoJourneyProgress,
  type DemoJourneySection,
  type DemoJourneySnapshot,
  type DemoJourneyState,
  type DemoJourneyStep,
} from "@/lib/demo-center/journey"
import type { DemoJourneyVariant } from "./demo-journey-player"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import { DemoLiveCall, type DemoLiveCallState } from "./demo-live-call"

/**
 * The guide panel: where the prospect is in the story, what to do now, and
 * what just happened. It duplicates the coach mark's step text so the
 * instruction is readable without the overlay (mobile, screen readers,
 * missing anchor) and hosts the recovery path when an anchor is absent.
 */
export interface DemoJourneyGuideProps {
  manifest: DemoJourneyManifest
  snapshot: DemoJourneySnapshot
  /** Capability token — the demo's own video route is scoped to it. */
  token: string
  /** Section shown in the scene (frontier or review). */
  section: DemoJourneySection
  /** Frontier step when it belongs to the shown section. */
  step: DemoJourneyStep | null
  stepIndex: number
  progress: DemoJourneyProgress
  reviewMode: boolean
  variant: DemoJourneyVariant
  anchorMissing: boolean
  /** The scene can host a coach mark, which then carries this same step. */
  sceneHasCoachMark: boolean
  resultBanner: string | null
  canBack: boolean
  canSkip: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onContinueFromGuide: () => void
  onExitReview: () => void
  /** Present on a grant whose admin allowed a real AI call. */
  liveCall?: DemoLiveCallState
  /** Record how the real call ended; only an `outcome` step accepts it. */
  onOutcome?: (to: DemoJourneyState) => void
  /** A clip was started, played to the end, or failed — for the session's report. */
  onClipEvent?: (name: DemoClipEvent) => void
}

export type DemoClipEvent = "video.started" | "video.completed" | "video.error"

export function DemoJourneyGuide({
  manifest,
  snapshot,
  token,
  section,
  step,
  stepIndex,
  progress,
  reviewMode,
  variant,
  anchorMissing,
  sceneHasCoachMark,
  resultBanner,
  canBack,
  canSkip,
  onNext,
  onBack,
  onSkip,
  onContinueFromGuide,
  onExitReview,
  liveCall,
  onOutcome,
  onClipEvent,
}: DemoJourneyGuideProps) {
  const sections = activeSections(manifest)
  const sectionIndex = sections.findIndex((candidate) => candidate.id === section.id)
  const mode = step && step.action !== "observe" && step.action !== "wait" ? "action" : "observe"

  // The coach mark already shows this step's instruction and its buttons,
  // pinned to the control it is talking about. Repeating the whole card here
  // put the same words and the same «İrəli» on screen twice at once — noise
  // on the one screen whose job is to be clear. So while the coach mark is
  // up, the panel keeps only where-you-are; when the anchor is missing there
  // is no coach mark, and the panel expands to carry the step on its own.
  const stepIsOnScene = sceneHasCoachMark && !anchorMissing && !reviewMode

  return (
    <aside
      data-tour-id="demo-guide-panel"
      data-testid="demo-guide"
      aria-label={S.guide}
      className="flex flex-col gap-4 border-t border-border bg-card p-4 lg:sticky lg:top-[73px] lg:max-h-[calc(100dvh-73px)] lg:overflow-y-auto lg:border-l lg:border-t-0"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {S.guide} · {S.sectionOf(sectionIndex + 1, sections.length)}
        </p>
        <h2 className="mt-1 text-base font-semibold leading-snug">{section.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.summary}</p>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <Progress value={progress.requiredDone} max={Math.max(progress.requiredTotal, 1)} className="h-1.5" aria-label={S.progressAria} />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{S.steps(progress.requiredDone, progress.requiredTotal)}</span>
        </div>
      </div>

      {reviewMode ? (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">{S.reviewMode}</p>
          <p className="mt-1 leading-relaxed">{S.reviewBody}</p>
          <Button size="sm" className="mt-2 h-8" onClick={onExitReview}>
            {S.backToCurrent} <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      ) : step ? (
        <div data-testid="demo-guide-step" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {S.stepOf(stepIndex + 1, section.steps.length)}
          </p>
          <p className="mt-1 text-sm font-semibold leading-tight">{step.title}</p>
          {stepIsOnScene ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{S.stepOnScene}</p>
          ) : (
          <>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.instruction}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                mode === "action" ? "bg-orange-50 text-orange-800" : "bg-muted text-muted-foreground",
              )}
            >
              {mode === "action" ? S.waiting : S.observe}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {canBack && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBack}>
                  <ChevronLeft className="mr-0.5 h-3 w-3" /> {S.back}
                </Button>
              )}
              {canSkip && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onSkip}>
                  <SkipForward className="mr-0.5 h-3 w-3" /> {S.skip}
                </Button>
              )}
              {mode === "observe" && (
                <Button size="sm" className="h-7 px-3 text-xs" onClick={onNext}>
                  {S.next} <ChevronRight className="ml-0.5 h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          </>
          )}
          {anchorMissing && (
            <div role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {S.anchorMissingTitle}</p>
              <p className="mt-1 leading-relaxed">{step.fallback ?? S.anchorMissingBody}</p>
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={onContinueFromGuide}>
                {S.continueFromGuide}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {resultBanner && (
        <div role="status" aria-live="polite" data-testid="demo-guide-result" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-3.5 w-3.5" /> {S.resultTitle}</p>
          <p className="mt-1 leading-relaxed">{resultBanner}</p>
        </div>
      )}

      {section.intro && manifest.capabilities.video && (
        <IntroClip slug={section.intro.slug} caption={section.intro.caption} status={section.intro.status} token={token} variant={variant} onClipEvent={onClipEvent} />
      )}

      {step && step.completion.kind === "outcome" && !reviewMode && variant === "granted" && liveCall?.enabled && onOutcome ? (
        <DemoLiveCall token={token} initial={liveCall} onOutcome={onOutcome} />
      ) : null}

      <DemoAssistant
        enabled={manifest.capabilities.assistant}
        token={token}
        variant={variant}
        snapshot={snapshot}
        prompts={section.assistantPrompts ?? []}
      />

      <ol className="space-y-1.5" aria-label={S.guide}>
        {sections.map((candidate, index) => {
          const status = sectionStatus(snapshot, manifest, candidate.id)
          const shown = candidate.id === section.id
          return (
            <li
              key={candidate.id}
              data-section-status={status}
              className={cn(
                "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
                shown && "bg-muted/60",
                status === "upcoming" && "text-muted-foreground",
              )}
            >
              {status === "done" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : status === "current" ? (
                <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF4D00]" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", status === "current" && "font-semibold")}>{index + 1}. {candidate.title}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{S.minutes(candidate.estimatedMinutes)}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

/**
 * Short intro clip from the help-video pipeline.
 *
 * The pipeline's own route (`/api/help-videos/[file]`) calls `requireAuth`,
 * so it works in the authenticated superadmin preview but would answer 401
 * to a prospect, who holds a capability session and no tenant session. The
 * prospect therefore streams the same bytes through the demo's own gated
 * route, scoped to their token.
 */
/**
 * Ask-the-assistant box.
 *
 * The browser sends only its position in the story — the server rebuilds the
 * records from the grant, so nothing typed here reaches the model as fact.
 * In the superadmin preview there is no capability session to spend a paid
 * call against, so the box explains itself instead of calling.
 */
function DemoAssistant({
  enabled,
  token,
  variant,
  snapshot,
  prompts,
}: {
  enabled: boolean
  token: string
  variant: DemoJourneyVariant
  snapshot: DemoJourneySnapshot
  prompts: readonly string[]
}) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)

  // The reference product kept its assistant behind an explicit activation
  // too. In the open demo the switch stays off: nobody has verified who is
  // asking, and every answer is a paid model call.
  if (!enabled || variant !== "granted") {
    if (!prompts.length) return null
    return (
      <div data-tour-id="demo-assistant" className="rounded-lg border border-dashed border-zinc-200 p-3 dark:border-zinc-700">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" aria-hidden="true" /> {S.assistantTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{variant === "open" ? S.assistantOpenDemo : variant === "preview" ? S.assistantPreviewOnly : S.assistantOff}</p>
      </div>
    )
  }

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || asking) return
    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/assistant`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          state: snapshot.state,
          sectionId: snapshot.sectionId,
          stepId: snapshot.stepId,
        }),
      })
      const payload = await response.json().catch(() => null) as
        { success?: boolean; answer?: string; error?: string; remaining?: number } | null
      if (typeof payload?.remaining === "number") setRemaining(payload.remaining)
      if (!response.ok || !payload?.success || !payload.answer) {
        setError(payload?.error ?? S.assistantFailed)
        return
      }
      setAnswer(payload.answer)
      setQuestion("")
    } catch {
      setError(S.assistantFailed)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div data-tour-id="demo-assistant" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" aria-hidden="true" /> {S.assistantTitle}
        {remaining !== null && (
          <span className="ml-auto font-normal tabular-nums text-muted-foreground">{S.assistantRemaining(remaining)}</span>
        )}
      </p>

      {prompts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {prompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                onClick={() => { setQuestion(prompt); void ask(prompt) }}
                disabled={asking}
                className="text-left text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                · {prompt}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-2"
        onSubmit={(event) => { event.preventDefault(); void ask(question) }}
      >
        <label htmlFor="demo-assistant-question" className="sr-only">{S.assistantTitle}</label>
        <textarea
          id="demo-assistant-question"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={S.assistantPlaceholder}
          maxLength={500}
          className="w-full resize-none rounded-md border border-zinc-200 bg-background p-2 text-xs dark:border-zinc-700"
        />
        <Button type="submit" size="sm" className="mt-1.5 h-7 w-full text-xs" disabled={asking || !question.trim()}>
          {asking ? S.assistantAsking : S.assistantAsk}
        </Button>
      </form>

      {answer && (
        <p role="status" aria-live="polite" className="mt-2 rounded-md bg-muted/60 p-2.5 text-xs leading-relaxed">{answer}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">{error}</p>
      )}
    </div>
  )
}

function IntroClip({
  slug,
  caption,
  status,
  token,
  variant,
  onClipEvent,
}: {
  slug: string
  caption: string
  status: "available" | "planned"
  token: string
  variant: DemoJourneyVariant
  onClipEvent?: (name: DemoClipEvent) => void
}) {
  const [playing, setPlaying] = useState(false)
  // The open demo streams nothing: its viewer is unverified, and these files
  // are the product's own help library, not public marketing assets.
  const entry = status === "available" && variant !== "open" ? getHelpVideoForSlug(slug, "az") : null
  const assets = !entry
    ? null
    : variant === "preview"
      ? getHelpVideoAsset(entry, "az")
      : {
          videoSrc: `/api/v1/public/demo-access/${encodeURIComponent(token)}/video/${encodeURIComponent(`${slug}.az`)}.VOICE.mp4`,
          posterSrc: `/api/v1/public/demo-access/${encodeURIComponent(token)}/video/${encodeURIComponent(`${slug}.az`)}.poster.jpg`,
        }

  return (
    <div data-testid="demo-intro-clip" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.clipTitle}</p>
      <p className="mt-1 text-xs leading-relaxed">{caption}</p>
      {assets ? (
        playing ? (
          // Sound only after the prospect asked for it; captions travel with the file.
          <video
            className="mt-2 w-full rounded-md"
            controls
            autoPlay
            poster={assets.posterSrc}
            src={assets.videoSrc}
            onEnded={() => onClipEvent?.("video.completed")}
            onError={() => onClipEvent?.("video.error")}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setPlaying(true)
              onClipEvent?.("video.started")
            }}
            className="group relative mt-2 block w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- poster from the help-video pipeline, sized by CSS */}
            <img src={assets.posterSrc} alt="" className="aspect-video w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white transition-colors group-hover:bg-black/40">
              <PlayCircle className="h-9 w-9" /> <span className="sr-only">{S.clipPlay}</span>
            </span>
          </button>
        )
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">{variant === "open" ? S.clipOpenDemo : S.clipPlanned}</p>
      )}
    </div>
  )
}
