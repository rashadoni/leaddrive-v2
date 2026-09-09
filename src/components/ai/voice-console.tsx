"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { FunctionCall, FunctionResponse, LiveServerMessage, Session as GeminiLiveSession } from "@google/genai"
import { usePathname, useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VOICE_TOOL_NAMES, type VoiceToolName } from "@/lib/ai/voice/read-tools"
import {
  diagnoseMicrophoneFailure,
  microphoneMessageKey,
  readMicrophoneEnvironment,
  type MicrophoneProblem,
} from "@/lib/ai/voice/microphone-diagnosis"
import {
  isVoiceSection,
  voiceSectionFromLocation,
  voiceSectionNavItem,
  voiceSectionPathFiltered,
  VOICE_SECTIONS,
  VOICE_SECTION_KEYS,
} from "@/lib/ai/voice/sections"
import { SECTION_FILTERS } from "@/lib/ai/voice/section-registry"
import { recordRoute } from "@/lib/ai/voice/record-types"
import { buildSectionInfo } from "@/lib/ai/voice/section-info"
import {
  base64Pcm16ToFloat32,
  geminiAudioParts,
  geminiFunctionCalls,
  geminiFunctionResponse,
  geminiInputTranscript,
  GEMINI_CAPTURE_WORKLET_URL,
  GEMINI_INPUT_SAMPLE_RATE,
  GEMINI_OUTPUT_SAMPLE_RATE,
  GEMINI_PLAYBACK_WORKLET_URL,
  pcm16ToBase64,
} from "@/lib/ai/voice/gemini-live-browser"
import { navItemPathname } from "@/lib/nav-items"

/**
 * Gemini-only browser voice console.
 *
 * Audio travels directly between the authenticated browser and Gemini Live by
 * WebSocket. LeadDrive's backend mints a one-use constrained token; its
 * long-lived Gemini key never reaches the browser. CRM tools still execute in
 * this tab with the user's same-origin cookie, so RBAC/RLS remain authoritative.
 */

const UNAVAILABLE =
  "DATA_UNAVAILABLE: нет связи с CRM. Скажи, что данных сейчас нет, и не называй никаких цифр."
const TOOL_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 8_000
const FIRST_RESPONSE_TIMEOUT_MS = 18_000
const RESPONSE_PROGRESS_TIMEOUT_MS = 30_000
const RESPONSE_STALL_GRACE_MS = 12_000
const MAX_UTTERANCE_MS = 45_000
const IDLE_STOP_MS = 60_000
const IDLE_CHECK_MS = 5_000
const MIC_SILENCE_WARN_MS = 10_000
const TRANSCRIPT_PREVIEW_LIMIT = 180
const MAX_RECONNECT_ATTEMPTS = 2
const PLAYBACK_BUFFER_SECONDS = 30
const GO_AWAY_SAFETY_MARGIN_MS = 500
const LIVE_CONNECT_TIMEOUT_MS = 15_000

const TRACE_ARG_KEYS: Readonly<Record<string, readonly string[]>> = {
  navigate_to_section: ["section", "filter"],
  find_record: ["type", "query"],
  open_record: ["type", "id"],
  get_current_screen: [],
  voice_gemini_error: ["code"],
  voice_transcription: ["status"],
}

function traceArgumentKeys(tool: string, args: unknown): string[] {
  const allowed = TRACE_ARG_KEYS[tool] ?? []
  if (!args || typeof args !== "object" || Array.isArray(args)) return []
  return allowed.filter((key) => Object.prototype.hasOwnProperty.call(args, key))
}

function durationMilliseconds(duration: string | undefined): number | null {
  if (!duration) return null
  const match = duration.match(/^(\d+(?:\.\d+)?)s$/)
  if (!match) return null
  const milliseconds = Number(match[1]) * 1_000
  return Number.isFinite(milliseconds) ? milliseconds : null
}

type Variant = "page" | "orb"
type VoiceUiPhase = "listening" | "user_speaking" | "processing" | "responding"

type SessionInfo = {
  voiceSessionId: string
  maxSessionSeconds: number
  heartbeatIntervalSeconds: number
  remainingSeconds: number
  firstName?: string
  allowedSections: string[]
}

type TokenInfo = {
  token: string
  expiresAt: string
  model: string
  apiVersion: string
  connectionId: string
}

type AudioPipeline = {
  captureContext: AudioContext
  playbackContext: AudioContext
  captureNode: AudioWorkletNode
  playbackNode: AudioWorkletNode
  source: MediaStreamAudioSourceNode
  silentGain: GainNode
}

async function settleVoiceSession(
  session: SessionInfo,
  startedAtMs: number,
  reason: string,
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SETTLE_TIMEOUT_MS)
  try {
    await fetch("/api/v1/ai/voice/session/end", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceSessionId: session.voiceSessionId,
        elapsedSeconds: Math.max(0, Math.ceil((Date.now() - startedAtMs) / 1000)),
        reason,
      }),
      keepalive: true,
      signal: controller.signal,
    }).catch(() => {})
  } finally {
    clearTimeout(timeout)
  }
}

function voiceLanguage(locale: string): "en" | "ru" | "az" {
  const base = locale.split("-")[0]?.toLowerCase()
  return base === "en" || base === "ru" || base === "az" ? base : "az"
}

async function withDeadline<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), START_TIMEOUT_MS)
  try {
    return await task(controller.signal)
  } finally {
    window.clearTimeout(timeout)
  }
}

