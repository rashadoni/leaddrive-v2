"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import Image from "next/image"
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Gift,
  Headphones,
  HeartPulse,
  Landmark,
  LockKeyhole,
  Map,
  MapPin,
  Megaphone,
  MessageSquare,
  Phone,
  Radio,
  Settings,
  Shield,
  Sparkles,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import type {
  DemoAccent,
  DemoModuleId,
  DemoModuleManifest,
  DemoStep,
  DemoTone,
} from "@/lib/demo-center/catalog"

type DemoEventType = "MODULE_OPENED" | "STEP_VIEWED" | "COMPLETED"

export interface DemoPlayerProps {
  token: string
  company: string
  watermark: string
  /** A server-filtered manifest. The player never loads modules on its own. */
  modules: readonly DemoModuleManifest[]
  serverNow?: string
  sessionExpiresAt?: string
  idleExpiresAt?: string
  onAccessLost?: () => void
}

const MODULE_ICONS: Record<DemoModuleId, LucideIcon> = {
  crm: Users,
  sales: BriefcaseBusiness,
  contracts: FileText,
  marketing: Megaphone,
  loyalty: Gift,
  omnichannel: MessageSquare,
  support: Headphones,
  finance: Wallet,
  analytics: BarChart3,
  mtm: Map,
  health: HeartPulse,
  insurance: Shield,
  "public-sector": Landmark,
  media: Radio,
  energy: Zap,
  settings: Settings,
  ai: Sparkles,
  voip: Phone,
  "sms-otp": LockKeyhole,
}

const ACCENT_STYLES: Record<
  DemoAccent,
  { icon: string; active: string; marker: string; soft: string }
