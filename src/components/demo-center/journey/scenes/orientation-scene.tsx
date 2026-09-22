"use client"

import { useTranslations } from "next-intl"
import { ChevronRight, ShieldCheck } from "lucide-react"
import { activeSections } from "@/lib/demo-center/journey"
import { navItems } from "@/lib/nav-items"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/** Orientation: the prospect meets the reduced LeadDrive shell. The sidebar,
 *  guide panel and watermark carry the anchors; the centre says hello and
 *  offers to start where the prospect's interest is (owner, 2026-09-22: «если
 *  клиент сразу интересуется омни-каналом, зачем ему переходить по всем
 *  разделам?»). The choices are the product's own sidebar entries, with
 *  their own icons and labels. */
export function OrientationScene({ manifest, snapshot, variant, reviewMode, openSection }: DemoSceneProps) {
  const t = useTranslations("nav")
  const { identity } = snapshot
  const sections = activeSections(manifest)
  const base = (route: string) => route.replace(/\/\[[a-zA-Z]+\]$/, "")
  // One choice per sidebar entry the story visits, opening its first section.
  const choices = navItems
    .filter((item) => manifest.visibleRoutes.includes(item.href))
    .map((item) => ({ item, section: sections.find((section) => section.navGroup !== "demo" && base(section.route) === item.href) }))
    .filter((choice): choice is { item: (typeof navItems)[number]; section: (typeof sections)[number] } => Boolean(choice.section))
    .sort((a, b) => sections.indexOf(a.section) - sections.indexOf(b.section))

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

      {openSection && !reviewMode && choices.length ? (
        <section data-tour-id="demo-start-choice" aria-labelledby="demo-start-choice-title" className="rounded-xl border border-orange-200 bg-orange-50/50 p-5 dark:border-orange-900/50 dark:bg-orange-950/20">
          <h2 id="demo-start-choice-title" className="text-base font-semibold">{S.chooseTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{S.chooseBody}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {choices.map(({ item, section }) => {
              const Icon = item.icon
              return (
                <button
                  key={item.href}
                  type="button"
                  data-start-section={section.id}
                  onClick={() => openSection(section.id)}
                  className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-card px-3 py-2.5 text-left transition-colors hover:border-[#FF4D00]/60 dark:border-zinc-700"
                >
                  <Icon className="h-4 w-4 shrink-0 text-[#FF4D00]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t(item.tKey)}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{section.title}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-muted/40 p-4 text-xs text-muted-foreground dark:border-zinc-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="leading-relaxed">{S.syntheticNote}</p>
      </div>
    </div>
  )
}
