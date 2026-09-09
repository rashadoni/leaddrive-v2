"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Zap, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface SequenceOption {
  id: string
  name: string
  isActive: boolean
  steps: { id: string }[]
}

/**
 * Reusable "Add to sequence" picker. Works for a single lead/contact (from its
 * card) or a bulk selection (from a list). Lists active sequences that have at
 * least one step, enrolls via the single or bulk API, and reports the outcome.
 */
export function EnrollInSequenceDialog({
  open, onClose, entityType, entityIds, entityName, onDone,
}: {
  open: boolean
  onClose: () => void
  entityType: "lead" | "contact"
  entityIds: string[]
  entityName?: string
  onDone?: () => void
}) {
  const t = useTranslations("sequencesPage")
  const [sequences, setSequences] = useState<SequenceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open) return
    setMessage("")
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch("/api/v1/sequences?isActive=true")
        const data = await res.json()
        if (res.ok && data.success) {
          setSequences((data.data as SequenceOption[]).filter((s) => s.isActive && s.steps.length > 0))
        }
      } catch {
        // leave empty; the dialog shows the empty state
      } finally {
        setLoading(false)
      }
    })()
  }, [open])

  const enroll = async (seq: SequenceOption) => {
    setBusyId(seq.id)
    setMessage("")
    try {
      const bulk = entityIds.length > 1
      const res = await fetch(`/api/v1/sequences/${seq.id}/${bulk ? "enroll-bulk" : "enroll"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulk ? { entityType, entityIds } : { entityType, entityId: entityIds[0] }),
      })
      const body = await res.json().catch(() => ({}))
      if (bulk && res.ok) {
        const s = body.data as Record<string, number>
        const enrolled = (s.created ?? 0) + (s.reenrolled ?? 0)
        const blocked = s.blocked_other_sequence ?? 0
        setMessage(
          t("enrollDialog.bulkResult", { enrolled, already: s.already_enrolled ?? 0, notFound: s.not_found ?? 0 }) +
            (blocked > 0 ? " " + t("enroll.blockedOtherBulk", { count: blocked }) : ""),
        )
        onDone?.()
        return
      }
      // E6 — the person is already in another active sequence (single-active policy).
      if (res.status === 409 && body.blockedByOtherSequence) {
        setMessage(t("enroll.blockedOther", { name: entityName ?? "" }))
        return
      }
      if (res.status === 409) { setMessage(t("enroll.alreadyEnrolled", { name: entityName ?? "" })); return }
      if (!res.ok) { setMessage(body.error ?? t("enroll.failed")); return }
      setMessage(t("enroll.enrolled", { name: entityName ?? "" }))
      onDone?.()
    } catch {
      setMessage(t("enroll.failed"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {entityIds.length > 1
              ? t("enrollDialog.titleBulk", { count: entityIds.length })
              : t("enroll.title", { name: entityName ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("loading")}</p>
          ) : sequences.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("enrollDialog.noSequences")}</p>
          ) : (
            sequences.map((seq) => (
              <button
                key={seq.id}
                disabled={busyId === seq.id}
                onClick={() => enroll(seq)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left",
                  "border-zinc-200 dark:border-zinc-700 hover:border-primary hover:bg-muted/50 disabled:opacity-50"
                )}
              >
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-sm block truncate">{seq.name}</span>
                  <span className="text-xs text-muted-foreground">{t("card.stepCount", { count: seq.steps.length })}</span>
                </span>
                {busyId === seq.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("form.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
