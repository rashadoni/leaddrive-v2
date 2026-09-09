"use client"

import { Loader2 } from "lucide-react"

interface LoyaltyFormActionsProps {
  busy?: boolean
  cancelLabel: string
  submitLabel: string
  submitDisabled?: boolean
  helperText?: string
  onCancel: () => void
  onSubmit: () => void
}

export function LoyaltyFormActions({
  busy = false,
  cancelLabel,
  submitLabel,
  submitDisabled = false,
  helperText,
  onCancel,
  onSubmit,
}: LoyaltyFormActionsProps) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-col gap-3 border-y border-zinc-200 bg-background/95 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700 dark:shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
      {helperText ? (
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">{helperText}</p>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="flex shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || submitDisabled}
          className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          aria-busy={busy}
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
