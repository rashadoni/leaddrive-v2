"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Check, KeyRound, Loader2, QrCode, RefreshCw, ShieldOff, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"

type DeviceEnrollment = {
  id: string
  agent: { id: string; name: string } | null
  deviceLabel: string
  status: "PENDING" | "ACTIVE" | "REVOKED"
  keyVerifiedAt: string | null
  approvedAt: string | null
  revokedAt: string | null
  createdAt: string
}

type QrStation = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "DISABLED"
  rotationSeconds: number
  siteId: string | null
  areaLabel: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

type IssuedQr = {
  stationId: string
  qrDataUrl: string
  expiresAt: string
  action: "START" | "PAUSE" | "RESUME" | "FINISH"
}

function messageForError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function deviceTone(status: DeviceEnrollment["status"]): "default" | "secondary" | "outline" {
  if (status === "ACTIVE") return "default"
  if (status === "PENDING") return "secondary"
  return "outline"
}

function actionMessageKey(action: IssuedQr["action"]): "actionStart" | "actionPause" | "actionResume" | "actionFinish" {
  switch (action) {
    case "START": return "actionStart"
    case "PAUSE": return "actionPause"
    case "RESUME": return "actionResume"
    case "FINISH": return "actionFinish"
  }
}

/**
 * Administrative security surface only.  It deliberately does not expose
 * QR-token text, device public keys, raw location, attestation material or an
 * employee's proof payload.  Station/site creation remains C8 configuration
 * work; this panel makes the already-authorized controller lifecycle visible.
 */
