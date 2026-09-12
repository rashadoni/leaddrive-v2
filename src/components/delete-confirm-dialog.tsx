"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Loader2, AlertTriangle, AlertCircle } from "lucide-react"
import { useTranslations } from "next-intl"

// Renamed 2026-05-28: was `DeleteConfirmDialog`. The component has 3+
// non-delete consumers (Stop series, MTM Deactivate Category, MTM
// Deactivate Type) and the historic name lies about intent at those
// callsites. `ConfirmDialog` is the canonical name going forward;
// `DeleteConfirmDialog` (and its prop type) remain as backward-compat
// aliases below so the ~56 destructive callsites don't have to migrate.
interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  title?: string
  description?: string
  itemName?: string
  confirmLabel?: string
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  loadingLabel?: string
  /**
   * Override the header icon. By default we auto-derive: a red AlertTriangle
   * for destructive variant, a muted AlertCircle for everything else
   * (Stop series, Deactivate, etc.) — so non-delete consumers don't
   * paint themselves red just by using this dialog.
   */
  icon?: ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  itemName,
  confirmLabel,
  confirmVariant = "destructive",
  loadingLabel,
  icon,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const t = useTranslations("common")

  async function handleConfirm() {
    setLoading(true)
    setError("")
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errorDeleteFailed"))
    } finally {
      setLoading(false)
    }
  }

  // Auto-derive icon + label fallbacks (2026-05-28). The component is
  // historically named DeleteConfirmDialog but is reused for soft actions
  // (Stop series, Deactivate). Hard-coding the red AlertTriangle and the
  // "Deleting..." loading copy in those callsites makes the dialog look
  // like a permanent delete. Branch on `confirmVariant` so the default
  // "destructive" path stays unchanged, while non-destructive callsites
  // get a muted AlertCircle + "Saving..." fallback automatically.
  const isDestructive = confirmVariant === "destructive"
  const defaultIcon = isDestructive ? (
    <AlertTriangle className="h-5 w-5 text-destructive" />
  ) : (
    <AlertCircle className="h-5 w-5 text-muted-foreground" />
  )
  const fallbackLoadingLabel = isDestructive ? t("deleting") : t("saving")
  const fallbackConfirmLabel = isDestructive ? t("delete") : t("save")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {icon || defaultIcon}
          {title || t("deleteConfirmTitle")}
        </DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {description || (
              itemName
                ? <>{t("deleteConfirmDesc", { name: itemName })}</>
                : <>{t("deleteConfirmDescGeneric")}</>
            )}
          </p>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={loading}>{t("cancel")}</Button>
        <Button variant={confirmVariant} className="min-h-11" onClick={handleConfirm} disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />{loadingLabel || fallbackLoadingLabel}</> : (confirmLabel || fallbackConfirmLabel)}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

// Backward-compat aliases — DO NOT use in new code.
// 56 existing destructive callsites still import `DeleteConfirmDialog` /
// `DeleteConfirmDialogProps`; this re-export lets them keep working
// without a mass rename. New non-delete consumers should import
// `ConfirmDialog` / `ConfirmDialogProps` above for semantic accuracy.
/** @deprecated Use `ConfirmDialog`. Alias kept for migration; will be removed once destructive callsites migrate. */
export { ConfirmDialog as DeleteConfirmDialog }
/** @deprecated Use `ConfirmDialogProps`. Alias kept for migration; will be removed once destructive callsites migrate. */
export type { ConfirmDialogProps as DeleteConfirmDialogProps }
