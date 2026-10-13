"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { QrCode, ShieldCheck } from "lucide-react"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import type { AttendanceQrDirectory, AttendanceQrDisplay } from "@/lib/mtm/attendance-qr-contract"

const ENDPOINT = "/api/v1/mtm/attendance/branch-qr"
type Code = AttendanceQrDisplay & { deadline: number }
export function MtmAttendanceQrDisplay() {
  const t = useTranslations("mtmAttendance")
  const [directory, setDirectory] = useState<AttendanceQrDirectory | null>(null), [branchId, setBranchId] = useState("")
  const [code, setCode] = useState<Code | null>(null), [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [denied, setDenied] = useState(false)
  const controller = useRef<AbortController | null>(null), mounted = useRef(false)
  const clear = useCallback(() => { setDirectory(null); setCode(null); setBranchId(""); setDenied(true) }, [])
  const load = useCallback(async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setBusy(true); setCode(null); setError(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: request.signal })
      if (request.signal.aborted || !mounted.current) return
      if ([401, 403, 404].includes(response.status)) { clear(); return }
      const body = await response.json()
      if (request.signal.aborted || !mounted.current) return
      if (!response.ok || body?.success !== true || typeof body.data?.enabled !== "boolean" || !Array.isArray(body.data?.branches)) throw new Error("INVALID_DIRECTORY")
      setDirectory(body.data); setDenied(false)
      setBranchId(previous => body.data.branches.some((row: { id: string }) => row.id === previous) ? previous : body.data.branches[0]?.id ?? "")
    } catch { if (!request.signal.aborted && mounted.current) { setDirectory(null); setError(true) } }
    finally { if (!request.signal.aborted && mounted.current) setBusy(false) }
  }, [clear])
  const issue = useCallback(async () => {
    if (!branchId || document.visibilityState === "hidden") return
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setBusy(true); setCode(null); setError(false)
    const sent = performance.now()
    try {
      const response = await fetch(ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId }), signal: request.signal })
      if (request.signal.aborted || !mounted.current) return
      if ([401, 403].includes(response.status)) { clear(); return }
      if (response.status === 404) { await load(); return }
      const body = await response.json(), value = body?.data as AttendanceQrDisplay | undefined
      if (request.signal.aborted || !mounted.current) return
      const life = value ? Date.parse(value.expiresAt) - Date.parse(value.serverNow) - (performance.now() - sent) : NaN
      if (!response.ok || body?.success !== true || !value || value.branch?.id !== branchId || !value.dataUrl?.startsWith("data:image/png;base64,") || !Number.isFinite(life) || life <= 0 || life > 60000) throw new Error("INVALID_CODE")
      setSeconds(Math.ceil(life / 1000)); setCode({ ...value, deadline: performance.now() + life })
    } catch { if (!request.signal.aborted && mounted.current) setError(true) }
    finally { if (!request.signal.aborted && mounted.current) setBusy(false) }
  }, [branchId, clear, load])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; controller.current?.abort() } }, [load])
  useEffect(() => { setCode(null); if (directory?.enabled && branchId) void issue() }, [directory, branchId, issue])
  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((code.deadline - performance.now()) / 1000)); setSeconds(left)
      if (!left) { setCode(null); void issue() }
    }, 250)
    return () => clearInterval(timer)
  }, [code, issue])
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") { controller.current?.abort(); setCode(null); setBusy(false) } else void load() }
    document.addEventListener("visibilitychange", visibility); return () => document.removeEventListener("visibilitychange", visibility)
  }, [load])
  async function toggle() {
    if (busy || !directory?.canConfigure) return
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setBusy(true); setCode(null); setError(false)
    try {
      const response = await fetch("/api/v1/mtm/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendanceBranchQrEnabled: !directory.enabled }), signal: request.signal })
      if (request.signal.aborted || !mounted.current) return
      if ([401, 403, 404].includes(response.status)) { clear(); setBusy(false); return }
      await load()
      if (!response.ok && mounted.current) setError(true)
    } catch { if (!request.signal.aborted && mounted.current) { await load(); setError(true) } }
  }
  if (denied) return <p role="status">{t("reportAccessUnavailable")}</p>
  return <main className="min-w-0 space-y-5" data-testid="attendance-qr-display">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("qrTitle")}</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("qrIntro")}</p></div>
    <HomeCard testId="attendance-qr-rule" titleId="attendance-qr-rule-title" title={t("qrRule")} icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />} tone="green">
      <div className="flex flex-wrap items-center justify-between gap-4 py-4"><p className="max-w-3xl text-sm text-muted-foreground">{t("qrRuleHint")}</p>
        {directory && <Button type="button" variant="outline" role="switch" aria-checked={directory.enabled} aria-label={t("qrRule")} className="min-h-11" disabled={busy || !directory.canConfigure} onClick={() => void toggle()}>{t(directory.enabled ? "installationOn" : "installationOff")}</Button>}
      </div>
    </HomeCard>
    {error && <p role="alert" className="text-sm text-destructive">{t("qrLoadError")}</p>}
    {directory?.enabled ? <HomeCard testId="attendance-qr-code" titleId="attendance-qr-code-title" title={t("qrTitle")} icon={<QrCode className="h-5 w-5" aria-hidden="true" />} tone="orange">
      <div className="space-y-6 py-4"><div className="flex flex-wrap items-end justify-between gap-4"><label className="block min-w-0 space-y-2 text-sm" htmlFor="attendance-qr-branch"><span>{t("qrBranch")}</span><select id="attendance-qr-branch" className="block min-h-11 max-w-full rounded-lg border bg-background px-3" value={branchId} disabled={busy} onChange={event => { setCode(null); setBranchId(event.target.value) }}>{directory.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        {code && seconds > 0 && <HomePill tone="green">{t("qrValid")}</HomePill>}</div>
        {!directory.branches.length ? <p>{t("qrEmpty")}</p> : <div className="grid min-w-0 items-center gap-8 lg:grid-cols-2">
          <div className="mx-auto w-full max-w-sm rounded-2xl border bg-white p-4">{code && seconds > 0 ? <Image src={code.dataUrl} alt={t("qrImageAlt")} width={480} height={480} unoptimized className="h-auto w-full" /> : <div className="flex aspect-square items-center justify-center p-6 text-center text-sm text-zinc-600" role="status">{t(busy ? "reportLoading" : "qrLoadError")}</div>}</div>
          <div className="space-y-4"><h2 className="text-xl font-semibold">{t("qrScanTitle")}</h2><p className="text-sm leading-relaxed text-muted-foreground">{t("qrScanHint")}</p>
            {code && seconds > 0 && <p className="text-2xl font-semibold tabular-nums text-emerald-700">{t("qrCountdown", { seconds })}</p>}
            <p className="text-sm text-muted-foreground">{t("qrRefreshHint")}</p><p className="border-l-2 border-orange-400 pl-4 text-sm text-muted-foreground">{t("qrMissingHint")}</p>
          </div></div>}
      </div>
    </HomeCard> : directory && <p className="text-sm text-muted-foreground">{t("qrOffHint")}</p>}
    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{t("qrRefresh")}</Button>
    <p className="text-sm text-muted-foreground">{t("qrPrivacy")}</p>
  </main>
}