export function WorkforceAttendanceAdministration() {
  const { data: session } = useSession()
  const t = useTranslations("workforceAttendanceAdmin")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const role = session?.user?.role
  const isAdministrator = role === "admin" || role === "superadmin"
  const [stations, setStations] = useState<QrStation[] | null>(null)
  const [devices, setDevices] = useState<DeviceEnrollment[] | null>(null)
  const [stationError, setStationError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [issued, setIssued] = useState<IssuedQr | null>(null)
  const [action, setAction] = useState<IssuedQr["action"]>("START")

  const request = useCallback(async (path: string, method: "GET" | "POST", body?: unknown) => {
    if (!organizationId) throw new Error(t("organizationUnavailable"))
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-organization-id": organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
    return result.data as unknown
  }, [organizationId, t])

  const load = useCallback(async () => {
    if (!isAdministrator || !organizationId) return
    setLoading(true)
    const [stationResult, deviceResult] = await Promise.allSettled([
      request("/api/v1/workforce/attendance/stations", "GET") as Promise<{ stations: QrStation[] }>,
      request("/api/v1/workforce/attendance/devices", "GET") as Promise<{ enrollments: DeviceEnrollment[] }>,
    ])
    if (stationResult.status === "fulfilled") {
      setStations(stationResult.value.stations)
      setStationError(null)
    } else {
      setStations(null)
      setStationError(messageForError(stationResult.reason, t("stationLoadFailed")))
    }
    if (deviceResult.status === "fulfilled") {
      setDevices(deviceResult.value.enrollments)
      setDeviceError(null)
    } else {
      setDevices(null)
      setDeviceError(messageForError(deviceResult.reason, t("deviceLoadFailed")))
    }
    setLoading(false)
  }, [isAdministrator, organizationId, request, t])

  useEffect(() => {
    void load()
  }, [load])

  const issuedExpiry = useMemo(() => issued ? new Date(issued.expiresAt) : null, [issued])
  const dateTime = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }), [])

  async function issue(station: QrStation) {
    setBusy(`issue:${station.id}`)
    try {
      const result = await request(`/api/v1/workforce/attendance/stations/${encodeURIComponent(station.id)}/qr`, "POST", { action }) as {
        station: { id: string }
        qrDataUrl: string
        expiresAt: string
      }
      setIssued({ stationId: result.station.id, qrDataUrl: result.qrDataUrl, expiresAt: result.expiresAt, action })
      toast.success(t("qrIssued"))
    } catch (cause) {
      setIssued(null)
      toast.error(messageForError(cause, t("qrIssueFailed")))
    } finally {
      setBusy(null)
    }
  }

  async function disable(station: QrStation) {
    setBusy(`disable:${station.id}`)
    try {
      await request(`/api/v1/workforce/attendance/stations/${encodeURIComponent(station.id)}/disable`, "POST", {})
      if (issued?.stationId === station.id) setIssued(null)
      toast.success(t("stationDisabled"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("stationDisableFailed")))
    } finally {
      setBusy(null)
    }
  }

  async function updateDevice(device: DeviceEnrollment, operation: "approve" | "revoke") {
    setBusy(`${operation}:${device.id}`)
    try {
      await request(`/api/v1/workforce/attendance/devices/${encodeURIComponent(device.id)}/${operation}`, "POST", {})
      toast.success(t(operation === "approve" ? "deviceApproved" : "deviceRevoked"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t(operation === "approve" ? "deviceApproveFailed" : "deviceRevokeFailed")))
    } finally {
      setBusy(null)
    }
  }

  if (!isAdministrator) return null

  return <section aria-labelledby="workforce-attendance-administration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h2 id="workforce-attendance-administration" className="text-lg font-semibold">{t("title")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("subtitle")}</p></div></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />{t("refresh")}</Button>
    </div>

    <div className="mt-6 grid gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:grid-cols-2">
      <div aria-labelledby="workforce-qr-stations-title">
        <div><h3 id="workforce-qr-stations-title" className="font-medium">{t("stationsTitle")}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("stationsHint")}</p></div>
        <div className="mt-4 flex max-w-xs items-end gap-3"><Select id="workforce-qr-action" label={t("qrAction")} value={action} onChange={(event) => setAction(event.target.value as IssuedQr["action"])}><option value="START">{t("actionStart")}</option><option value="PAUSE">{t("actionPause")}</option><option value="RESUME">{t("actionResume")}</option><option value="FINISH">{t("actionFinish")}</option></Select></div>
        {stationError ? <p className="mt-4 text-sm text-muted-foreground" role="status">{t("stationUnavailable", { error: stationError })}</p> : null}
        {stations?.map((station) => <article key={station.id} className="border-b border-zinc-200 py-5 dark:border-zinc-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{station.name}</p><Badge variant={station.status === "ACTIVE" ? "default" : "outline"}>{t(`stationStatus.${station.status}`)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{station.code} · {t("rotation", { seconds: station.rotationSeconds })}</p><p className="mt-1 text-sm text-muted-foreground">{station.areaLabel || t("siteReference", { id: station.siteId || "—" })}</p></div>{station.status === "ACTIVE" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void issue(station)}>{busy === `issue:${station.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <QrCode />}{t("showQr")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void disable(station)}>{busy === `disable:${station.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldOff />}{t("disableStation")}</Button></div> : null}</div>
          {issued?.stationId === station.id ? <div className="mt-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-muted/30 p-4 sm:flex-row sm:items-center dark:border-zinc-700"><Image src={issued.qrDataUrl} alt={t("qrImageAlt", { station: station.name, action: t(actionMessageKey(issued.action)) })} width={192} height={192} unoptimized className="h-48 w-48 rounded bg-white p-2" /><div><p className="font-medium">{t("qrDisplayTitle")}</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{t("qrDisplayHint")}</p><p className="mt-2 text-sm text-muted-foreground">{issuedExpiry ? t("qrExpiresAt", { value: dateTime.format(issuedExpiry) }) : "—"}</p><Button type="button" variant="outline" className="mt-4 min-h-11" disabled={busy !== null} onClick={() => void issue(station)}><RefreshCw />{t("refreshQr")}</Button></div></div> : null}
        </article>)}
        {stations?.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("noStations")}</p> : null}
      </div>

      <div aria-labelledby="workforce-device-lifecycle-title" className="border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
        <div className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h3 id="workforce-device-lifecycle-title" className="font-medium">{t("devicesTitle")}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("devicesHint")}</p></div></div>
        {deviceError ? <p className="mt-4 text-sm text-muted-foreground" role="status">{t("deviceUnavailable", { error: deviceError })}</p> : null}
        <div className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">{devices?.map((device) => <article key={device.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{device.deviceLabel}</p><Badge variant={deviceTone(device.status)}>{t(`deviceStatus.${device.status}`)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{device.agent?.name || t("unknownEmployee")}</p><p className="mt-1 text-sm text-muted-foreground">{t("deviceRecordedAt", { value: dateTime.format(new Date(device.createdAt)) })}</p></div><div className="flex flex-wrap gap-2">{device.status === "PENDING" && device.keyVerifiedAt ? <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => void updateDevice(device, "approve")}>{busy === `approve:${device.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("approveDevice")}</Button> : null}{device.status === "ACTIVE" ? <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void updateDevice(device, "revoke")}>{busy === `revoke:${device.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldOff />}{t("revokeDevice")}</Button> : null}</div></article>)}{devices?.length === 0 ? <p className="py-5 text-sm text-muted-foreground">{t("noDevices")}</p> : null}</div>
      </div>
    </div>
  </section>
}
