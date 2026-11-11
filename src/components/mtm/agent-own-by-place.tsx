"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, ArrowRightLeft, Loader2, UserMinus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { Select } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MtmAgentClientPicker, announceDoctorChanges, type AgentClientChoice } from "@/components/mtm/agent-client-picker"
import { MtmAgentPanelHead } from "@/components/mtm/agent-panel-head"
import { changeAgentDoctors, moveAgentDoctors } from "@/lib/mtm/assign-agent-doctors"

type OtherAgent = { id: string; name: string }

/**
 * «Əməkdaşın müştəriləri» by specialty and place (owner, 2026-11-11: «не только
 * поимённо убирать клиентов от агента, но и по специальностям… город, район,
 * или каких конкретных»; the picture approved with «Давай»). The same steps as
 * «Əlavə müştəri təyin et», over the agent's own doctors only, all ticked; the
 * ticked ones are taken off him or handed to another, both asked once more.
 * The buttons stand in the line with the counts: no bar floats over the list
 * («полоска внизу… глаза режет»). Batches of 500, so 229 at once is one press.
 */
export function MtmAgentOwnByPlace({ agentId, agentName, onChanged, onForbidden, switcher }: {
  agentId: string
  agentName: string
  /** «By specialty / whole list», in the corner of the card. */
  switcher?: ReactNode
  onChanged: () => void
  onForbidden: () => void
}) {
  const t = useTranslations("mtmAgentSection")
  const tf = useTranslations("mtmForms")
  const [choice, setChoice] = useState<AgentClientChoice>({ contactIds: [], asOf: null })
  const [refresh, setRefresh] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [moving, setMoving] = useState(false)
  const ticked = choice.contactIds.length
  const asOf = () => choice.asOf ?? new Date().toISOString().slice(0, 10)

  const run = async (work: () => Promise<void>) => {
    if (ticked === 0 || saving) return
    setSaving(true)
    setError("")
    try {
      await work()
      onChanged()
    } catch {
      setError(t("attachFailed"))
    } finally {
      // Asked again either way: a failed batch may have followed a good one.
      setRefresh(value => value + 1)
      setSaving(false)
    }
  }
  const remove = () => run(async () => {
    const done = await changeAgentDoctors(agentId, { add: [], remove: choice.contactIds }, asOf(), t("ownRemoveReason"))
    announceDoctorChanges(tf, done, true)
  })
  const move = (target: OtherAgent) => run(async () => {
    const done = await moveAgentDoctors(agentId, target.id, choice.contactIds, asOf(), t("ownMoveReason", { from: agentName, to: target.name }))
    if (done.left > 0) toast.warning(t("ownMovedPartly", { moved: done.moved, left: done.left, name: target.name }))
    else toast.success(t("ownMoved", { count: done.moved, name: target.name }))
  })

  const actions = (
    <>
      <Hint text={ticked === 0 ? t("hint.ownNoneTicked") : t("hint.ownMove")}>
        <span className="inline-flex" tabIndex={ticked > 0 ? undefined : 0}>
          <Button type="button" variant="outline" className="min-h-11" disabled={ticked === 0 || saving} onClick={() => setMoving(true)} data-testid="mtm-agent-own-move">
            <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("ownMove", { count: ticked })}
          </Button>
        </span>
      </Hint>
      <Hint text={ticked === 0 ? t("hint.ownNoneTicked") : t("hint.ownRemove")}>
        <span className="inline-flex" tabIndex={ticked > 0 ? undefined : 0}>
          <Button type="button" variant="destructive" className="min-h-11" disabled={ticked === 0 || saving} onClick={() => setConfirmRemoval(true)} data-testid="mtm-agent-own-remove">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserMinus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {t("ownRemove", { count: ticked })}
          </Button>
        </span>
      </Hint>
    </>
  )

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5" data-testid="mtm-agent-own-panel">
      <MtmAgentPanelHead title={t("ownPanelTitle")} body={t("ownPanelBody", { name: agentName })} switcher={switcher} />
      <MtmAgentClientPicker agentId={agentId} own onChange={setChoice} refresh={refresh} onForbidden={onForbidden} actions={actions} />
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
          await remove()
        }}
        title={tf("clientsRemoveConfirmTitle")}
        description={tf("clientsRemoveConfirmBody", { count: ticked, name: agentName })}
        confirmLabel={tf("clientsRemoveConfirm", { count: ticked })}
      />
      {moving ? (
        <MoveDialog
          agentId={agentId}
          agentName={agentName}
          count={ticked}
          onCancel={() => setMoving(false)}
          onMove={(target) => {
            setMoving(false)
            void move(target)
          }}
        />
      ) : null}
    </div>
  )
}

function MoveDialog({ agentId, agentName, count, onCancel, onMove }: {
  agentId: string
  agentName: string
  count: number
  onCancel: () => void
  onMove: (target: OtherAgent) => void
}) {
  const t = useTranslations("mtmAgentSection")
  const [agents, setAgents] = useState<OtherAgent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [targetId, setTargetId] = useState("")

  useEffect(() => {
    let alive = true
    fetch("/api/v1/mtm/agents?limit=500", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        const rows: unknown = body?.data?.agents
        if (!response.ok || !Array.isArray(rows)) throw new Error("agents")
        // Whoever may hold clients: a field card at work, not this one.
        const others = rows
          .filter((row) => row && typeof row.id === "string" && row.id !== agentId && row.status === "ACTIVE" && (row.role === "AGENT" || row.role === "MANAGER"))
          .map((row) => ({ id: row.id as string, name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "—" }))
          .sort((left, right) => left.name.localeCompare(right.name))
        if (alive) setAgents(others)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [agentId])

  const target = agents?.find((agent) => agent.id === targetId) ?? null
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }} widthClassName="max-w-[30rem]">
      <DialogHeader>
        <DialogTitle>{t("ownMoveTitle")}</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3" >
        <p className="text-sm">{t("ownMoveBody", { count, name: agentName })}</p>
        <label className="block text-xs font-semibold" htmlFor="mtm-agent-own-move-target">{t("ownMoveTarget")}</label>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">{t("ownMoveAgentsFailed")}</p>
        ) : (
          <Select id="mtm-agent-own-move-target" value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!agents} data-testid="mtm-agent-own-move-target">
            <option value="">{agents ? t("ownMoveChoose") : t("ownMoveLoading")}</option>
            {(agents ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </Select>
        )}
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{t("ownMoveCancel")}</Button>
        <Button type="button" disabled={!target} onClick={() => { if (target) onMove(target) }} data-testid="mtm-agent-own-move-confirm">
          {t("ownMoveConfirm", { count })}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
