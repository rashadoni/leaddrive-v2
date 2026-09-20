"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import Image from "next/image"
import { ArrowRight, BarChart3, CheckCircle2, Clock3, KeyRound, Layers3, LoaderCircle, LockKeyhole, Mail, Play, ShieldCheck, ShieldX, Sparkles, TrendingUp, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DemoModuleManifest } from "@/lib/demo-center/catalog"
import { getDemoJourneyScenario, type DemoProspectIdentity } from "@/lib/demo-center/journey"
import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { DemoPlayer } from "@/components/demo-center/demo-player"

type AccessState = "ready_for_otp" | "otp_sent" | "verified" | "active" | "active_elsewhere" | "completed" | "expired" | "revoked" | "connection_lost" | "unavailable"

interface ModulePreview { id: string; title: string; summary: string }
/** Present only on grants issued for a guided scenario. */
interface ScenarioPreview {
  scenarioId: string
  scenarioVersion: number
  title?: string
  summary?: string
  sections?: number
}
interface AccessPayload {
  success: boolean
  state: AccessState
  company?: string
  recipient?: string
  watermark?: string
  modules?: ModulePreview[] | DemoModuleManifest[]
  scenario?: ScenarioPreview
  identity?: DemoProspectIdentity
  linkExpiresAt?: string
  serverNow?: string
  sessionExpiresAt?: string
  idleExpiresAt?: string
  sessionDurationMinutes?: number
  inactivityMinutes?: number
  error?: string
}

