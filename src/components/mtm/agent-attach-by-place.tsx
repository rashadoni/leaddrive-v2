"use client"

import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Loader2, UserMinus, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { MtmAgentClientPicker, announceDoctorChanges, type AgentClientChoice } from "@/components/mtm/agent-client-picker"
import { MtmAgentPanelHead } from "@/components/mtm/agent-panel-head"
import { changeAgentDoctors } from "@/lib/mtm/assign-agent-doctors"

/**
 * «Привязать ещё клиентов» on the agent's own page (owner, 2026-10-16, in front
 * of this page: «и где твои изменения?» — then «да, сюда тоже»): the same
 * specialty → city → district → ticks as the agent's card, and one button with
 * the counts. A tick taken off one of the agent's own doctors takes him off
 * the agent, asked once more with the count («нет возможности снимать
 * галочки»). What changed stays in sight: the list is asked again.
 */
export function MtmAgentAttachByPlace({ agentId, agentName, onAttached, onForbidden, switcher }: {
  agentId: string
  agentName: string
  /** «By specialty / whole list», in the corner of the card. */
  switcher?: ReactNode
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

  const label = remove === 0 ? t("attachChosen", { count: add }) : add === 0 ? t("attachRemove", { count: remove }) : t("attachChange", { add, remove })

  // In the line with the counts above the list, not a bar floating over it
  // (owner, 2026-11-11: «полоска внизу… глаза режет, которая спускается с экраном»).
  const actions = (
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
  )

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5" data-testid="mtm-agent-attach-panel">
      <MtmAgentPanelHead title={t("attachPanelTitle")} body={t("attachPanelBody", { name: agentName })} switcher={switcher} />
      {/* Nobody ticked until somebody ticks; his own doctors are shown as his — taking off lives on his own tab. */}
      <MtmAgentClientPicker agentId={agentId} startUnticked lockOwn onChange={setChoice} refresh={refresh} onForbidden={onForbidden} actions={actions} />
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
        </p>
      ) : null}
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
