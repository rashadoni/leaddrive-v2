"use client"

import { ShieldCheck } from "lucide-react"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/** Orientation: the prospect meets the reduced LeadDrive shell. The sidebar,
 *  guide panel and watermark carry the anchors; the centre only says hello. */
export function OrientationScene({ snapshot, variant }: DemoSceneProps) {
  const { identity } = snapshot
  return (
    <div data-testid="demo-scene-orientation" className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-card p-6 dark:border-zinc-700">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{variant === "preview" ? S.badgePreview : variant === "open" ? S.badgeOpen : S.badgePrivate}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{S.welcome(identity.name)}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{S.welcomeBody(identity.company)}</p>
        <ul className="mt-4 space-y-2 text-sm">
          {S.welcomePoints.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#FF4D00]" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-muted/40 p-4 text-xs text-muted-foreground dark:border-zinc-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="leading-relaxed">{S.syntheticNote}</p>
      </div>
    </div>
  )
}
