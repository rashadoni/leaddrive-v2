"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { AttendanceBranchScreenQr } from "@/lib/mtm/attendance-qr-contract"

const PAIR_ENDPOINT = "/api/v1/public/attendance-screen/pair"
const QR_ENDPOINT = "/api/v1/public/attendance-screen/qr"
// The next code (and the position it needs) is fetched a little before this one runs out, so the screen never stands empty.
const REFRESH_BEFORE_MS = 15_000
const RETRY_MS = 15_000
// A fresh position before every code: a still tablet's watcher may stay silent for hours.
const FIX_OPTIONS = { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 }
const LANGUAGES = [{ code: "az", label: "AZ" }, { code: "ru", label: "RU" }, { code: "en", label: "EN" }] as const

type Showing = Extract<AttendanceBranchScreenQr, { state: "SHOWING" }> & { deadline: number }
type View =
  | { kind: "loading" }
  | { kind: "pair"; refused?: boolean; limited?: boolean }
  | { kind: "showing"; code: Showing }
  | { kind: "waiting"; state: "QR_OFF" | "BRANCH_UNAVAILABLE"; organizationName?: string; branchName?: string }
  | { kind: "offline"; organizationName?: string; branchName?: string }
  | { kind: "away"; reason: "AWAY" | "NO_FIX"; distanceMeters: number | null; organizationName: string; branchName: string }
type Geo = "off" | "waiting" | "ok" | "denied" | "unavailable"
type Fix = { latitude: number; longitude: number; accuracy: number; at: number }

const isHidden = () => document.visibilityState === "hidden"

