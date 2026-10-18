"use client"

import { Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_NEXT_MODULE_FINISH_PATH, getDemoJourneyModule, suggestedDemoModule } from "@/lib/demo-center/journey"
import { demoLabel, demoTarget } from "../demo-target"
import { DemoModuleChooser } from "../module-chooser"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * «What next?» — where every module ends (modules.ts). The guide stops here
 * and asks, instead of opening the next module by itself. The prospect asks
 * Da Vinci a question, opens a module, or finishes the demo.
 */
export function NextModuleScene({ manifest, snapshot, step, reviewMode, dispatch, openSection }: DemoSceneProps) {
  const from = getDemoJourneyModule(String(snapshot.ui["next.from"] ?? ""))
  const suggested = suggestedDemoModule(manifest, snapshot)
  const finishIsTheStep = Boolean(step) && !suggested

  return (
    <div data-testid="demo-scene-next-module" data-tour-id="demo-next-modules" className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-card p-6 dark:border-zinc-700">
        <h1 className="text-xl font-bold tracking-tight">{from ? S.nextAfterTitle(from.title) : S.nextStartTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{suggested ? S.nextBody : S.nextAllDone}</p>
      </div>

      {openSection && !reviewMode ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50/40 p-5 dark:border-orange-900/50 dark:bg-orange-950/20">
          <DemoModuleChooser manifest={manifest} snapshot={snapshot} onOpen={openSection} targetStepId={step && suggested ? step.id : undefined} />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-muted/40 p-4 dark:border-zinc-700">
        <Button
          type="button"
          variant={suggested ? "outline" : "default"}
          data-testid="demo-next-finish"
          // The step's control once every module was walked; before that the
          // arrow is on the suggested module's card (module-chooser.tsx).
          {...demoTarget(finishIsTheStep && "next-module-pick")}
          {...(finishIsTheStep ? demoLabel(S.nextFinish) : {})}
          disabled={!step || reviewMode}
          onClick={() => dispatch({ type: "ui", path: DEMO_NEXT_MODULE_FINISH_PATH, value: true })}
        >
          <Flag className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {S.nextFinish}
        </Button>
        <p className="text-xs text-muted-foreground">{S.nextFinishHint}</p>
      </div>
    </div>
  )
}
