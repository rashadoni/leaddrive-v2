"use client"

import { Button } from "@/components/ui/button"

/** The status filter above a purchasing list — the shared selected / outline buttons of the CRM. */
export function StatusTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: readonly { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          type="button"
          size="sm"
          role="tab"
          aria-selected={value === tab.id}
          variant={value === tab.id ? "selected" : "outline"}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}
