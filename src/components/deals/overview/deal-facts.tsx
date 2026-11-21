"use client"

/** Plain facts of a deal as two even columns of «label — value»; a fact with no value says so in words. */
import type { ReactNode } from "react"

export interface DealFact { label: string; value: ReactNode | null | undefined; wide?: boolean }

export function DealFacts({ facts, empty, footer }: { facts: DealFact[]; empty: string; footer?: ReactNode }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-8 md:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className={`flex justify-between gap-4 border-b border-border py-2.5 text-sm ${fact.wide ? "md:col-span-2" : ""}`}>
            <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
            <dd className={`min-w-0 text-right font-medium ${fact.wide ? "whitespace-pre-wrap" : "truncate"} ${fact.value ? "" : "font-normal text-muted-foreground"}`}>{fact.value || empty}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="flex flex-wrap gap-2">{footer}</div>}
    </div>
  )
}
