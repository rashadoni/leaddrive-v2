"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, Play, PlayCircle, SkipForward, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { getHelpVideoAsset, getHelpVideoForSlug } from "@/content/help/video-assets"
import {
  DEMO_PUBLIC_CLIP_SLUGS,
  activeSections,
  demoPublicClipUrl,
  getDemoJourneyModule,
  moduleOfSection,
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
import { DemoLiveWhatsApp } from "./demo-live-whatsapp"
import { DemoLiveSocial } from "./demo-live-social"
import type { DemoLiveSocialHandle } from "./use-demo-live-social"
import { LIVE_WHATSAPP_TICKET_SECTIONS, type DemoLiveWhatsAppHandle } from "./use-demo-live-whatsapp"
import { demoTarget } from "./demo-target"
import { isGuideVoiceOn, setGuideVoiceMicrophone, useGuideVoice, type GuideMicrophoneChange, type GuideVoice } from "./demo-guide-voice"
import { GuideVoiceSwitch } from "./guide-voice-switch"
import { stepVoiceUrl } from "@/lib/demo-center/guide-voice"
import { parseDemoAssistantAction, type DemoAssistantAction } from "@/lib/demo-center/assistant/actions"
import { DemoAssistantVoice } from "./demo-assistant-voice"

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
  /** Brings back the coach card the prospect put away; absent while it is shown. */
  onShowCoach?: () => void
  /**
   * The step's own control lives in this panel: a transition step anchored
   * on the panel («Zəngsiz davam edin»). Without it that step had no control
   * anywhere and the story stopped there.
   */
  onGuideAction?: () => void
  /** Opens a chapter: behind the story read-only, ahead of it by jumping. */
  onOpenChapter?: (sectionId: string) => void
  /** The live WhatsApp thread, when this chapter shows it (the player reads it once for the page). */
  liveWhatsApp?: DemoLiveWhatsAppHandle
  /** The prospect's own Facebook Page, when this chapter shows it (the player reads it once for the page). */
  liveSocial?: DemoLiveSocialHandle
  /**
   * The guide's hands: runs an assistant answer's action against the player's
   * latest position. `askedKey` is where the question was asked; when the
   * story moved meanwhile, a jump becomes an offer and nothing else happens.
   */
  onAssistantAction?: (action: DemoAssistantAction, askedKey: string) => DemoAssistantActionResult
  /**
   * The server's voice switch (owner, 2026-10-20): Da Vinci's answers are
   * spoken in the guide's voice and «Səslə soruşun» is offered. Granted only.
   */
  assistantVoice?: boolean
}

/**
 * What became of an answer's action: done, offered as a button (the screen
 * moved and a jump would still open something), moved (it pointed at a step
 * the prospect has left — the answer is about the wrong step), or dropped.
 */
