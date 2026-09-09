"use client"

import { useTour } from "./tour-provider"

interface TourBeaconProps {
  tourId: string
  className?: string
}

/**
 * Pulsing dot shown next to elements when their tour hasn't been completed.
 * Clicking starts the tour.
 */
export function TourBeacon({ tourId, className = "" }: TourBeaconProps) {
  const { isTourCompleted, startTour } = useTour()

  if (isTourCompleted(tourId)) return null

  return (
    <button
      onClick={(e) => { e.stopPropagation(); startTour(tourId) }}
      className={`relative inline-flex h-2.5 w-2.5 ${className}`}
      title="New feature tour"
    >
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
    </button>
  )
}
