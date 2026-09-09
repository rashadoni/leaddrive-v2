"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useTour } from "./tour-provider"
import { TourStep } from "./tour-step"
import { TOUR_DEFINITIONS } from "@/lib/tour-definitions"

/**
 * Renders the active tour step. Place once in the layout.
 * Reads tour definitions and i18n keys, renders TourStep for current step.
 */
export function TourRenderer() {
  const t = useTranslations("tour")
  const tc = useTranslations("common")
  const { activeTour, currentStep, nextStep, prevStep, skipTour, completeTour, setTotalSteps } = useTour()

  const tourDef = activeTour ? TOUR_DEFINITIONS[activeTour] : null
  const steps = tourDef?.steps || []
  const totalSteps = steps.length
  const current = steps[currentStep]

  useEffect(() => {
    if (totalSteps > 0) setTotalSteps(totalSteps)
  }, [totalSteps, setTotalSteps])

  // Auto-complete when past last step
  useEffect(() => {
    if (activeTour && currentStep >= totalSteps && totalSteps > 0) {
      completeTour()
    }
  }, [currentStep, totalSteps, activeTour, completeTour])

  if (!activeTour || !current) return null

  // Resolve i18n keys
  let title: string
  let description: string
  try {
    title = t(`${activeTour}.${current.titleKey}`)
    description = t(`${activeTour}.${current.descKey}`)
  } catch {
    title = current.titleKey
    description = current.descKey
  }

  return (
    <TourStep
      targetId={current.targetId}
      title={title}
      description={description}
      step={currentStep}
      totalSteps={totalSteps}
      onNext={nextStep}
      onPrev={prevStep}
      onSkip={skipTour}
      isFirst={currentStep === 0}
      isLast={currentStep === totalSteps - 1}
      labels={{ back: tc("back"), next: tc("next"), done: tc("done") }}
    />
  )
}
