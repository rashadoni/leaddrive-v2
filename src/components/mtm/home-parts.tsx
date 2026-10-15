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

export const HOME_CHIP: Record<HomeTone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  red: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  blue: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  orange: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900",
}

export const HOME_ICON: Record<HomeTone, string> = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  blue: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
}

const HOME_BAR: Record<HomeTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  blue: "bg-sky-500",
  zinc: "bg-zinc-300 dark:bg-zinc-600",
  orange: "bg-orange-500",
}

const CARD = "rounded-2xl border border-zinc-200 bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-700"

export function HomePill({ tone, children, className }: { tone: HomeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", HOME_CHIP[tone], className)}>{children}</span>
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
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", HOME_ICON[tone])}>{icon}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span data-testid={`${testId}-value`} className="text-[34px] font-bold leading-none tracking-tight tabular-nums">{value ?? "—"}</span>
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
  tone,
  title,
  badge,
  action,
  children,
}: {
  testId: string
  titleId: string
  icon: ReactNode
  tone: HomeTone
  title: string
  badge?: string | null
  action?: { href: string; label: string; hint?: string } | null
  children: ReactNode
}) {
  return (
    <section data-testid={testId} aria-labelledby={titleId} className={cn(CARD, "flex min-w-0 flex-col")}>
      <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", HOME_ICON[tone])}>{icon}</span>
        <h3 id={titleId} className="min-w-0 truncate text-[15px] font-semibold">{title}</h3>
        {badge ? <HomePill tone={tone}>{badge}</HomePill> : null}
        {action ? (
          <Hint text={action.hint}><Link href={action.href} prefetch={false} className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-3 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700">
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
    <div className="mb-3 mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/60 px-3.5 py-2 text-xs">
      <HintValue className="font-medium" text={textHint}>{text}</HintValue>
      <Hint text={linkHint}><Link href={href} prefetch={false} className="ml-auto inline-flex min-h-9 items-center gap-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-0">
        {link}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link></Hint>
    </div>
  )
}
