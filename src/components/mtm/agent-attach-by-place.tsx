"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertCircle, Loader2, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { MtmAgentClientPicker, type AgentClientChoice } from "@/components/mtm/agent-client-picker"
import { assignDoctorsToAgent } from "@/lib/mtm/assign-agent-doctors"

/**
 * «Привязать ещё клиентов» on the agent's own page (owner, 2026-10-16, in front
 * of this page: «и где твои изменения?» — then «да, сюда тоже»): the same
 * specialty → city → district → ticks as the agent's card, and one button with
 * the count that assigns what is ticked. The doctors just assigned stay in
 * sight, greyed as «уже у агента», so the result is on the screen.
 */
export function MtmAgentAttachByPlace({ agentId, onAttached, onForbidden }: {
  agentId: string
  onAttached: () => void
  onForbidden: () => void
}) {
  const t = useTranslations("mtmAgentSection")
  const tf = useTranslations("mtmForms")
  const [choice, setChoice] = useState<AgentClientChoice>({ contactIds: [], asOf: null })
  const [refresh, setRefresh] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const count = choice.contactIds.length

  const attach = async () => {
    if (count === 0 || saving) return
    setSaving(true)
    setError("")
    try {
      const done = await assignDoctorsToAgent(agentId, choice.contactIds, choice.asOf ?? new Date().toISOString().slice(0, 10), t("attachReason"))
      if (done.left > 0) toast.warning(tf("clientsPartlyAssigned", { changed: done.changed, left: done.left }))
      else toast.success(tf("clientsAssigned", { count: done.changed }))
      onAttached()
    } catch {
      setError(t("attachFailed"))
    } finally {
      // Asked again either way: a failed batch may have followed a good one.
      setRefresh(value => value + 1)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700" data-testid="mtm-agent-attach-by-place">
      <MtmAgentClientPicker agentId={agentId} onChange={setChoice} refresh={refresh} onForbidden={onForbidden} />
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
        </p>
      ) : null}
      {/* Stays at the bottom of the screen while the list is scrolled. */}
      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 px-4 py-3 backdrop-blur" data-testid="mtm-agent-attach-bar">
        <span className="text-sm text-muted-foreground">{count > 0 ? t("attachChecked", { count }) : t("attachNothingYet")}</span>
        <Hint text={count > 0 ? t("hint.attachChosen") : t("hint.attachNothingChosen")}>
          <span className="inline-flex" tabIndex={count > 0 ? undefined : 0}>
            <Button type="button" className="min-h-11" disabled={count === 0 || saving} onClick={() => void attach()} data-testid="mtm-agent-attach-submit">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {t("attachChosen", { count })}
            </Button>
          </span>
        </Hint>
      </div>
    </div>
  )
}
