"use client"

import { useTranslations } from "next-intl"
import { HelpCircle } from "lucide-react"
import { useTour } from "./tour-provider"

interface TourReplayButtonProps {
  tourId: string
  className?: string
}

/**
 * Small button to replay a completed tour.
 * Shows only after tour is completed. Clicking restarts it.
 */
export function TourReplayButton({ tourId, className = "" }: TourReplayButtonProps) {
  const t = useTranslations("common")
  const { isTourCompleted, resetTour, startTour, activeTour } = useTour()

  // Don't show during active tour or if tour never completed
  if (activeTour || !isTourCompleted(tourId)) return null

  const handleReplay = () => {
    resetTour(tourId)
    // Small delay to let state update
    setTimeout(() => startTour(tourId), 50)
  }

  return (
    <button
      onClick={handleReplay}
      className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors ${className}`}
      title={t("replayTour")}
    >
      <HelpCircle className="h-3.5 w-3.5" />
      <span>{t("replayTour")}</span>
    </button>
  )
}
