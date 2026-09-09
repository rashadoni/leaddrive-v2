"use client"

/**
 * EntityBulkBar — shared bulk-selection action bar used across list pages.
 *
 * Owns the visual chrome (primary-tinted background, count badge, clear X)
 * so every entity's bulk bar reads consistently. Action buttons are passed
 * as children — each entity controls its own action set (delete, reassign,
 * change-stage, set-custom-field, etc.) including any popovers or
 * dropdowns specific to that entity. This gives us cross-entity visual
 * consistency without forcing one-size-fits-all action signatures.
 *
 * Hidden when `selectedCount === 0` — callers don't need to gate.
 *
 * Roadmap #19 — bulk actions consistency. Replaces ad-hoc inline bars in
 * tasks/contacts and serves as the foundation for adding bulk-actions to
 * deals/leads/companies.
 */

import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  /** Number of selected rows. The bar renders nothing when this is 0. */
  selectedCount: number
  /** Called when the user dismisses the bar via the X button on the right. */
  onClearSelection: () => void
  /**
   * Action controls rendered between the count badge and the clear button.
   * Typically a sequence of `<Button size="sm">` and/or popover triggers.
   * Each entity is responsible for the action-specific UI inside this slot.
   */
  children: React.ReactNode
  /**
   * Optional translated count label. Defaults to the `common.selected`
   * ICU pattern ("{count} selected") so callers can omit when no entity-
   * specific label is needed.
   */
  countLabel?: string
  /** Extra Tailwind classes merged into the outer wrapper (rare). */
  className?: string
}

export function EntityBulkBar({
  selectedCount,
  onClearSelection,
  children,
  countLabel,
  className,
}: Props) {
  // Shared component reads from the `common` namespace so it never leaks
  // entity-specific i18n keys. `selected` is an ICU pattern ("{count} selected").
  const tc = useTranslations("common")

  if (selectedCount === 0) return null

  const label = countLabel ?? tc("selected", { count: selectedCount })
  const clearLabel = tc("deselect")

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg",
        className,
      )}
      role="region"
      aria-label={label}
    >
      <span className="text-sm font-medium shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        {children}
      </div>
      <button
        type="button"
        onClick={onClearSelection}
        aria-label={clearLabel}
        title={clearLabel}
        className="ml-auto p-1 rounded hover:bg-muted transition-colors shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
