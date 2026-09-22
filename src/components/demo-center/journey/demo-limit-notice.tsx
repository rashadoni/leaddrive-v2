"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * One shape for every wall the demo puts in front of a prospect.
 *
 * Owner, 2026-09-22: «везде, не только здесь, когда дошёл до лимита, чтоб
 * предупреждал, из-за чего не может продолжить». A limit that just stops
 * working reads as a broken demo, so each one says what the limit is, why it
 * exists, and what the prospect can still do. The live call
 * (`demo-live-call.tsx`) and the assistant (`assistant/policy.ts`) carry
 * their own copy of the same promise in their own panels.
 */
export function DemoLimitNotice({ body, className, title = S.limitTitle }: { body: string; className?: string; title?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900",
        "dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
        className,
      )}
    >
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">{title}. </span>
        {body}
      </span>
    </div>
  )
}
