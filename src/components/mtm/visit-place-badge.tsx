"use client"

import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, MapPin } from "lucide-react"
import {
  formatMtmDistance,
  VISIT_PLACE_VERDICT_MESSAGE_KEYS,
  type VisitPlaceSummary,
  type VisitPlaceVerdict,
} from "@/lib/mtm/visit-place-check"

/**
 * One visual answer to "was the visit recorded at the customer?" for the
 * visits list, the route detail and the GPS history — same verdict
 * (`visitPlaceSummary`), same words (`mtmPlaceCheck`), same colours.
 */
export function visitPlaceTone(verdict: VisitPlaceVerdict): "ok" | "alert" | "warning" | "unknown" {
  if (verdict === "at_point") return "ok"
  if (verdict === "outside") return "alert"
  if (verdict === "checkout_gps_missing" || verdict === "checkin_gps_missing") return "warning"
  return "unknown"
}

const TONE_CLASSES = {
  ok: "text-emerald-700 dark:text-emerald-300",
  alert: "font-semibold text-red-700 dark:text-red-300",
  warning: "text-amber-700 dark:text-amber-300",
  unknown: "text-muted-foreground",
} as const

export function useMtmDistanceText() {
  const locale = useLocale()
  const tUnits = useTranslations("mtmMap.distanceUnits")
  return (meters: number) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))
}

export function VisitPlaceBadge({
  place,
  size = "sm",
  showDistanceDetail = false,
  className = "",
}: {
  place: VisitPlaceSummary
  size?: "xs" | "sm"
  /** Adds «7,8 km from the customer (allowed 100 m)» under the label. */
  showDistanceDetail?: boolean
  className?: string
}) {
  const t = useTranslations("mtmPlaceCheck")
  const distanceText = useMtmDistanceText()
  const tone = visitPlaceTone(place.verdict)
  const Icon = tone === "ok" ? CheckCircle2 : tone === "unknown" ? MapPin : AlertTriangle
  const key = VISIT_PLACE_VERDICT_MESSAGE_KEYS[place.verdict]
  const label = place.verdict === "outside"
    ? t(key, { distance: distanceText(place.distanceMeters ?? 0) })
    : t(key)
  const iconClass = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span
        data-place-verdict={place.verdict}
        className={`inline-flex items-center gap-1 font-medium ${size === "xs" ? "text-[10px]" : "text-xs"} ${TONE_CLASSES[tone]}`}
      >
        <Icon className={iconClass} aria-hidden="true" />
        {label}
      </span>
      {showDistanceDetail && place.distanceMeters !== null ? (
        <span className="mt-0.5 text-xs text-muted-foreground">
          {t("distanceDetail", { distance: distanceText(place.distanceMeters), radius: distanceText(place.radiusMeters) })}
        </span>
      ) : null}
    </span>
  )
}