/** The whole branch screen: the pairing form until paired, then the branch's live QR. */
export function AttendanceBranchScreenKiosk() {
  const t = useTranslations("attendanceBranchScreen"), locale = useLocale()
  const [view, setView] = useState<View>({ kind: "loading" })
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [seconds, setSeconds] = useState(0)
  const mounted = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null), last = useRef<{ organizationName?: string; branchName?: string }>({})
  // The screen's own position (owner, 2026-10-30): a code is given only to a screen at its branch.
  const [geo, setGeo] = useState<Geo>("off")
  // Positions are asked for only once the screen is known to be paired: an unpaired page asks for nothing.
  const geoRef = useRef<Geo>("off"), fix = useRef<Fix | null>(null), locating = useRef(false)
  const setGeoState = useCallback((value: Geo) => { geoRef.current = value; setGeo(value) }, [])
  /** The browser's current position, kept with the moment it was taken; a failure keeps the last one (the server judges its age). */
  const locate = useCallback(() => new Promise<void>(resolve => {
    if (!("geolocation" in navigator)) { setGeoState("unavailable"); return resolve() }
    if (geoRef.current === "off") setGeoState("waiting")
    navigator.geolocation.getCurrentPosition(position => {
      fix.current = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, at: position.timestamp || Date.now() }
      setGeoState("ok"); resolve()
    }, error => {
      if (error.code === error.PERMISSION_DENIED) { fix.current = null; setGeoState("denied") }
      else if (!fix.current) setGeoState("unavailable")
      resolve()
    }, FIX_OPTIONS)
  }), [setGeoState])
  const later = useCallback((run: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(run, ms)
  }, [])
  const fetchCode = useCallback(async (): Promise<void> => {
    if (document.visibilityState === "hidden") return
    if (locating.current) await locate()
    // Hidden while the position was being found: the page asks again when it is shown.
    if (!mounted.current || isHidden()) return
    const sent = performance.now()
    try {
      const position = fix.current
      const body = position ? { fix: { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy, ageMs: Math.max(0, Date.now() - position.at) } } : {}
      const response = await fetch(QR_ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      if (!mounted.current) return
      const answer = await response.json().catch(() => null)
      if (!response.ok || answer?.success !== true) throw new Error("SCREEN_UNAVAILABLE")
      const data = answer.data as AttendanceBranchScreenQr
      if (data.state === "UNPAIRED") { setView({ kind: "pair" }); return }
      last.current = { organizationName: data.organizationName, branchName: data.branch?.name }
      // A paired screen asked for the first time without a position: find it, then ask again at once.
      if (data.state === "NOT_AT_BRANCH" && data.reason === "NO_FIX" && !locating.current) {
        locating.current = true
        setView(current => current.kind === "showing" ? current : { kind: "loading" })
        return fetchCode()
      }
      if (data.state === "NOT_AT_BRANCH") {
        setView({ kind: "away", reason: data.reason, distanceMeters: data.distanceMeters, organizationName: data.organizationName, branchName: data.branch.name })
        later(() => void fetchCode(), RETRY_MS); return
      }
      if (data.state !== "SHOWING") { setView({ kind: "waiting", state: data.state, ...last.current }); later(() => void fetchCode(), RETRY_MS); return }
      const life = Date.parse(data.expiresAt) - Date.parse(data.serverNow) - (performance.now() - sent)
      if (!data.dataUrl?.startsWith("data:image/png;base64,") || !Number.isFinite(life) || life <= 0 || life > 60_000) throw new Error("SCREEN_CODE_INVALID")
      setSeconds(Math.ceil(life / 1000))
      setView({ kind: "showing", code: { ...data, deadline: performance.now() + life } })
      later(() => void fetchCode(), Math.max(1_000, life - REFRESH_BEFORE_MS))
    } catch {
      if (!mounted.current) return
      // No connection: an expired code is taken off the screen by the countdown; try again shortly.
      setView(current => current.kind === "showing" ? current : { kind: "offline", ...last.current })
      later(() => void fetchCode(), RETRY_MS)
    }
  }, [later, locate])
  useEffect(() => {
    mounted.current = true
    void fetchCode()
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current) }
  }, [fetchCode])
  // Countdown; a code past its minute never stays on the screen.
  useEffect(() => {
    if (view.kind !== "showing") return
    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((view.code.deadline - performance.now()) / 1000))
      setSeconds(left)
      if (!left) { setView({ kind: "offline", ...last.current }); void fetchCode() }
    }, 250)
    return () => clearInterval(tick)
  }, [view, fetchCode])
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") { if (timer.current) clearTimeout(timer.current); setView(current => current.kind === "showing" ? { kind: "loading" } : current) }
      else void fetchCode()
    }
    document.addEventListener("visibilitychange", visibility)
    return () => document.removeEventListener("visibilitychange", visibility)
  }, [fetchCode])
  // Keep the tablet awake while it shows codes, where the browser allows it.
  useEffect(() => {
    if (view.kind !== "showing" || !("wakeLock" in navigator)) return
    let lock: { release: () => Promise<void> } | null = null
    void (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen").then(value => { lock = value }).catch(() => {})
    return () => { void lock?.release().catch(() => {}) }
  }, [view.kind])
  async function pair(event: FormEvent) {
    event.preventDefault()
    if (busy || !code.trim()) return
    setBusy(true)
    try {
      const response = await fetch(PAIR_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })
      if (!mounted.current) return
      if (response.status === 429) { setView({ kind: "pair", limited: true }); return }
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true) { setView({ kind: "pair", refused: true }); return }
      setCode(""); setView({ kind: "loading" }); locating.current = true; await fetchCode()
    } catch { if (mounted.current) setView({ kind: "pair", refused: true }) }
    finally { if (mounted.current) setBusy(false) }
  }
  const distanceLabel = (meters: number) => meters < 1000
    ? t("distanceMeters", { meters })
    : t("distanceKm", { km: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000) })
  const header = (organizationName?: string, branchName?: string) => (organizationName || branchName) && <div className="space-y-1 text-center">
    {organizationName && <p className="text-base text-muted-foreground">{organizationName}</p>}
    {branchName && <h1 className="text-3xl font-semibold tracking-tight md:text-4xl" data-testid="branch-screen-branch">{branchName}</h1>}
  </div>
  return <main className="flex min-h-screen flex-col bg-background px-4 py-6 text-foreground" data-testid="branch-screen">
    <nav aria-label={t("languageLabel")} className="flex justify-end gap-2 text-sm">
      {LANGUAGES.map(language => <a key={language.code} href={`/screen?lang=${language.code}`} aria-current={language.code === locale ? "true" : undefined}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md ${language.code === locale ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{language.label}</a>)}
    </nav>
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8">
      {view.kind === "loading" && <p role="status" className="text-muted-foreground">{t("loading")}</p>}
      {view.kind === "pair" && <form onSubmit={event => void pair(event)} className="w-full max-w-md space-y-5" data-testid="branch-screen-pair">
        <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("pairTitle")}</h1><p className="text-sm leading-relaxed text-muted-foreground">{t("pairHint")}</p></div>
        <label className="block space-y-2 text-sm" htmlFor="branch-screen-code"><span>{t("pairCode")}</span>
          <input id="branch-screen-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32}
            placeholder="4F7K-92QD" className="block min-h-14 w-full rounded-lg border bg-background px-4 font-mono text-2xl uppercase tracking-widest" /></label>
        {view.refused && <p role="alert" className="text-sm text-destructive">{t("pairRefused")}</p>}
        {view.limited && <p role="alert" className="text-sm text-destructive">{t("pairLimited")}</p>}
        <Button type="submit" className="min-h-12 w-full text-base" disabled={busy || !code.trim()}>{t("pairButton")}</Button>
      </form>}
      {view.kind === "showing" && <>
        {header(view.code.organizationName, view.code.branch.name)}
        <div className="w-full max-w-md rounded-2xl border bg-white p-4"><Image src={view.code.dataUrl} alt={t("qrAlt")} width={480} height={480} unoptimized className="h-auto w-full" /></div>
        <div className="space-y-2 text-center"><p className="text-lg">{t("scanHint")}</p>
          <p className="text-2xl font-semibold tabular-nums text-emerald-700" data-testid="branch-screen-countdown">{t("countdown", { seconds })}</p></div>
      </>}
      {view.kind === "waiting" && <>{header(view.organizationName, view.branchName)}<p role="status" className="max-w-md text-center text-lg">{t(view.state === "QR_OFF" ? "qrOff" : "branchUnavailable")}</p></>}
      {view.kind === "away" && <>{header(view.organizationName, view.branchName)}
        <div role="status" className="max-w-md space-y-2 text-center" data-testid="branch-screen-away">
          <p className="text-lg font-medium">{t("notAtBranchTitle")}</p>
          <p className="text-muted-foreground">{view.reason === "AWAY" && view.distanceMeters !== null
            ? t("notAtBranchAway", { distance: distanceLabel(view.distanceMeters) })
            : t(geo === "denied" ? "locationDenied" : geo === "unavailable" ? "locationUnavailable" : "locationImprecise")}</p>
        </div></>}
      {view.kind === "offline" && <>{header(view.organizationName, view.branchName)}<p role="status" className="max-w-md text-center text-lg">{t("offline")}</p></>}
    </div>
  </main>
}
