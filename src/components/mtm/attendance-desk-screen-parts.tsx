"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { formatTime } from "@/lib/format-date"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { ATTENDANCE_BUILT_IN_BREAK_KINDS } from "@/lib/mtm/attendance-break-kinds-names"
import type { AttendanceBranchScreenQr, AttendanceDeskDay } from "@/lib/mtm/attendance-qr-contract"

const DESK_PAIR_ENDPOINT = "/api/v1/public/attendance-screen/desk-pair"
const DESK_BREAK_ENDPOINT = "/api/v1/public/attendance-screen/desk-break"
const TOKEN_LIFETIME_MS = 60_000
const POLL_MS = 3_000

/** 256 random bits of this browser, shown only in the pairing QR (`attendance-desk-screen.ts`). */
function newDeskToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `mtmd1.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`
}

/**
 * The employee's own computer, not yet paired (owner, 2026-11-04; mockup
 * desk-and-breaks/1-desk-computer.png, «Первый раз»): a QR that the employee
 * scans in LeadDrive Time. A new QR every minute; the page asks every three
 * seconds whether the phone has confirmed it.
 */
export function AttendanceDeskPairing({ onPaired, onReception }: { onPaired: () => void; onReception: () => void }) {
  const t = useTranslations("attendanceBranchScreen")
  const [shown, setShown] = useState<{ token: string; until: number } | null>(null), [dataUrl, setDataUrl] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(60), [failed, setFailed] = useState(false)
  const paired = useRef(false), done = useRef(onPaired)
  useEffect(() => { done.current = onPaired }, [onPaired])
  useEffect(() => {
    let alive = true
    const issue = async () => {
      const token = newDeskToken()
      // The token is asked about at once; its picture follows.
      setShown({ token, until: Date.now() + TOKEN_LIFETIME_MS }); setDataUrl(null)
      const image = await QRCode.toDataURL(token, { errorCorrectionLevel: "M", width: 480, margin: 4 }).catch(() => null)
      if (alive) setDataUrl(image)
    }
    void issue()
    const rotate = setInterval(() => void issue(), TOKEN_LIFETIME_MS)
    return () => { alive = false; clearInterval(rotate) }
  }, [])
  useEffect(() => {
    if (!shown) return
    let alive = true
    const ask = async () => {
      if (paired.current || document.visibilityState === "hidden") return
      try {
        const response = await fetch(DESK_PAIR_ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: shown.token }) })
        const body = await response.json().catch(() => null)
        if (!alive) return
        setFailed(!response.ok)
        if (response.ok && body?.state === "PAIRED") { paired.current = true; done.current() }
      } catch { if (alive) setFailed(true) }
    }
    const poll = setInterval(() => void ask(), POLL_MS)
    const tick = setInterval(() => setSeconds(Math.max(0, Math.ceil((shown.until - Date.now()) / 1000))), 250)
    return () => { alive = false; clearInterval(poll); clearInterval(tick) }
  }, [shown])
  return <div className="w-full max-w-2xl space-y-6 text-center" data-testid="desk-screen-pair">
    <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("deskPairTitle")}</h1>
    <div className="flex flex-col items-center gap-6 md:flex-row md:text-left">
      <div className="w-56 shrink-0 rounded-2xl border bg-white p-3">{dataUrl && <Image src={dataUrl} alt={t("deskPairAlt")} width={480} height={480} unoptimized className="h-auto w-full" data-testid="desk-screen-pair-qr" />}</div>
      <div className="space-y-3">
        <p className="text-lg">{t("deskPairHint")}</p>
        <p className="text-sm text-muted-foreground">{t("deskPairNote")}</p>
        <p className="font-semibold tabular-nums text-emerald-700">{t("deskPairCountdown", { seconds })}</p>
        {failed && <p role="status" className="text-sm text-muted-foreground">{t("offline")}</p>}
      </div>
    </div>
    <button type="button" className="min-h-11 text-sm font-semibold text-primary hover:underline" onClick={onReception} data-testid="desk-screen-reception-link">{t("receptionLink")}</button>
  </div>
}

type Showing = Extract<AttendanceBranchScreenQr, { state: "SHOWING" }>
const kindName = (kind: { id: string; name: string | null }, t: (key: string) => string) =>
  kind.name ?? ((ATTENDANCE_BUILT_IN_BREAK_KINDS as readonly string[]).includes(kind.id) ? t(`breakKind_${kind.id}`) : t("breakKindNone"))

/**
 * The paired desk (mockup «Каждое утро», «Днём», «На перерыве»): the branch
 * code to start or finish the day in Time, and — only here, never on a
 * reception screen — the employee's day and break buttons.
 */
