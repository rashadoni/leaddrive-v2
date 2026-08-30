"use client"

import Image from "next/image"
import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Check, KeyRound, Loader2, QrCode, RefreshCw, ShieldOff, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

type DeviceEnrollment = {
  id: string
  agent: { id: string; name: string } | null
  deviceLabel: string
  status: "PENDING" | "ACTIVE" | "REVOKED" | "REPLACED"
  keyVerifiedAt: string | null
  approvedAt: string | null
  revokedAt: string | null
  replacesEnrollmentId: string | null
  createdAt: string
}

type QrStation = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "DISABLED"
  rotationSeconds: number
  siteId: string | null
  geofenceRevisionId: string | null
  areaLabel: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

type WorkforceSite = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "ARCHIVED"
}

type WorkforceSiteGeofenceRevision = {
  id: string
  revision: number
  effectiveFrom: string
  effectiveTo: string | null
}

type StationForm = {
  code: string
  name: string
  rotationSeconds: string
  siteId: string
  geofenceRevisionId: string
  areaLabel: string
  effectiveFrom: string
  effectiveTo: string
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

function emptyStationForm(): StationForm {
  return {
    code: "",
    name: "",
    rotationSeconds: "60",
    siteId: "",
    geofenceRevisionId: "",
    areaLabel: "",
    effectiveFrom: "",
    effectiveTo: "",
  }
}

function asDateKey(value: string | null): string {
  return value ? value.slice(0, 10) : ""
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Administrative security surface only.  It deliberately does not expose
 * QR-token text, device public keys, raw location, attestation material or an
 * employee's proof payload. It offers only named Workforce-site/revision
 * selection; ordinary schedulers never receive this security surface.
 */
export function WorkforceAttendanceAdministration() {
  const { data: session } = useSession()
  const t = useTranslations("workforceAttendanceAdmin")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const role = session?.user?.role
  const isAdministrator = role === "admin" || role === "superadmin"
  const [stations, setStations] = useState<QrStation[] | null>(null)
  const [devices, setDevices] = useState<DeviceEnrollment[] | null>(null)
  const [sites, setSites] = useState<WorkforceSite[] | null>(null)
  const [geofenceRevisions, setGeofenceRevisions] = useState<WorkforceSiteGeofenceRevision[]>([])
  const [stationForm, setStationForm] = useState<StationForm>(emptyStationForm)
  const [stationError, setStationError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [geofenceError, setGeofenceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [savingStation, setSavingStation] = useState(false)
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
    const [stationResult, deviceResult, siteResult] = await Promise.allSettled([
      request("/api/v1/workforce/attendance/stations", "GET") as Promise<{ stations: QrStation[] }>,
      request("/api/v1/workforce/attendance/devices", "GET") as Promise<{ enrollments: DeviceEnrollment[] }>,
      request("/api/v1/workforce/configuration/sites", "GET") as Promise<{ sites: WorkforceSite[] }>,
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
    if (siteResult.status === "fulfilled") {
      setSites(siteResult.value.sites)
    } else {
      setSites(null)
    }
    setLoading(false)
  }, [isAdministrator, organizationId, request, t])

  useEffect(() => {
    void load()
  }, [load])

  const loadGeofenceRevisions = useCallback(async () => {
    if (!stationForm.siteId) {
      setGeofenceRevisions([])
      setGeofenceError(null)
      return
    }
    setGeofenceError(null)
    try {
      const result = await request(`/api/v1/workforce/configuration/sites/${encodeURIComponent(stationForm.siteId)}/geofences`, "GET") as {
        revisions: WorkforceSiteGeofenceRevision[]
      }
      setGeofenceRevisions(result.revisions)
    } catch (cause) {
      setGeofenceRevisions([])
      setGeofenceError(messageForError(cause, t("stationGeofenceLoadFailed")))
    }
  }, [request, stationForm.siteId, t])

  useEffect(() => {
    void loadGeofenceRevisions()
  }, [loadGeofenceRevisions])

  const issuedExpiry = useMemo(() => issued ? new Date(issued.expiresAt) : null, [issued])
  const dateTime = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }), [])
  const effectiveGeofenceRevisions = useMemo(() => geofenceRevisions.filter((revision) => (
    !stationForm.effectiveFrom
    || (
      asDateKey(revision.effectiveFrom) <= stationForm.effectiveFrom
      && (revision.effectiveTo == null || asDateKey(revision.effectiveTo) > stationForm.effectiveFrom)
    )
  )), [geofenceRevisions, stationForm.effectiveFrom])
  const stationSiteLabel = (siteId: string | null) => sites?.find((site) => site.id === siteId)?.name ?? t("stationSiteUnavailable")

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

  async function saveStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const rotationSeconds = positiveInteger(stationForm.rotationSeconds)
    if (
      !stationForm.code.trim()
      || !stationForm.name.trim()
      || !stationForm.siteId
      || !stationForm.geofenceRevisionId
      || !stationForm.effectiveFrom
      || rotationSeconds == null
      || rotationSeconds < 30
      || rotationSeconds > 300
      || (stationForm.effectiveTo && stationForm.effectiveTo <= stationForm.effectiveFrom)
    ) {
      toast.error(t("stationValidationFailed"))
      return
    }
    setSavingStation(true)
    try {
      await request("/api/v1/workforce/attendance/stations", "POST", {
        code: stationForm.code.trim(),
        name: stationForm.name.trim(),
        rotationSeconds,
        siteId: stationForm.siteId,
        geofenceRevisionId: stationForm.geofenceRevisionId,
        areaLabel: stationForm.areaLabel.trim() || null,
        effectiveFrom: stationForm.effectiveFrom,
        effectiveTo: stationForm.effectiveTo || null,
      })
      setStationForm(emptyStationForm())
      setGeofenceRevisions([])
      toast.success(t("stationCreated"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("stationCreateFailed")))
    } finally {
      setSavingStation(false)
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
        <form onSubmit={saveStation} className="mt-5 space-y-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-700" aria-labelledby="workforce-qr-station-create-title">
          <div><h4 id="workforce-qr-station-create-title" className="font-medium">{t("newStation")}</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("newStationHint")}</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor="workforce-qr-station-code" className="text-sm font-medium">{t("stationCode")}</label><Input id="workforce-qr-station-code" value={stationForm.code} onChange={(event) => setStationForm((current) => ({ ...current, code: event.target.value }))} maxLength={64} required /></div><div className="space-y-1.5"><label htmlFor="workforce-qr-station-name" className="text-sm font-medium">{t("stationName")}</label><Input id="workforce-qr-station-name" value={stationForm.name} onChange={(event) => setStationForm((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></div></div>
          <Select id="workforce-qr-station-site" label={t("stationSite")} value={stationForm.siteId} onChange={(event) => setStationForm((current) => ({ ...current, siteId: event.target.value, geofenceRevisionId: "" }))} required><option value="">{t("selectStationSite")}</option>{sites?.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}</Select>
          <Select id="workforce-qr-station-geofence" label={t("stationGeofenceRevision")} value={stationForm.geofenceRevisionId} onChange={(event) => setStationForm((current) => ({ ...current, geofenceRevisionId: event.target.value }))} required disabled={!stationForm.siteId}><option value="">{t("selectStationGeofence")}</option>{effectiveGeofenceRevisions.map((revision) => <option key={revision.id} value={revision.id}>{t("stationGeofenceOption", { version: revision.revision, start: asDateKey(revision.effectiveFrom), end: revision.effectiveTo ? asDateKey(revision.effectiveTo) : t("openEnded") })}</option>)}</Select>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor="workforce-qr-station-effective-from" className="text-sm font-medium">{t("stationEffectiveFrom")}</label><Input id="workforce-qr-station-effective-from" type="date" value={stationForm.effectiveFrom} onChange={(event) => setStationForm((current) => ({ ...current, effectiveFrom: event.target.value, geofenceRevisionId: "" }))} required /></div><div className="space-y-1.5"><label htmlFor="workforce-qr-station-effective-to" className="text-sm font-medium">{t("stationEffectiveTo")}</label><Input id="workforce-qr-station-effective-to" type="date" min={stationForm.effectiveFrom || undefined} value={stationForm.effectiveTo} onChange={(event) => setStationForm((current) => ({ ...current, effectiveTo: event.target.value }))} /></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor="workforce-qr-station-rotation" className="text-sm font-medium">{t("stationRotationSeconds")}</label><Input id="workforce-qr-station-rotation" type="number" min="30" max="300" step="1" value={stationForm.rotationSeconds} onChange={(event) => setStationForm((current) => ({ ...current, rotationSeconds: event.target.value }))} required /></div><div className="space-y-1.5"><label htmlFor="workforce-qr-station-area" className="text-sm font-medium">{t("stationAreaLabel")}</label><Input id="workforce-qr-station-area" value={stationForm.areaLabel} onChange={(event) => setStationForm((current) => ({ ...current, areaLabel: event.target.value }))} maxLength={120} /></div></div>
          {geofenceError ? <p className="text-sm text-destructive" role="alert">{geofenceError}</p> : null}
          {!stationForm.siteId || effectiveGeofenceRevisions.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("stationGeofenceRequired")}</p> : null}
          <Button type="submit" className="min-h-11" disabled={savingStation || !sites?.some((site) => site.status === "ACTIVE")}>{savingStation ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <QrCode />}{t("createStation")}</Button>
        </form>
        <div className="mt-4 flex max-w-xs items-end gap-3"><Select id="workforce-qr-action" label={t("qrAction")} value={action} onChange={(event) => setAction(event.target.value as IssuedQr["action"])}><option value="START">{t("actionStart")}</option><option value="PAUSE">{t("actionPause")}</option><option value="RESUME">{t("actionResume")}</option><option value="FINISH">{t("actionFinish")}</option></Select></div>
        {stationError ? <p className="mt-4 text-sm text-muted-foreground" role="status">{t("stationUnavailable", { error: stationError })}</p> : null}
        {stations?.map((station) => <article key={station.id} className="border-b border-zinc-200 py-5 dark:border-zinc-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{station.name}</p><Badge variant={station.status === "ACTIVE" ? "default" : "outline"}>{t(`stationStatus.${station.status}`)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{station.code} · {t("rotation", { seconds: station.rotationSeconds })}</p><p className="mt-1 text-sm text-muted-foreground">{station.areaLabel || stationSiteLabel(station.siteId)}</p></div>{station.status === "ACTIVE" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void issue(station)}>{busy === `issue:${station.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <QrCode />}{t("showQr")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void disable(station)}>{busy === `disable:${station.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldOff />}{t("disableStation")}</Button></div> : null}</div>
          {issued?.stationId === station.id ? <div className="mt-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-muted/30 p-4 sm:flex-row sm:items-center dark:border-zinc-700"><Image src={issued.qrDataUrl} alt={t("qrImageAlt", { station: station.name, action: t(actionMessageKey(issued.action)) })} width={192} height={192} unoptimized className="h-48 w-48 rounded bg-white p-2" /><div><p className="font-medium">{t("qrDisplayTitle")}</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{t("qrDisplayHint")}</p><p className="mt-2 text-sm text-muted-foreground">{issuedExpiry ? t("qrExpiresAt", { value: dateTime.format(issuedExpiry) }) : "—"}</p><Button type="button" variant="outline" className="mt-4 min-h-11" disabled={busy !== null} onClick={() => void issue(station)}><RefreshCw />{t("refreshQr")}</Button></div></div> : null}
        </article>)}
        {stations?.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("noStations")}</p> : null}
      </div>

      <div aria-labelledby="workforce-device-lifecycle-title" className="border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
        <div className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h3 id="workforce-device-lifecycle-title" className="font-medium">{t("devicesTitle")}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("devicesHint")}</p></div></div>
        {deviceError ? <p className="mt-4 text-sm text-destructive" role="alert">{t("deviceUnavailable", { error: deviceError })}</p> : null}
        <div className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">{devices?.map((device) => {
          const replaces = device.replacesEnrollmentId ? devices.find((candidate) => candidate.id === device.replacesEnrollmentId) : null
          const replacement = devices.find((candidate) => candidate.replacesEnrollmentId === device.id) ?? null
          return <article key={device.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{device.deviceLabel}</p><Badge variant={deviceTone(device.status)}>{t(`deviceStatus.${device.status}`)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{device.agent?.name || t("unknownEmployee")}</p><p className="mt-1 text-sm text-muted-foreground">{t("deviceRecordedAt", { value: dateTime.format(new Date(device.createdAt)) })}</p>{replaces ? <p className="mt-1 text-sm text-muted-foreground">{t("deviceReplaces", { device: replaces.deviceLabel })}</p> : null}{replacement ? <p className="mt-1 text-sm text-muted-foreground">{t("deviceReplacedBy", { device: replacement.deviceLabel })}</p> : null}</div><div className="flex flex-wrap gap-2">{device.status === "PENDING" && device.keyVerifiedAt ? <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => void updateDevice(device, "approve")}>{busy === `approve:${device.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("approveDevice")}</Button> : null}{device.status === "ACTIVE" ? <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void updateDevice(device, "revoke")}>{busy === `revoke:${device.id}` ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldOff />}{t("revokeDevice")}</Button> : null}</div></article>
        })}{devices?.length === 0 ? <p className="py-5 text-sm text-muted-foreground">{t("noDevices")}</p> : null}</div>
      </div>
    </div>
  </section>
}
