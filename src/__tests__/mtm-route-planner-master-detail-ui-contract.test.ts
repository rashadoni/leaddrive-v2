import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM route planner master-detail UI contract", () => {
  const builder = source("src/components/mtm/route-builder.tsx")
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const dialog = source("src/components/ui/dialog.tsx")

  it("keeps the existing candidate workspace and adds a desktop/tablet selected-stop detail pane", () => {
    expect(builder).toContain('data-testid="mtm-route-selected-stops-detail"')
    expect(builder).toContain('md:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]')
    expect(builder).toContain('className="order-2 hidden min-w-0 md:sticky md:top-0 md:block')
    expect(builder).toContain('aria-labelledby="mtm-route-selected-stops-heading"')
    expect(builder).toContain('<ol className="divide-y divide-zinc-200 dark:divide-zinc-700">')
    expect(builder).toContain('role="status" aria-live="polite"')
    expect(builder).toContain('onClick={() => removeStop(index)}')
    expect(builder).toContain('className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2"')
  })

  it("keeps keyboard focus in the review flow and uses the full phone surface through the tablet breakpoint", () => {
    expect(builder).toContain('ref={reviewHeadingRef} tabIndex={-1}')
    expect(builder).toContain('reviewHeadingRef.current?.focus({ preventScroll: true })')
    expect(routesPage).toContain('mobileFullscreenBreakpoint="md"')
    expect(routesPage).toContain('maxHeightClassName="max-h-dvh md:max-h-[min(52rem,calc(100dvh-2rem))]"')
    expect(dialog).toContain('mobileFullscreenBreakpoint?: "sm" | "md"')
    expect(dialog).toContain('"items-stretch p-0 md:items-center md:p-4"')
    expect(dialog).toContain('"rounded-none md:rounded-lg"')
  })
})
