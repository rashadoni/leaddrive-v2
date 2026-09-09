"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ExternalLink, Loader2, Map, Navigation, Route as RouteIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MtmRoutePoint, MtmRouteRecord } from "@/components/mtm/route-types"
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedDirectionsUrl,
  hasMtmGoogleMapCoordinate,
} from "@/lib/mtm/google-maps-urls"

type TravelResult = {
  distanceMeters: number
  durationSeconds: number
  sourceFingerprint: string
}

type Props = {
  route: MtmRouteRecord
  canCalculate: boolean
  locale: string
  orgId?: string
}

type TravelErrorCode =
  | "MTM_ROUTE_TRAVEL_IDEMPOTENCY_REQUIRED"
  | "MTM_ROUTE_TRAVEL_IDEMPOTENCY_MISMATCH"
  | "MTM_ROUTE_TRAVEL_COORDINATES_INCOMPLETE"
  | "MTM_ROUTE_TRAVEL_POINTS_INSUFFICIENT"
  | "MTM_ROUTE_TRAVEL_STOP_LIMIT"
  | "MTM_ROUTE_TRAVEL_NOT_CONFIGURED"
  | "MTM_ROUTE_TRAVEL_NOT_EDITABLE"
  | "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT"
  | "MTM_ROUTE_TRAVEL_DAILY_LIMIT"
  | "MTM_ROUTE_TRAVEL_PROTECTION_UNAVAILABLE"
  | "MTM_ROUTE_TRAVEL_IN_FLIGHT"
  | "MTM_ROUTE_TRAVEL_REPLAY_SUPPRESSED"
  | "MTM_ROUTE_TRAVEL_RATE_LIMITED"
  | "MTM_ROUTE_TRAVEL_PROVIDER_UNAVAILABLE"

function orderedPoints(points: readonly MtmRoutePoint[]) {
  return [...points].sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
}

function pointCoordinate(point: MtmRoutePoint) {
  return {
    latitude: point.customer?.latitude,
    longitude: point.customer?.longitude,
  }
}

function createIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `route-travel:${uuid ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`}`
}

function parseTravelResult(body: unknown): TravelResult | null {
  const data = (body as { data?: unknown } | null)?.data as {
    transient?: unknown
    source?: { fingerprint?: unknown }
    calculation?: { distanceMeters?: unknown; durationSeconds?: unknown }
  } | undefined
  const distanceMeters = data?.calculation?.distanceMeters
  const durationSeconds = data?.calculation?.durationSeconds
  const sourceFingerprint = data?.source?.fingerprint
  if (
    data?.transient !== true
    || typeof distanceMeters !== "number"
    || !Number.isFinite(distanceMeters)
    || typeof durationSeconds !== "number"
    || !Number.isFinite(durationSeconds)
    || typeof sourceFingerprint !== "string"
  ) return null
  return { distanceMeters, durationSeconds, sourceFingerprint }
}

function errorCode(body: unknown): TravelErrorCode | null {
  const code = (body as { code?: unknown; error?: unknown } | null)?.code
    ?? (body as { error?: unknown } | null)?.error
  switch (code) {
    case "MTM_ROUTE_TRAVEL_IDEMPOTENCY_REQUIRED":
    case "MTM_ROUTE_TRAVEL_IDEMPOTENCY_MISMATCH":
    case "MTM_ROUTE_TRAVEL_COORDINATES_INCOMPLETE":
    case "MTM_ROUTE_TRAVEL_POINTS_INSUFFICIENT":
    case "MTM_ROUTE_TRAVEL_STOP_LIMIT":
    case "MTM_ROUTE_TRAVEL_NOT_CONFIGURED":
    case "MTM_ROUTE_TRAVEL_NOT_EDITABLE":
    case "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT":
    case "MTM_ROUTE_TRAVEL_DAILY_LIMIT":
    case "MTM_ROUTE_TRAVEL_PROTECTION_UNAVAILABLE":
    case "MTM_ROUTE_TRAVEL_IN_FLIGHT":
    case "MTM_ROUTE_TRAVEL_REPLAY_SUPPRESSED":
    case "MTM_ROUTE_TRAVEL_RATE_LIMITED":
    case "MTM_ROUTE_TRAVEL_PROVIDER_UNAVAILABLE":
      return code
    default:
      return null
  }
}

/**
 * This surface only displays a user-triggered, transient estimate. It never
 * stores the response in browser storage, changes the manual order, or draws
 * Google route content over the existing product-owned Leaflet map.
 */
export function MtmRouteTravelPanel({ route, canCalculate, locale, orgId }: Props) {
  const t = useTranslations("mtmRoutesPage")
  const requestRef = useRef<AbortController | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [result, setResult] = useState<TravelResult | null>(null)
  const [failure, setFailure] = useState<TravelErrorCode | "UNKNOWN" | null>(null)
  const [googleMapOpen, setGoogleMapOpen] = useState(false)
  const travelPlan = route.travelPlan
  const travelPolicy = route.travelPolicy
  const points = useMemo(() => orderedPoints(route.points ?? []), [route.points])
  const sourceFingerprint = travelPlan?.source.fingerprint ?? ""
  const calculationReady = Boolean(
    travelPlan
    && travelPolicy?.calculationEnabled
    && canCalculate
    && points.length >= 2
    && points.length <= 10
    && travelPlan.coordinateCoverage.missingPoints === 0,
  )
  const nextStop = useMemo(
    () => points.find((point) => point.status === "PENDING" && hasMtmGoogleMapCoordinate(pointCoordinate(point)))
      ?? points.find((point) => point.status !== "VISITED" && point.status !== "SKIPPED" && hasMtmGoogleMapCoordinate(pointCoordinate(point)))
      ?? null,
    [points],
  )
  const navigationUrl = travelPolicy?.navigationEnabled && nextStop
    ? buildGoogleMapsDirectionsUrl(pointCoordinate(nextStop))
    : null
  const googleMapUrl = useMemo(() => {
    if (!googleMapOpen || !travelPolicy?.calculationEnabled) return null
    return buildGoogleMapsEmbedDirectionsUrl({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY ?? "",
      points: points.map(pointCoordinate),
      language: locale,
      region: "AZ",
    })
  }, [googleMapOpen, locale, points, travelPolicy?.calculationEnabled])

  useEffect(() => {
    requestRef.current?.abort()
    requestRef.current = null
    setResult(null)
    setFailure(null)
    setGoogleMapOpen(false)
  }, [sourceFingerprint])

  useEffect(() => () => requestRef.current?.abort(), [])

  if (!travelPlan || !travelPolicy) return null

  const requestEstimate = async () => {
    if (!calculationReady || calculating) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setCalculating(true)
    setResult(null)
    setFailure(null)
    try {
      const response = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(route.id)}/travel/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": createIdempotencyKey(),
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedVersion: route.version,
          sourceFingerprint,
        }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted || requestRef.current !== controller) return
      const nextResult = response.ok ? parseTravelResult(body) : null
      if (nextResult && nextResult.sourceFingerprint === sourceFingerprint) {
        setResult(nextResult)
        return
      }
      setFailure(errorCode(body) ?? "UNKNOWN")
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") setFailure("UNKNOWN")
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setCalculating(false)
      }
    }
  }

  const failureMessage = () => {
    switch (failure) {
      case "MTM_ROUTE_TRAVEL_IDEMPOTENCY_REQUIRED": return t("routeTravelIdempotencyRequired")
      case "MTM_ROUTE_TRAVEL_IDEMPOTENCY_MISMATCH": return t("routeTravelIdempotencyMismatch")
      case "MTM_ROUTE_TRAVEL_COORDINATES_INCOMPLETE": return t("routeTravelCoordinatesIncomplete")
      case "MTM_ROUTE_TRAVEL_POINTS_INSUFFICIENT": return t("routeTravelPointsInsufficient")
      case "MTM_ROUTE_TRAVEL_STOP_LIMIT": return t("routeTravelStopLimit")
      case "MTM_ROUTE_TRAVEL_NOT_CONFIGURED": return t("routeTravelNotConfigured")
      case "MTM_ROUTE_TRAVEL_NOT_EDITABLE": return t("routeTravelNotEditable")
      case "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT": return t("routeTravelSourceConflict")
      case "MTM_ROUTE_TRAVEL_DAILY_LIMIT": return t("routeTravelDailyLimit")
      case "MTM_ROUTE_TRAVEL_PROTECTION_UNAVAILABLE": return t("routeTravelProtectionUnavailable")
      case "MTM_ROUTE_TRAVEL_IN_FLIGHT":
      case "MTM_ROUTE_TRAVEL_REPLAY_SUPPRESSED":
      case "MTM_ROUTE_TRAVEL_RATE_LIMITED": return t("routeTravelRetryLater")
      case "MTM_ROUTE_TRAVEL_PROVIDER_UNAVAILABLE": return t("routeTravelProviderUnavailable")
      default: return t("routeTravelGenericError")
    }
  }

  const distanceKm = result ? result.distanceMeters / 1_000 : null
  const durationHours = result ? Math.floor(result.durationSeconds / 3_600) : 0
  const durationMinutes = result ? Math.max(0, Math.round((result.durationSeconds % 3_600) / 60)) : 0
  const distanceValue = distanceKm === null
    ? null
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(distanceKm)

  return (
    <section data-testid="mtm-route-travel-panel" aria-labelledby="mtm-route-travel-heading" className="space-y-3 rounded-lg border border-zinc-200 bg-muted/20 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id="mtm-route-travel-heading" className="flex items-center gap-2 text-sm font-semibold">
            <RouteIcon className="h-4 w-4 text-cyan-700" aria-hidden="true" />
            {t("routeTravelTitle")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">{t("routeTravelDescription")}</p>
        </div>
        <span className="rounded-full border border-zinc-200 bg-background px-2 py-1 text-xs text-muted-foreground dark:border-zinc-700">
          {t("routeTravelManualOrder")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {travelPlan.coordinateCoverage.missingPoints > 0 ? (
          <p className="text-xs text-amber-800 dark:text-amber-300">{t("routeTravelCoordinatesIncomplete")}</p>
        ) : points.length < 2 ? (
          <p className="text-xs text-amber-800 dark:text-amber-300">{t("routeTravelPointsInsufficient")}</p>
        ) : points.length > 10 ? (
          <p className="text-xs text-amber-800 dark:text-amber-300">{t("routeTravelStopLimit")}</p>
        ) : !canCalculate ? (
          <p className="text-xs text-muted-foreground">{t("routeTravelNotEditable")}</p>
        ) : !travelPolicy.calculationEnabled ? (
          <p className="text-xs text-muted-foreground">{t("routeTravelNotConfigured")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("routeTravelReady")}</p>
        )}
        {calculationReady ? (
          <Button type="button" size="sm" className="min-h-11" onClick={() => void requestEstimate()} disabled={calculating}>
            {calculating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <RouteIcon className="mr-1 h-4 w-4" aria-hidden="true" />}
            {calculating ? t("routeTravelCalculating") : t("routeTravelCalculate")}
          </Button>
        ) : null}
        {travelPolicy.calculationEnabled && !googleMapOpen ? (
          <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setGoogleMapOpen(true)}>
            <Map className="mr-1 h-4 w-4" aria-hidden="true" />
            {t("routeTravelOpenGoogleMap")}
          </Button>
        ) : null}
        {travelPolicy.navigationEnabled && navigationUrl ? (
          <Button asChild type="button" size="sm" variant="outline" className="min-h-11">
            <a href={navigationUrl} target="_blank" rel="noreferrer">
              <Navigation className="mr-1 h-4 w-4" aria-hidden="true" />
              {t("routeTravelOpenNavigation")}
              <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>

      {travelPolicy.navigationEnabled ? (
        <p className="text-xs text-muted-foreground">{navigationUrl ? t("routeTravelNavigationHint") : t("routeTravelNavigationUnavailable")}</p>
      ) : null}

      {result && distanceValue !== null ? (
        <div className="grid gap-2 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm dark:border-cyan-900 dark:bg-cyan-950/30 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">{t("routeTravelDistance")}</div>
            <div className="mt-0.5 font-semibold">{t("routeTravelDistanceValue", { value: distanceValue })}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("routeTravelDuration")}</div>
            <div className="mt-0.5 font-semibold">{t("routeTravelDurationValue", { hours: durationHours, minutes: durationMinutes })}</div>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("routeTravelTemporary")}</p>
        </div>
      ) : null}

      {failure ? <p role="status" className="text-xs text-destructive">{failureMessage()}</p> : null}

      {googleMapOpen ? (
        googleMapUrl ? (
          <div className="space-y-2 rounded-md border border-zinc-200 bg-background p-2 dark:border-zinc-700">
            <p className="text-xs text-muted-foreground">{t("routeTravelGoogleMapHint")}</p>
            <iframe
              title={t("routeTravelGoogleMap")}
              src={googleMapUrl}
              className="h-56 w-full rounded border-0 sm:h-72"
              loading="lazy"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : <p className="text-xs text-muted-foreground">{t("routeTravelMapUnavailable")}</p>
      ) : null}
    </section>
  )
}
