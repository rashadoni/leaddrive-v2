"use client"

import { useEffect, useState } from "react"
import { X, type LucideIcon } from "lucide-react"
import { dismissMtmHint, isMtmHintDismissed, mtmHintStorageKey } from "@/lib/mtm/dismissible-hint"

type MtmWorkflowGuideStep = {
  title: string
  description?: string
  icon: LucideIcon
  active?: boolean
  onClick?: () => void
}

type MtmWorkflowGuideProps = {
  title: string
  description: string
  steps: MtmWorkflowGuideStep[]
  className?: string
  /**
   * C5: identity of this panel for "do not show again". Without it the guide
   * behaves exactly as before — always visible — so no screen loses its
   * orientation panel by accident.
   */
  dismissId?: string
  /** Who is dismissing it; the choice is theirs, not the browser's. */
  viewerKey?: string | null
  /** Label of the dismiss control, from the caller's namespace. */
  dismissLabel?: string
}

/**
 * A compact orientation panel used by MTM workspaces. It intentionally
 * explains the normal path before showing filters, grids, or bulk tools.
 */
export function MtmWorkflowGuide({ title, description, steps, className, dismissId, viewerKey, dismissLabel }: MtmWorkflowGuideProps) {
  const storageKey = dismissId ? mtmHintStorageKey(dismissId, viewerKey) : ""
  // Rendered on the server too, where there is no storage: start visible and
  // hide after mount if the viewer has already dismissed it. The alternative —
  // hiding first — would flash the panel away for everyone on every load.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!storageKey) return
    if (isMtmHintDismissed(typeof window === "undefined" ? null : window.localStorage, storageKey)) setDismissed(true)
  }, [storageKey])

  if (dismissed) return null

  const gridColumns = steps.length <= 1
    ? "sm:grid-cols-1"
    : steps.length === 2
      ? "sm:grid-cols-2"
      : "sm:grid-cols-3"

  return (
    <section
      aria-label={title}
      className={`overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.035] shadow-sm ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-primary/10 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {storageKey && dismissLabel ? (
          <button
            type="button"
            data-testid="mtm-workflow-guide-dismiss"
            aria-label={dismissLabel}
            title={dismissLabel}
            className="-m-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              dismissMtmHint(typeof window === "undefined" ? null : window.localStorage, storageKey)
              setDismissed(true)
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ol className={`grid divide-y divide-primary/10 ${gridColumns} sm:divide-x sm:divide-y-0`}>
        {steps.map(({ title: stepTitle, description: stepDescription, icon: Icon, active, onClick }, index) => (
          <li key={`${index}-${stepTitle}`} className="flex min-h-[76px] items-start gap-3 px-4 py-3 sm:px-5">
            {onClick ? (
              <button
                type="button"
                onClick={onClick}
                aria-pressed={active}
                className={`-m-3 flex min-h-[76px] w-[calc(100%+1.5rem)] items-start gap-3 rounded-xl p-3 text-left transition-colors hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "bg-primary/[0.09]" : ""}`}
              >
                <GuideStepContent index={index} title={stepTitle} description={stepDescription} icon={Icon} />
              </button>
            ) : (
              <GuideStepContent index={index} title={stepTitle} description={stepDescription} icon={Icon} />
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function GuideStepContent({
  index,
  title,
  description,
  icon: Icon,
}: {
  index: number
  title: string
  description?: string
  icon: LucideIcon
}) {
  return (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {index + 1}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {title}
        </span>
        {description ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span> : null}
      </span>
    </>
  )
}
