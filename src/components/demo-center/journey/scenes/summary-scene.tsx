"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, ChevronRight, Circle, Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { activeSections, demoMoney, moduleProgress, quoteTotals } from "@/lib/demo-center/journey"
import { navItems } from "@/lib/nav-items"
import { demoModuleLabel } from "../module-label"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Last screen: what the prospect did, the source → won attribution — and,
 * first of all, the modules they have not seen.
 *
 * It used to be one list and one button, «Bitir», with the guide's arrow on
 * it. The owner walked 15 of 27 steps, was led straight to that button, and
 * read «Demo tamamlandı» having never seen the inbox, the AI reply or the AI
 * call (2026-10-13). Now the unseen modules come first, each a button that
 * opens it with its guide, and the arrow points at them; closing the session
 * is offered plainly only once everything was seen.
 */
export function SummaryScene({ manifest, snapshot, step, reviewMode, dispatch, hint, openSection, onContactSales }: DemoSceneProps & { onContactSales?: () => void }) {
  const tn = useTranslations("nav")
  // The module as the menu names it («Gələn qutusu»), so the button and the
  // sidebar entry it leads to read the same.
  const moduleName = (route: string, fallback: string) => {
    const item = navItems.find((candidate) => candidate.href === route)
    return item ? demoModuleLabel(item, tn) : fallback
  }
  const sections = activeSections(manifest).filter((section) => section.navGroup !== "demo")
  const completed = new Set(snapshot.completedSteps)
  const skipped = new Set(snapshot.skippedSteps)
  const { records } = snapshot
  const wonAmount = records.deal?.wonAt ? records.deal.amount : records.quote ? quoteTotals(records.quote).total : null
  const finished = snapshot.state === "COMPLETED"
  const unseen = finished ? [] : moduleProgress(snapshot, manifest).filter((module) => !module.done)
  const onFinishStep = step?.id === "summary-finish"
  // Each module the prospect walked: what they did — the results its steps
  // wrote when they did them, already vetted against the product — and what
  // it gives a business. Modules not started are in the box above instead.
  const routeOf = (route: string) => route.replace(/\/\[[a-zA-Z]+\]$/, "")
  const walked = moduleProgress(snapshot, manifest).flatMap((module) => {
    const own = sections.filter((section) => routeOf(section.route) === module.route)
    const steps = own.flatMap((section) => section.steps)
    const stepsDone = steps.filter((candidate) => completed.has(candidate.id)).length
    if (stepsDone === 0) return []
    // The last three: a module's outcome comes at its end («Sənəd imzalandı»).
    const results = [...new Set(steps.filter((candidate) => completed.has(candidate.id) && candidate.result).map((candidate) => candidate.result as string))].slice(-3)
    return [{
      ...module,
      stepsDone,
      stepsTotal: steps.length,
      stepsSkipped: steps.filter((candidate) => skipped.has(candidate.id)).length,
      results,
      sectionTitles: own.map((section) => section.title),
    }]
  })

  const finish = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "summary-finish") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "COMPLETED" })
  }

  return (
    <div data-testid="demo-scene-summary" className="mx-auto max-w-2xl space-y-4">
      {unseen.length > 0 && (
        <div data-testid="demo-unseen-modules" className="rounded-xl border border-orange-200 bg-orange-50/60 p-5 dark:border-orange-900/50 dark:bg-orange-950/20">
          <h2 className="text-lg font-bold tracking-tight">{S.unseenTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{S.unseenBody}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {unseen.map((module, index) => (
              <Button
                key={module.route}
                variant="outline"
                className="h-auto justify-between whitespace-normal bg-card py-2.5 text-left"
                onClick={() => openSection?.(module.firstSectionId)}
                // The guide's arrow belongs here while something is unseen — not on «Bitir».
                {...(onFinishStep && index === 0 ? { ...demoTarget("summary-finish"), "data-demo-label": S.unseenOpen(moduleName(module.route, module.title)) } : {})}
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{moduleName(module.route, module.title)}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{module.title}</span>
                </span>
                <ChevronRight className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
      )}
      <div data-tour-id="journey-summary" className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">{finished ? S.completedTitle : unseen.length ? manifest.title : S.allSeenTitle}</h1>
        <div className="grid gap-3 md:grid-cols-2">
          {walked.map((module) => (
            <section key={module.route} data-testid="demo-summary-module" data-module-route={module.route} className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-start gap-2">
                {module.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold leading-tight">{moduleName(module.route, module.title)}</h2>
                  <p className="text-xs text-muted-foreground">{S.summaryModuleSteps(module.stepsDone, module.stepsTotal)}{module.stepsSkipped ? ` · ${S.summarySkipped}: ${module.stepsSkipped}` : ""}</p>
                </div>
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{module.results.length ? S.summaryYouDid : S.summaryYouSaw}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {(module.results.length ? module.results : module.sectionTitles).map((line) => (
                  <li key={line} className="flex gap-2"><span aria-hidden="true" className="text-muted-foreground">•</span><span className="min-w-0">{line}</span></li>
                ))}
              </ul>
              {S.moduleValue[module.route] && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <span className="font-semibold">{S.summaryForBusiness}:</span> {S.moduleValue[module.route]}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>

      <div data-tour-id="journey-attribution" className="rounded-xl border border-zinc-200 bg-card p-5 dark:border-zinc-700">
        <p className="flex items-center gap-2 text-sm font-semibold"><Flag className="h-4 w-4 text-[#FF4D00]" /> {records.campaign.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {wonAmount !== null ? S.summaryAttribution(records.campaign.name, demoMoney(wonAmount)) : S.syntheticNote}
        </p>
      </div>

      <div data-tour-id="journey-finish" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-card p-5 dark:border-zinc-700">
        {finished ? (
          <>
            <p className="flex-1 text-sm text-muted-foreground">{S.completedBody}</p>
            {onContactSales && (
              <Button onClick={onContactSales} className="bg-[#FF4D00] text-white hover:bg-[#e04400]">{S.contactSales}</Button>
            )}
          </>
        ) : (
          <>
            <p className="flex-1 text-sm text-muted-foreground">{S.syntheticNote}</p>
            <Button
              onClick={finish}
              variant={unseen.length ? "outline" : "default"}
              className={unseen.length ? undefined : "bg-[#FF4D00] text-white hover:bg-[#e04400]"}
              disabled={reviewMode}
              data-testid="demo-finish"
              {...(unseen.length ? {} : demoTarget("summary-finish"))}
            >
              {S.finish}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
