"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { MapPin } from "lucide-react"
import { calculateDistance } from "@/lib/geo-utils"
import {
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
/** After «too many requests» nothing is asked for a minute. */
const RATE_LIMIT_PAUSE_MS = 60_000
const CACHE_LIMIT = 300
/** A street asked for this far from where he is now is no longer shown while the new one is on its way. */
const STREET_OUTDATED_METERS = 300

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
  position, inVisit, stops, stopsReady,
}: {
  /** Null when the live map shows no current position for him. */
  position: LiveMapPlacePosition | null
  inVisit: boolean
  stops: readonly LiveMapPlaceStop[]
  /** Today's route has been read: until then «not at a client» is not known, and no street is asked. */
  stopsReady: boolean
}) {
  const tMap = useTranslations("mtmMap")
  const place = useMemo(() => liveMapPlace({ position, inVisit, stops }), [position, inVisit, stops])
  const [street, setStreet] = useState<{ latitude: number; longitude: number; answer: StreetAnswer } | null>(null)
  const anchorRef = useRef<{ latitude: number; longitude: number } | null>(null)

  const askLatitude = place.kind === "street" && stopsReady ? place.latitude : null
  const askLongitude = place.kind === "street" && stopsReady ? place.longitude : null
  const accuracy = position?.accuracy ?? null

  useEffect(() => {
    if (askLatitude === null || askLongitude === null) return
    const current = { latitude: askLatitude, longitude: askLongitude, accuracy }
    // Standing still, or wandering inside the fix's own error: the street on screen stands.
    if (!placeMovedFromAnchor(anchorRef.current, current)) return
    const point = placeLookupPoint(askLatitude, askLongitude)
    const controller = new AbortController()
    // The answer is tied to the coordinate it was asked for only once it has
    // arrived: a refresh that lands while the question is still out asks again
    // instead of leaving the line on «определяю» for good.
    const settle = (answer: StreetAnswer) => {
      if (controller.signal.aborted) return
      anchorRef.current = { latitude: askLatitude, longitude: askLongitude }
      setStreet({ latitude: askLatitude, longitude: askLongitude, answer })
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
          if (response.status === 429) pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS
          if (!response.ok) return { available: false, street: null } satisfies StreetAnswer
          const body = await response.json().catch(() => null) as { data?: { available?: unknown; street?: unknown } } | null
          const name = typeof body?.data?.street === "string" ? body.data.street.trim() : ""
          const answer: StreetAnswer = { available: body?.data?.available === true, street: name || null }
          // «The road server is down» is not remembered: the next move asks again.
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
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [askLatitude, askLongitude, accuracy])

  if (place.kind === "unknown") return null

  let text: string
  let detail: string | null = null
  if (place.kind === "client") {
    text = tMap(place.basis === "visit" ? "place.atClientVisit" : "place.atClientZone", { name: place.name })
    detail = place.address
  } else if (!stopsReady || !street
    || calculateDistance(street.latitude, street.longitude, place.latitude, place.longitude) > STREET_OUTDATED_METERS) {
    text = tMap("place.loading")
  } else if (street.answer.street) {
    text = isPlaceApproximate(position)
      ? tMap("place.approximately", { place: street.answer.street })
      : street.answer.street
  } else {
    text = tMap("place.coordinates", { coordinates: `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}` })
  }

  return (
    <div className="flex items-start gap-1.5 text-foreground" data-testid="live-map-agent-place" data-place={place.kind}>
      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="font-medium">{tMap("place.title")}: </span>
        <span data-testid="live-map-agent-place-text">{text}</span>
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </span>
    </div>
  )
}
