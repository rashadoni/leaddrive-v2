"use client"

import { HelpCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

/*
 * The product's «Kömək» (`HelpButton`, src/components/help/help-button.tsx)
 * as it looks beside a page's heading, without its drawer: in the demo a
 * press explains itself instead (`onClick`). Its classes are the product's,
 * letter for letter (mtm-calm-colours.test.ts compares them) — the one soft
 * orange the owner's calm MTM colours kept, being the CRM's help button and
 * not MTM's (2026-10-18).
 */
const LABEL = "border-orange-200 bg-orange-50/60 text-orange-800 hover:bg-orange-100 hover:text-orange-900 dark:border-orange-900/60 dark:bg-orange-950/20 dark:text-orange-300 dark:hover:bg-orange-950/40"
const ICON = "h-8 w-8 rounded-full bg-orange-50 text-orange-800 ring-1 ring-orange-200 hover:bg-orange-100 hover:text-orange-900 transition-colors dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/60 dark:hover:bg-orange-950/50"

export const DEMO_HELP_BUTTON_CLASSES = { label: LABEL, icon: ICON } as const

export function DemoHelpButton({ variant = "icon", className, onClick }: { variant?: "icon" | "label"; className?: string; onClick: () => void }) {
  const t = useTranslations("nav")
  const label = t("help")
  return variant === "label" ? (
    <Button variant="outline" size="sm" onClick={onClick} className={`${LABEL} ${className ?? ""}`}>
      <HelpCircle className="h-4 w-4 mr-1.5" />
      {label}
    </Button>
  ) : (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label={label} className={`${ICON} ${className ?? ""}`}>
      <HelpCircle className="h-4 w-4" />
    </Button>
  )
}
