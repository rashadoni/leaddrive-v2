"use client"

import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Checkbox — the one primitive this UI kit was missing.
 *
 * `contact-dictionary-assignment-panel.tsx` has imported `@/components/ui/checkbox`
 * since the governed-contact-master-data change, and the file never existed: the
 * production build died on `Module not found` and the deploy stayed on the old
 * version until this was added.
 *
 * Built on a native `<input type="checkbox">` rather than `@radix-ui/react-checkbox`,
 * which the sibling components use. The Radix package is not among the project's
 * dependencies, and pulling one in to render a checkbox is a poor trade against a
 * built-in control that is keyboard-accessible and screen-reader-correct on its own.
 *
 * The prop surface matches Radix on purpose — `checked` plus `onCheckedChange` —
 * so call sites written against the usual shadcn API work unchanged, and swapping
 * in the Radix version later needs no edits outside this file.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked"> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        className={cn(
          "peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-primary shadow",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "checked:bg-primary checked:border-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      {/* Sits above the input and ignores pointer events so the input keeps the click. */}
      <Check
        aria-hidden
        className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  ),
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
