import Link from "next/link"
import { Hint } from "@/components/hint"
import { mtmChipClass } from "@/components/mtm/calm-classes"
import { cn } from "@/lib/utils"

export type AttendanceTab = { key: string; label: string; hint: string }

/**
 * The views of one Personnel page («Əməkdaşlar · Filiallar · Telefonlar»).
 * The section's own tabs stand above every Personnel page as the one menu
 * (attendance-section-tabs.tsx), so these are drawn as chips, not a second
 * underlined row — on «Əməkdaşlar» the same word was lit in both rows. The
 * chosen chip is outlined dark and marked the current item of this set
 * (`aria-current="true"`): the current page is the section tab's to say.
 */
export function MtmAttendanceTabs({ base, tabs, active, label }: { base: string; tabs: readonly AttendanceTab[]; active: string; label: string }) {
  return <nav aria-label={label} className="flex flex-wrap gap-2" data-testid="attendance-tabs">
    {tabs.map(tab => {
      const selected = tab.key === active
      return <Hint key={tab.key} text={tab.hint}>
        <Link href={`${base}?tab=${tab.key}`} scroll={false} prefetch={false} aria-current={selected ? "true" : undefined}
          data-testid={`attendance-tab-${tab.key}`}
          className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border border-border px-4 text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            mtmChipClass(selected))}>{tab.label}</Link>
      </Hint>
    })}
  </nav>
}

/** Resolves `?tab=` against the known keys; anything else opens the first tab. */
export function attendanceTab<T extends string>(value: string | string[] | undefined, keys: readonly T[]): T {
  const raw = Array.isArray(value) ? value[0] : value
  return keys.includes(raw as T) ? raw as T : keys[0]
}
