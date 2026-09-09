"use client"

/**
 * Help content layout primitives.
 *
 * Articles in `src/content/help/<slug>/<locale>.tsx` import these to
 * structure their content. Keeps every article visually consistent
 * without each one re-inventing typography + spacing.
 */
import { ReactNode } from "react"
import { Lightbulb, ShieldCheck, AlertTriangle, ArrowRight, Eye } from "lucide-react"

interface SectionProps {
  title: string
  children: ReactNode
}

export function HelpSection({ title, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

interface StepProps {
  n: number
  children: ReactNode
}

export function HelpStep({ n, children }: StepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
        {n}
      </div>
      <div className="flex-1 pt-0.5">{children}</div>
    </div>
  )
}

type CalloutKind = "tip" | "warning" | "security" | "next" | "see"

const CALLOUT_STYLE: Record<CalloutKind, { wrap: string; icon: ReactNode; label: string }> = {
  see: {
    wrap: "border-indigo-200 bg-indigo-50 dark:border-indigo-900/40 dark:bg-indigo-950/20",
    icon: <Eye className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />,
    label: "What you'll see",
  },
  tip: {
    wrap: "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20",
    icon: <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    label: "Tip",
  },
  warning: {
    wrap: "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20",
    icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />,
    label: "Heads up",
  },
  security: {
    wrap: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
    icon: <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    label: "Security",
  },
  next: {
    wrap: "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20",
    icon: <ArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
    label: "What's next",
  },
}

interface CalloutProps {
  kind: CalloutKind
  /** Override the default Tip/Warning label */
  label?: string
  children: ReactNode
}

export function HelpCallout({ kind, label, children }: CalloutProps) {
  const cfg = CALLOUT_STYLE[kind]
  return (
    <div className={`rounded-md border p-3 ${cfg.wrap}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-foreground/80 mb-1">
        {cfg.icon}
        <span>{label ?? cfg.label}</span>
      </div>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  )
}

/** Keyboard-shortcut / UI label inline pill. */
export function HelpKey({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground">
      {children}
    </span>
  )
}

/** A definition list row — used for "Field name → meaning" tables. */
export function HelpDef({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 border-b border-border/50 last:border-b-0">
      <dt className="text-xs font-medium text-foreground/70 pt-0.5">{term}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * Scenario / persona framing card — sits at the top of a video-tutorial-script
 * article. Sets up "who you are" + "what you're trying to do" + optional
 * starting point / prerequisites, so the article reads as a guided walkthrough
 * a producer can narrate over a screen recording.
 */
export function HelpScenario({
  persona,
  goal,
  children,
}: {
  persona: string
  goal: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border-l-4 border-primary/60 bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.7rem] font-medium text-primary">
          {persona}
        </span>
        <span className="text-sm font-semibold tracking-tight">{goal}</span>
      </div>
      {children ? (
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
      ) : null}
    </div>
  )
}
