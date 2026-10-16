"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Loader2, UserMinus, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { MtmAgentClientPicker, announceDoctorChanges, type AgentClientChoice } from "@/components/mtm/agent-client-picker"
import { changeAgentDoctors } from "@/lib/mtm/assign-agent-doctors"

/**
 * «Привязать ещё клиентов» on the agent's own page (owner, 2026-10-16, in front
 * of this page: «и где твои изменения?» — then «да, сюда тоже»): the same
 * specialty → city → district → ticks as the agent's card, and one button with
 * the counts. A tick taken off one of the agent's own doctors takes him off
 * the agent, asked once more with the count («нет возможности снимать
 * галочки»). What changed stays in sight: the list is asked again.
 */
export function MtmAgentAttachByPlace({ agentId, agentName, onAttached, onForbidden }: {
  agentId: string
  agentName: string
  onAttached: () => void
  onForbidden: () => void
}) {
  const t = useTranslations("mtmAgentSection")
  const tf = useTranslations("mtmForms")
  const [choice, setChoice] = useState<AgentClientChoice>({ contactIds: [], asOf: null })
  const [refresh, setRefresh] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const add = choice.contactIds.length
  const remove = choice.removeIds?.length ?? 0
  const changes = add + remove

  const apply = async () => {
    if (changes === 0 || saving) return
    setSaving(true)
    setError("")
    try {
      const done = await changeAgentDoctors(agentId, { add: choice.contactIds, remove: choice.removeIds ?? [] }, choice.asOf ?? new Date().toISOString().slice(0, 10), t("attachReason"))
      announceDoctorChanges(tf, done, remove > 0)
      onAttached()
    } catch {
      setError(t("attachFailed"))
    } finally {
      // Asked again either way: a failed batch may have followed a good one.
      setRefresh(value => value + 1)
      setSaving(false)
    }
  }

  const summary = [add > 0 ? t("attachChecked", { count: add }) : null, remove > 0 ? t("attachWillRemove", { count: remove }) : null].filter(Boolean).join(" · ")
  const label = remove === 0 ? t("attachChosen", { count: add }) : add === 0 ? t("attachRemove", { count: remove }) : t("attachChange", { add, remove })

  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700" data-testid="mtm-agent-attach-by-place">
      <MtmAgentClientPicker agentId={agentId} onChange={setChoice} refresh={refresh} onForbidden={onForbidden} />
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
        </p>
      ) : null}
      {/* Floats over the list while it is scrolled, like the other save bars:
          the page's own padding keeps a bar pinned flush at «bottom: 0» a few
          rows above the edge, with the list showing under it. */}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur" data-testid="mtm-agent-attach-bar">
        <span className="text-sm text-muted-foreground">{changes > 0 ? summary : choice.listed ? t("attachNoneTicked") : t("attachNothingYet")}</span>
        <Hint text={changes === 0 ? (choice.listed ? t("hint.attachNoneTicked") : t("hint.attachNothingChosen")) : remove > 0 ? t("hint.attachRemove") : t("hint.attachChosen")}>
          <span className="inline-flex" tabIndex={changes > 0 ? undefined : 0}>
            <Button
              type="button"
              className="min-h-11"
              variant={remove > 0 && add === 0 ? "destructive" : "default"}
              disabled={changes === 0 || saving}
              onClick={() => (remove > 0 ? setConfirmRemoval(true) : void apply())}
              data-testid="mtm-agent-attach-submit"
            >
              {saving
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                : remove > 0 && add === 0 ? <UserMinus className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {label}
            </Button>
          </span>
        </Hint>
      </div>
      <ConfirmDialog
        open={confirmRemoval}
        onOpenChange={setConfirmRemoval}
        onConfirm={async () => {
          setConfirmRemoval(false)
          await apply()
        }}
        title={tf("clientsRemoveConfirmTitle")}
        description={tf("clientsRemoveConfirmBody", { count: remove, name: agentName })}
        confirmLabel={tf("clientsRemoveConfirm", { count: remove })}
      />
    </div>
  )
}
