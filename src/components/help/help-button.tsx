"use client"

/**
 * Compact "?" trigger that opens the HelpDrawer for a given slug.
 *
 * Drop it next to any page header — it consolidates state ownership of
 * the drawer so consumers don't each re-implement `useState(false)`.
 *
 * Variants:
 *   icon  → 32×32 round ghost button with just the ? glyph (default)
 *   label → outlined button with "Help" text (use in main toolbars)
 */
import { useState } from "react"
import { HelpCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HelpDrawer } from "./help-drawer"
import type { HelpSlug } from "@/content/help/registry"

interface HelpButtonProps {
  slug: HelpSlug
  variant?: "icon" | "label"
  className?: string
}

export function HelpButton({ slug, variant = "icon", className }: HelpButtonProps) {
  const [open, setOpen] = useState(false)
  // `nav.help` lives in messages/{en,ru,az}.json — keep the key generic
  // so the same button label works across every feature page. All three
  // locales carry the key; missing-key would be a build-time i18n bug,
  // not a runtime concern → no fallback wrapper needed.
  const t = useTranslations("nav")
  const label = t("help")

  const trigger =
    variant === "label" ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={`border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary ${className ?? ""}`}
      >
        <HelpCircle className="h-4 w-4 mr-1.5" />
        {label}
      </Button>
    ) : (
      // Brand-tinted "?" so help is noticeable next to a page title (was a
      // muted-grey ghost that blended into the header). Mirrors the primary
      // accent of the App Launcher button in the top header.
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={label}
        className={`h-8 w-8 rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/20 hover:text-primary transition-colors ${className ?? ""}`}
      >
        <HelpCircle className="h-4 w-4" />
      </Button>
    )

  return (
    <>
      {/* TooltipProvider is mounted globally in (dashboard)/layout.tsx — do
          NOT add a local one here. shadcn's Provider tracks a single
          delayDuration registry; nested instances would create flicker
          and double-mount the timer machinery. */}
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>

      <HelpDrawer slug={slug} open={open} onOpenChange={setOpen} />
    </>
  )
}
