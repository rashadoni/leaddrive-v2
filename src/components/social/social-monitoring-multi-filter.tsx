"use client"

import { useId, type ComponentType } from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type SocialMonitoringMultiFilterOption = {
  value: string
  label: string
  count?: number
  dotClassName?: string
}

type SocialMonitoringMultiFilterProps = {
  label: string
  allLabel: string
  selectedCountLabel: (count: number) => string
  clearLabel: string
  values: string[]
  options: SocialMonitoringMultiFilterOption[]
  onChange: (values: string[]) => void
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  className?: string
}

export function SocialMonitoringMultiFilter({
  label,
  allLabel,
  selectedCountLabel,
  clearLabel,
  values,
  options,
  onChange,
  icon: Icon,
  className,
}: SocialMonitoringMultiFilterProps) {
  const labelId = useId()
  const selected = new Set(values)
  const selectedOptions = options.filter(option => selected.has(option.value))
  const summary = selectedOptions.length === 0
    ? allLabel
    : selectedOptions.length <= 2
      ? selectedOptions.map(option => option.label).join(" + ")
      : selectedCountLabel(selectedOptions.length)

  const toggle = (value: string) => {
    onChange(
      selected.has(value)
        ? values.filter(item => item !== value)
        : [...values, value],
    )
  }

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label id={labelId} className="text-sm font-medium">
        {label}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-labelledby={labelId}
            className={cn(
              "h-11 w-full min-w-0 justify-start gap-2 bg-background px-3 text-left font-normal",
              selectedOptions.length > 0 && "border-primary/35 bg-primary/[0.035] text-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground",
                selectedOptions.length > 0 && "text-primary",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm">{summary}</span>
            {selectedOptions.length > 0 && (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">
                {selectedOptions.length}
              </span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] space-y-2 p-2"
          aria-labelledby={labelId}
        >
          <div className="flex min-h-9 items-center justify-between gap-3 px-1">
            <p className="text-xs font-semibold text-foreground">{label}</p>
            {selectedOptions.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {clearLabel}
              </button>
            )}
          </div>
          <div className="grid gap-1" role="group" aria-labelledby={labelId}>
            {options.map(option => {
              const active = selected.has(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/[0.08] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 bg-background dark:border-zinc-600",
                    )}
                    aria-hidden="true"
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                  </span>
                  {option.dotClassName && (
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", option.dotClassName)} aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {typeof option.count === "number" && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
