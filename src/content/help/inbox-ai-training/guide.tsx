"use client"

/**
 * «Обучение ИИ» — the guide (owner 2026-11-15: «не забудь в гид с навигацией сделать, чтоб люди
 * понимали, как ориентироваться там»). One article per locale (ru.tsx, en.tsx, az.tsx) built from
 * this layout: a table of contents first — every entry a button that scrolls the article to its part —
 * then the screen part by part, in the order it appears on the screen.
 */
import type { ReactNode } from "react"
import { HelpCallout, HelpKey, HelpScenario, HelpSection } from "@/components/help/help-content"

export type GuidePart = { id: string; title: string; body: ReactNode }

export function TrainingGuide({ persona, goal, intro, tocTitle, parts }: {
  persona: string
  goal: string
  intro: ReactNode
  tocTitle: string
  parts: GuidePart[]
}) {
  const go = (id: string) => document.getElementById(`ai-training-guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  return (
    <div className="space-y-6">
      <HelpScenario persona={persona} goal={goal}>{intro}</HelpScenario>
      <nav aria-label={tocTitle} className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tocTitle}</div>
        <ol className="grid gap-1 sm:grid-cols-2">
          {parts.map((part, i) => (
            <li key={part.id}>
              <button type="button" onClick={() => go(part.id)} className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted">
                <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>{part.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {parts.map((part, i) => (
        <div key={part.id} id={`ai-training-guide-${part.id}`} className="scroll-mt-4">
          <HelpSection title={`${i + 1}. ${part.title}`}>{part.body}</HelpSection>
        </div>
      ))}
    </div>
  )
}

export { HelpCallout, HelpKey }
