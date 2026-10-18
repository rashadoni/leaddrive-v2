"use client"

import { Play, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * The guide's voice switch, in words (a bare speaker glyph was the kind of
 * control the owner found unreadable). When the browser refused to start the
 * voice without a click, it is the click: a filled orange «Bələdçini
 * dinləyin» instead of a quiet «Səsi söndür» over a guide that says nothing.
 */
export function GuideVoiceSwitch({
  on,
  blocked,
  onToggle,
  onUnblock,
  testId,
  className,
}: {
  on: boolean
  blocked: boolean
  onToggle: () => void
  onUnblock: () => void
  testId: string
  className?: string
}) {
  if (blocked) {
    return (
      <Button
        size="sm"
        className={cn("h-8 bg-[#FF4D00] text-xs text-white hover:bg-[#e64500] motion-safe:animate-pulse", className)}
        data-testid={testId}
        data-blocked="true"
        onClick={onUnblock}
      >
        <Play className="mr-1.5 h-3.5 w-3.5 fill-current" aria-hidden="true" />
        {S.voiceUnblock}
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant={on ? "secondary" : "outline"}
      className={cn("h-8 text-xs", className)}
      aria-pressed={on}
      data-testid={testId}
      onClick={onToggle}
    >
      {on ? <VolumeX className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
      {on ? S.voiceOff : S.voiceOn}
    </Button>
  )
}
