"use client"

/**
 * Bulk-close dialog (Whelp-style): close N conversations with a disposition
 * (won / lost / none) plus an OPTIONAL farewell message. Empty message = just
 * close; non-empty = the text is sent to every selected conversation through
 * its normal channel path before closing (per-channel send failures are
 * reported but never block the close — the operator's intent is closure).
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { type CloseOutcome } from "@/lib/inbox/close-outcome"

type DialogOutcome = CloseOutcome | "pending"

interface Props {
  open: boolean
  selectedCount: number
  busy: boolean
  allowNoResult?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (message: string, outcome: DialogOutcome, followUpAt?: string) => void
}

export function BulkCloseDialog(props: Props) {
  // Mount only while open so each open starts from fresh defaults — no reset
  // effect needed (and no stale farewell/outcome carried between batches).
  if (!props.open) return null
  return <BulkCloseDialogBody {...props} />
}

function BulkCloseDialogBody({ selectedCount, busy, allowNoResult, onOpenChange, onConfirm }: Props) {
  const t = useTranslations("inboxV2")
  const tc = useTranslations("common")
  const [message, setMessage] = useState("")
  const [outcome, setOutcome] = useState<DialogOutcome>("pending")
  const [followUpAt, setFollowUpAt] = useState("")
  const outcomes: DialogOutcome[] = ["won", "lost", "pending", ...(allowNoResult ? ["none" as const] : [])]

  return (
    // The app's Dialog is the panel itself (its width is `widthClassName`); header, content and
    // footer are the panel's three sections, side by side. Until 2026-11-16 the header and the
    // footer were nested inside a `DialogContent` with a width of its own: a narrow card stood in
    // a wide panel with an empty column on the right, the title and the buttons on white slabs.
    <Dialog open onOpenChange={(next) => { if (!busy && !next) onOpenChange(false) }} widthClassName="max-w-md">
      <DialogHeader>
        <DialogTitle>{outcome === "pending"
          ? t("bulkPendingTitle", { count: selectedCount })
          : t("bulkCloseTitle", { count: selectedCount })}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3" data-testid="inbox-bulk-close-dialog">
          <div className="space-y-1.5">
            <span className="text-xs font-medium">{t("closeOutcomeLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {outcomes.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  aria-pressed={outcome === option}
                  onClick={() => setOutcome(option)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    outcome === option
                      ? option === "won"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : option === "lost"
                          ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          : "border-zinc-400 bg-muted"
                      : "border-border text-muted-foreground hover:border-zinc-300"
                  }`}
                >
                  {t(`closeOutcome.${option}`)}
                </button>
              ))}
            </div>
          </div>
          {outcome === "pending" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="pending-follow-up">{t("pendingFollowUpLabel")}</label>
              <input
                id="pending-follow-up"
                type="datetime-local"
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                disabled={busy}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">{t("pendingFollowUpHint")}</p>
            </div>
          )}
          {outcome !== "pending" && <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="bulk-close-message">{t("bulkCloseOptionalMessage")}</label>
            {/* The hint is said once, under the field, where it stays while the person types. It used
                to be the field's placeholder as well: the same two sentences twice, one above the other. */}
            <Textarea
              id="bulk-close-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={4000}
              aria-describedby="bulk-close-message-hint"
              disabled={busy}
            />
            <p id="bulk-close-message-hint" className="text-[11px] text-muted-foreground">{t("bulkCloseHint")}</p>
          </div>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
        <Button disabled={busy} onClick={() => onConfirm(message.trim(), outcome, followUpAt || undefined)} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {outcome === "pending" ? t("moveToPending") : t("bulkClose")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
