"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

interface GrantData {
  users: { id: string; name: string }[]
  grants: { coordinatorUserId: string; hostUserId: string; canManage: boolean }[]
}

export function BookingCoordinatorsPanel() {
  const t = useTranslations("booking")
  const [data, setData] = useState<GrantData | null>(null)
  const [coordinator, setCoordinator] = useState("")
  const [hosts, setHosts] = useState<string[]>([])
  const [canManage, setCanManage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/bookings/coordinators", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error("load")
      if (!controller.signal.aborted) setData(body.data)
    }).catch(() => { if (!controller.signal.aborted) setError(t("errLoad")) })
    return () => controller.abort()
  }, [t])

  function choose(id: string) {
    setCoordinator(id); setSaved(false)
    const grants = data?.grants.filter((row) => row.coordinatorUserId === id) ?? []
    setHosts(grants.map((row) => row.hostUserId)); setCanManage(grants.length === 0 || grants.some((row) => row.canManage))
  }
  async function save() {
    if (!coordinator || !data) return
    setBusy(true); setError(""); setSaved(false)
    const response = await fetch("/api/v1/bookings/coordinators", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordinatorUserId: coordinator, hostIds: hosts, canManage }) }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t("errSave")); return }
    setData({ ...data, grants: [...data.grants.filter((row) => row.coordinatorUserId !== coordinator), ...hosts.map((hostUserId) => ({ coordinatorUserId: coordinator, hostUserId, canManage }))] })
    setSaved(true)
  }
  return <section className="max-w-2xl space-y-5">
    <header><h2 className="text-lg font-semibold">{t("coordinatorTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("coordinatorHint")}</p></header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!data ? <p role="status">{t("workspaceLoading")}</p> : <>
      <div className="space-y-2"><Label htmlFor="booking-coordinator">{t("coordinatorPerson")}</Label><select id="booking-coordinator" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" value={coordinator} disabled={busy} onChange={(event) => choose(event.target.value)}><option value="">{t("chooseEmployee")}</option>{data.users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></div>
      {coordinator ? <><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("coordinatorHosts")}</legend>{data.users.filter((user) => user.id !== coordinator).map((user) => <label key={user.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" disabled={busy} checked={hosts.includes(user.id)} onChange={(event) => { setHosts(event.target.checked ? [...hosts, user.id] : hosts.filter((id) => id !== user.id)); setSaved(false) }} />{user.name}</label>)}</fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={canManage} onChange={(event) => { setCanManage(event.target.checked); setSaved(false) }} />{t("coordinatorCanManage")}</label>
        <p className="text-xs text-muted-foreground">{t("coordinatorRevokeHint")}</p>
        <Button onClick={() => void save()} disabled={busy}>{busy ? t("saving") : t("save")}</Button>{saved ? <p role="status" className="text-sm">{t("saved")}</p> : null}
      </> : null}
    </>}
  </section>
}
