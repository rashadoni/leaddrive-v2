"use client"

import { AlertTriangle, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface LoyaltyConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function LoyaltyConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onOpenChange,
  onConfirm,
}: LoyaltyConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={busy ? () => undefined : onOpenChange} widthClassName="max-w-md">
      <DialogHeader className="pr-10">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 dark:border-zinc-700"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {confirmLabel}
        </button>
      </DialogFooter>
    </Dialog>
  )
}