export function DemoAccessShell({ token }: { token: string }) {
  const [payload, setPayload] = useState<AccessPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<"otp" | "verify" | "start" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const statePanelRef = useRef<HTMLDivElement>(null)
  const previousStateRef = useRef<AccessState | null>(null)
  const state = payload?.state || "unavailable"
  const modules = payload?.modules || []

  const probeState = useCallback(async (): Promise<AccessPayload> => {
    const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}?probe=1`, {
      cache: "no-store",
      credentials: "same-origin",
    })
    const result = await response.json().catch(() => ({ success: false, state: "unavailable" })) as AccessPayload
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      throw new Error("transient probe failure")
    }
    if (result.state !== "active") {
      setPayload({ ...result, state: result.state || "unavailable" })
    } else {
      setPayload((current) => current ? { ...current, ...result } : result)
    }
    return result
  }, [token])

  const loadState = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      const result = await response.json().catch(() => ({ success: false, state: "unavailable" })) as AccessPayload
      setPayload(response.ok ? result : { ...result, state: result.state || "unavailable" })
    } catch {
      setError("Demo məlumatını yükləyə bilmədik. İnternet bağlantısını yoxlayın.")
      setPayload((current) => current?.state === "active" ? { success: false, state: "connection_lost" } : current)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void loadState() }, [loadState])

  useEffect(() => {
    const previousLanguage = document.documentElement.lang
    const hadDarkTheme = document.documentElement.classList.contains("dark")
    document.documentElement.lang = "az"
    document.documentElement.classList.remove("dark")
    return () => {
      document.documentElement.lang = previousLanguage
      if (hadDarkTheme) document.documentElement.classList.add("dark")
    }
  }, [])

  useEffect(() => {
    if (payload?.state !== "active") return
    let consecutiveFailures = 0

    const checkLifecycle = async () => {
      try {
        await probeState()
        consecutiveFailures = 0
      } catch {
        consecutiveFailures += 1
        // One missed probe tolerates a short network handover. Two consecutive
        // misses remove the already-loaded player until the server can confirm
        // that the one-session grant is still active.
        if (consecutiveFailures >= 2) {
          setPayload({ success: false, state: "connection_lost" })
        }
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkLifecycle()
    }

    const interval = window.setInterval(() => { void checkLifecycle() }, 30_000)
    window.addEventListener("focus", checkLifecycle)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", checkLifecycle)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [payload?.state, probeState])

  const handleAccessLost = useCallback(() => {
    void probeState().catch(() => {
      setPayload({ success: false, state: "connection_lost" })
    })
  }, [probeState])

  useEffect(() => {
    if (!payload) return
    const previousState = previousStateRef.current
    previousStateRef.current = state
    if (!previousState || previousState === state || state === "active") return
    window.requestAnimationFrame(() => statePanelRef.current?.focus())
  }, [payload, state])

  async function sendOtp() {
    setAction("otp")
    setError(null)
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/otp`, {
        method: "POST",
        credentials: "same-origin",
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || "Kodu göndərə bilmədik")
      setCodeSent(true)
      setPayload((current) => current ? { ...current, state: "otp_sent" } : current)
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Kodu göndərə bilmədik")
    } finally {
      setAction(null)
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAction("verify")
    setError(null)
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || "Kodu təsdiqləyə bilmədik")
      setCode("")
      setPayload((current) => current ? { ...current, state: "verified" } : current)
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Kodu təsdiqləyə bilmədik")
    } finally {
      setAction(null)
    }
  }

  async function startDemo() {
    setAction("start")
    setError(null)
    try {
      const response = await fetch(`/api/v1/public/demo-access/${encodeURIComponent(token)}/start`, {
        method: "POST",
        credentials: "same-origin",
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || "Demonu başlada bilmədik")
      await loadState()
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Demonu başlada bilmədik")
    } finally {
      setAction(null)
    }
  }

  if (loading && !payload) return <LoadingScreen />

  // A scenario grant opens the guided journey. The manifest is looked up by
  // the id the SERVER returned, so a tampered payload cannot summon one the
  // grant was not issued for; an unknown id falls through to the states
  // below rather than rendering an empty player.
  if (payload?.state === "active" && payload.company && payload.watermark && payload.scenario && payload.identity) {
    const manifest = getDemoJourneyScenario(payload.scenario.scenarioId)
    if (manifest && manifest.version === payload.scenario.scenarioVersion) {
      return <DemoJourneyPlayer
        key={token}
        token={token}
        manifest={manifest}
        identity={payload.identity}
        company={payload.company}
        watermark={payload.watermark}
        serverNow={payload.serverNow}
        sessionExpiresAt={payload.sessionExpiresAt}
        idleExpiresAt={payload.idleExpiresAt}
        onAccessLost={handleAccessLost}
      />
    }
  }

  if (payload?.state === "active" && payload.company && payload.watermark && payload.modules) {
    return <DemoPlayer
      key={token}
      token={token}
      company={payload.company}
      watermark={payload.watermark}
      modules={payload.modules as DemoModuleManifest[]}
      serverNow={payload.serverNow}
      sessionExpiresAt={payload.sessionExpiresAt}
      idleExpiresAt={payload.idleExpiresAt}
      onAccessLost={handleAccessLost}
    />
  }

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-white text-[#102a43]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[-55%] -z-10 bg-[radial-gradient(115%_115%_at_88%_2%,#ffe2c2_0%,#fff1de_10%,#e5f6f1_21%,#cdeff5_34%,#f8fbfa_48%,#ffffff_66%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-50 [background-image:linear-gradient(to_right,rgba(15,50,65,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,50,65,0.035)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="mx-auto flex min-h-dvh w-full max-w-[1560px] flex-col gap-8 px-5 py-6 sm:px-9 lg:px-12">
        <header className="flex items-center justify-between">
          <Image src="/logo.svg" alt="LeadDrive CRM" width={164} height={40} priority className="h-9 w-auto" />
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d9e2e7] bg-white/85 px-3.5 text-sm font-semibold text-[#17384a] shadow-sm backdrop-blur">
            <span aria-hidden="true" className="text-base">🇦🇿</span>
            <span className="hidden sm:inline">Azərbaycan dili</span><span className="sm:hidden">AZ</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 items-center gap-10 py-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(520px,1.18fr)] lg:gap-16 lg:py-8">
          <section className="mx-auto flex w-full max-w-xl flex-col lg:mx-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a83e15]">Sizin üçün hazırlanmış məhsul demosu</p>
            <h1 className="mt-4 max-w-xl text-[clamp(2.25rem,4.2vw,4rem)] font-semibold leading-[1.03] tracking-[-0.045em] text-[#0a2540]">
              {payload?.company ? `${payload.company}, LeadDrive-a xoş gəlmisiniz.` : "LeadDrive demosuna xoş gəlmisiniz."}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-[#486477] sm:text-lg">
              Seçilmiş modulları real iş ssenarilərinə bənzəyən, tam sintetik məlumatlarla hazırlanmış interaktiv turda kəşf edin.
            </p>

            <ul className="order-3 mt-7 grid gap-3 text-sm text-[#29485a] sm:text-[15px] lg:order-2">
              <li className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#b74617]" /><span>Şirkətinizin ehtiyaclarına uyğun seçilmiş demo marşrutu</span></li>
              <li className="flex items-start gap-3"><Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-[#b74617]" /><span>Məhsulu addım-addım sınamaq üçün interaktiv səhnələr</span></li>
              <li className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#b74617]" /><span>LeadDrive hesabı yaratmadan qorunan bir brauzer sessiyası</span></li>
            </ul>

            <div ref={statePanelRef} tabIndex={-1} className="order-2 mt-7 max-w-md outline-none lg:order-3 lg:mt-8">
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{accessStateAnnouncement(state)}</p>
            {state === "ready_for_otp" || state === "otp_sent" ? (
              <>
                <div className="flex items-center gap-3 text-sm font-semibold text-[#17384a]"><StateIcon icon={Mail} /><span>Dəvəti e-poçtla təsdiqləyin</span></div>
                <p className="mt-3 text-sm leading-6 text-[#5b7280]">6 rəqəmli kod <strong className="font-semibold text-[#17384a]">{payload?.recipient || "korporativ e-poçtunuza"}</strong> göndəriləcək. Linki açmaq sessiyanı hələ başlatmır.</p>
                {state === "ready_for_otp" && !codeSent ? (
                  <Button onClick={sendOtp} disabled={action !== null} className="mt-6 min-h-14 rounded-full bg-[#172f3f] px-6 text-base text-white shadow-[inset_0_-2px_3px_rgba(0,0,0,0.28)] hover:bg-[#0a2540]">
                    {action === "otp" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Giriş kodunu göndər<ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <form onSubmit={verifyOtp} className="mt-6 space-y-4">
                    <label htmlFor="demo-otp" className="block text-sm font-semibold text-[#17384a]">E-poçtdakı kod</label>
                    <Input
                      id="demo-otp"
                      autoFocus
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
                      className="h-14 rounded-full border-[#cbd7dd] bg-white px-6 text-center text-xl font-bold tracking-[0.35em] text-[#0a2540] shadow-sm"
                      placeholder="000000"
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={action !== null || code.length !== 6} className="min-h-12 rounded-full bg-[#172f3f] px-6 text-white hover:bg-[#0a2540]">
                        {action === "verify" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Təsdiqlə və davam et
                      </Button>
                      <Button type="button" variant="ghost" className="rounded-full text-[#486477]" disabled={action !== null} onClick={sendOtp}>Kodu yenidən göndər</Button>
                    </div>
                  </form>
                )}
              </>
            ) : state === "verified" ? (
              <>
                <div className="flex items-center gap-3 text-sm font-semibold text-[#17384a]"><StateIcon icon={LockKeyhole} /><span>Demo hazırdır</span></div>
                <p className="mt-3 text-sm leading-6 text-[#5b7280]">Başladıqdan sonra sessiya bu brauzerə bağlanacaq. Səhifəni yeniləyə və qısa internet kəsilməsindən sonra davam edə bilərsiniz.</p>
                <GrantContents scenario={payload?.scenario} modules={modules} />
                <Button onClick={startDemo} disabled={action !== null} className="mt-6 min-h-14 rounded-full bg-[#172f3f] px-7 text-base text-white shadow-[inset_0_-2px_3px_rgba(0,0,0,0.28)] hover:bg-[#0a2540]">
                  {action === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}Demonu başlat<ArrowRight className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <TerminalState state={state} />
                {state === "connection_lost" ? (
                  <Button type="button" onClick={() => { void loadState() }} disabled={loading} className="mt-6 min-h-12 rounded-full bg-[#172f3f] px-6 text-white hover:bg-[#0a2540]">
                    {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Yenidən qoşul
                  </Button>
                ) : null}
              </>
            )}

            {error ? <p role="alert" className="mt-5 rounded-2xl border border-[#e9b8aa] bg-[#fff4ef] px-4 py-3 text-sm text-[#8f2f21]">{error}</p> : null}
            {state === "ready_for_otp" || state === "otp_sent" ? <GrantContents scenario={payload?.scenario} modules={modules} /> : null}
            </div>

            <p className="order-4 mt-6 flex items-start gap-2 text-xs leading-5 text-[#516d7c]">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sessiya başladıqdan sonra {payload?.sessionDurationMinutes || 120} dəqiqəyədək aktivdir və {payload?.inactivityMinutes || 30} dəqiqə fəaliyyətsizlikdən sonra bağlanır.
            </p>
          </section>

          <section aria-label="Demo önizləməsi" className="relative mx-auto w-full max-w-4xl">
            <DemoPreview moduleCount={modules.length} sectionCount={payload?.scenario?.sections} company={payload?.company} />
          </section>
        </div>

        <footer className="flex items-center justify-between gap-4 pb-1 text-[11px] text-[#77909d] sm:text-xs">
          <span className="text-[#526d7b]">LeadDrive CRM · Məxfi məhsul təqdimatı</span>
          <span className="text-[#526d7b]">Yalnız sintetik məlumat</span>
        </footer>
      </div>
    </main>
  )
}

function StateIcon({ icon: Icon }: { icon: typeof Mail }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff0e5] text-[#c64f1c]"><Icon className="h-4 w-4" /></span>
}

/**
 * What the prospect was granted, in the lobby before they start: one guided
 * scenario, or the legacy module playlist. Never both — the grant is one or
 * the other by construction.
 */
function GrantContents({ scenario, modules }: { scenario?: ScenarioPreview; modules: readonly ModulePreview[] }) {
  if (scenario) {
    return (
      <div className="mt-6 rounded-2xl border border-[#dbe5e9] bg-white/70 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#516d7c]">
          Sizin marşrutunuz{typeof scenario.sections === "number" ? ` · ${scenario.sections} bölmə` : ""}
        </p>
        {scenario.title ? <p className="mt-2 text-sm font-semibold text-[#17384a]">{scenario.title}</p> : null}
        {scenario.summary ? <p className="mt-1 text-sm leading-6 text-[#5b7280]">{scenario.summary}</p> : null}
      </div>
    )
  }
  if (!modules.length) return null
  return <ModuleList modules={modules} />
}

function ModuleList({ modules }: { modules: readonly ModulePreview[] }) {
  const visibleModules = modules.slice(0, 5)
  const hiddenCount = Math.max(0, modules.length - visibleModules.length)

  return (
    <div className="mt-6 border-y border-[#dbe4e8] py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#516d7c]">Sizin marşrutunuz · {modules.length} modul</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleModules.map((module) => <span key={module.id} className="rounded-full border border-[#d5e0e5] bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#29485a] shadow-sm">{module.title}</span>)}
        {hiddenCount ? <span className="rounded-full bg-[#e8f1f3] px-3 py-1.5 text-xs font-semibold text-[#486477]">+{hiddenCount} modul</span> : null}
      </div>
    </div>
  )
}

function TerminalState({ state }: { state: AccessState }) {
  const copy: Record<Exclude<AccessState, "ready_for_otp" | "otp_sent" | "verified" | "active">, { title: string; body: string; icon: typeof ShieldX }> = {
    active_elsewhere: { title: "Sessiya başqa brauzerdə aktivdir", body: "Bu demo başladıldığı brauzerdə davam etdirilə bilər. Yeni giriş üçün demo sahibindən yeni link istəyin.", icon: LockKeyhole },
    completed: { title: "Demo sessiyası tamamlandı", body: "Bu birdəfəlik link yenidən istifadə edilə bilməz. Növbəti addım üçün LeadDrive nümayəndəsi ilə əlaqə saxlayın.", icon: CheckCircle2 },
    expired: { title: "Demo müddəti bitib", body: "Təhlükəsizlik səbəbilə bu link və ya aktiv sessiya artıq işləmir. Yeni link üçün demo sahibinə müraciət edin.", icon: Clock3 },
    revoked: { title: "Demo girişi dayandırılıb", body: "Bu giriş demo sahibi tərəfindən ləğv edilib. Sualınız varsa, sizə linki göndərən şəxslə əlaqə saxlayın.", icon: ShieldX },
    connection_lost: { title: "Demo müvəqqəti dayandırılıb", body: "Sessiyanın hələ aktiv olduğunu təsdiqləyə bilmirik. İnternet bağlantısını bərpa edib yenidən qoşulun.", icon: ShieldCheck },
    unavailable: { title: "Demo tapılmadı", body: "Link düzgün deyil və ya artıq əlçatan deyil. E-poçtdakı tam linkdən istifadə edin.", icon: ShieldX },
  }
  const item = copy[state as keyof typeof copy] || copy.unavailable
  return <><div className="flex items-center gap-3"><StateIcon icon={item.icon} /><h2 className="text-xl font-semibold tracking-tight text-[#0a2540] sm:text-2xl">{item.title}</h2></div><p className="mt-4 max-w-xl text-sm leading-6 text-[#5b7280]">{item.body}</p></>
}

function accessStateAnnouncement(state: AccessState): string {
  const announcements: Record<AccessState, string> = {
    ready_for_otp: "Demo dəvəti hazırdır. E-poçt təsdiq kodunu göndərin.",
    otp_sent: "Təsdiq kodu göndərildi. E-poçtdakı altı rəqəmli kodu daxil edin.",
    verified: "E-poçt təsdiqləndi. Demo başlamağa hazırdır.",
    active: "Demo sessiyası başladı.",
    active_elsewhere: "Sessiya başqa brauzerdə aktivdir.",
    completed: "Demo sessiyası tamamlandı.",
    expired: "Demo müddəti bitib.",
    revoked: "Demo girişi dayandırılıb.",
    connection_lost: "Demo müvəqqəti dayandırılıb.",
    unavailable: "Demo tapılmadı.",
  }
  return announcements[state]
}

function LoadingScreen() {
  return <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(100%_100%_at_85%_0%,#ffe2c2_0%,#e7f8f2_22%,#ffffff_58%)] text-[#0a2540]"><div className="text-center"><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-[#d65b28]" /><p className="mt-4 text-sm font-medium">Şəxsi demo hazırlanır…</p></div></main>
}

function DemoPreview({ moduleCount, sectionCount, company }: { moduleCount: number; sectionCount?: number; company?: string }) {
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-black/[0.07] bg-[#f8faf9]/95 p-3 shadow-[0_28px_90px_-38px_rgba(10,37,64,0.38)] backdrop-blur-sm sm:p-4">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[20px] border border-[#dfe8eb] bg-[#f8fafc]">
        <div className="grid h-full grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]">
          <div className="border-r border-[#dfe8eb] bg-[#0a2540] p-3 text-white sm:p-4">
            <div className="flex h-8 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff6d00] text-[9px] font-black">LD</span>
              <span className="hidden text-xs font-semibold sm:block">LeadDrive</span>
            </div>
            <div className="mt-8 space-y-2.5">
              {[Users, TrendingUp, BarChart3, Layers3].map((Icon, index) => (
                <div key={index} className={`flex h-9 items-center gap-2 rounded-lg px-2 ${index === 0 ? "bg-white/12" : "text-white/55"}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden h-1.5 rounded-full bg-current sm:block" style={{ width: `${48 + index * 8}px` }} />
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="h-2 w-20 rounded-full bg-[#d7e2e7]" />
                <div className="mt-2 h-4 w-40 max-w-[55vw] rounded-full bg-[#15384c]" />
              </div>
              <div className="h-9 w-9 rounded-full border border-[#dfe8eb] bg-white" />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
              {[
                ["68", "+12%", "#e7f5ef"],
                ["₼184K", "+8.4%", "#fff0e4"],
                ["92%", "+4.1%", "#e8f2fb"],
              ].map(([value, trend, background]) => (
                <div key={value} className="rounded-xl border border-[#e2eaed] bg-white p-3 sm:p-4">
                  <div className="h-1.5 w-10 rounded-full bg-[#dbe5e9]" />
                  <p className="mt-3 text-sm font-bold text-[#0a2540] sm:text-xl">{value}</p>
                  <span className="mt-2 inline-flex rounded-full px-2 py-1 text-[8px] font-bold text-[#315b4a] sm:text-[10px]" style={{ background }}>{trend}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 grid min-h-0 grid-cols-[1.3fr_0.7fr] gap-3 sm:mt-4">
              <div className="rounded-xl border border-[#e2eaed] bg-white p-3 sm:p-4">
                <div className="flex h-24 items-end gap-2 sm:h-32">
                  {[42, 64, 48, 82, 68, 92, 76].map((height, index) => <span key={index} className="min-w-0 flex-1 rounded-t bg-[#ff8a3d]" style={{ height: `${height}%`, opacity: 0.42 + index * 0.07 }} />)}
                </div>
              </div>
              <div className="rounded-xl border border-[#e2eaed] bg-white p-3 sm:p-4">
                <div className="h-2 w-14 rounded-full bg-[#dbe5e9]" />
                <div className="mt-4 space-y-3">
                  {[72, 56, 84].map((width, index) => <div key={index}><div className="h-1.5 rounded-full bg-[#dfe8eb]" style={{ width: `${width}%` }} /><div className="mt-1.5 h-1 rounded-full bg-[#edf2f4]" /></div>)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center bg-[#0a2540]/18 p-5 backdrop-blur-[3px]">
          <div className="max-w-xs rounded-2xl border border-white/65 bg-white/88 px-5 py-4 text-center shadow-xl backdrop-blur-md">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf1f3] text-[#0a2540]"><Layers3 className="h-4 w-4" /></span>
            <p className="mt-3 text-sm font-semibold text-[#0a2540]">{company ? `${company} üçün demo` : "Şəxsi demo"}</p>
            <p className="mt-1 text-xs text-[#5b7280]">Önizləmə · {typeof sectionCount === "number" ? `${sectionCount} bölmə` : `${moduleCount || 0} seçilmiş modul`} · bir sessiya</p>
          </div>
        </div>
      </div>
    </div>
  )
}
