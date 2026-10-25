"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import type { AttendanceHrUser } from "@/lib/mtm/attendance-hr-access"

const ENDPOINT = "/api/v1/mtm/attendance/access"
const ROLE_MESSAGES: Record<string, string> = { manager: "hrRoleManager", sales: "hrRoleSales", support: "hrRoleSupport", ticketing: "hrRoleTicketing", viewer: "hrRoleViewer" }
type Props = { canManage: boolean; onAccessLost: () => void; accessUnavailable?: boolean
  /** Settings opens the editor itself; elsewhere it waits behind its button. */
  alwaysOpen?: boolean }

/** Separate per-user attendance permission; the API rechecks administrator access. */
export function MtmAttendanceHrAccess({ canManage, onAccessLost, accessUnavailable = false, alwaysOpen = false }: Props) {
  const t = useTranslations("mtmAttendance")
  const [open, setOpen] = useState(alwaysOpen)
  const [users, setUsers] = useState<AttendanceHrUser[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, setPending] = useState<AttendanceHrUser | null>(null)
  const [mustReload, setMustReload] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const interrupted = useRef(false)
  const appliedSearch = useRef("")
  const accessLost = useRef(onAccessLost)
  accessLost.current = onAccessLost

  const clearPrivate = useCallback(() => {
    setUsers([]); setSearch(""); setHasMore(false); setPending(null); setSaved(null); setSaveError(null)
    appliedSearch.current = ""
  }, [])
  const load = useCallback(async (query: string, acknowledgeInterrupted = false) => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    appliedSearch.current = query
    setLoading(true); setUsers([]); setHasMore(false); setPending(null); setLoadError(null); setSaveError(null); setSaved(null)
    if (interrupted.current) setSaving(false)
    try {
      const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ search: query })}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.users)) {
        const denied = [401, 403, 404].includes(response.status)
        setLoadError(t(denied ? "hrAccessUnavailable" : "hrLoadError"))
        if (denied) { clearPrivate(); accessLost.current() }
        return
      }
      setUsers(body.data.users as AttendanceHrUser[])
      setHasMore(body.data.hasMore === true)
      const unresolved = interrupted.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("hrUnconfirmed"))
      else interrupted.current = false
    } catch {
      if (!controller.signal.aborted) setLoadError(t("hrLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t, clearPrivate])

  useEffect(() => {
    if (open && canManage && !accessUnavailable) void load(appliedSearch.current)
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) { interrupted.current = true; writeRequest.current.abort(); writeRequest.current = null }
    }
  }, [open, canManage, accessUnavailable, load])
  useEffect(() => {
    if (canManage && !accessUnavailable) return
    clearPrivate(); setLoading(false); setSaving(false); setOpen(false)
  }, [canManage, accessUnavailable, clearPrivate])

  async function save(user: AttendanceHrUser) {
    if (!canManage || accessUnavailable || saving || loading || writeRequest.current || mustReload || pending?.id !== user.id || (!user.allEmployees && !user.canGrant)) return
    const controller = new AbortController()
    writeRequest.current = controller
    setSaving(true); setSaveError(null); setSaved(null)
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ allEmployees: !user.allEmployees, version: user.version }), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || body.data?.id !== user.id) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setLoadError(t("hrAccessUnavailable")); accessLost.current() }
        else {
          interrupted.current = true
          setMustReload(true)
          const keys: Record<string, string> = { MTM_ATTENDANCE_HR_CHANGED: "hrChanged", MTM_ATTENDANCE_HR_UNAVAILABLE: "hrGrantChanged", MTM_ATTENDANCE_HR_ADMIN_AUTOMATIC: "hrAdminChanged" }
          setSaveError(t(keys[body?.code] ?? "hrUnconfirmed"))
        }
        return
      }
      const updated = body.data as AttendanceHrUser
      setUsers(previous => previous.map(item => item.id === updated.id ? updated : item))
      setPending(null)
      setSaved(t(updated.allEmployees ? "hrGranted" : "hrRevoked", { name: updated.name }))
    } catch {
      if (!controller.signal.aborted) { interrupted.current = true; setMustReload(true); setSaveError(t("hrUnconfirmed")) }
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!saving && !mustReload) void load(search.trim())
  }
  if (!canManage || accessUnavailable) return null
  const disabled = saving || loading || mustReload || Boolean(loadError)

  return <section data-testid="attendance-hr-access" className="space-y-3">
    {alwaysOpen ? null : <Button type="button" variant="outline" className="min-h-11" disabled={saving} aria-expanded={open} aria-controls="attendance-hr-access-panel" onClick={() => setOpen(previous => !previous)}>
      <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />{t(open ? "hrClose" : "hrOpen")}
    </Button>}
    {open ? <div id="attendance-hr-access-panel"><HomeCard testId="attendance-hr-access-card" titleId="attendance-hr-access-title" title={t("hrTitle")} tone="orange" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
      <div className="space-y-5 py-4">
        <div className="max-w-prose space-y-2"><p className="text-sm font-medium">{t("hrPermission")}</p><p className="text-sm text-muted-foreground">{t("hrIntro")}</p><p className="text-xs text-muted-foreground">{t("hrAdmins")}</p></div>
        <form aria-label={t("hrSearchForm")} onSubmit={submitSearch} className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-64 space-y-2"><label htmlFor="attendance-hr-search" className="text-sm font-medium">{t("hrSearchLabel")}</label>
          <Input id="attendance-hr-search" type="search" className="min-h-11" value={search} maxLength={100} disabled={saving || mustReload} onChange={event => setSearch(event.target.value)} /></div>
          <Button type="submit" className="min-h-11" disabled={saving || mustReload}>{t("hrSearch")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving || loading} onClick={() => void load(appliedSearch.current, true)}>{t("hrReload")}</Button></form>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("hrLoading")}</p> : null}
        {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
        {saveError ? <p role="alert" className="max-w-prose text-sm text-destructive">{saveError}</p> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{saved}</p> : null}
        {!loading && !loadError ? <>
          {hasMore ? <p className="max-w-prose text-sm text-muted-foreground">{t("hrMoreResults")}</p> : null}
          {users.length ? <ul aria-label={t("hrUsers")} className="divide-y divide-border">{users.map(user => <li key={user.id} className="space-y-3 py-4" data-testid="attendance-hr-user">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-2"><h3 className="break-words text-sm font-semibold">{user.name || t("hrUnnamed")}</h3>
              <p className="text-xs text-muted-foreground">{t(ROLE_MESSAGES[user.role] ?? "hrRoleUser")} · {t(user.isActive ? "hrActive" : "hrInactive")}</p>
              <HomePill tone={user.allEmployees ? "blue" : "zinc"}>{t(user.allEmployees ? "hrAllEmployees" : "hrNormalScope")}</HomePill>
              {!user.canGrant ? <p className="max-w-prose text-xs text-muted-foreground">{t(user.isActive ? "hrGrantUnavailable" : "hrInactiveHint")}</p> : null}</div>
              <Button type="button" variant="outline" className="min-h-11" disabled={disabled || (!user.allEmployees && !user.canGrant)} aria-label={t(user.allEmployees ? "hrRevokeNamed" : "hrGrantNamed", { name: user.name || t("hrUnnamed") })}
                onClick={() => { setPending(user); setSaved(null); setSaveError(null) }}>{t(user.allEmployees ? "hrRevoke" : "hrGrant")}</Button></div>
            {pending?.id === user.id ? <div className="space-y-3 rounded-xl bg-muted/50 px-4 py-3"><p className="max-w-prose text-sm">{t(user.allEmployees ? "hrConfirmRevokeHint" : "hrConfirmGrantHint", { name: user.name || t("hrUnnamed") })}</p>
              <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={disabled} onClick={() => void save(user)}>{t(saving ? "hrSaving" : user.allEmployees ? "hrConfirmRevoke" : "hrConfirmGrant")}</Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setPending(null)}>{t("hrCancel")}</Button></div></div> : null}
          </li>)}</ul> : <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t("hrEmpty")}</p>}
          <p className="max-w-prose text-xs text-muted-foreground">{t("hrAuditHint")}</p>
        </> : null}
      </div>
    </HomeCard></div> : null}
  </section>
}
