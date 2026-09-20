"use client"

import { CheckCircle2, Circle, Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { activeSections, quoteTotals } from "@/lib/demo-center/journey"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

function formatAzn(amount: number): string {
  return `${new Intl.NumberFormat("az-AZ", { maximumFractionDigits: 0 }).format(amount)} ₼`
}

/** Final screen: what the prospect did, the source → won attribution, and
 *  the one button that closes the session. */
export function SummaryScene({ manifest, snapshot, step, reviewMode, dispatch, hint, onContactSales }: DemoSceneProps & { onContactSales?: () => void }) {
  const sections = activeSections(manifest).filter((section) => section.navGroup !== "demo")
  const completed = new Set(snapshot.completedSteps)
  const skipped = new Set(snapshot.skippedSteps)
  const { records } = snapshot
  const wonAmount = records.deal?.wonAt ? records.deal.amount : records.quote ? quoteTotals(records.quote).gross : null
  const finished = snapshot.state === "COMPLETED"

  const finish = () => {
    if (reviewMode) return
    if (step?.id !== "summary-finish") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "COMPLETED" })
  }

  return (
    <div data-testid="demo-scene-summary" className="mx-auto max-w-2xl space-y-4">
      <div data-tour-id="journey-summary" className="rounded-xl border border-zinc-200 bg-card p-6 dark:border-zinc-700">
        <h1 className="text-2xl font-bold tracking-tight">{finished ? S.completedTitle : manifest.title}</h1>
        <ol className="mt-4 space-y-2 text-sm">
          {sections.map((section, index) => {
            const stepsDone = section.steps.filter((candidate) => completed.has(candidate.id)).length
            const stepsSkipped = section.steps.filter((candidate) => skipped.has(candidate.id)).length
            const done = section.steps.filter((candidate) => candidate.required).every((candidate) => completed.has(candidate.id))
            return (
              <li key={section.id} className="flex items-start gap-2">
                {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{index + 1}. {section.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {S.summaryDone}: {stepsDone}{stepsSkipped ? ` · ${S.summarySkipped}: ${stepsSkipped}` : ""}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <div data-tour-id="journey-attribution" className="rounded-xl border border-zinc-200 bg-card p-5 dark:border-zinc-700">
        <p className="flex items-center gap-2 text-sm font-semibold"><Flag className="h-4 w-4 text-[#FF4D00]" /> {records.campaign.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {wonAmount !== null ? S.summaryAttribution(records.campaign.name, formatAzn(wonAmount)) : S.syntheticNote}
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
            <Button onClick={finish} className="bg-[#FF4D00] text-white hover:bg-[#e04400]" disabled={reviewMode}>
              {S.finish}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