function ConsoleInner({
  variant,
  autoStart,
  showFloatingOrb,
  orbPortalTarget,
}: {
  variant: Variant
  autoStart: boolean
  showFloatingOrb: boolean
  orbPortalTarget: HTMLElement | null
}) {
  const t = useTranslations("voice")
  const tNavLabel = useTranslations("nav")
  const tNav = useTranslations("navDesc")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [active, setActive] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [phase, setPhase] = useState<VoiceUiPhase>("listening")
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const [transcriptionWarning, setTranscriptionWarning] = useState(false)
  const [micSilent, setMicSilent] = useState(false)

  const sessionRef = useRef<SessionInfo | null>(null)
  const liveSessionRef = useRef<GeminiLiveSession | null>(null)
  const credentialRef = useRef<TokenInfo | null>(null)
  const resumptionHandleRef = useRef<string | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectingRef = useRef(false)
  const pendingReconnectRef = useRef<{
    cause: string
    failedSession: GeminiLiveSession
    generation: number
  } | null>(null)
  const pendingReconnectTimerRef = useRef<number | null>(null)
  const lostSpeechDuringReconnectRef = useRef(false)
  const reconnectGeminiRef = useRef<(
    cause: string,
    failedSession: GeminiLiveSession,
    generation: number,
  ) => void>(() => {})
  const tryDeferredReconnectRef = useRef<() => void>(() => {})
  const streamRef = useRef<MediaStream | null>(null)
  const audioPipelineRef = useRef<AudioPipeline | null>(null)
  const micMeterRef = useRef<{ context: AudioContext; timer: number; source: MediaStreamAudioSourceNode } | null>(null)
  const generationRef = useRef(0)
  const startedAtRef = useRef(0)
  const lastActivityRef = useRef(0)
  const failureStreakRef = useRef(0)
  const speechActiveRef = useRef(false)
  const responseWatchdogRef = useRef<number | null>(null)
  const utteranceWatchdogRef = useRef<number | null>(null)
  const nudgedRef = useRef(false)
  const transcriptDraftRef = useRef("")
  const handledToolCallsRef = useRef(new Set<string>())
  const inFlightToolCallsRef = useRef(new Set<string>())
  const pendingToolResponsesRef = useRef(new Map<string, FunctionResponse>())
  const cancelledToolCallsRef = useRef(new Set<string>())
  const flushPendingToolResponsesRef = useRef<(generation: number) => void>(() => {})
  const playbackActiveRef = useRef(false)
  const generationInProgressRef = useRef(false)
  const executeToolRef = useRef<(name: string, args: unknown) => Promise<string>>(async () => UNAVAILABLE)

  const trace = useCallback((tool: string, args: unknown, outcome: string) => {
    const current = sessionRef.current
    if (!current) return
    void fetch("/api/v1/ai/voice/trace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceSessionId: current.voiceSessionId,
        tool,
        args: { keys: traceArgumentKeys(tool, args) },
        outcome,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  const callTool = useCallback(async (tool: VoiceToolName, filter: unknown): Promise<string> => {
    const current = sessionRef.current
    if (!current) return UNAVAILABLE
    const generation = generationRef.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
    try {
      const response = await fetch("/api/v1/ai/voice/read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceSessionId: current.voiceSessionId, tool, filter: filter ?? {} }),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (generationRef.current === generation) failureStreakRef.current += 1
        return UNAVAILABLE
      }
      const body = await response.json()
      if (generationRef.current !== generation) return UNAVAILABLE
      failureStreakRef.current = 0
      return JSON.stringify(body.data)
    } catch {
      if (generationRef.current === generation) failureStreakRef.current += 1
      return UNAVAILABLE
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  const navigate = useCallback((args: unknown): string => {
    const input = (args ?? {}) as { section?: unknown; filter?: unknown }
    if (!isVoiceSection(input.section)) {
      trace("navigate_to_section", input, "unknown_section")
      return `UNKNOWN_SECTION: доступны только ${VOICE_SECTION_KEYS.join(", ")}. Скажи, что такого раздела нет.`
    }
    if (!(sessionRef.current?.allowedSections ?? []).includes(input.section)) {
      trace("navigate_to_section", input, "not_permitted")
      return "NOT_PERMITTED_FOR_ROLE: этот раздел недоступен вашей роли или организации. Скажи об этом и не открывай другой раздел вместо него."
    }
    const filter = typeof input.filter === "string" ? input.filter : undefined
    const query = filter && (filter === "overdue" || filter === "unassigned" || filter === "open")
      ? SECTION_FILTERS[input.section]?.[filter]
      : undefined
    const destination = voiceSectionPathFiltered(input.section, query)
    trace("navigate_to_section", { section: input.section, filter }, "ok")
    if (typeof window !== "undefined" && destination.includes("?") && navItemPathname(destination) === pathname) {
      window.history.pushState(window.history.state, "", destination)
      window.dispatchEvent(new PopStateEvent("popstate"))
    } else {
      router.push(destination)
    }
    if (filter && !query) {
      return `OK: открыт раздел ${input.section}, но отфильтровать его нельзя. Обязательно скажи, что показал раздел целиком, а не только «${filter}».`
    }
    return `OK: открыт раздел ${input.section}${query ? " с фильтром" : ""}. Продолжай говорить — экран уже переключён.`
  }, [pathname, router, trace])

  const currentScreen = useCallback((): string => {
    const here = pathname || "/"
    const search = typeof window === "undefined" ? "" : window.location.search
    const sectionKey = voiceSectionFromLocation(here, search)
    if (!sectionKey) return JSON.stringify({ path: here, section: null, note: "Раздел не опознан — скажи адрес страницы." })
    if (!(sessionRef.current?.allowedSections ?? []).includes(sectionKey)) {
      return JSON.stringify({ path: here, section: null, note: "NOT_PERMITTED_FOR_ROLE: текущий раздел недоступен голосовому помощнику." })
    }
    const navKey = voiceSectionNavItem(sectionKey)?.tKey ?? sectionKey
    const info = buildSectionInfo(sectionKey, { summary: tNav.has(navKey) ? tNav(navKey) : undefined })
    return JSON.stringify({
      ...info,
      onRecordPage: here !== navItemPathname(VOICE_SECTIONS[sectionKey]),
      label: tNavLabel.has(navKey) ? tNavLabel(navKey) : sectionKey,
    })
  }, [pathname, tNav, tNavLabel])

  const openRecord = useCallback((args: unknown): string => {
    const input = (args ?? {}) as { type?: unknown; id?: unknown }
    const id = typeof input.id === "string" ? input.id : ""
    const path = /^[A-Za-z0-9_-]{6,64}$/.test(id) ? recordRoute(String(input.type), id) : null
    if (!path) {
      trace("open_record", input, "bad_record")
      return "BAD_RECORD: не понял, что открыть. Уточни у пользователя и найди запись заново."
    }
    trace("open_record", { type: input.type }, "ok")
    router.push(path)
    return "OK: запись открыта на экране. Расскажи о ней и продолжай."
  }, [router, trace])

  const executeTool = useCallback(async (name: string, args: unknown): Promise<string> => {
    if (name === "navigate_to_section") return navigate(args)
    if (name === "get_current_screen") return currentScreen()
    if (name === "open_record") return openRecord(args)
    if ((VOICE_TOOL_NAMES as readonly string[]).includes(name)) return callTool(name as VoiceToolName, args)
    return "UNKNOWN_TOOL: this tool is not available."
  }, [callTool, currentScreen, navigate, openRecord])
  executeToolRef.current = executeTool

  const clearResponseWatchdog = useCallback(() => {
    if (responseWatchdogRef.current !== null) window.clearTimeout(responseWatchdogRef.current)
    responseWatchdogRef.current = null
  }, [])

  const clearUtteranceWatchdog = useCallback(() => {
    if (utteranceWatchdogRef.current !== null) window.clearTimeout(utteranceWatchdogRef.current)
    utteranceWatchdogRef.current = null
  }, [])

  const stopMicMeter = useCallback(() => {
    const meter = micMeterRef.current
    if (meter) {
      window.clearInterval(meter.timer)
      try { meter.source.disconnect() } catch { /* already disconnected */ }
      void meter.context.close().catch(() => {})
    }
    micMeterRef.current = null
    setMicSilent(false)
  }, [])

  const startMicMeter = useCallback((stream: MediaStream) => {
    stopMicMeter()
    try {
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const buffer = new Uint8Array(analyser.frequencyBinCount)
      let silentSince: number | null = null
      void context.resume().catch(() => {})
      const timer = window.setInterval(() => {
        if (context.state !== "running") return
        analyser.getByteTimeDomainData(buffer)
        if (buffer.some((sample) => sample !== 128)) {
          silentSince = null
          setMicSilent(false)
        } else if (silentSince === null) {
          silentSince = Date.now()
        } else if (Date.now() - silentSince >= MIC_SILENCE_WARN_MS) {
          setMicSilent(true)
        }
      }, 1_000)
      micMeterRef.current = { context, timer, source }
    } catch {
      // Meter failure removes only the warning; it never ends a conversation.
    }
  }, [stopMicMeter])

  const closeMedia = useCallback(() => {
    clearResponseWatchdog()
    clearUtteranceWatchdog()
    stopMicMeter()
    try { liveSessionRef.current?.sendRealtimeInput({ audioStreamEnd: true }) } catch { /* socket already closed */ }
    try { liveSessionRef.current?.close() } catch { /* socket already closed */ }
    liveSessionRef.current = null
    credentialRef.current = null
    resumptionHandleRef.current = null
    reconnectAttemptsRef.current = 0
    reconnectingRef.current = false
    pendingReconnectRef.current = null
    if (pendingReconnectTimerRef.current !== null) window.clearTimeout(pendingReconnectTimerRef.current)
    pendingReconnectTimerRef.current = null
    lostSpeechDuringReconnectRef.current = false
    const pipeline = audioPipelineRef.current
    audioPipelineRef.current = null
    if (pipeline) {
      try { pipeline.source.disconnect() } catch { /* already disconnected */ }
      try { pipeline.captureNode.disconnect() } catch { /* already disconnected */ }
      try { pipeline.playbackNode.disconnect() } catch { /* already disconnected */ }
      void pipeline.captureContext.close().catch(() => {})
      void pipeline.playbackContext.close().catch(() => {})
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    speechActiveRef.current = false
    nudgedRef.current = false
    transcriptDraftRef.current = ""
    handledToolCallsRef.current.clear()
    inFlightToolCallsRef.current.clear()
    pendingToolResponsesRef.current.clear()
    cancelledToolCallsRef.current.clear()
    playbackActiveRef.current = false
    generationInProgressRef.current = false
    setActive(false)
    setIsSpeaking(false)
    setPhase("listening")
    setLastTranscript(null)
    setTranscriptionWarning(false)
  }, [clearResponseWatchdog, clearUtteranceWatchdog, stopMicMeter])

  const stop = useCallback(async (reason: string, stopNotice?: string) => {
    const current = sessionRef.current
    const expectedGeneration = generationRef.current
    generationRef.current += 1
    sessionRef.current = null
    setSession(null)
    setStarting(false)
    closeMedia()
    if (stopNotice && generationRef.current === expectedGeneration + 1) setNotice(stopNotice)
    if (current) await settleVoiceSession(current, startedAtRef.current, reason)
  }, [closeMedia])

  const failConversation = useCallback(async (
    message: string,
    reason: string,
    traceCode?: string,
    expectedGeneration = generationRef.current,
  ) => {
    if (!sessionRef.current || generationRef.current !== expectedGeneration) return
    if (traceCode) trace("voice_gemini_error", { code: traceCode }, reason)
    const stopping = stop(reason)
    if (!sessionRef.current && generationRef.current === expectedGeneration + 1) setError(message)
    await stopping.catch(() => {})
  }, [stop, trace])

  const armResponseWatchdog = useCallback((delayMs = FIRST_RESPONSE_TIMEOUT_MS) => {
    clearResponseWatchdog()
    const generation = generationRef.current
    responseWatchdogRef.current = window.setTimeout(() => {
      responseWatchdogRef.current = null
      if (generationRef.current !== generation || !sessionRef.current) return
      if (!nudgedRef.current && liveSessionRef.current) {
        nudgedRef.current = true
        trace("voice_gemini_error", { code: "response_stalled" }, "nudging")
        liveSessionRef.current.sendRealtimeInput({ text: "Answer the user's latest request now, briefly." })
        setPhase("processing")
        armResponseWatchdog(RESPONSE_STALL_GRACE_MS)
        return
      }
      void failConversation(t("noResponse"), "response_timeout", "response_timeout", generation)
    }, delayMs)
  }, [clearResponseWatchdog, failConversation, t, trace])

  const armUtteranceWatchdog = useCallback(() => {
    clearUtteranceWatchdog()
    const generation = generationRef.current
    utteranceWatchdogRef.current = window.setTimeout(() => {
      if (generationRef.current === generation && speechActiveRef.current) {
        void failConversation(t("noResponse"), "speech_timeout", "speech_timeout", generation)
      }
    }, MAX_UTTERANCE_MS * 2)
  }, [clearUtteranceWatchdog, failConversation, t])

  const runToolCalls = useCallback(async (
    calls: FunctionCall[],
    generation: number,
  ) => {
    const pending = calls.filter((call) => {
      const id = call.id ?? ""
      if (
        !id
        || handledToolCallsRef.current.has(id)
        || inFlightToolCallsRef.current.has(id)
        || pendingToolResponsesRef.current.has(id)
      ) return false
      inFlightToolCallsRef.current.add(id)
      return true
    })
    if (pending.length === 0) return
    clearResponseWatchdog()
    setPhase("processing")
    lastActivityRef.current = Date.now()
    const responses = await Promise.all(pending.map(async (call) => {
      const id = call.id ?? ""
      try {
        if (cancelledToolCallsRef.current.has(id)) return null
        const output = await executeToolRef.current(call.name ?? "", call.args ?? {})
        if (cancelledToolCallsRef.current.has(id) || generationRef.current !== generation) return null
        return geminiFunctionResponse(call, output)
      } finally {
        inFlightToolCallsRef.current.delete(id)
      }
    }))
    if (generationRef.current !== generation || !sessionRef.current) return
    const activeResponses = responses.filter((response) => response !== null)
    for (const response of activeResponses) {
      if (response.id) pendingToolResponsesRef.current.set(response.id, response)
    }
    flushPendingToolResponsesRef.current(generation)
    tryDeferredReconnectRef.current()
  }, [clearResponseWatchdog])

  const flushPendingToolResponses = useCallback((generation: number) => {
    if (generationRef.current !== generation || !sessionRef.current || reconnectingRef.current) return
    const live = liveSessionRef.current
    if (!live) return
    const entries = [...pendingToolResponsesRef.current.entries()].filter(
      ([id]) => !cancelledToolCallsRef.current.has(id),
    )
    if (entries.length === 0) return
    try {
      live.sendToolResponse({ functionResponses: entries.map(([, response]) => response) })
    } catch {
      return
    }
    for (const [id] of entries) {
      pendingToolResponsesRef.current.delete(id)
      handledToolCallsRef.current.add(id)
    }
    armResponseWatchdog(RESPONSE_PROGRESS_TIMEOUT_MS)
  }, [armResponseWatchdog])
  flushPendingToolResponsesRef.current = flushPendingToolResponses

  const handleGeminiMessage = useCallback((
    message: LiveServerMessage,
    live: GeminiLiveSession,
    generation: number,
  ) => {
    if (generationRef.current !== generation || liveSessionRef.current !== live) return
    lastActivityRef.current = Date.now()

    // Any new model generation or function call invalidates an older
    // checkpoint locally, even if a resumable:false update is lost with an
    // abrupt socket close. Only a true handle delivered in this or a later
    // event may be used for reconnect.
    if (message.serverContent?.modelTurn || (message.toolCall?.functionCalls?.length ?? 0) > 0) {
      resumptionHandleRef.current = null
      generationInProgressRef.current = true
    }

    const resumption = message.sessionResumptionUpdate
    if (resumption?.resumable === true && resumption.newHandle) {
      resumptionHandleRef.current = resumption.newHandle
      tryDeferredReconnectRef.current()
    } else if (resumption?.resumable === false) {
      resumptionHandleRef.current = null
    }

    const cancellationIds = message.toolCallCancellation?.ids ?? []
    cancellationIds.forEach((id) => {
      cancelledToolCallsRef.current.add(id)
      pendingToolResponsesRef.current.delete(id)
    })

    const transcript = geminiInputTranscript(message)
    if (transcript) {
      transcriptDraftRef.current = `${transcriptDraftRef.current}${transcript.text}`.slice(-TRANSCRIPT_PREVIEW_LIMIT)
      setTranscriptionWarning(false)
      if (transcript.finished) {
        const text = transcriptDraftRef.current.trim()
        setLastTranscript(text ? text.slice(0, TRANSCRIPT_PREVIEW_LIMIT) : null)
        transcriptDraftRef.current = ""
      }
    }

    if (message.serverContent?.interrupted) {
      audioPipelineRef.current?.playbackNode.port.postMessage({ type: "interrupt", generation })
      playbackActiveRef.current = false
      generationInProgressRef.current = false
      setIsSpeaking(false)
      setPhase(speechActiveRef.current ? "user_speaking" : "listening")
      clearResponseWatchdog()
    }

    let decodedParts: Float32Array[]
    try {
      decodedParts = geminiAudioParts(message).map((part) => base64Pcm16ToFloat32(part.data))
    } catch {
      void failConversation(
        t("connectionLost"),
        "invalid_audio_payload",
        "invalid_audio_payload",
        generation,
      )
      return
    }
    if (decodedParts.length > 0) {
      playbackActiveRef.current = true
      generationInProgressRef.current = true
      nudgedRef.current = false
      setIsSpeaking(true)
      setPhase("responding")
      armResponseWatchdog(RESPONSE_PROGRESS_TIMEOUT_MS)
      for (const samples of decodedParts) {
        audioPipelineRef.current?.playbackNode.port.postMessage(
          { type: "audio", samples, generation },
          [samples.buffer],
        )
      }
    }

    const calls = geminiFunctionCalls(message)
    if (calls.length > 0) {
      generationInProgressRef.current = true
      void runToolCalls(calls, generation)
    }

    if (message.serverContent?.generationComplete) {
      generationInProgressRef.current = false
      tryDeferredReconnectRef.current()
    }

    if (message.serverContent?.turnComplete) {
      generationInProgressRef.current = false
      clearResponseWatchdog()
      nudgedRef.current = false
      setPhase(speechActiveRef.current ? "user_speaking" : "listening")
      tryDeferredReconnectRef.current()
    }

    if (message.goAway) {
      const remaining = durationMilliseconds(message.goAway.timeLeft)
      pendingReconnectRef.current = { cause: "go_away", failedSession: live, generation }
      if (pendingReconnectTimerRef.current !== null) window.clearTimeout(pendingReconnectTimerRef.current)
      pendingReconnectTimerRef.current = window.setTimeout(() => {
        pendingReconnectTimerRef.current = null
        const deferred = pendingReconnectRef.current
        if (!deferred) return
        if (
          resumptionHandleRef.current
          && !generationInProgressRef.current
          && inFlightToolCallsRef.current.size === 0
        ) {
          tryDeferredReconnectRef.current()
          return
        }
        pendingReconnectRef.current = null
        void failConversation(
          t("connectionLost"),
          "gemini_resumption_checkpoint_timeout",
          "go_away_checkpoint_timeout",
          deferred.generation,
        )
      }, Math.max(0, (remaining ?? TOOL_TIMEOUT_MS) - GO_AWAY_SAFETY_MARGIN_MS))
      tryDeferredReconnectRef.current()
    }
  }, [armResponseWatchdog, clearResponseWatchdog, failConversation, runToolCalls, t])

  const prepareAudio = useCallback(async (
    stream: MediaStream,
    generation: number,
  ): Promise<AudioPipeline> => {
    const captureContext = new AudioContext({ sampleRate: GEMINI_INPUT_SAMPLE_RATE })
    const playbackContext = new AudioContext({ sampleRate: GEMINI_OUTPUT_SAMPLE_RATE })
    await Promise.all([
      captureContext.audioWorklet.addModule(GEMINI_CAPTURE_WORKLET_URL),
      playbackContext.audioWorklet.addModule(GEMINI_PLAYBACK_WORKLET_URL),
    ])
    await Promise.all([captureContext.resume(), playbackContext.resume()])
    const source = captureContext.createMediaStreamSource(stream)
    const captureNode = new AudioWorkletNode(captureContext, "gemini-live-capture", {
      processorOptions: { targetSampleRate: GEMINI_INPUT_SAMPLE_RATE },
    })
    const playbackNode = new AudioWorkletNode(playbackContext, "gemini-live-playback", {
      processorOptions: {
        sourceSampleRate: GEMINI_OUTPUT_SAMPLE_RATE,
        maxBufferedSeconds: PLAYBACK_BUFFER_SECONDS,
        generation,
      },
    })
    const silentGain = captureContext.createGain()
    silentGain.gain.value = 0
    source.connect(captureNode)
    captureNode.connect(silentGain)
    silentGain.connect(captureContext.destination)
    playbackNode.connect(playbackContext.destination)

    captureNode.port.onmessage = (event) => {
      if (generationRef.current !== generation || !sessionRef.current) return
      if (event.data?.type === "audio" && event.data.samples instanceof Float32Array) {
        if (reconnectingRef.current) {
          if (speechActiveRef.current) lostSpeechDuringReconnectRef.current = true
          return
        }
        try {
          liveSessionRef.current?.sendRealtimeInput({
            audio: {
              data: pcm16ToBase64(event.data.samples),
              mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`,
            },
          })
        } catch {
          // onerror/onclose owns terminal transport handling.
        }
      } else if (event.data?.type === "activity") {
        speechActiveRef.current = event.data.active === true
        lastActivityRef.current = Date.now()
        if (speechActiveRef.current) {
          playbackNode.port.postMessage({ type: "interrupt", generation })
          playbackActiveRef.current = false
          setIsSpeaking(false)
          clearResponseWatchdog()
          armUtteranceWatchdog()
          setLastTranscript(null)
          setPhase("user_speaking")
        } else {
          clearUtteranceWatchdog()
          if (lostSpeechDuringReconnectRef.current && !reconnectingRef.current && liveSessionRef.current) {
            lostSpeechDuringReconnectRef.current = false
            liveSessionRef.current.sendRealtimeInput({
              text: "The connection briefly interrupted the user's speech. Apologize in the current language and ask them to repeat only their last sentence.",
            })
            setPhase("processing")
            armResponseWatchdog()
            return
          }
          setPhase("processing")
          armResponseWatchdog()
        }
      }
    }
    playbackNode.port.onmessage = (event) => {
      if (generationRef.current !== generation || event.data?.generation !== generation) return
      if (event.data?.type === "drained") {
        playbackActiveRef.current = false
        setIsSpeaking(false)
      }
      if (event.data?.type === "overflow") {
        // The playback buffer grows with the answer, so this now means ten
        // minutes of speech never drained — a broken stream, not a long reply.
        // The tail is dropped; the conversation continues. Ending the call here
        // is exactly what cut a detailed analytics answer off mid-sentence.
        trace("voice_gemini_error", { code: "playback_overflow" }, "tail_dropped")
      }
    }
    playbackNode.port.postMessage({ type: "reset", generation })
    return { captureContext, playbackContext, captureNode, playbackNode, source, silentGain }
  }, [armResponseWatchdog, armUtteranceWatchdog, clearResponseWatchdog, clearUtteranceWatchdog, failConversation, t, trace])

  const connectGemini = useCallback(async (
    credential: TokenInfo,
    generation: number,
    resumeHandle?: string,
  ): Promise<GeminiLiveSession> => {
    const { GoogleGenAI } = await import("@google/genai")
    const ai = new GoogleGenAI({
      apiKey: credential.token,
      httpOptions: { apiVersion: credential.apiVersion },
    })
    let connected: GeminiLiveSession | null = null
    let rejectBeforeSetup: ((reason: Error) => void) | null = null
    const failedBeforeSetup = new Promise<never>((_resolve, reject) => {
      rejectBeforeSetup = reject
    })
    const connectPromise = ai.live.connect({
      model: credential.model,
      config: { sessionResumption: resumeHandle ? { handle: resumeHandle } : {} },
      callbacks: {
        onopen: () => {},
        onmessage: (message) => {
          if (connected) handleGeminiMessage(message, connected, generation)
        },
        onerror: () => {
          if (connected) reconnectGeminiRef.current("socket_error", connected, generation)
          else rejectBeforeSetup?.(new Error("Gemini Live errored before setupComplete"))
        },
        onclose: () => {
          if (connected) reconnectGeminiRef.current("socket_closed", connected, generation)
          else rejectBeforeSetup?.(new Error("Gemini Live closed before setupComplete"))
        },
      },
    })
    // The SDK resolves only after setupComplete, but provider close/error does
    // not reject that promise. Race it explicitly and close a session that
    // resolves after our bounded timeout so no orphan socket survives.
    let timeoutId: number | null = null
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("Gemini Live setupComplete timed out")),
        LIVE_CONNECT_TIMEOUT_MS,
      )
    })
    try {
      connected = await Promise.race([connectPromise, failedBeforeSetup, timedOut])
      return connected
    } catch (error) {
      void connectPromise.then((late) => late.close()).catch(() => {})
      throw error
    } finally {
      rejectBeforeSetup = null
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [handleGeminiMessage])

  const reconnectGemini = useCallback((
    cause: string,
    failedSession: GeminiLiveSession,
    generation: number,
  ) => {
    if (
      generationRef.current !== generation
      || !sessionRef.current
      || liveSessionRef.current !== failedSession
      || reconnectingRef.current
    ) return
    const credential = credentialRef.current
    const handle = resumptionHandleRef.current
    if (
      !credential
      || !handle
      || generationInProgressRef.current
      || inFlightToolCallsRef.current.size > 0
      || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
    ) {
      void failConversation(t("connectionLost"), "gemini_reconnect_exhausted", cause, generation)
      return
    }
    reconnectingRef.current = true
    pendingReconnectRef.current = null
    if (pendingReconnectTimerRef.current !== null) window.clearTimeout(pendingReconnectTimerRef.current)
    pendingReconnectTimerRef.current = null
    reconnectAttemptsRef.current += 1
    if (speechActiveRef.current) lostSpeechDuringReconnectRef.current = true
    clearResponseWatchdog()
    if (!playbackActiveRef.current) {
      setPhase("processing")
    }
    void connectGemini(credential, generation, handle).then((resumed) => {
      if (generationRef.current !== generation || !sessionRef.current) {
        resumed.close()
        return
      }
      const previous = liveSessionRef.current
      liveSessionRef.current = resumed
      reconnectingRef.current = false
      reconnectAttemptsRef.current = 0
      lastActivityRef.current = Date.now()
      if (previous !== resumed) {
        try { previous?.close() } catch { /* old socket is already closing */ }
      }
      setActive(true)
      setPhase(speechActiveRef.current
        ? "user_speaking"
        : playbackActiveRef.current
          ? "responding"
          : "listening")
      flushPendingToolResponsesRef.current(generation)
      if (lostSpeechDuringReconnectRef.current && !speechActiveRef.current) {
        lostSpeechDuringReconnectRef.current = false
        resumed.sendRealtimeInput({
          text: "The connection briefly interrupted the user's speech. Apologize in the current language and ask them to repeat only their last sentence.",
        })
        setPhase("processing")
        armResponseWatchdog()
      }
    }).catch(() => {
      reconnectingRef.current = false
      if (generationRef.current !== generation || !sessionRef.current) return
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        window.setTimeout(() => reconnectGeminiRef.current(cause, failedSession, generation), 250)
        return
      }
      void failConversation(t("connectionLost"), "gemini_reconnect_failed", cause, generation)
    })
  }, [armResponseWatchdog, clearResponseWatchdog, connectGemini, failConversation, t])
  reconnectGeminiRef.current = reconnectGemini

  const tryDeferredReconnect = useCallback(() => {
    const deferred = pendingReconnectRef.current
    if (
      !deferred
      || !resumptionHandleRef.current
      || generationInProgressRef.current
      || inFlightToolCallsRef.current.size > 0
    ) return
    pendingReconnectRef.current = null
    if (pendingReconnectTimerRef.current !== null) window.clearTimeout(pendingReconnectTimerRef.current)
    pendingReconnectTimerRef.current = null
    reconnectGeminiRef.current(deferred.cause, deferred.failedSession, deferred.generation)
  }, [])
  tryDeferredReconnectRef.current = tryDeferredReconnect

  const start = useCallback(async () => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setError(null)
    setNotice(null)
    setStarting(true)
    // Set only where the microphone is actually asked for. The try below wraps
    // the whole start sequence - session row, provider token, websocket,
    // worklets - and any of those can fail for reasons that have nothing to do
    // with the microphone.
    let micProblem: MicrophoneProblem | null = null
    try {
      const started = await withDeadline(async (signal) => {
        const response = await fetch("/api/v1/ai/voice/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-locale": locale },
          body: "{}",
          signal,
        })
        const body = await response.json()
        if (!response.ok) throw Object.assign(new Error("session rejected"), { body })
        return (body as { data: SessionInfo }).data
      })
      if (generationRef.current !== generation) {
        void settleVoiceSession(started, Date.now(), "start_cancelled")
        return
      }
      sessionRef.current = started
      setSession(started)
      startedAtRef.current = Date.now()
      lastActivityRef.current = Number.POSITIVE_INFINITY
      failureStreakRef.current = 0

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch (caught) {
        // Diagnosed here rather than in the outer handler, because only here is
        // the microphone provably the thing that failed. The insecure-context
        // branch in particular has to see the failure of THIS call: on an
        // http:// page navigator.mediaDevices is absent, so the throw is a
        // TypeError with no error name to recognise, and applying that test to
        // any other failure reported a provider timeout as "this page is not
        // served over https".
        micProblem = diagnoseMicrophoneFailure(caught, await readMicrophoneEnvironment())
        throw caught
      }
      if (generationRef.current !== generation || sessionRef.current !== started) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      startMicMeter(stream)

      const credential = await withDeadline(async (signal) => {
        const response = await fetch("/api/v1/ai/voice/session/token", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voiceSessionId: started.voiceSessionId }),
          signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error("Gemini token mint failed")
        return (body as { data: TokenInfo }).data
      })
      if (generationRef.current !== generation || sessionRef.current !== started) return

      credentialRef.current = credential
      resumptionHandleRef.current = null
      reconnectAttemptsRef.current = 0
      const connected = await connectGemini(credential, generation)
      if (generationRef.current !== generation || sessionRef.current !== started) {
        connected.close()
        return
      }
      liveSessionRef.current = connected
      await withDeadline(async (signal) => {
        const response = await fetch("/api/v1/ai/voice/session/connected", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voiceSessionId: started.voiceSessionId,
            connectionId: credential.connectionId,
          }),
          signal,
        })
        if (!response.ok) throw new Error("Gemini connection confirmation failed")
      })
      const pipeline = await prepareAudio(stream, generation)
      if (generationRef.current !== generation || sessionRef.current !== started) {
        await Promise.all([pipeline.captureContext.close(), pipeline.playbackContext.close()])
        connected.close()
        return
      }
      audioPipelineRef.current = pipeline
      lastActivityRef.current = Date.now()
      setActive(true)
      setPhase("processing")
      connected.sendRealtimeInput({
        text: `Greet the user briefly in ${voiceLanguage(locale)}${started.firstName ? ` and address them as ${started.firstName}` : ""}.`,
      })
      armResponseWatchdog()
    } catch (caught) {
      if (generationRef.current !== generation) return
      const providerBody = (caught as { body?: { error?: unknown } } | null)?.body
      const stopPromise = stop("start_failed")
      if (generationRef.current === generation + 1 && !sessionRef.current) {
        const message = providerBody?.error === "Voice budget exhausted"
          ? t("budgetExhausted")
          : micProblem
            ? t(microphoneMessageKey(micProblem))
            : t("startFailed")
        setError(message)
        setStarting(false)
      }
      await stopPromise.catch(() => {})
    } finally {
      if (generationRef.current === generation) setStarting(false)
    }
  }, [armResponseWatchdog, connectGemini, locale, prepareAudio, startMicMeter, stop, t])

  useEffect(() => {
    if (!session) return
    const generation = generationRef.current
    const isCurrent = () => generationRef.current === generation && sessionRef.current?.voiceSessionId === session.voiceSessionId
    const heartbeat = window.setInterval(() => {
      if (!isCurrent()) return
      void fetch("/api/v1/ai/voice/session/heartbeat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceSessionId: session.voiceSessionId }),
      }).then((response) => {
        if (response.status === 409 && isCurrent()) void stop("server_closed", t("connectionLost"))
      }).catch(() => {})
      if (failureStreakRef.current >= 2 && isCurrent()) void stop("tool_failures", t("crmUnreachable"))
    }, session.heartbeatIntervalSeconds * 1000)
    const ceiling = window.setTimeout(() => {
      if (isCurrent()) void stop("max_duration", t("sessionLimit"))
    }, session.maxSessionSeconds * 1000)
    const idle = window.setInterval(() => {
      if (!isCurrent() || speechActiveRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_STOP_MS) void stop("idle", t("idleStopped"))
    }, IDLE_CHECK_MS)
    return () => {
      window.clearInterval(heartbeat)
      window.clearTimeout(ceiling)
      window.clearInterval(idle)
    }
  }, [session, stop, t])

  const armedOnce = useRef(false)
  useEffect(() => {
    if (!autoStart || armedOnce.current) return
    armedOnce.current = true
    void start()
  }, [autoStart, start])

  useEffect(() => {
    const tearDown = () => {
      generationRef.current += 1
      const current = sessionRef.current
      sessionRef.current = null
      closeMedia()
      if (!current) return
      const elapsedSeconds = Math.ceil((Date.now() - startedAtRef.current) / 1000)
      const accepted = navigator.sendBeacon?.(
        "/api/v1/ai/voice/session/end",
        new Blob([JSON.stringify({ voiceSessionId: current.voiceSessionId, elapsedSeconds })], { type: "application/json" }),
      )
      if (accepted !== true) void settleVoiceSession(current, startedAtRef.current, "page_unload")
    }
    window.addEventListener("pagehide", tearDown)
    return () => {
      window.removeEventListener("pagehide", tearDown)
      tearDown()
    }
  }, [closeMedia])

  const label = error
    ? error
    : starting
      ? t("connecting")
      : !active
        ? notice ?? t("idle")
        : isSpeaking
          ? t("speaking")
          : phase === "user_speaking"
            ? t("hearing")
            : phase === "processing" || phase === "responding"
              ? t("processing")
              : t("listening")

  if (variant === "orb") {
    const tone = error
      ? "bg-destructive shadow-destructive/40"
      : starting
        ? "bg-amber-500 shadow-amber-500/40"
        : !active
          ? "bg-muted-foreground/70 shadow-black/20"
          : isSpeaking
            ? "bg-primary shadow-primary/50"
            : phase === "user_speaking"
              ? "bg-sky-500 shadow-sky-500/50"
              : phase === "processing" || phase === "responding"
                ? "bg-amber-500 shadow-amber-500/40"
                : "bg-emerald-500 shadow-emerald-500/50"
    const inline = Boolean(orbPortalTarget)
    const showInlineMessage = Boolean(error || notice || micSilent || transcriptionWarning)
    const orbControl = (
      <div className={inline
        ? "relative flex shrink-0 flex-col items-center"
        : "fixed bottom-24 right-6 z-50 flex flex-col items-center gap-2"}
      >
        <button
          type="button"
          onClick={() => void (starting || sessionRef.current ? stop("user") : start())}
          data-testid="voice-assistant-launcher"
          data-placement={inline ? "inline" : "floating"}
          aria-label={label}
          title={label}
          className={`relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${inline ? "h-11 w-11" : "h-14 w-14"}`}
        >
          {active && isSpeaking && <span className={`absolute inset-0 animate-ping rounded-full ${tone} opacity-40`} />}
          <span className={[
            "relative flex items-center justify-center rounded-full text-white shadow-lg transition-colors duration-300",
            inline ? "h-11 w-11" : "h-14 w-14",
            tone,
            !active && !starting ? "animate-[pulse_3s_ease-in-out_infinite]" : "",
            starting ? "animate-pulse" : "",
          ].join(" ")}>
            <Mic className="h-5 w-5" />
          </span>
        </button>
        {(error || notice || active || micSilent || transcriptionWarning) && (
          <span className={`${inline
            ? showInlineMessage
              ? "absolute right-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-md px-2 py-1 text-center text-[11px] leading-tight shadow-sm"
              : "sr-only"
            : "max-w-[16rem] rounded-md px-2 py-1 text-center text-[11px] leading-tight shadow-sm"} ${error ? "bg-destructive text-destructive-foreground" : "bg-background text-muted-foreground"}`} aria-live="polite">
            <span className="block">{label}</span>
            {!error && lastTranscript && <span data-sentry-mask className="mt-0.5 block max-w-[15rem] truncate text-foreground">{t("heard", { text: lastTranscript })}</span>}
            {!error && micSilent && <span className="mt-0.5 block max-w-[15rem] text-amber-700 dark:text-amber-300">{t("micSilent")}</span>}
            {!error && transcriptionWarning && <span className="mt-0.5 block max-w-[15rem] text-amber-700 dark:text-amber-300">{t("transcriptionUnavailable")}</span>}
          </span>
        )}
      </div>
    )
    if (orbPortalTarget) return createPortal(orbControl, orbPortalTarget)
    if (!showFloatingOrb) return null
    return orbControl
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className={[
        "flex h-32 w-32 items-center justify-center rounded-full border-4 transition-colors",
        active
          ? isSpeaking
            ? "border-primary bg-primary/10 animate-pulse"
            : phase === "user_speaking"
              ? "border-sky-500 bg-sky-500/10"
              : phase === "processing" || phase === "responding"
                ? "border-amber-500 bg-amber-500/10 animate-pulse"
                : "border-emerald-500 bg-emerald-500/10"
          : "border-muted bg-muted/30",
      ].join(" ")} aria-live="polite">
        <span className="text-sm font-medium">{label}</span>
      </div>
      {lastTranscript && active && <p data-sentry-mask className="max-w-md text-center text-sm text-muted-foreground">{t("heard", { text: lastTranscript })}</p>}
      {micSilent && active && <p className="max-w-md text-center text-xs text-amber-700 dark:text-amber-300">{t("micSilent")}</p>}
      {transcriptionWarning && active && <p className="max-w-md text-center text-xs text-amber-700 dark:text-amber-300">{t("transcriptionUnavailable")}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {!active ? (
        <Button onClick={() => void (starting || sessionRef.current ? stop("user") : start())} size="lg">
          {starting || sessionRef.current ? t("stop") : t("start")}
        </Button>
      ) : (
        <Button onClick={() => void stop("user")} variant="secondary" size="lg">{t("stop")}</Button>
      )}
    </div>
  )
}

export function VoiceConsole({
  variant = "page",
  autoStart = false,
  showFloatingOrb = true,
  orbPortalTarget = null,
}: {
  variant?: Variant
  autoStart?: boolean
  showFloatingOrb?: boolean
  orbPortalTarget?: HTMLElement | null
}) {
  return (
    <ConsoleInner
      variant={variant}
      autoStart={autoStart}
      showFloatingOrb={showFloatingOrb}
      orbPortalTarget={orbPortalTarget}
    />
  )
}