export type DemoAssistantActionResult = "done" | "offer" | "moved" | "dropped"

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
  onShowCoach,
  onGuideAction,
  onOpenChapter,
  liveWhatsApp,
  liveSocial,
  onAssistantAction,
  assistantVoice = false,
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

  // The guide reads each step aloud when it opens (guide-voice.ts). Keyed by
  // the step, so a re-render never restarts a sentence mid-way. A step that
  // opens while the prospect's microphone is open is not read into the
  // question: the voice module holds it until the clip is thrown away, and
  // drops it when the clip is sent (demo-guide-voice.ts) — the coach card's
  // switch and the clip's «say the step again» go through the same gate.
  const voice = useGuideVoice()
  const narration = step && !reviewMode ? stepVoiceUrl(step) : null
  useEffect(() => {
    if (narration) voice.play(narration)
    else voice.stop()
    // voice.play/stop are stable; the recording is the only thing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration])

  return (
    <aside
      data-tour-id="demo-guide-panel"
      data-testid="demo-guide"
      aria-label={S.guide}
      className="flex flex-col gap-4 border-t border-border bg-card p-4 xl:sticky xl:top-[73px] xl:max-h-[calc(100dvh-73px)] xl:overflow-y-auto xl:border-l xl:border-t-0"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {S.guide} · {S.sectionOf(sectionIndex + 1, sections.length)}
        </p>
        <h2 className="mt-1 text-base font-semibold leading-snug">{section.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.summary}</p>
        {/* Words, not an icon: a bare speaker glyph was the kind of control
            the owner found unreadable. While the coach card carries the step
            it carries this switch too — one control on screen, not two. */}
        {!stepIsOnScene && (
          <GuideVoiceSwitch
            className="mt-2"
            testId="demo-guide-voice"
            on={voice.on}
            blocked={voice.blocked}
            onToggle={() => voice.toggle(narration)}
            onUnblock={voice.unblock}
          />
        )}
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
          <p className="mt-1 leading-relaxed">{sectionStatus(snapshot, manifest, section.id) === "passed" ? S.reviewPassedBody : S.reviewBody}</p>
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
          {onShowCoach && !anchorMissing && (
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={onShowCoach} data-testid="demo-coach-show">
              {S.coachShow}
            </Button>
          )}
          </>
          )}
          {onGuideAction && !reviewMode && step.anchor === "demo-guide-panel" && step.completion.kind === "transition" && (
            <Button size="sm" className="mt-3 h-8 w-full" onClick={onGuideAction} {...demoTarget(step.id)}>
              {step.targetLabel ?? S.next} <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
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

      {/* The clip itself plays at the top of the product screen (the player
          renders it). Here only the note for a clip this viewer cannot be
          served — it is being made, or it opens in a personal demo. */}
      {section.intro && manifest.capabilities.video && !introClipAssets(section.intro.slug, section.intro.status, token, variant) && (
        <div data-testid="demo-intro-clip-note" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.clipTitle}</p>
          <p className="mt-1 text-xs leading-relaxed">{section.intro.caption}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">{variant === "open" ? S.clipOpenDemo : S.clipPlanned}</p>
        </div>
      )}

      {step && step.completion.kind === "outcome" && !reviewMode && variant === "granted" && liveCall?.enabled && onOutcome ? (
        <DemoLiveCall token={token} initial={liveCall} onOutcome={onOutcome} />
      ) : null}

      {/* The inbox chapters are where a real WhatsApp thread belongs: the
          panel asks the server whether this session has one and renders
          nothing when it has not. */}
      {liveWhatsApp ? <DemoLiveWhatsApp live={liveWhatsApp} mode={LIVE_WHATSAPP_TICKET_SECTIONS.has(section.id) ? "ticket" : "chat"} /> : null}

      {/* Beside it, the prospect's own Facebook Page — only where the admin
          allowed it and the server has the demo's Meta app; otherwise the
          panel renders nothing. */}
      {liveSocial ? <DemoLiveSocial live={liveSocial} /> : null}

      <DemoAssistant
        enabled={manifest.capabilities.assistant}
        token={token}
        variant={variant}
        snapshot={snapshot}
        prompts={section.assistantPrompts ?? []}
        voice={voice}
        onAction={onAssistantAction}
        voiceEnabled={assistantVoice}
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
              {/* Any chapter opens (owner, 2026-09-22): the story's own shell
                  ahead of the frontier (the summary) is the one exception. */}
              {onOpenChapter && !opensLater(candidate, status) ? (
                <button
                  type="button"
                  onClick={() => onOpenChapter(candidate.id)}
                  aria-current={shown ? "step" : undefined}
                  className="min-w-0 flex-1 text-left hover:underline"
                >
                  <span className={cn("block truncate", status === "current" && "font-semibold")}>{index + 1}. {candidate.title}</span>
                  {status === "passed" ? <span className="block text-[10px] text-muted-foreground">{S.chapterPassed}</span> : null}
                </button>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", status === "current" && "font-semibold")}>{index + 1}. {candidate.title}</span>
                </span>
              )}
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{S.minutes(candidate.estimatedMinutes)}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

/** The summary opens when the story gets there; everything else opens now. */
function opensLater(section: DemoJourneySection, status: ReturnType<typeof sectionStatus>): boolean {
  return section.navGroup === "demo" && status === "upcoming"
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
  voice,
  onAction,
  voiceEnabled = false,
}: {
  enabled: boolean
  token: string
  variant: DemoJourneyVariant
  snapshot: DemoJourneySnapshot
  prompts: readonly string[]
  /** A prepared answer comes with its recording; with the voice switch on, Da Vinci's is spoken too. */
  voice?: GuideVoice
  onAction?: (action: DemoAssistantAction, askedKey: string) => DemoAssistantActionResult
  /** The server's voice switch: spoken Da Vinci answers and «Səslə soruşun». */
  voiceEnabled?: boolean
}) {
  const [question, setQuestion] = useState("")
  // The conversation so far, newest last: the last few questions and answers,
  // and on the newest answer a worded button when the guide only offers a jump.
  const [turns, setTurns] = useState<ReadonlyArray<AssistantTurn>>([])
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  // The live «a question is being answered»: a clip is heard seconds after the
  // press that stopped it, and calls the `ask` of that press's render.
  const askingRef = useRef(false)
  // A spoken question heard while another was still being answered: it waits
  // in the box, and one press of «Soruş» asks it.
  const [heardWaiting, setHeardWaiting] = useState<string | null>(null)
  // Voice minutes ran out for this demo or for today: answers stay text and the button goes.
  const [voiceExhausted, setVoiceExhausted] = useState(false)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  // Where the prospect is now and which answer is newest: a spoken answer
  // that comes back after either moved would talk over the wrong screen.
  const positionRef = useRef(`${snapshot.sectionId}:${snapshot.stepId}`)
  const newestAnswerRef = useRef<string | null>(null)
  // «Səslə soruşun» has the microphone opening or open, or its clip is being
  // turned into text: nothing may play, or the guide's voice would be in the
  // question — or start, only to be cut by the answer to it.
  const micOpenRef = useRef(false)
  // A spoken answer that came back while the microphone was open: heard once
  // the clip is thrown away, never once it is sent (that is a new question).
  const heldAnswerRef = useRef<{ answerId: string; askedKey: string; audio: Blob } | null>(null)
  useEffect(() => {
    positionRef.current = `${snapshot.sectionId}:${snapshot.stepId}`
  }, [snapshot.sectionId, snapshot.stepId])

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

  // Over the budget ends voice for this demo only when the server says not
  // even one full question fits any more (`exhausted`); a long answer's
  // estimate can be refused while there is still room to ask. A refusal
  // without the flag is taken at its word.
  const refusedVoice = (code: string | undefined, exhausted?: boolean) => {
    if ((code === "demo_budget" || code === "day_budget") && exhausted !== false) setVoiceExhausted(true)
  }

  // One voicing per answer, and only an answer the server vouched for: the
  // id and hash it issued go back with the text, unchanged.
  const speak = async (answerId: string, answer: string, answerHash: string, askedKey: string) => {
    // The switch as it is now: switched off while the answer was coming, it sends nothing.
    if (!isGuideVoiceOn()) return
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/assistant/voice`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId, answer, answerHash, stepId: snapshot.stepId }),
      })
      if (response.ok && (response.headers.get("content-type") ?? "").startsWith("audio/")) {
        const audio = await response.blob()
        if (newestAnswerRef.current !== answerId || positionRef.current !== askedKey) return
        if (micOpenRef.current) heldAnswerRef.current = { answerId, askedKey, audio }
        else voice?.playBlob(audio)
        return
      }
      const payload = await response.json().catch(() => null) as { code?: string; error?: string; exhausted?: boolean } | null
      const overBudget = payload?.code === "demo_budget" || payload?.code === "day_budget"
      refusedVoice(payload?.code, payload?.exhausted)
      setVoiceNote(overBudget && payload?.exhausted !== false ? S.voiceExhausted : S.voiceAnswerFailed)
    } catch {
      setVoiceNote(S.voiceAnswerFailed)
    }
  }

  // What the microphone did. A clip thrown away (a scroll that began on the
  // button, a cancelled pointer, a clip that came back with no question in
  // it) takes nothing from the prospect: the answer that came back meanwhile
  // is heard now. A clip heard as a question is a new question: an answer to
  // the one before, held or still on its way, is not spoken.
  const microphoneChanged = (change: GuideMicrophoneChange) => {
    micOpenRef.current = change === "opening" || change === "open"
    setGuideVoiceMicrophone(change)
    if (micOpenRef.current) return
    const held = heldAnswerRef.current
    heldAnswerRef.current = null
    if (change === "sent") {
      newestAnswerRef.current = null
      return
    }
    if (held && newestAnswerRef.current === held.answerId && positionRef.current === held.askedKey) voice?.playBlob(held.audio)
  }

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || askingRef.current) return
    askingRef.current = true
    setAsking(true)
    setHeardWaiting(null)
    setError(null)
    setVoiceNote(null)
    // A new question retires the previous answer's offer.
    setTurns((current) => current.map((turn) => (turn.offer ? { ...turn, offer: undefined } : turn)))
    const askedKey = `${snapshot.sectionId}:${snapshot.stepId}`
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
        { success?: boolean; answer?: string; error?: string; remaining?: number; audio?: string; action?: unknown; answerId?: unknown; answerHash?: unknown } | null
      if (typeof payload?.remaining === "number") setRemaining(payload.remaining)
      if (!response.ok || !payload?.success || !payload.answer) {
        setError(payload?.error ?? S.assistantFailed)
        return
      }
      // The hands first: only an action from the closed list, planned by the
      // player against where the prospect is now.
      const action = parseDemoAssistantAction(payload.action)
      const result = action && onAction ? onAction(action, askedKey) : null
      const offer = result === "offer" && action?.kind === "open_module" ? action : undefined
      // An answer that points at a step the prospect has already left would
      // read out that old step over the new one's narration: neither its words
      // nor its recording are true any more.
      const moved = result === "moved"
      // A question typed while the microphone is open is answered in text:
      // no recording plays into the clip, and nothing is paid to be spoken.
      const micOpen = micOpenRef.current
      // Only our own recordings: a path under the guide's sound folder.
      if (!moved && !micOpen && payload.audio?.startsWith("/sounds/demo-guide/")) voice?.play(payload.audio)
      // A Da Vinci answer has no recording; with the switch on it is spoken
      // once, in the same voice, through the same element — unless the guide's
      // voice is off, when nothing is sent to be spoken at all. Off NOW: this
      // runs seconds after the press, and `voice.on` is the press's render.
      const answerId = typeof payload.answerId === "string" ? payload.answerId : null
      newestAnswerRef.current = answerId
      if (voiceEnabled && !moved && !micOpen && !payload.audio && answerId && typeof payload.answerHash === "string" && voice && isGuideVoiceOn() && !voiceExhausted) {
        void speak(answerId, payload.answer, payload.answerHash, askedKey)
      }
      const asked: AssistantTurn = { id: `you-${Date.now()}`, who: "you", text: trimmed }
      const said: AssistantTurn = { id: `guide-${Date.now()}`, who: "guide", text: moved ? S.assistantMoved : payload.answer, offer }
      setTurns((current) => [...current, asked, said].slice(-ASSISTANT_TURNS_SHOWN))
      // Only the question just answered leaves the box: a spoken one waiting there stays.
      setQuestion((current) => (current === text ? "" : current))
    } catch {
      setError(S.assistantFailed)
    } finally {
      askingRef.current = false
      setAsking(false)
    }
  }

  // What «Səslə soruşun» heard is asked — unless another question is still
  // being answered. One at a time, so it waits in the box for one press of
  // «Soruş», rather than going by itself once that answer is in: the answer
  // may have moved the story on, and the prospect, not the page, decides
  // whether the question still fits the screen.
  const heardQuestion = (heard: string) => {
    setQuestion(heard)
    if (askingRef.current) setHeardWaiting(heard)
    else void ask(heard)
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
        {heardWaiting !== null && question === heardWaiting ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" data-testid="demo-assistant-heard-waiting">{S.voiceHeardWaiting(S.assistantAsk)}</p>
        ) : null}
      </form>

      {voiceEnabled ? (
        <DemoAssistantVoice
          token={token}
          stepId={snapshot.stepId}
          busy={asking}
          exhausted={voiceExhausted}
          onMicrophoneChange={microphoneChanged}
          onHeard={heardQuestion}
          onRefused={refusedVoice}
        />
      ) : null}

      {turns.length > 0 && (
        <ol data-testid="demo-assistant-turns" className="mt-2 space-y-1.5">
          {turns.map((turn, index) => {
            const newest = index === turns.length - 1
            // The offer outlives navigation: once the prospect is in that
            // module, pressing it would open nothing, so it is not shown.
            const offered = turn.offer && moduleOfSection(snapshot.sectionId)?.id !== turn.offer.moduleId
              ? getDemoJourneyModule(turn.offer.moduleId)
              : null
            return (
              <li
                key={turn.id}
                {...(newest ? { role: "status", "aria-live": "polite" as const } : {})}
                className={cn("min-w-0 break-words rounded-md p-2.5 text-xs leading-relaxed [overflow-wrap:anywhere]", turn.who === "you" ? "ml-6 border border-zinc-200 dark:border-zinc-700" : "bg-muted/60")}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{turn.who === "you" ? S.assistantYou : S.assistantGuide}</span>
                {turn.text}
                {newest && turn.offer && offered ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-auto min-h-7 w-full whitespace-normal py-1 text-xs"
                    onClick={() => {
                      const offer = turn.offer
                      if (!offer || !onAction) return
                      setTurns((current) => current.map((candidate) => (candidate.id === turn.id ? { ...candidate, offer: undefined } : candidate)))
                      onAction(offer, `${snapshot.sectionId}:${snapshot.stepId}`)
                    }}
                  >
                    {S.assistantOpenModule(offered.title)}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">{error}</p>
      )}
      {voiceNote && !voiceExhausted ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground" data-testid="demo-assistant-voice-note">{voiceNote}</p>
      ) : null}
      {voiceEnabled && voice?.on ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{S.voiceAnswersNote}</p>
      ) : null}
    </div>
  )
}

/** How many questions and answers the box keeps on screen. */
const ASSISTANT_TURNS_SHOWN = 6

interface AssistantTurn {
  readonly id: string
  readonly who: "you" | "guide"
  readonly text: string
  /** The guide offers a jump the story moved past: pressed, it opens the module from where the prospect is then. */
  readonly offer?: Extract<DemoAssistantAction, { kind: "open_module" }>
}

/** What a chapter's clip plays from, or null when this viewer cannot be served it. */
export function introClipAssets(slug: string, status: "available" | "planned", token: string, variant: DemoJourneyVariant) {
  // The open demo's viewer is unverified, so it streams only the clips filmed
  // on the invented demo stand (public-clips.ts); a help-library clip in the
  // story stays behind a grant and the card says where to watch it.
  const openClip = variant === "open" && DEMO_PUBLIC_CLIP_SLUGS.has(slug)
  const entry = status === "available" && (variant !== "open" || openClip) ? getHelpVideoForSlug(slug, "az") : null
  if (!entry) return null
  if (variant === "preview") return getHelpVideoAsset(entry, "az")
  if (variant === "open") return { videoSrc: demoPublicClipUrl(slug, "video"), posterSrc: demoPublicClipUrl(slug, "poster") }
  return {
    videoSrc: `/api/v1/public/demo-access/${encodeURIComponent(token)}/video/${encodeURIComponent(`${slug}.az`)}.VOICE.mp4`,
    posterSrc: `/api/v1/public/demo-access/${encodeURIComponent(token)}/video/${encodeURIComponent(`${slug}.az`)}.poster.jpg`,
  }
}

/**
 * A chapter's one-minute clip, at the top of the product screen.
 *
 * It used to sit low in the guide's column, a 300px thumbnail under the step
 * card: the owner started one and left after five seconds, then asked why the
 * video was «at the bottom, on the right, where nobody looks» (2026-10-13).
 * Here it is the first thing on the chapter's first step — large, with the
 * button in words — and a single line on the later steps, so the product
 * screen is not pushed down for the whole chapter. Playing keeps it open.
 */
export function IntroClip({
  slug,
  caption,
  status,
  token,
  variant,
  compact = false,
  stepKey,
  onClipEvent,
}: {
  slug: string
  caption: string
  status: "available" | "planned"
  token: string
  variant: DemoJourneyVariant
  /** Past the chapter's first step: one line instead of the poster. */
  compact?: boolean
  /**
   * The step on screen. When it changes the clip pauses: the guide reads the
   * new step aloud, and the clip talking over it is what made prospects switch
   * the guide off for good (the switch is remembered).
   */
  stepKey?: string
  onClipEvent?: (name: DemoClipEvent) => void
}) {
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const shownStep = useRef(stepKey)
  useEffect(() => {
    if (shownStep.current === stepKey) return
    shownStep.current = stepKey
    videoRef.current?.pause()
  }, [stepKey])
  const assets = introClipAssets(slug, status, token, variant)
  if (!assets) return null
  const start = () => {
    setPlaying(true)
    onClipEvent?.("video.started")
  }

  if (playing) {
    return (
      <div data-testid="demo-intro-clip" className="mb-4 rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/50 dark:bg-orange-950/20">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-300">
          <PlayCircle className="h-4 w-4" aria-hidden="true" /> {S.clipTitle} · <span className="normal-case tracking-normal">{caption}</span>
        </p>
        {/* Sound only after the prospect asked for it; captions travel with the file. */}
        <video
          ref={videoRef}
          className="mt-3 w-full max-w-3xl rounded-lg"
          controls
          autoPlay
          poster={assets.posterSrc}
          src={assets.videoSrc}
          onEnded={() => onClipEvent?.("video.completed")}
          onError={() => onClipEvent?.("video.error")}
        />
      </div>
    )
  }

  if (compact) {
    return (
      <button
        type="button"
        data-testid="demo-intro-clip-play"
        onClick={start}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2 text-left text-sm transition-colors hover:bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20"
      >
        <PlayCircle className="h-4 w-4 shrink-0 text-[#FF4D00]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{caption}</span>
        <span className="shrink-0 font-semibold text-[#c2410c] dark:text-orange-300">{S.clipWatch}</span>
      </button>
    )
  }

  return (
    <div data-testid="demo-intro-clip" className="mb-4 rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/50 dark:bg-orange-950/20">
      {/* It has to read as a video at a glance: the owner looked at the
          poster alone on 2026-09-22 and did not guess it played. */}
      <button type="button" data-testid="demo-intro-clip-play" onClick={start} className="group flex w-full flex-col gap-4 text-left sm:flex-row sm:items-center">
        <span className="relative block overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 sm:w-80 sm:shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- poster from the help-video pipeline, sized by CSS */}
          <img src={assets.posterSrc} alt="" className="aspect-video w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors group-hover:bg-black/45">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FF4D00] text-white shadow-lg ring-4 ring-white/40 transition-transform group-hover:scale-105">
              <Play className="ml-0.5 h-6 w-6 fill-current" aria-hidden="true" />
            </span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-300">
            <PlayCircle className="h-4 w-4" aria-hidden="true" /> {S.clipTitle}
          </span>
          <span className="mt-1 block text-base font-semibold leading-snug">{caption}</span>
          <span className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#FF4D00] px-5 text-sm font-semibold text-white transition-colors group-hover:bg-[#e64500]">
            <Play className="h-4 w-4 fill-current" aria-hidden="true" /> {S.clipWatch}
          </span>
        </span>
      </button>
    </div>
  )
}
