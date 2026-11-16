"use client"

/**
 * «Hand over all» (2026-11-16): every open conversation one person holds goes to another in one
 * press — the selection in the list carries fifty at a time, and a manager who left with hundreds
 * is not handed over in rounds. The dialog is the whole action: it says how many conversations
 * move and what stays, asks who takes them, and its button names the number once more. The server
 * (`POST /api/v1/inbox/assignees/transfer`) moves what it finds at that moment and answers with
 * the real count.
 *
 * There is no «to nobody» here: an open conversation without an owner is what the AI auto-reply
 * takes (lib/user-work-handover).
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowRightLeft, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"

interface Props {
  open: boolean
  /** Whose conversations — in the words the filter shows the person in. */
  fromLabel: string
  /** How many open conversations the person holds, as the filter counted them. */
  count: number
  /** Who can take them: the assign list without the person herself. */
  targets: ReadonlyArray<{ id: string; name: string | null }>
  busy: boolean
  /** Said in the dialog when the press did not go through — nothing was moved then. */
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (toUserId: string) => void
}

export function AssigneeTransferDialog(props: Props) {
  // Mounted only while open: every opening starts with nobody chosen.
  if (!props.open) return null
  return <AssigneeTransferDialogBody {...props} />
}

function AssigneeTransferDialogBody({ fromLabel, count, targets, busy, error, onOpenChange, onConfirm }: Props) {
  const t = useTranslations("inboxV2")
  const tc = useTranslations("common")
  const [toUserId, setToUserId] = useState("")

  return (
    // The app's Dialog is the panel itself; header, content and footer are its three sections.
    <Dialog open onOpenChange={(next) => { if (!busy && !next) onOpenChange(false) }} widthClassName="max-w-md">
      <DialogHeader>
        <DialogTitle>{t("assigneeTransferTitle")}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3" data-testid="inbox-assignee-transfer-dialog">
          <p className="text-sm">{t("assigneeTransferText", { name: fromLabel, count })}</p>
          <Select
            label={t("assigneeTransferTo")}
            value={toUserId}
            onChange={(event) => setToUserId(event.target.value)}
            disabled={busy}
            data-testid="inbox-assignee-transfer-to"
          >
            <option value="">{t("assigneeTransferChoose")}</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>{target.name || target.id}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{t("assigneeTransferNote")}</p>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
        <Button
          disabled={busy || !toUserId}
          onClick={() => onConfirm(toUserId)}
          className="min-h-11 gap-1.5"
          data-testid="inbox-assignee-transfer-confirm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowRightLeft className="h-4 w-4" />}
          {busy ? t("assigneeTransferBusy") : t("assigneeTransferConfirm", { count })}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
