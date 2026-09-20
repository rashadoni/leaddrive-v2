"use client"

import { Hammer } from "lucide-react"
import type { DemoJourneySection } from "@/lib/demo-center/journey"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Admin-preview notice for a section whose scene is not built yet. It never
 * reaches a prospect: the public flow is not wired to the journey renderer
 * until every scene of the issued scenario exists. It is a status message,
 * not a stand-in screen — no invented product UI here.
 */
export function ScenePending({ section }: { section: DemoJourneySection }) {
  return (
    <div data-testid="demo-scene-pending" className="mx-auto max-w-lg rounded-xl border border-dashed border-zinc-300 bg-card p-6 text-center dark:border-zinc-700">
      <Hammer className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold">{S.pendingSceneTitle}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{S.pendingSceneBody(section.title)}</p>
      <p className="mt-3 text-[11px] text-muted-foreground">{section.route}</p>
    </div>
  )
}
