import { Hint, HintValue } from "@/components/hint"
import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The building blocks of the MTM home screen, in the language of the CRM's
 * own home (`src/components/dashboard/*`): rounded cards, a figure with a
 * label and an icon, a card with a header. The owner rejected the Panel drawn
 * as rows of grey text on 2026-10-11 and accepted this look as a picture.
 */

export type HomeTone = "green" | "amber" | "red" | "blue" | "zinc" | "orange"

/*
 * Colours (owner-approved mockup, 2026-10-18: «не слишком ли много заливок»):
 * a status is said by the colour of its text or number — «43%» red, «5»
 * orange — never by a filled pill, tile or square under an icon. The one
 * orange fill on a screen is its main button; bars are the brand orange.
 */
export const HOME_CHIP: Record<HomeTone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-rose-700 dark:text-rose-300",
  blue: "text-sky-700 dark:text-sky-300",
  zinc: "text-muted-foreground",
  orange: "text-orange-700 dark:text-orange-300",
}

/** An icon in its tone's colour, with nothing under it. */
export const HOME_ICON: Record<HomeTone, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-rose-600 dark:text-rose-400",
  blue: "text-sky-600 dark:text-sky-400",
  zinc: "text-muted-foreground",
  orange: "text-orange-600 dark:text-orange-400",
}

const HOME_BAR: Record<HomeTone, string> = {
  green: "bg-primary",
  amber: "bg-primary",
  red: "bg-primary",
  blue: "bg-primary",
  zinc: "bg-zinc-300 dark:bg-zinc-600",
  orange: "bg-primary",
}

/** The figure itself carries the colour only when it asks for something. */
const HOME_VALUE: Record<HomeTone, string> = {
  green: "",
  amber: "text-primary",
  red: "text-rose-600 dark:text-rose-400",
  blue: "",
  zinc: "",
  orange: "",
}

const CARD = "rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)]"

export function HomePill({ tone, children, className }: { tone: HomeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold", HOME_CHIP[tone], className)}>{children}</span>
}

/** One figure: what it counts, the number, what it is out of, and one line under it. */
export function HomeKpi({
  testId,
  label,
  icon,
  tone,
  value,
  unit,
  pill,
  progress,
  sub,
  hint,
}: {
  testId: string
  label: string
  /** What the figure counts, said under the cursor on its label. */
  hint?: string | null
  icon: ReactNode
  tone: HomeTone
  /** Null while the number is not known: a dash, never a made-up zero. */
  value: string | null
  unit?: string | null
  pill?: string | null
  /** 0–100; omitted when the figure has no bar. */
  progress?: number | null
  sub?: string | null
}) {
  return (
    <div data-testid={testId} className={cn(CARD, "flex min-w-0 flex-col p-4")}>
      <div className="flex items-center justify-between gap-2">
        <HintValue className="truncate text-[13px] font-medium text-muted-foreground" text={hint}>{label}</HintValue>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span data-testid={`${testId}-value`} className={cn("text-[34px] font-bold leading-none tracking-tight tabular-nums", HOME_VALUE[tone])}>{value ?? "—"}</span>
        {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
        {pill ? <HomePill tone={tone} className="ml-auto">{pill}</HomePill> : null}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
        {typeof progress === "number" ? <div className={cn("h-full rounded-full", HOME_BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /> : null}
      </div>
      <p data-testid={`${testId}-sub`} className="mt-2 min-h-4 text-xs text-muted-foreground">{sub ?? ""}</p>
    </div>
  )
}

export function HomeCard({
  testId,
  titleId,
  icon,
  title,
  badge,
  action,
  children,
}: {
  testId: string
  titleId: string
  icon: ReactNode
  /** Kept for the callers; since 2026-10-18 the header is grey whatever the tone. */
  tone: HomeTone
  title: string
  badge?: string | null
  action?: { href: string; label: string; hint?: string } | null
  children: ReactNode
}) {
  return (
    <section data-testid={testId} aria-labelledby={titleId} className={cn(CARD, "flex min-w-0 flex-col")}>
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="flex h-8 w-6 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
        <h3 id={titleId} className="min-w-0 truncate text-[15px] font-semibold">{title}</h3>
        {badge ? <span className="inline-flex shrink-0 items-center rounded-full border border-border px-2 text-xs font-semibold leading-5 text-muted-foreground">{badge}</span> : null}
        {action ? (
          <Hint text={action.hint}><Link href={action.href} prefetch={false} className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {action.label}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link></Hint>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col px-5 py-1">{children}</div>
    </section>
  )
}

/** The grey strip at the bottom of a card: one fact and where to read more. */
export function HomeCardFoot({ text, href, link, textHint, linkHint }: { text: string; href: string; link: string; textHint?: string; linkHint?: string }) {
  return (
    <div className="mb-3 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-xs">
      <HintValue className="font-medium" text={textHint}>{text}</HintValue>
      <Hint text={linkHint}><Link href={href} prefetch={false} className="ml-auto inline-flex min-h-9 items-center gap-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-0">
        {link}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link></Hint>
    </div>
  )
}