export function AttendanceDeskDayPanel({ code, desk, seconds, onChanged }: { code: Showing; desk: AttendanceDeskDay; seconds: number; onChanged: () => void }) {
  const t = useTranslations("attendanceBranchScreen"), locale = useLocale()
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [now, setNow] = useState(() => Date.now())
  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick) }, [])
  // When this answer came: the worked time goes on from it.
  const [readAt, setReadAt] = useState(() => Date.now())
  useEffect(() => { setReadAt(Date.now()) }, [desk])
  const time = (iso: string | null) => iso ? formatTime(iso, locale, { hour: "2-digit", minute: "2-digit" }) : "—"
  async function press(action: "PAUSE" | "RESUME", kindId?: string) {
    if (busy) return
    setBusy(true); setFailed(false)
    try {
      const response = await fetch(DESK_BREAK_ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, kindId: kindId ?? null, requestId: crypto.randomUUID() }) })
      if (!response.ok) setFailed(true)
      onChanged()
    } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  const kinds = desk.breaks?.kinds ?? []
  const current = desk.state === "PAUSED" && desk.breaks?.currentKindId ? kinds.find(kind => kind.id === desk.breaks!.currentKindId) ?? null : null
  const usage = (kind: (typeof kinds)[number]) => kind.limitMinutes === null ? t("deskNoLimit") : t("deskUsed", { used: Math.floor(kind.usedSeconds / 60), limit: kind.limitMinutes })
  const qr = (size: "large" | "small") => <div className={`${size === "large" ? "w-full max-w-sm p-4" : "w-36 p-2"} shrink-0 rounded-2xl border bg-white`}>
    <Image src={code.dataUrl} alt={t("qrAlt")} width={480} height={480} unoptimized className="h-auto w-full" data-testid="desk-screen-qr" /></div>
  const elapsed = desk.pausedAt ? Math.max(0, Math.floor((now - Date.parse(desk.pausedAt)) / 1000)) : 0
  return <div className="flex w-full max-w-2xl flex-col items-center gap-5 text-center" data-testid="desk-screen" data-state={desk.state}>
    <div className="space-y-1"><p className="text-base text-muted-foreground" data-testid="desk-screen-employee">{t("deskOf", { name: desk.employeeName })}</p>
      <h1 className="text-3xl font-semibold tracking-tight">{code.branch.name}</h1></div>
    {desk.state === "NOT_STARTED" && <>{qr("large")}<p className="text-lg">{t("deskStart")}</p></>}
    {desk.state === "RUNNING" && <>
      <div className="space-y-1"><p className="text-2xl font-semibold" data-testid="desk-screen-running">{t("deskRunning", { time: time(desk.startedAt) })}</p>
        {desk.workedSeconds !== null && <p className="text-muted-foreground">{t("deskWorked", { worked: formatAttendanceDuration(Math.floor((desk.workedSeconds + Math.max(0, (now - readAt) / 1000)) / 60) * 60) })}</p>}</div>
      <p className="font-semibold">{t("deskBreakTitle")}</p>
      <div className="flex flex-wrap justify-center gap-2" data-testid="desk-screen-breaks">
        {kinds.length ? kinds.map(kind => <button key={kind.id} type="button" disabled={busy} onClick={() => void press("PAUSE", kind.id)} data-testid={`desk-screen-break-${kind.id}`}
          className="min-h-14 rounded-xl border-2 bg-background px-5 py-2 text-left font-semibold hover:bg-muted disabled:opacity-50">
          {kindName(kind, t)}<span className="block text-xs font-normal text-muted-foreground">{usage(kind)}</span></button>)
          : <Button type="button" variant="outline" className="min-h-12 px-6 text-base" disabled={busy} onClick={() => void press("PAUSE")} data-testid="desk-screen-break">{t("deskBreak")}</Button>}
      </div>
      <div className="flex items-center gap-4 text-left">{qr("small")}<p className="max-w-56 text-sm text-muted-foreground">{t("deskFinishHint")}</p></div>
    </>}
    {desk.state === "PAUSED" && <>
      <span className="rounded-full bg-amber-100 px-4 py-1 text-sm font-semibold text-amber-900" data-testid="desk-screen-paused">{current ? t("deskPausedKind", { name: kindName(current, t) }) : t("deskPaused")}</span>
      <p className="text-6xl font-bold tabular-nums text-amber-800">{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}</p>
      <p className="text-muted-foreground">{t("deskPausedSince", { time: time(desk.pausedAt) })}{current ? ` · ${kindName(current, t)}: ${usage(current)}` : ""}</p>
      <Button type="button" className="min-h-12 px-8 text-base" disabled={busy} onClick={() => void press("RESUME")} data-testid="desk-screen-resume">{t("deskResume")}</Button>
      <p className="text-sm text-muted-foreground">{t("deskBreakPrivacy")}</p>
    </>}
    {desk.state === "COMPLETED" && <><p className="text-2xl font-semibold" data-testid="desk-screen-completed">{t("deskCompleted")}</p>
      <div className="flex items-center gap-4 text-left">{qr("small")}<p className="max-w-56 text-sm text-muted-foreground">{t("deskCompletedHint")}</p></div></>}
    <div className="flex flex-wrap items-center justify-center gap-3"><span className="font-semibold tabular-nums text-emerald-700" data-testid="branch-screen-countdown">{t("countdown", { seconds })}</span>
      {code.place === "NETWORK" && <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-800">✓ {t("deskNetwork")}</span>}</div>
    {failed && <p role="alert" className="text-sm text-destructive">{t("deskActionFailed")}</p>}
  </div>
}
