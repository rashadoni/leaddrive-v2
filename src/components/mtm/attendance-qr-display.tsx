"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTimeZone, useTranslations } from "next-intl"
import { MonitorSmartphone, ShieldCheck } from "lucide-react"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import { formatDateTime, formatTime } from "@/lib/format-date"
import type { AttendanceBranchScreenDirectory, AttendanceBranchScreenPairing } from "@/lib/mtm/attendance-qr-contract"

const ENDPOINT = "/api/v1/mtm/attendance/branch-screens"
// The screen asks for a code every minute and is stamped at most once a minute.
const ONLINE_WITHIN_MS = 3 * 60_000
const PAIRING_POLL_MS = 5_000

/**
 * Personnel → Settings → QR. The branch QR is shown only on a screen paired
 * to the branch (a tablet at the entrance); this page pairs and revokes
 * screens. It never shows a code itself (owner, 2026-10-29).
 */
export function MtmAttendanceQrDisplay() {
  const t = useTranslations("mtmAttendance"), locale = useLocale(), timeZone = useTimeZone()
  const [directory, setDirectory] = useState<AttendanceBranchScreenDirectory | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [denied, setDenied] = useState(false)
  const [pairing, setPairing] = useState<(AttendanceBranchScreenPairing & { screensBefore: number }) | null>(null)
  const [pairedBranch, setPairedBranch] = useState<string | null>(null), [confirming, setConfirming] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" })
      if (!mounted.current) return null
      if ([401, 403, 404].includes(response.status)) { setDirectory(null); setDenied(true); return null }
      const body = await response.json()
      if (!response.ok || body?.success !== true || typeof body.data?.enabled !== "boolean" || !Array.isArray(body.data?.branches)) throw new Error("INVALID_DIRECTORY")
      if (!mounted.current) return null
      setDirectory(body.data); setDenied(false); setError(false); setNow(Date.now())
      return body.data as AttendanceBranchScreenDirectory
    } catch { if (mounted.current) setError(true); return null }
  }, [])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [load])
  // While a code waits on the tablet: notice the new screen, and drop the code when it expires.
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(async () => {
      if (Date.now() >= Date.parse(pairing.expiresAt)) { setPairing(null); return }
      const next = await load()
      const branch = next?.branches.find(row => row.id === pairing.branch.id)
      if (branch && branch.screens.length > pairing.screensBefore) { setPairing(null); setPairedBranch(branch.id) }
    }, PAIRING_POLL_MS)
    return () => clearInterval(timer)
  }, [pairing, load])
  async function mutate(run: () => Promise<Response>) {
    if (busy) return null
    setBusy(true); setError(false)
    try {
      const response = await run()
      if (!mounted.current) return null
      if ([401, 403].includes(response.status)) { await load(); setError(true); return null }
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true) { await load(); setError(true); return null }
      return body.data
    } catch { if (mounted.current) setError(true); return null }
    finally { if (mounted.current) setBusy(false) }
  }
  async function toggle() {
    if (!directory?.canConfigure) return
    await mutate(() => fetch("/api/v1/mtm/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendanceBranchQrEnabled: !directory.enabled }) }))
    await load()
  }
  async function pair(branchId: string, screensBefore: number) {
    setPairedBranch(null); setConfirming(null)
    const data = await mutate(() => fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId }) })) as AttendanceBranchScreenPairing | null
    if (data?.code && data.branch?.id === branchId) setPairing({ ...data, screensBefore })
  }
  async function revoke(screenId: string) {
    setConfirming(null)
    await mutate(() => fetch(`${ENDPOINT}/${encodeURIComponent(screenId)}/revoke`, { method: "POST" }))
    await load()
  }
  const when = (iso: string) => formatDateTime(iso, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone })
  const distance = (meters: number) => meters < 1000
    ? t("qrScreenDistanceMeters", { meters })
    : t("qrScreenDistanceKm", { km: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000) })
  const screenUrl = typeof window === "undefined" ? "/screen" : `${window.location.host}/screen`
  if (denied) return <p role="status">{t("reportAccessUnavailable")}</p>
  return <main className="min-w-0 space-y-5" data-testid="attendance-qr-display">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("qrTitle")}</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("qrScreenIntro")}</p></div>
    <HomeCard testId="attendance-qr-rule" titleId="attendance-qr-rule-title" title={t("qrRule")} icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />} tone="green">
      <div className="flex flex-wrap items-center justify-between gap-4 py-4"><p className="max-w-3xl text-sm text-muted-foreground">{t("qrRuleHint")}</p>
        {/* State and action in words: a button reading "On" looked like a status, yet pressing it switched the rule off. */}
        {directory && <div className="flex flex-wrap items-center gap-3"><HomePill tone={directory.enabled ? "green" : "zinc"}>{t(directory.enabled ? "installationOn" : "installationOff")}</HomePill>
          {directory.canConfigure && <Button type="button" variant={directory.enabled ? "outline" : "default"} role="switch" aria-checked={directory.enabled} aria-label={t("qrRule")} className="min-h-11" disabled={busy} onClick={() => void toggle()}>{t(directory.enabled ? "qrTurnOff" : "qrTurnOn")}</Button>}</div>}
      </div>
    </HomeCard>
    {error && <p role="alert" className="text-sm text-destructive">{t("qrScreenError")}</p>}
    {directory?.enabled ? <HomeCard testId="attendance-qr-screens" titleId="attendance-qr-screens-title" title={t("qrScreensTitle")} icon={<MonitorSmartphone className="h-5 w-5" aria-hidden="true" />} tone="orange">
      {!directory.branches.length ? <div className="space-y-3 py-4" data-testid="attendance-qr-no-branches"><p className="text-sm leading-relaxed">{t("qrEmptyAdd")}</p>
        <Button asChild className="min-h-11 rounded-full"><Link href="/mtm/attendance/people?tab=branches" prefetch={false}>{t("qrAddBranch")}</Link></Button></div>
        : <div className="divide-y">{directory.branches.map(branch => <div key={branch.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start" data-testid="attendance-qr-branch">
          <div className="min-w-0 space-y-2"><p className="font-medium">{branch.name}</p>
            {branch.screens.length ? branch.screens.map(screen => {
              const online = screen.lastSeenAt !== null && now - Date.parse(screen.lastSeenAt) < ONLINE_WITHIN_MS
              return <div key={screen.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid="attendance-qr-screen">
                <span className="text-muted-foreground">{t("qrScreenPaired", { date: when(screen.pairedAt) })}</span>
                <HomePill tone={online ? "green" : "amber"}>{online ? t("qrScreenOnline") : screen.lastSeenAt ? t("qrScreenOfflineSince", { date: when(screen.lastSeenAt) }) : t("qrScreenNeverSeen")}</HomePill>
                {/* A screen away from its branch, or unable to say where it is, shows no code. */}
                {screen.place?.state === "AWAY" && screen.place.distanceMeters !== null && <HomePill tone="red">{t("qrScreenAway", { distance: distance(screen.place.distanceMeters) })}</HomePill>}
                {screen.place?.state === "NO_FIX" && <HomePill tone="amber">{t("qrScreenNoFix")}</HomePill>}
                {directory.canConfigure && (confirming === screen.id
                  ? <span className="flex flex-wrap items-center gap-2"><span>{t("qrScreenRevokeConfirm")}</span>
                    <Button type="button" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void revoke(screen.id)}>{t("qrScreenRevokeYes")}</Button>
                    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirming(null)}>{t("qrScreenRevokeNo")}</Button></span>
                  : <Button type="button" variant="outline" className="min-h-11 text-destructive" disabled={busy} onClick={() => setConfirming(screen.id)}>{t("qrScreenRevoke")}</Button>)}
              </div>
            }) : <p className="text-sm text-amber-700" data-testid="attendance-qr-branch-unscreened">{t("qrScreenNone")}</p>}
            {pairedBranch === branch.id && <p role="status" className="text-sm text-emerald-700">{t("qrScreenJustPaired")}</p>}
            {pairing?.branch.id === branch.id && <div className="space-y-2 rounded-xl border bg-muted/40 p-4" data-testid="attendance-qr-pairing">
              <p className="text-sm">{t("qrScreenPairOpen", { url: screenUrl })}</p>
              <p className="font-mono text-3xl font-semibold tracking-widest" data-testid="attendance-qr-pairing-code">{pairing.code}</p>
              <p className="text-sm">{t("qrScreenPlaceHint")}</p>
              <p className="text-xs text-muted-foreground">{t("qrScreenPairHint", { time: formatTime(pairing.expiresAt, locale, { hour: "2-digit", minute: "2-digit", timeZone }) })}</p>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPairing(null)}>{t("qrScreenPairClose")}</Button>
            </div>}
          </div>
          {directory.canConfigure && <Button type="button" className="min-h-11" disabled={busy} onClick={() => void pair(branch.id, branch.screens.length)}>{t("qrScreenPair")}</Button>}
        </div>)}</div>}
    </HomeCard> : directory && <p className="text-sm text-muted-foreground">{t("qrOffHint")}</p>}
    <p className="border-l-2 border-orange-400 pl-4 text-sm text-muted-foreground">{t("qrScreenGpsHint")}</p>
    <p className="text-sm text-muted-foreground">{t("qrPrivacy")}</p>
  </main>
}
