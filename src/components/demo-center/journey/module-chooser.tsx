"use client"

import type { ComponentType } from "react"
import { CheckCircle2, ChevronRight, Clock, FileSignature, Handshake, Headphones, LifeBuoy, MapPinned, Megaphone, MessagesSquare, PhoneCall } from "lucide-react"
import { cn } from "@/lib/utils"
import { demoModuleChoices, type DemoJourneyManifest, type DemoJourneyModuleId, type DemoJourneySnapshot } from "@/lib/demo-center/journey"
import { demoLabel, demoTarget } from "./demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

const MODULE_ICONS: Record<DemoJourneyModuleId, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  marketing: Megaphone,
  omnichannel: MessagesSquare,
  "ai-calls": PhoneCall,
  deals: Handshake,
  "service-desk": LifeBuoy,
  "call-center": Headphones,
  "route-field": MapPinned,
  personnel: Clock,
  contracts: FileSignature,
}

/**
 * The modules to choose from, as cards: the ones the prospect asked for on
 * the request form first, the ones already walked ticked. The welcome screen
 * and the «what next» screen show the same list (owner, 2026-10-18: «в начале
 * выбирал модуль по модулю… гид спрашивал, на какой модуль хочет перейти
 * дальше, показывая доступные модули»).
 *
 * `targetStepId` marks the card the guide suggests — the first not yet walked
 * — so the step's arrow points at it.
 */
export function DemoModuleChooser({
  manifest,
  snapshot,
  onOpen,
  targetStepId,
}: {
  manifest: DemoJourneyManifest
  snapshot: DemoJourneySnapshot
  onOpen: (sectionId: string) => void
  targetStepId?: string
}) {
  const choices = demoModuleChoices(manifest, snapshot)
  const suggested = choices.find((choice) => !choice.done)
  const groups = [
    { title: S.nextChosen, items: choices.filter((choice) => choice.chosen) },
    { title: S.nextOthers, items: choices.filter((choice) => !choice.chosen) },
  ].filter((group) => group.items.length)

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.title}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.items.map((choice) => {
              const Icon = MODULE_ICONS[choice.module.id]
              const isSuggested = choice === suggested
              return (
                <button
                  key={choice.module.id}
                  type="button"
                  data-start-section={choice.firstSectionId}
                  data-module={choice.module.id}
                  {...demoTarget(isSuggested && targetStepId)}
                  {...(isSuggested && targetStepId ? demoLabel(S.nextOpen(choice.module.title)) : {})}
                  onClick={() => onOpen(choice.firstSectionId)}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:border-[#FF4D00]/60",
                    isSuggested ? "border-[#FF4D00]/70 ring-1 ring-[#FF4D00]/30" : "border-zinc-200 dark:border-zinc-700",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#FF4D00]" aria-hidden={true} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{choice.module.title}</span>
                      {choice.done ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {S.nextDone}
                        </span>
                      ) : isSuggested ? (
                        <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">{S.nextSuggested}</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{choice.module.pitch}</span>
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
