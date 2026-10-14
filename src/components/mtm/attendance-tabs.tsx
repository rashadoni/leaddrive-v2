import Link from "next/link"
import { cn } from "@/lib/utils"

export type AttendanceTab = { key: string; label: string }

/** One row of plain links: each former attendance page is a tab of its section. */
export function MtmAttendanceTabs({ base, tabs, active, label }: { base: string; tabs: readonly AttendanceTab[]; active: string; label: string }) {
  return <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-1" data-testid="attendance-tabs">
    {tabs.map(tab => {
      const selected = tab.key === active
      return <Link key={tab.key} href={`${base}?tab=${tab.key}`} scroll={false} prefetch={false} aria-current={selected ? "page" : undefined}
        data-testid={`attendance-tab-${tab.key}`}
        className={cn("-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{tab.label}</Link>
    })}
  </nav>
}

/** Resolves `?tab=` against the known keys; anything else opens the first tab. */
export function attendanceTab<T extends string>(value: string | string[] | undefined, keys: readonly T[]): T {
  const raw = Array.isArray(value) ? value[0] : value
  return keys.includes(raw as T) ? raw as T : keys[0]
}
