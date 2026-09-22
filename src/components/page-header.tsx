import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  /** Contents of the <h1>: the title plus its inline buttons (TourReplayButton, HelpButton). */
  title: ReactNode
  /** Typography of the <h1>; the layout classes are added here. */
  titleClassName?: string
  /** data-tour-id of the <h1>, for tours that point at the title. */
  titleTourId?: string
  /** What sits under the title: subtitle, PageDescription. */
  description?: ReactNode
  /** The page's buttons, on the right of the title. */
  actions?: ReactNode
}

/**
 * Title row of a page: the title on the left, the page's buttons on the right.
 *
 * It wraps instead of overflowing. The dashboard's <main> hides horizontal
 * overflow, so a row that cannot wrap does not scroll — its last buttons are
 * simply cut off. On a 390 px phone the content is 302 px wide (64 px icon
 * rail, 12 px padding each side), and in az most list pages lost their
 * «Yeni …» button that way. Here the buttons move under the title, and below
 * `lg` the title's own «Turu təkrarla» / «Kömək» move under the title text.
 *
 * Wherever the old `flex items-center justify-between` row fitted on a
 * desktop, this one draws the same pixels (checked at 1280 and 1440 px on
 * every page that uses it): the title column takes the room the buttons leave
 * (`grow`), there is no horizontal gap (the old row had none), from `lg` up
 * the title squeezes the way it used to (`lg:flex-nowrap`, `lg:min-w-min`),
 * and the buttons drop under the title only when the two cannot share the
 * line. `basis-64` is the room the title claims before the buttons may sit
 * beside it — on a phone they never do. With plain `flex-wrap gap-3`, a long
 * description on a 1280 px screen already pushed «Yeni makro» under the title.
 */
export function PageHeader({
  title,
  titleClassName = "text-2xl font-bold tracking-tight",
  titleTourId,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-y-3">
      <div className="min-w-0 grow basis-64 lg:min-w-min">
        <h1 data-tour-id={titleTourId} className={cn(titleClassName, "flex flex-wrap items-center gap-2 lg:flex-nowrap")}>
          {title}
        </h1>
        {description}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