> = {
  orange: {
    icon: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
    active: "border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100",
    marker: "bg-orange-500",
    soft: "bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200",
  },
  blue: {
    icon: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    active: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100",
    marker: "bg-blue-500",
    soft: "bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-200",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    active: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
    marker: "bg-emerald-500",
    soft: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  },
  violet: {
    icon: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    active: "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100",
    marker: "bg-violet-500",
    soft: "bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200",
  },
  amber: {
    icon: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    active: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
    marker: "bg-amber-500",
    soft: "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  },
  rose: {
    icon: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    active: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100",
    marker: "bg-rose-500",
    soft: "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200",
  },
}

const TONE_STYLES: Record<DemoTone, { metric: string; badge: string; dot: string }> = {
  neutral: {
    metric: "text-foreground",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-zinc-400",
  },
  info: {
    metric: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  positive: {
    metric: "text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  attention: {
    metric: "text-amber-700 dark:text-amber-300",
    badge: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
}

type DemoSceneFamily = "profile" | "pipeline" | "document" | "campaign" | "inbox" | "analytics" | "map" | "case" | "settings" | "assistant"

const DEMO_SCENE_FAMILY: Record<DemoModuleId, DemoSceneFamily> = {
  crm: "profile",
  sales: "pipeline",
  contracts: "document",
  marketing: "campaign",
  loyalty: "campaign",
  omnichannel: "inbox",
  support: "inbox",
  finance: "analytics",
  analytics: "analytics",
  mtm: "map",
  health: "case",
  insurance: "case",
  "public-sector": "case",
  media: "campaign",
  energy: "analytics",
  settings: "settings",
  ai: "assistant",
  voip: "inbox",
  "sms-otp": "inbox",
}

function totalStepCount(modules: readonly DemoModuleManifest[]): number {
  return modules.reduce((sum, module) => sum + module.steps.length, 0)
}

function stepsBeforeModule(modules: readonly DemoModuleManifest[], moduleIndex: number): number {
  return modules
    .slice(0, moduleIndex)
    .reduce((sum, module) => sum + module.steps.length, 0)
}

export function DemoPlayer({ token, company, watermark, modules, serverNow, sessionExpiresAt, idleExpiresAt, onAccessLost }: DemoPlayerProps) {
  const [moduleIndex, setModuleIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [activatedSteps, setActivatedSteps] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [progressReady, setProgressReady] = useState(false)
  const [showFullPlaylist, setShowFullPlaylist] = useState(modules.length <= 6)
  const [isComplete, setIsComplete] = useState(false)
  const [completionPending, setCompletionPending] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const [currentIdleExpiresAt, setCurrentIdleExpiresAt] = useState(idleExpiresAt)
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(() => clockOffset(serverNow))
  const [remainingSeconds, setRemainingSeconds] = useState(() => secondsUntil(nearestDeadline(sessionExpiresAt, idleExpiresAt)?.value, clockOffset(serverNow)))
  const [deadlineKind, setDeadlineKind] = useState<"session" | "idle" | null>(() => nearestDeadline(sessionExpiresAt, idleExpiresAt)?.kind ?? null)

  const openedModulesRef = useRef(new Set<string>())
  const viewedStepsRef = useRef(new Set<string>())
  const completedTokensRef = useRef(new Set<string>())
  const expiryNotifiedRef = useRef(false)
  const playerHeadingRef = useRef<HTMLHeadingElement>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const saved = readStoredProgress(token, modules)
    setModuleIndex(saved.moduleIndex)
    setStepIndex(saved.stepIndex)
    setActivatedSteps(new Set(saved.activatedSteps))
    setVisitedSteps(new Set(saved.visitedSteps))
    setProgressReady(true)
  }, [modules, token])

  useEffect(() => {
    if (!progressReady) return
    try {
      window.sessionStorage.setItem(progressStorageKey(token), JSON.stringify({
        moduleIndex,
        stepIndex,
        activatedSteps: [...activatedSteps],
        visitedSteps: [...visitedSteps],
      }))
    } catch {
      // Session storage is a convenience only. The server-side one-session
      // credential remains authoritative when storage is unavailable.
    }
  }, [activatedSteps, moduleIndex, progressReady, stepIndex, token, visitedSteps])

  useEffect(() => {
    setCurrentIdleExpiresAt(idleExpiresAt)
  }, [idleExpiresAt])

  useEffect(() => {
    setServerClockOffsetMs(clockOffset(serverNow))
  }, [serverNow])

  useEffect(() => {
    if (!progressReady || isComplete) return
    window.requestAnimationFrame(() => playerHeadingRef.current?.focus())
  }, [isComplete, progressReady])

  useEffect(() => {
    if (!isComplete) return
    window.requestAnimationFrame(() => completionHeadingRef.current?.focus())
  }, [isComplete])

  useEffect(() => {
    const nearest = nearestDeadline(sessionExpiresAt, currentIdleExpiresAt)
    const deadline = nearest ? Date.parse(nearest.value) : Number.NaN
    setDeadlineKind(nearest?.kind ?? null)
    if (!Number.isFinite(deadline)) {
      setRemainingSeconds(null)
      return
    }
    expiryNotifiedRef.current = false

    const updateRemaining = () => {
      const next = Math.max(0, Math.ceil((deadline - (Date.now() + serverClockOffsetMs)) / 1_000))
      setRemainingSeconds(next)
      if (next === 0 && !expiryNotifiedRef.current) {
        expiryNotifiedRef.current = true
        onAccessLost?.()
      }
    }

    updateRemaining()
    const interval = window.setInterval(updateRemaining, 1_000)
    return () => window.clearInterval(interval)
  }, [currentIdleExpiresAt, onAccessLost, serverClockOffsetMs, sessionExpiresAt])

  const currentModule = modules[moduleIndex]
  const step = currentModule?.steps[stepIndex]
  const totalSteps = totalStepCount(modules)
  const currentStepNumber = currentModule
    ? stepsBeforeModule(modules, moduleIndex) + stepIndex + 1
    : 0
  const safeCompany = company.trim() || "Sizin şirkət"
  const safeWatermark = watermark.trim() || `${safeCompany} · Məxfi demo`

  const postEvent = useCallback(
    async (
      type: DemoEventType,
      moduleId?: DemoModuleId,
      stepId?: string,
      metadata?: Record<string, string | number | boolean | null>,
    ): Promise<boolean> => {
      if (!token.trim()) return false

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          signal: controller.signal,
          body: JSON.stringify({
            eventType: type,
            moduleId,
            stepId,
            metadata: { occurredAt: new Date().toISOString(), ...metadata },
          }),
        })
        const result = await response.json().catch(() => ({})) as { idleExpiresAt?: string; serverNow?: string }
        if (response.ok && result.idleExpiresAt) setCurrentIdleExpiresAt(result.idleExpiresAt)
        if (response.ok && result.serverNow) setServerClockOffsetMs(clockOffset(result.serverNow))
        if ([401, 403, 409, 410].includes(response.status)) onAccessLost?.()
        return response.ok
      } catch {
        return false
      } finally {
        window.clearTimeout(timeout)
      }
    },
    [onAccessLost, token],
  )

  useEffect(() => {
    if (!progressReady || !currentModule) return

    const key = `${token}:${currentModule.id}`
    if (openedModulesRef.current.has(key)) return

    openedModulesRef.current.add(key)
    void postEvent("MODULE_OPENED", currentModule.id)
  }, [currentModule, postEvent, progressReady, token])

  useEffect(() => {
    if (!progressReady || !currentModule || !step) return

    const key = `${token}:${currentModule.id}:${step.id}`
    const progressKey = `${currentModule.id}:${step.id}`
    setVisitedSteps((current) => {
      if (current.has(progressKey)) return current
      const next = new Set(current)
      next.add(progressKey)
      return next
    })
    if (viewedStepsRef.current.has(key)) return

    viewedStepsRef.current.add(key)
    void postEvent("STEP_VIEWED", currentModule.id, step.id)
  }, [currentModule, postEvent, progressReady, step, token])

  const refreshVisitedTarget = (nextModuleIndex: number, nextStepIndex: number) => {
    const targetModule = modules[nextModuleIndex]
    const targetStep = targetModule?.steps[nextStepIndex]
    if (!targetModule || !targetStep || !visitedSteps.has(`${targetModule.id}:${targetStep.id}`)) return
    void postEvent("STEP_VIEWED", targetModule.id, targetStep.id, { activityOnly: true })
  }

  const selectModule = (nextModuleIndex: number) => {
    if (isComplete || completionPending) return
    refreshVisitedTarget(nextModuleIndex, 0)
    setModuleIndex(nextModuleIndex)
    setStepIndex(0)
  }

  const selectStep = (nextStepIndex: number) => {
    if (isComplete || completionPending) return
    refreshVisitedTarget(moduleIndex, nextStepIndex)
    setStepIndex(nextStepIndex)
  }

  const goBack = () => {
    if (stepIndex > 0) {
      refreshVisitedTarget(moduleIndex, stepIndex - 1)
      setStepIndex((current) => current - 1)
      return
    }

    if (moduleIndex > 0) {
      const previousModuleIndex = moduleIndex - 1
      const previousStepIndex = modules[previousModuleIndex]?.steps.length - 1 || 0
      refreshVisitedTarget(previousModuleIndex, previousStepIndex)
      setModuleIndex(previousModuleIndex)
      setStepIndex(previousStepIndex)
    }
  }

  const goForward = async () => {
    if (!currentModule || !step) return

    if (stepIndex < currentModule.steps.length - 1) {
      refreshVisitedTarget(moduleIndex, stepIndex + 1)
      setStepIndex((current) => current + 1)
      return
    }

    if (moduleIndex < modules.length - 1) {
      refreshVisitedTarget(moduleIndex + 1, 0)
      setModuleIndex((current) => current + 1)
      setStepIndex(0)
      return
    }

    const seenAtClick = new Set(visitedSteps)
    seenAtClick.add(`${currentModule.id}:${step.id}`)
    const missing = firstUnvisitedStep(modules, seenAtClick)
    if (missing) {
      setModuleIndex(missing.moduleIndex)
      setStepIndex(missing.stepIndex)
      return
    }

    const completionKey = token || "anonymous-demo"
    if (completedTokensRef.current.has(completionKey)) return
    completedTokensRef.current.add(completionKey)
    setCompletionPending(true)
    setCompletionError(null)
    const completed = await postEvent("COMPLETED", currentModule.id, step.id)
    setCompletionPending(false)
    if (!completed) {
      completedTokensRef.current.delete(completionKey)
      setCompletionError("Sessiyanı bağlaya bilmədik. İnternet bağlantısını yoxlayıb yenidən cəhd edin.")
      return
    }
    try {
      window.sessionStorage.removeItem(progressStorageKey(token))
    } catch {
      // The terminal server state is authoritative even if storage is blocked.
    }
    setIsComplete(true)
  }

  const activateCurrentStep = () => {
    if (!currentModule || !step) return

    void postEvent("STEP_VIEWED", currentModule.id, step.id, { activityOnly: true })
    const key = `${currentModule.id}:${step.id}`
    setActivatedSteps((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
  }

  if (!currentModule || !step) {
    return (
      <section
        aria-label="LeadDrive məhsul demosu"
        className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground"
      >
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-6 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Demo modulu seçilməyib
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Bu məxfi keçid üçün hələ heç bir modul ayrılmayıb. Demo sahibi ilə
            əlaqə saxlayın.
          </p>
        </div>
      </section>
    )
  }

  const ModuleIcon = MODULE_ICONS[currentModule.id]
  const accent = ACCENT_STYLES[currentModule.accent]
  const activeStepKey = `${currentModule.id}:${step.id}`
  const stepActivated = activatedSteps.has(activeStepKey)
  const isFirstStep = moduleIndex === 0 && stepIndex === 0
  const isLastStep =
    moduleIndex === modules.length - 1 &&
    stepIndex === currentModule.steps.length - 1
  const allStepsVisited = visitedSteps.size >= totalSteps
  const moduleWindowStart = Math.min(
    Math.max(moduleIndex - 2, 0),
    Math.max(0, modules.length - 5),
  )
  const navigationModules = (showFullPlaylist
    ? modules.map((item, index) => ({ item, index }))
    : modules.slice(moduleWindowStart, moduleWindowStart + 5).map((item, offset) => ({
      item,
      index: moduleWindowStart + offset,
    })))

  return (
    <section
      aria-label="LeadDrive məhsul demosu"
      className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 top-[73px] z-20 grid select-none grid-cols-2 grid-rows-3 place-items-center overflow-hidden opacity-[0.04] sm:grid-cols-3 sm:grid-rows-2"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className="-rotate-12 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.18em] text-foreground sm:text-sm"
          >
            {safeWatermark}
          </span>
        ))}
      </div>

      <header className="relative z-30 border-b border-[#dfe8eb] bg-white">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/logo.svg" alt="LeadDrive CRM" width={132} height={32} priority className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-800">
                  Məxfi demo
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                Yalnız {safeCompany} üçün hazırlanıb
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-md">
            <Progress
              value={isComplete ? totalSteps : visitedSteps.size}
              max={Math.max(totalSteps, 1)}
              className="h-1.5"
              aria-label="Ümumi demo irəliləyişi"
            />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {isComplete ? totalSteps : visitedSteps.size}/{totalSteps}
            </span>
            {remainingSeconds !== null ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
                  remainingSeconds <= 60
                    ? "bg-amber-100 text-amber-900"
                    : "bg-muted text-muted-foreground",
                )}
                title={deadlineKind === "idle" ? "Fəaliyyətsizlik limiti" : "Sessiyanın mütləq limiti"}
                aria-label={`${deadlineKind === "idle" ? "Fəaliyyətsizlik limitinə" : "Sessiyanın bitməsinə"} ${formatRemaining(remainingSeconds)} qalıb`}
              >
                <Clock3 className="size-3.5" aria-hidden="true" />
                {deadlineKind === "idle" ? "Fasilə" : "Sessiya"} · {formatRemaining(remainingSeconds)}
              </span>
            ) : null}
            <span className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
              {deadlineAnnouncement(remainingSeconds, deadlineKind)}
            </span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-[1480px] lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-card lg:block">
          <nav
            aria-label="Demo modulları"
            className="sticky top-0 max-h-[calc(100dvh-73px)] overflow-y-auto px-4 py-6"
          >
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Sizin modullarınız
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {navigationModules.map(({ item, index }) => {
                const Icon = MODULE_ICONS[item.id]
                const itemAccent = ACCENT_STYLES[item.accent]
                const isActive = index === moduleIndex && !isComplete

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectModule(index)}
                    disabled={isComplete || completionPending}
                    aria-current={isActive ? "page" : undefined}
                    aria-controls="demo-scene"
                    className={cn(
                      "group flex min-h-12 w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-45",
                      isActive
                        ? itemAccent.active
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        isActive ? itemAccent.icon : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.shortTitle}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        3 addım
                      </span>
                    </span>
                    {isActive ? (
                      <span className={cn("size-1.5 rounded-full", itemAccent.marker)} />
                    ) : null}
                  </button>
                )
              })}
            </div>
            {modules.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowFullPlaylist((current) => !current)}
                className="mt-3 min-h-10 w-full rounded-lg px-3 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {showFullPlaylist ? "Marşrutu yığ" : `Bütün ${modules.length} modulu göstər`}
              </button>
            ) : null}
          </nav>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-5xl">
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {!isComplete ? `${currentModule.title}, ${stepIndex + 1}. addım: ${step.title}` : ""}
            </p>
            <div className="mb-6 lg:hidden">
              <label
                htmlFor="demo-module-select"
                className="mb-2 block text-xs font-medium text-muted-foreground"
              >
                Demo modulu
              </label>
              <select
                id="demo-module-select"
                value={currentModule.id}
                disabled={isComplete || completionPending}
                aria-controls="demo-scene"
                onChange={(event) => {
                  const nextIndex = modules.findIndex(
                    (item) => item.id === event.target.value,
                  )
                  if (nextIndex >= 0) selectModule(nextIndex)
                }}
                className="min-h-12 w-full rounded-xl border border-input bg-card px-4 text-base font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/30"
              >
                {modules.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.shortTitle} — {item.title}
                  </option>
                ))}
              </select>
            </div>

            {isComplete ? (
              <div className="flex min-h-[65dvh] items-center justify-center py-10">
                <div className="max-w-2xl text-center">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <CheckCircle2 className="size-8" aria-hidden="true" />
                  </div>
                  <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    Demo tamamlandı
                  </p>
                  <p className="sr-only" role="status" aria-live="polite">Demo sessiyası tamamlandı.</p>
                  <h1 ref={completionHeadingRef} tabIndex={-1} className="mt-3 text-3xl font-semibold tracking-tight outline-none sm:text-4xl">
                    Baxdığınız üçün təşəkkür edirik
                  </h1>
                  <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                    {safeCompany} üçün seçilmiş {modules.length} modul və {totalSteps}{" "}
                    sintetik ssenari ilə tanış oldunuz. Bu təqdimatda heç bir real
                    müştəri və ya şirkət hesabı məlumatı istifadə edilməyib.
                  </p>
                  <p className="mx-auto mt-8 w-fit rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
                    Birdəfəlik sessiya bağlandı — pəncərəni bağlaya bilərsiniz
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-xl",
                        accent.icon,
                      )}
                    >
                      <ModuleIcon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                        {currentModule.shortTitle}
                      </p>
                      <h1 ref={playerHeadingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
                        {currentModule.title}
                      </h1>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                        {currentModule.summary}
                      </p>
                    </div>
                  </div>
                  <span className="w-fit shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    {moduleIndex + 1}/{modules.length} modul
                  </span>
                </div>

                <div
                  aria-label={`${currentModule.shortTitle} addımları`}
                  className="mt-7 grid grid-cols-3 gap-2"
                >
                  {currentModule.steps.map((item, index) => {
                    const isActive = index === stepIndex
                    const hasViewed = visitedSteps.has(`${currentModule.id}:${item.id}`)

                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={isActive ? "step" : undefined}
                        aria-controls="demo-scene"
                        onClick={() => selectStep(index)}
                        disabled={completionPending}
                        className={cn(
                          "flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-45 sm:px-4",
                          isActive
                            ? "border-foreground/15 bg-card text-foreground shadow-sm"
                            : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : hasViewed
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-card text-muted-foreground",
                          )}
                        >
                          {hasViewed && !isActive ? (
                            <Check className="size-3.5" aria-hidden="true" />
                          ) : (
                            index + 1
                          )}
                        </span>
                        <span className={cn("truncate text-xs font-medium", !isActive && "hidden sm:block")}>
                          {item.stageLabel}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <article id="demo-scene" aria-labelledby="demo-scene-title" className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_45px_-35px_rgba(15,23,42,0.35)]">
                  <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("size-2 rounded-full", accent.marker)} />
                      <span>{currentModule.shortTitle}</span>
                      <span aria-hidden="true">/</span>
                      <span>{step.stageLabel}</span>
                    </div>
                    <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Yalnız sintetik məlumat
                    </span>
                  </div>

                  <div className="px-4 pb-5 pt-6 sm:px-6 sm:pb-6 sm:pt-8 lg:px-8">
                    <div className="max-w-3xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Addım {stepIndex + 1} · {step.stageLabel}
                      </p>
                      <h2 id="demo-scene-title" className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                        {step.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                        {step.description}
                      </p>
                    </div>

                    <DemoScene moduleId={currentModule.id} step={step} activated={stepActivated} />
                  </div>

                  <div className="border-t border-border bg-muted/35 px-4 py-5 sm:px-6 lg:px-8">
                    {stepActivated ? (
                      <div
                        aria-live="polite"
                        className={cn(
                          "flex flex-col gap-3 rounded-xl px-4 py-4 sm:flex-row sm:items-start",
                          accent.soft,
                        )}
                      >
                        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-semibold">{step.outcomeTitle}</p>
                          <p className="mt-1 text-sm leading-6 opacity-80">{step.outcome}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium">İnteraktiv sınaq</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Əməliyyat yalnız bu sintetik demo görünüşünü dəyişəcək.
                          </p>
                        </div>
                        <Button
                          type="button"
                          onClick={activateCurrentStep}
                          className="min-h-11 shrink-0"
                        >
                          {step.actionLabel}
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                </article>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-4 sm:px-5"
                    onClick={goBack}
                    disabled={isFirstStep || completionPending}
                  >
                    <ArrowLeft aria-hidden="true" />
                    <span className="hidden sm:inline">Geri</span>
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    {currentStepNumber}. addım · cəmi {totalSteps}
                  </p>
                  <Button
                    type="button"
                    className="min-h-11 px-4 sm:px-5"
                    onClick={() => { void goForward() }}
                    disabled={completionPending}
                  >
                    <span>{completionPending ? "Sessiya bağlanır…" : isLastStep ? (allStepsVisited ? "Sessiyanı bitir" : "Baxılmamış addıma keç") : "Növbəti"}</span>
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
                {completionError ? <p role="alert" className="mt-3 text-right text-sm text-destructive">{completionError}</p> : null}
              </>
            )}
          </div>
        </main>
      </div>
    </section>
  )
}

function DemoScene({ moduleId, step, activated }: { moduleId: DemoModuleId; step: DemoStep; activated: boolean }) {
  const family = DEMO_SCENE_FAMILY[moduleId]

  if (family === "profile") {
    return (
      <div className="mt-7 grid gap-4 md:grid-cols-[0.72fr_1.28fr]">
        <div className="rounded-2xl bg-[#0a2540] p-5 text-white">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/12"><Users className="size-5" /></span>
          <p className="mt-5 text-lg font-semibold">{step.records[0].title}</p>
          <p className="mt-1 text-xs leading-5 text-white/65">{step.records[0].meta}</p>
          <div className="mt-6 grid gap-3">
            {step.metrics.map((metric) => (
              <div key={metric.label} className="flex items-end justify-between gap-4 border-t border-white/12 pt-3">
                <span className="text-xs text-white/65">{metric.label}</span>
                <span className="text-sm font-semibold tabular-nums">{metric.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={cn("rounded-2xl border bg-background p-5 transition-colors", activated ? "border-emerald-300" : "border-border")}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">Fəaliyyət zaman xətti</p>
            {activated ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"><Check className="size-3" />Yeniləndi</span> : null}
          </div>
          <div className="mt-4 space-y-1">
            {step.records.map((record, index) => (
              <div key={`${record.title}:${record.value}`} className={cn("grid grid-cols-[20px_minmax(0,1fr)_auto] gap-3 rounded-xl py-3 transition-colors", activated && index === 0 && "bg-emerald-50 px-3")}>
                <div className="flex flex-col items-center"><span className={cn("mt-1.5 size-2 rounded-full", TONE_STYLES[record.tone].dot)} />{index < step.records.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}</div>
                <div className="min-w-0"><p className="truncate text-sm font-medium">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.meta}</p></div>
                <div className="text-right"><p className="text-xs font-semibold tabular-nums">{record.value}</p><StatusBadge record={record} className="mt-2" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (family === "pipeline") {
    return (
      <div className="mt-7">
        <MetricStrip step={step} />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {step.records.map((record, index) => (
            <div key={`${record.title}:${record.value}`} className={cn("rounded-2xl border bg-background p-4 transition-all", activated && index === 0 ? "-translate-y-1 border-emerald-300 shadow-md" : "border-border")}>
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Mərhələ {index + 1}</span>{activated && index === 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"><Check className="size-3" />Keçirildi</span> : <StatusBadge record={record} />}</div>
              <p className="mt-5 text-sm font-semibold">{record.title}</p>
              <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{record.meta}</p>
              <p className="mt-5 text-lg font-semibold tabular-nums">{record.value}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${activated && index === 0 ? 100 : 46 + index * 21}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (family === "document") {
    return (
      <div className="mt-7 grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-2xl border border-border bg-[#f6f3ec] p-3 sm:p-5">
          <div className="relative min-h-64 overflow-hidden rounded-xl border border-[#ddd7ca] bg-white p-5 shadow-sm sm:p-7">
            {activated ? <span className="absolute right-5 top-16 -rotate-6 rounded-lg border-2 border-emerald-600 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-emerald-700 opacity-80">Təsdiqləndi</span> : null}
            <div className="flex items-start justify-between gap-4 border-b border-border pb-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">LeadDrive Docs</p><p className="mt-2 text-lg font-semibold">{step.records[0].title}</p></div><FileText className="size-6 text-muted-foreground" /></div>
            <div className="mt-5 space-y-4">
              {step.records.map((record) => (
                <div key={`${record.title}:${record.value}`} className="grid gap-2 border-b border-dashed border-border pb-4 sm:grid-cols-[1fr_auto] sm:items-end"><div><p className="text-xs font-semibold">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.meta}</p></div><p className="text-sm font-semibold tabular-nums">{record.value}</p></div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {step.metrics.map((metric) => <MetricTile key={metric.label} metric={metric} />)}
        </div>
      </div>
    )
  }

  if (family === "campaign") {
    return (
      <div className="mt-7 rounded-2xl border border-border bg-background p-4 sm:p-6">
        <MetricStrip step={step} />
        <div className="mt-6 grid gap-5 md:grid-cols-[1fr_0.8fr] md:items-end">
          <div className="space-y-3">
            {step.records.map((record, index) => (
              <div key={`${record.title}:${record.value}`} className="rounded-xl border border-border bg-card p-4" style={{ width: `${100 - index * 10}%` }}>
                <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{record.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{record.meta}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums">{record.value}</span></div>
              </div>
            ))}
          </div>
          <div className="relative flex h-40 items-end justify-center gap-3 rounded-xl bg-gradient-to-b from-orange-50 to-white px-5 pb-5">
            {activated ? <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"><Check className="size-3" />Kampaniya aktivdir</span> : null}
            {[44, 63, 55, 82, 74, 94, 86].map((height, index) => <span key={index} className="w-full max-w-7 rounded-t-md bg-orange-500 transition-[height] duration-500" style={{ height: `${Math.min(100, height + (activated ? 8 : 0))}%`, opacity: 0.35 + index * 0.08 }} />)}
          </div>
        </div>
      </div>
    )
  }

  if (family === "inbox") {
    return (
      <div className="mt-7 grid min-h-72 overflow-hidden rounded-2xl border border-border bg-background md:grid-cols-[0.82fr_1.18fr]">
        <div className="border-b border-border bg-muted/35 p-3 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><MessageSquare className="size-4" />Canlı növbə</div>
          <div className="mt-2 space-y-2">
            {step.records.map((record, index) => (
              <div key={`${record.title}:${record.value}`} className={cn("rounded-xl border p-3", index === 0 ? "border-primary/25 bg-card shadow-sm" : "border-transparent bg-transparent")}><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{record.title}</p><span className="text-[10px] tabular-nums text-muted-foreground">{record.value}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{record.meta}</p></div>
            ))}
          </div>
        </div>
        <div className="flex flex-col p-4 sm:p-5">
          <div className="flex items-center justify-between border-b border-border pb-3"><div><p className="text-sm font-semibold">{step.records[0].title}</p><p className="mt-0.5 text-xs text-emerald-700">● Aktiv əlaqə</p></div><Phone className="size-4 text-muted-foreground" /></div>
          <div className="flex flex-1 flex-col justify-center gap-3 py-5"><div className="max-w-[78%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-xs leading-5">{step.records[0].meta}</div><div className="ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-[#0a2540] px-4 py-3 text-xs leading-5 text-white">{step.description}</div>{activated ? <div className="max-w-[84%] rounded-2xl rounded-bl-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900"><span className="font-semibold">Avtomatik cavab:</span> {step.outcome}</div> : null}</div>
          <div className="grid grid-cols-3 gap-2">{step.metrics.map((metric) => <div key={metric.label} className="rounded-lg bg-muted/60 px-3 py-2"><p className="truncate text-[9px] uppercase text-muted-foreground">{metric.label}</p><p className="mt-1 truncate text-xs font-semibold">{metric.value}</p></div>)}</div>
        </div>
      </div>
    )
  }

  if (family === "analytics") {
    const chartHeights = [34, 48, 42, 67, 58, 76, 71, 90]

    return (
      <div className="mt-7">
        <MetricStrip step={step} />
        <div className="mt-4 grid gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5 md:grid-cols-[1.25fr_0.75fr]">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Dinamika</p>
                <p className="mt-1 text-xs text-muted-foreground">Son 8 dövr üzrə sintetik göstəricilər</p>
              </div>
              {activated ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"><Check className="size-3" />Hesablandı</span> : <BarChart3 className="size-5 text-primary" aria-hidden="true" />}
            </div>
            <div className="mt-6 flex h-44 items-end gap-2 border-b border-l border-border px-3 pt-4" aria-label="Sintetik dinamika qrafiki">
              {chartHeights.map((height, index) => (
                <div key={index} className="group relative flex h-full flex-1 items-end">
                  <span
                    className="w-full rounded-t-md bg-gradient-to-t from-primary to-orange-400 transition-opacity group-hover:opacity-80"
                    style={{ height: `${Math.min(100, height + (activated ? 7 : 0))}%` }}
                  />
                  <span className="sr-only">Dövr {index + 1}: {height}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="divide-y divide-border rounded-xl bg-muted/35 px-4">
            {step.records.map((record) => (
              <div key={`${record.title}:${record.value}`} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{record.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{record.meta}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{record.value}</p>
                </div>
                <StatusBadge record={record} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (family === "map") {
    const positions = ["left-[16%] top-[24%]", "right-[18%] top-[35%]", "left-[46%] bottom-[17%]"]
    return (
      <div className="mt-7 overflow-hidden rounded-2xl border border-border bg-[#edf3ef]">
        <div className="relative min-h-72 [background-image:linear-gradient(to_right,rgba(43,78,67,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(43,78,67,0.08)_1px,transparent_1px)] [background-size:32px_32px]">
          <div className={cn("absolute left-[20%] top-[30%] h-28 w-[55%] rotate-6 rounded-[50%] border-2 border-emerald-600/35 transition-all", activated ? "border-solid bg-emerald-100/35" : "border-dashed")} />
          {step.records.map((record, index) => <div key={`${record.title}:${record.value}`} className={cn("absolute max-w-[150px] rounded-xl border border-white/80 bg-white/95 p-3 shadow-lg transition-transform", positions[index], activated && index === 2 && "scale-105 ring-2 ring-emerald-500/30")}><MapPin className={cn("size-4", activated && index === 2 ? "text-orange-600" : "text-emerald-700")} /><p className="mt-2 truncate text-xs font-semibold">{record.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{record.value} · {activated && index === 2 ? "Marşrut yeniləndi" : record.status}</p></div>)}
          <div className="absolute inset-x-4 bottom-4 grid grid-cols-3 gap-2 rounded-xl border border-white/75 bg-white/90 p-3 shadow-sm backdrop-blur">{step.metrics.map((metric) => <div key={metric.label}><p className="truncate text-[9px] uppercase text-muted-foreground">{metric.label}</p><p className="mt-1 truncate text-sm font-semibold">{metric.value}</p></div>)}</div>
        </div>
      </div>
    )
  }

  if (family === "case") {
    return (
      <div className="mt-7 grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="rounded-2xl border border-border bg-background p-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Workflow className="size-4" />İş axını</div>
          <div className="mt-5 space-y-3">{step.records.map((record, index) => <div key={`${record.title}:${record.value}`} className={cn("grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl transition-colors", activated && index === step.records.length - 1 && "bg-emerald-50 p-2")}><span className={cn("flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white", activated && index === step.records.length - 1 ? "bg-emerald-600" : "bg-[#0a2540]")}>{activated && index === step.records.length - 1 ? <Check className="size-4" /> : index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{record.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{record.meta}</p></div><StatusBadge record={record} /></div>)}</div>
        </div>
        <div className="grid gap-3">{step.metrics.map((metric) => <MetricTile key={metric.label} metric={metric} />)}</div>
      </div>
    )
  }

  if (family === "settings") {
    return (
      <div className="mt-7 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border bg-background p-5"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Settings className="size-4" />İdarəetmə qaydaları</div><div className="mt-4 divide-y divide-border">{step.records.map((record, index) => {
          const enabled = activated || index !== 2
          return <div key={`${record.title}:${record.value}`} className="flex items-center justify-between gap-4 py-4"><div><p className="text-sm font-semibold">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{record.meta}</p></div><div className="flex shrink-0 items-center gap-2"><span className={cn("text-xs font-semibold", enabled ? "text-emerald-700" : "text-muted-foreground")}>{enabled ? "Aktiv" : "Söndürülüb"}</span><span aria-hidden="true" className={cn("relative h-7 w-12 rounded-full transition-colors", enabled ? "bg-emerald-600" : "bg-muted")}><span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-[left,right]", enabled ? "right-1" : "left-1")} /></span></div></div>
        })}</div></div>
        <div className="space-y-3">{step.metrics.map((metric) => <MetricTile key={metric.label} metric={metric} />)}</div>
      </div>
    )
  }

  if (family === "assistant") {
    return (
      <div className="mt-7 rounded-2xl border border-border bg-gradient-to-br from-violet-50 via-white to-orange-50 p-4 sm:p-6">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-violet-100 text-violet-700"><Sparkles className="size-5" /></span><div><p className="text-sm font-semibold">Da Vinci köməkçisi</p><p className="text-xs text-muted-foreground">Sintetik demo konteksti</p></div></div>
        <div className="mt-5 ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[#0a2540] px-4 py-3 text-sm text-white">{step.title}</div>
        <div className="mt-3 max-w-[92%] rounded-2xl rounded-bl-sm border border-violet-100 bg-white px-4 py-4 shadow-sm"><p className="text-sm leading-6 text-foreground">{step.description}</p><div className="mt-4 flex flex-wrap gap-2">{step.metrics.map((metric) => <span key={metric.label} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800">{metric.label}: {metric.value}</span>)}</div></div>
        {activated ? <div className="mt-3 max-w-[92%] rounded-2xl rounded-bl-sm border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-950"><span className="font-semibold">Nəticə hazırdır:</span> {step.outcome}</div> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">{step.records.map((record) => <div key={`${record.title}:${record.value}`} className="rounded-xl border border-white bg-white/75 p-3"><p className="text-xs font-semibold">{record.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{record.value} · {record.status}</p></div>)}</div>
      </div>
    )
  }

  return (
    <div className="mt-7">
      {activated ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" />{step.outcomeTitle}</div> : null}
      <MetricStrip step={step} />
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-background">
        {step.records.map((record) => <div key={`${record.title}:${record.value}`} className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0"><div className="min-w-0"><p className="truncate text-sm font-semibold">{record.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{record.meta}</p></div><StatusBadge record={record} /></div>)}
      </div>
    </div>
  )
}

function MetricStrip({ step }: { step: DemoStep }) {
  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-background sm:grid-cols-3 sm:divide-x sm:divide-border">
      {step.metrics.map((metric) => {
        const tone = TONE_STYLES[metric.tone ?? "neutral"]
        return <div key={metric.label} className="border-b border-border px-4 py-4 last:border-b-0 sm:border-b-0"><p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">{metric.label}</p><p className={cn("mt-1 text-lg font-semibold tabular-nums", tone.metric)}>{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></div>
      })}
    </div>
  )
}

function MetricTile({ metric }: { metric: DemoStep["metrics"][number] }) {
  const tone = TONE_STYLES[metric.tone ?? "neutral"]
  return <div className="rounded-xl border border-border bg-background p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">{metric.label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", tone.metric)}>{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></div>
}

function StatusBadge({ record, className }: { record: DemoStep["records"][number]; className?: string }) {
  const tone = TONE_STYLES[record.tone]
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium", tone.badge, className)}><span className={cn("size-1.5 rounded-full", tone.dot)} />{record.status}</span>
}

function secondsUntil(value?: string, offsetMs = 0): number | null {
  if (!value) return null
  const deadline = Date.parse(value)
  if (!Number.isFinite(deadline)) return null
  return Math.max(0, Math.ceil((deadline - (Date.now() + offsetMs)) / 1_000))
}

function clockOffset(serverNow?: string): number {
  if (!serverNow) return 0
  const parsed = Date.parse(serverNow)
  return Number.isFinite(parsed) ? parsed - Date.now() : 0
}

function nearestDeadline(
  sessionExpiresAt?: string,
  idleExpiresAt?: string,
): { value: string; kind: "session" | "idle" } | null {
  const candidates = [
    sessionExpiresAt ? { value: sessionExpiresAt, kind: "session" as const, time: Date.parse(sessionExpiresAt) } : null,
    idleExpiresAt ? { value: idleExpiresAt, kind: "idle" as const, time: Date.parse(idleExpiresAt) } : null,
  ].filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate && Number.isFinite(candidate.time))

  const nearest = candidates.sort((left, right) => left.time - right.time)[0]
  return nearest ? { value: nearest.value, kind: nearest.kind } : null
}

function firstUnvisitedStep(
  modules: readonly DemoModuleManifest[],
  visited: ReadonlySet<string>,
): { moduleIndex: number; stepIndex: number } | null {
  for (const [moduleIndex, module] of modules.entries()) {
    const stepIndex = module.steps.findIndex((step) => !visited.has(`${module.id}:${step.id}`))
    if (stepIndex >= 0) return { moduleIndex, stepIndex }
  }
  return null
}

function deadlineAnnouncement(
  remainingSeconds: number | null,
  kind: "session" | "idle" | null,
): string {
  if (remainingSeconds === null || ![60, 30, 10, 0].includes(remainingSeconds)) return ""
  if (remainingSeconds === 0) return "Demo sessiyasının vaxtı bitdi."
  return `${kind === "idle" ? "Fəaliyyətsizlik limitinə" : "Sessiyanın bitməsinə"} ${formatRemaining(remainingSeconds)} qalıb.`
}

function formatRemaining(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

function progressStorageKey(token: string): string {
  return `ld_demo_progress_${token.slice(-16)}`
}

function readStoredProgress(token: string, modules: readonly DemoModuleManifest[]) {
  const fallback = { moduleIndex: 0, stepIndex: 0, activatedSteps: [] as string[], visitedSteps: [] as string[] }
  if (typeof window === "undefined") return fallback

  try {
    const raw = window.sessionStorage.getItem(progressStorageKey(token))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const requestedModuleIndex = typeof parsed.moduleIndex === "number" && Number.isInteger(parsed.moduleIndex)
      ? parsed.moduleIndex
      : 0
    const moduleIndex = Math.min(Math.max(requestedModuleIndex, 0), Math.max(0, modules.length - 1))
    const selectedModule = modules[moduleIndex]
    const requestedStepIndex = typeof parsed.stepIndex === "number" && Number.isInteger(parsed.stepIndex)
      ? parsed.stepIndex
      : 0
    const stepIndex = Math.min(Math.max(requestedStepIndex, 0), Math.max(0, (selectedModule?.steps.length || 1) - 1))
    const allowedKeys = new Set(modules.flatMap((module) => module.steps.map((item) => `${module.id}:${item.id}`)))
    const safeKeys = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && allowedKeys.has(item))
      : []

    return {
      moduleIndex,
      stepIndex,
      activatedSteps: safeKeys(parsed.activatedSteps),
      visitedSteps: safeKeys(parsed.visitedSteps),
    }
  } catch {
    return fallback
  }
}
