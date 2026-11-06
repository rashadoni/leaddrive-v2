"use client"

import { useTranslations } from "next-intl"

/**
 * Grey page placeholder shown while a CRM page is not ready yet: the session
 * is still hydrating (dashboard shell) or the next route's code and data are
 * on their way (`src/app/(dashboard)/loading.tsx`). A layout-shaped shell —
 * title, toolbar, a table of rows — reads as "the page is coming", where a
 * lone spinner in an empty pane reads as "something is stuck".
 *
 * Purely visual: no data, no fetch. Respects reduced motion.
 */
export function PageSkeleton() {
  const t = useTranslations("common")
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="w-full" data-testid="page-skeleton">
      <span className="sr-only">{t("loading")}</span>
      <div className="animate-pulse space-y-6 motion-reduce:animate-none" aria-hidden="true">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 w-48 rounded-md bg-muted" />
            <div className="h-4 w-72 max-w-[60vw] rounded bg-muted/70" />
          </div>
          <div className="hidden h-9 w-32 rounded-md bg-muted sm:block" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/60" />
          ))}
        </div>
        <div className="flex gap-3">
          <div className="h-9 flex-1 rounded-md bg-muted/70 sm:max-w-sm" />
          <div className="h-9 w-24 rounded-md bg-muted/70" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="h-10 bg-muted/70" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-4 border-t border-border/40 px-4 py-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
              <div className="h-4 flex-1 rounded bg-muted/80" />
              <div className="hidden h-4 w-24 rounded bg-muted/60 sm:block" />
              <div className="hidden h-4 w-16 rounded bg-muted/60 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
