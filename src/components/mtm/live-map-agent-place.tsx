"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { MapPin } from "lucide-react"
import { calculateDistance } from "@/lib/geo-utils"
import { cn } from "@/lib/utils"
import {
  PLACE_MAX_MOVE_METERS,
  isPlaceApproximate,
  liveMapPlace,
  placeLookupPoint,
  placeMovedFromAnchor,
  type LiveMapPlacePosition,
  type LiveMapPlaceStop,
} from "@/lib/mtm/live-map-place"

type StreetAnswer = { available: boolean; street: string | null }

/** The position must rest this long before the street is asked for (the map picker's rhythm). */
const SETTLE_MS = 600
/** After «too many requests», or a road server that did not answer, nothing is asked for a minute. */
const PAUSE_MS = 60_000
/** A card whose street could not be had asks again by itself this many times; after that, on his next move. */
const MAX_RETRIES = 3
const CACHE_LIMIT = 300

// One answer per corner for the whole tab: reselecting an employee, or two
// employees at the same door, do not ask twice.
const streetCache = new Map<string, StreetAnswer>()
let pausedUntil = 0

export function resetLiveMapPlaceCacheForTests(): void {
  streetCache.clear()
  pausedUntil = 0
}

/**
 * «Где сейчас» in the selected employee's card: at a client (the visit he is
 * in, or a stop of today's route whose circle he is inside), otherwise the
 * street from the company's own road server, otherwise the coordinates.
 * Nothing is drawn when the map shows no live position for him — an old
 * coordinate is not where he is.
 */
export function LiveMapAgentPlace({
  position, inVisit, stops, stopsReady, delayed = false, formatDistance = (meters) => `${Math.round(meters)} m`,
  settleMs = SETTLE_MS,
}: {
  /** Null when the live map shows no current position for him. */
  position: LiveMapPlacePosition | null
  inVisit: boolean
  stops: readonly LiveMapPlaceStop[]
  /** Today's route has been read: until then «not at a client» is not known, and no street is asked. */
  stopsReady: boolean
  /** The coordinate is a few minutes old: the place is where he was then, and is toned like the signal. */
  delayed?: boolean
  formatDistance?: (meters: number) => string
  /** How long the position must rest before the street is asked for. */
  settleMs?: number
}) {
  const tMap = useTranslations("mtmMap")
  const place = useMemo(() => liveMapPlace({ position, inVisit, stops }), [position, inVisit, stops])
  const [street, setStreet] = useState<{ latitude: number; longitude: number; answer: StreetAnswer } | null>(null)
  /** Bumped when a street that could not be had is to be asked for again. */
  const [retry, setRetry] = useState(0)
  const anchorRef = useRef<{ latitude: number; longitude: number } | null>(null)

  const asks = (place.kind === "street" || place.kind === "away") && stopsReady
  const askLatitude = asks ? place.latitude : null
  const askLongitude = asks ? place.longitude : null
  const accuracy = position?.accuracy ?? null

  useEffect(() => {
    if (askLatitude === null || askLongitude === null) return
    const current = { latitude: askLatitude, longitude: askLongitude, accuracy }
    // Standing still, or wandering inside the fix's own error: the street on screen stands.
    if (!placeMovedFromAnchor(anchorRef.current, current)) return
    const point = placeLookupPoint(askLatitude, askLongitude)
    const controller = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const settle = (answer: StreetAnswer) => {
      if (controller.signal.aborted) return
      setStreet({ latitude: askLatitude, longitude: askLongitude, answer })
      if (answer.available) {
        // Tied to the coordinate only once a real answer has arrived: a
        // refresh that lands while the question is still out asks again.
        anchorRef.current = { latitude: askLatitude, longitude: askLongitude }
        return
      }
      // The road server did not answer. That is not the street of this
      // corner: nothing is anchored, and a person who is standing still —
      // the one this line matters for — is asked about again after the
      // pause, a bounded number of times, without waiting for him to move.
      pausedUntil = Math.max(pausedUntil, Date.now() + PAUSE_MS)
      if (retry < MAX_RETRIES) {
        retryTimer = setTimeout(() => setRetry((count) => count + 1), Math.max(0, pausedUntil - Date.now()) + 1_000)
      }
    }
    const timer = setTimeout(() => {
      const known = streetCache.get(point.key)
      if (known) return settle(known)
      if (Date.now() < pausedUntil) return settle({ available: false, street: null })
      void fetch(`/api/v1/mtm/geocode/street?lat=${point.latitude}&lng=${point.longitude}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) return { available: false, street: null } satisfies StreetAnswer
          const body = await response.json().catch(() => null) as { data?: { available?: unknown; street?: unknown } } | null
          const name = typeof body?.data?.street === "string" ? body.data.street.trim() : ""
          const answer: StreetAnswer = { available: body?.data?.available === true, street: name || null }
          // Only a real answer is remembered — «no named road here» included.
          if (answer.available) {
            if (streetCache.size >= CACHE_LIMIT) {
              const oldest = streetCache.keys().next().value
              if (oldest !== undefined) streetCache.delete(oldest)
            }
            streetCache.set(point.key, answer)
          }
          return answer
        })
        .then(settle)
        .catch(() => settle({ available: false, street: null }))
    }, settleMs)
    return () => {
      clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
      controller.abort()
    }
  }, [askLatitude, askLongitude, accuracy, retry, settleMs])

  if (place.kind === "unknown") return null

  // The street asked for a place he has since left by more than a few
  // hundred metres is not shown while the new one is on its way; the same
  // distance always counts as a move, so a question is in fact on its way.
  const streetHere = asks && street
    && calculateDistance(street.latitude, street.longitude, place.latitude, place.longitude) <= PLACE_MAX_MOVE_METERS
    ? street.answer
    : null
  const approximate = isPlaceApproximate(position)
  const roughly = (text: string) => (approximate ? tMap("place.approximately", { place: text }) : text)

  let text: string
  let detail: string | null = null
  if (place.kind === "client") {
    text = place.basis === "visit"
      ? tMap("place.atClientVisit", { name: place.name })
      // A circle is a hundred metres: a fix worse than that is «примерно» here too.
      : roughly(tMap("place.atClientZone", { name: place.name }))
    detail = place.address
  } else if (place.kind === "away") {
    text = tMap("place.visitAway", { name: place.name, distance: formatDistance(place.distanceMeters) })
    detail = streetHere?.street ? roughly(streetHere.street) : null
  } else if (!streetHere) {
    text = tMap("place.loading")
  } else if (streetHere.street) {
    text = roughly(streetHere.street)
  } else {
    text = tMap("place.coordinates", { coordinates: `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}` })
  }

  return (
    <div
      className={cn("flex items-start gap-1.5", delayed ? "text-amber-700 dark:text-amber-300" : "text-foreground")}
      title={delayed ? tMap("place.delayedHint") : undefined}
      data-testid="live-map-agent-place"
      data-place={place.kind}
    >
      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-medium">{tMap("place.title")}: </span>
        <span data-testid="live-map-agent-place-text">{text}</span>
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        {delayed ? <span className="sr-only"> · {tMap("place.delayedHint")}</span> : null}
      </span>
    </div>
  )
}
