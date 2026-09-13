"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Loader2, RefreshCw, Search, ShieldCheck, ShieldOff, UserRoundCheck } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  WORKFORCE_ACCESS_ROLES,
  workforceRoleScopeKinds,
  type WorkforceAccessRole,
  type WorkforceAccessScope,
} from "@/lib/workforce/access-control"

type ScopeKind = WorkforceAccessScope["kind"]
type TargetKind = "PRINCIPAL" | Exclude<ScopeKind, "ORGANIZATION">

type Target = { id: string; label: string }

type ActiveGrant = {
  grantId: string
  role: WorkforceAccessRole
  scopeKind: ScopeKind
  effectiveFrom: string
  effectiveUntil: string | null
  principal: { name: string; email: string }
  scope: { name: string; code?: string | null; externalCode?: string | null } | null
}

type ApiFailure = Error & { code?: string }

const GRANTABLE_ROLES = WORKFORCE_ACCESS_ROLES.filter((role) => role !== "TENANT_ADMIN")
const INITIAL_ROLE: WorkforceAccessRole = "TEAM_MANAGER"
const REASON_CODES = ["ROLE_ASSIGNMENT", "TEMPORARY_COVER", "RESPONSIBILITY_CHANGE", "PILOT_OPERATION"] as const
const REVOCATION_REASON_CODES = ["ACCESS_REVIEW", "ROLE_CHANGE", "EMPLOYMENT_CHANGE", "SECURITY_RESPONSE"] as const

function localizedFailure(t: ReturnType<typeof useTranslations>, failure: unknown): string {
  const code = failure && typeof failure === "object" && "code" in failure
    ? String((failure as { code?: unknown }).code ?? "")
    : ""
  if (code === "WORKFORCE_GRANT_MANAGEMENT_BOOTSTRAP_REQUIRED") return t("bootstrapRequired")
  if (code === "WORKFORCE_GRANULAR_ACCESS_REQUIRED") return t("accessRequired")
  if (code === "WORKFORCE_ATTENDANCE_MFA_REQUIRED") return t("mfaRequired")
  if (code === "WORKFORCE_ACCESS_GRANT_INCOMPATIBLE_ROLE") return t("incompatibleRole")
  if (code === "WORKFORCE_ACCESS_GRANT_SELF_GRANT_DENIED") return t("selfGrantDenied")
  return t("requestFailed")
}

/**
 * Accountable browser surface for the C7 immutable role ledger. It deliberately
 * omits TENANT_ADMIN bootstrap/removal, raw evidence, operation identifiers and
 * reason history. Grant and revocation are explicit two-step actions; the
 * server remains authoritative for scope, incompatibility, MFA and tenant RLS.
 */
export function WorkforceAccessManagement() {
  const { data: session } = useSession()
  const t = useTranslations("workforceAccessManagement")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const [grants, setGrants] = useState<ActiveGrant[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [principalQuery, setPrincipalQuery] = useState("")
  const [principalResults, setPrincipalResults] = useState<Target[]>([])
  const [principal, setPrincipal] = useState<Target | null>(null)
  const [role, setRole] = useState<WorkforceAccessRole>(INITIAL_ROLE)
  const [scopeKind, setScopeKind] = useState<ScopeKind>(workforceRoleScopeKinds(INITIAL_ROLE)[0])
  const [scopeQuery, setScopeQuery] = useState("")
  const [scopeResults, setScopeResults] = useState<Target[]>([])
  const [scopeTarget, setScopeTarget] = useState<Target | null>(null)
  const [searching, setSearching] = useState<TargetKind | null>(null)
  const [effectiveUntil, setEffectiveUntil] = useState("")
  const [grantReasonCode, setGrantReasonCode] = useState<(typeof REASON_CODES)[number]>(REASON_CODES[0])
  const [confirmed, setConfirmed] = useState(false)
  const [pendingRevocation, setPendingRevocation] = useState<string | null>(null)
  const [revocationReasonCode, setRevocationReasonCode] = useState<(typeof REVOCATION_REASON_CODES)[number]>(REVOCATION_REASON_CODES[0])

  const allowedScopeKinds = useMemo(() => workforceRoleScopeKinds(role), [role])
  const dateTime = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }), [])

  const request = useCallback(async (path: string, method: "GET" | "POST" | "DELETE", body?: unknown) => {
    if (!organizationId) throw new Error("organization-unavailable")
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-organization-id": organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await response.json().catch(() => ({})) as {
      success?: boolean
      code?: string
      data?: unknown
    }
    if (!response.ok || !result.success) {
      const failure = new Error("workforce-access-request-failed") as ApiFailure
      failure.code = result.code
      throw failure
    }
    return result.data
  }, [organizationId])

  const load = useCallback(async () => {
    if (!organizationId) return
    setLoading(true)
    try {
      const data = await request("/api/v1/workforce/configuration/access/grants", "GET")
      setGrants(data as ActiveGrant[])
      setLoadError(null)
    } catch (failure) {
      setGrants(null)
      setLoadError(localizedFailure(t, failure))
    } finally {
      setLoading(false)
    }
  }, [organizationId, request, t])

  useEffect(() => {
    void load()
  }, [load])

  function changeRole(nextRole: WorkforceAccessRole) {
    const nextKind = workforceRoleScopeKinds(nextRole)[0]
    setRole(nextRole)
    setScopeKind(nextKind)
    setScopeQuery("")
    setScopeResults([])
    setScopeTarget(null)
    setConfirmed(false)
  }

  function changeScopeKind(nextKind: ScopeKind) {
    setScopeKind(nextKind)
    setScopeQuery("")
    setScopeResults([])
    setScopeTarget(null)
    setConfirmed(false)
  }

  async function searchTargets(kind: TargetKind, query: string) {
    if (query.trim().length < 2) {
      toast.error(t("searchMinimum"))
      return
    }
    setSearching(kind)
    try {
      const data = await request(
        "/api/v1/workforce/configuration/access/grant-targets?kind="
          + encodeURIComponent(kind) + "&q=" + encodeURIComponent(query.trim()),
        "GET",
      ) as { items: Target[]; hasMore: boolean }
      if (kind === "PRINCIPAL") setPrincipalResults(data.items)
      else setScopeResults(data.items)
      if (data.items.length === 0) toast.info(t("noSearchResults"))
      if (data.hasMore) toast.info(t("searchNarrower"))
    } catch (failure) {
      toast.error(localizedFailure(t, failure))
    } finally {
      setSearching(null)
    }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!principal || (scopeKind !== "ORGANIZATION" && !scopeTarget) || !confirmed) {
      toast.error(t("completeReview"))
      return
    }
    const scope = scopeKind === "ORGANIZATION"
      ? { kind: "ORGANIZATION" as const }
      : scopeKind === "TEAM"
        ? { kind: "TEAM" as const, teamId: scopeTarget!.id }
        : scopeKind === "SITE"
          ? { kind: "SITE" as const, siteId: scopeTarget!.id }
          : { kind: "AGENT" as const, agentId: scopeTarget!.id }
    setSaving(true)
    try {
      await request("/api/v1/workforce/configuration/access/grants", "POST", {
        operationId: crypto.randomUUID(),
        principalUserId: principal.id,
        role,
        scope,
        effectiveUntil: effectiveUntil ? new Date(effectiveUntil).toISOString() : null,
        grantReasonCode,
      })
      toast.success(t("grantRecorded"))
      setPrincipal(null)
      setPrincipalQuery("")
      setPrincipalResults([])
      setScopeTarget(null)
      setScopeQuery("")
      setScopeResults([])
      setEffectiveUntil("")
      setConfirmed(false)
      await load()
    } catch (failure) {
      toast.error(localizedFailure(t, failure))
    } finally {
      setSaving(false)
    }
  }

  async function revoke(grantId: string) {
    setSaving(true)
    try {
      await request(
        "/api/v1/workforce/configuration/access/grants/" + encodeURIComponent(grantId),
        "DELETE",
        { operationId: crypto.randomUUID(), revocationReasonCode },
      )
      toast.success(t("grantRevoked"))
      setPendingRevocation(null)
      await load()
    } catch (failure) {
      toast.error(localizedFailure(t, failure))
    } finally {
      setSaving(false)
    }
  }

  if (!organizationId) return null

  return <section className="overflow-hidden rounded-xl border border-zinc-200 bg-background dark:border-zinc-800" aria-labelledby="workforce-access-title">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800 sm:px-6">
      <div className="flex max-w-3xl gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
        <div className="space-y-1">
          <h2 id="workforce-access-title" className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()} disabled={loading || saving}>
        {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}{t("refresh")}
      </Button>
    </div>

    {loadError ? <div className="flex gap-3 bg-zinc-50 px-5 py-4 text-sm leading-6 text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 sm:px-6"><ShieldOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><p>{loadError}</p></div> : null}

    {grants ? <div className="grid gap-8 px-5 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
      <form className="space-y-6" onSubmit={grant}>
        <div className="space-y-1">
          <h3 className="font-semibold">{t("newGrantTitle")}</h3>
          <p className="text-sm leading-6 text-muted-foreground">{t("newGrantHint")}</p>
        </div>

        <div className="space-y-3">
          <label htmlFor="workforce-access-principal-search" className="text-sm font-medium">{t("principal")}</label>
          {principal ? <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><span className="flex items-center gap-2 text-sm"><UserRoundCheck className="h-4 w-4 text-orange-600" aria-hidden="true" />{principal.label}</span><Button type="button" variant="ghost" size="sm" onClick={() => { setPrincipal(null); setConfirmed(false) }}>{t("change")}</Button></div> : <><div className="flex gap-2"><Input id="workforce-access-principal-search" value={principalQuery} onChange={(event) => setPrincipalQuery(event.target.value)} placeholder={t("principalSearchPlaceholder")} /><Button type="button" variant="outline" className="min-h-11" onClick={() => void searchTargets("PRINCIPAL", principalQuery)} disabled={searching !== null}>{searching === "PRINCIPAL" ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Search />}{t("search")}</Button></div>{principalResults.length > 0 ? <div className="grid gap-2" role="list" aria-label={t("principalResults")}>{principalResults.map((item) => <Button key={item.id} type="button" variant="outline" className="min-h-11 justify-start whitespace-normal text-left" onClick={() => { setPrincipal(item); setPrincipalResults([]); setConfirmed(false) }}>{item.label}</Button>)}</div> : null}</>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="workforce-access-role" label={t("role")} value={role} onChange={(event) => changeRole(event.target.value as WorkforceAccessRole)}>{GRANTABLE_ROLES.map((item) => <option key={item} value={item}>{t(`roles.${item}`)}</option>)}</Select>
          <Select id="workforce-access-scope-kind" label={t("scopeKind")} value={scopeKind} onChange={(event) => changeScopeKind(event.target.value as ScopeKind)}>{allowedScopeKinds.map((item) => <option key={item} value={item}>{t(`scopes.${item}`)}</option>)}</Select>
        </div>

        {scopeKind !== "ORGANIZATION" ? <div className="space-y-3">
          <label htmlFor="workforce-access-scope-search" className="text-sm font-medium">{t("scopeTarget")}</label>
          {scopeTarget ? <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><span className="text-sm">{scopeTarget.label}</span><Button type="button" variant="ghost" size="sm" onClick={() => { setScopeTarget(null); setConfirmed(false) }}>{t("change")}</Button></div> : <><div className="flex gap-2"><Input id="workforce-access-scope-search" value={scopeQuery} onChange={(event) => setScopeQuery(event.target.value)} placeholder={t("scopeSearchPlaceholder")} /><Button type="button" variant="outline" className="min-h-11" onClick={() => void searchTargets(scopeKind, scopeQuery)} disabled={searching !== null}>{searching === scopeKind ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Search />}{t("search")}</Button></div>{scopeResults.length > 0 ? <div className="grid gap-2" role="list" aria-label={t("scopeResults")}>{scopeResults.map((item) => <Button key={item.id} type="button" variant="outline" className="min-h-11 justify-start whitespace-normal text-left" onClick={() => { setScopeTarget(item); setScopeResults([]); setConfirmed(false) }}>{item.label}</Button>)}</div> : null}</>}
        </div> : <p className="text-sm leading-6 text-muted-foreground">{t("organizationScopeHint")}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><label htmlFor="workforce-access-effective-until" className="text-sm font-medium">{t("effectiveUntil")}</label><Input id="workforce-access-effective-until" type="datetime-local" value={effectiveUntil} onChange={(event) => { setEffectiveUntil(event.target.value); setConfirmed(false) }} /><p className="text-xs leading-5 text-muted-foreground">{t("effectiveUntilHint")}</p></div>
          <Select id="workforce-access-reason" label={t("reason")} value={grantReasonCode} onChange={(event) => { setGrantReasonCode(event.target.value as (typeof REASON_CODES)[number]); setConfirmed(false) }}>{REASON_CODES.map((item) => <option key={item} value={item}>{t(`grantReasons.${item}`)}</option>)}</Select>
        </div>

        <label className="flex min-h-11 items-start gap-3 rounded-lg bg-zinc-50 px-3 py-3 text-sm leading-6 dark:bg-zinc-900/60"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t("confirmGrant")}</span></label>
        <Button type="submit" className="min-h-11" disabled={saving || !confirmed || !principal || (scopeKind !== "ORGANIZATION" && !scopeTarget)}>{saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck />}{t("recordGrant")}</Button>
      </form>

      <div className="space-y-4">
        <div className="space-y-1"><h3 className="font-semibold">{t("activeTitle")}</h3><p className="text-sm leading-6 text-muted-foreground">{t("activeHint", { count: grants.length })}</p></div>
        {grants.length === 0 ? <p className="rounded-lg bg-zinc-50 px-4 py-5 text-sm leading-6 text-muted-foreground dark:bg-zinc-900/60">{t("empty")}</p> : <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{grants.map((grantItem) => <li key={grantItem.grantId} className="space-y-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><p className="font-medium">{grantItem.principal.name}</p><p className="text-sm text-muted-foreground">{grantItem.principal.email}</p></div><Badge variant="outline">{t(`roles.${grantItem.role}`)}</Badge></div>
          <p className="text-sm leading-6"><span className="text-muted-foreground">{t(`scopes.${grantItem.scopeKind}`)}:</span> {grantItem.scope?.name ?? t("wholeOrganization")}</p>
          <p className="text-xs leading-5 text-muted-foreground">{t("grantWindow", { start: dateTime.format(new Date(grantItem.effectiveFrom)), end: grantItem.effectiveUntil ? dateTime.format(new Date(grantItem.effectiveUntil)) : t("noExpiry") })}</p>
          {pendingRevocation === grantItem.grantId ? <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/60"><Select id={`workforce-access-revoke-reason-${grantItem.grantId}`} label={t("revocationReason")} value={revocationReasonCode} onChange={(event) => setRevocationReasonCode(event.target.value as (typeof REVOCATION_REASON_CODES)[number])}>{REVOCATION_REASON_CODES.map((item) => <option key={item} value={item}>{t(`revocationReasons.${item}`)}</option>)}</Select><p className="text-sm leading-6 text-muted-foreground">{t("confirmRevocation")}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" className="min-h-11" disabled={saving} onClick={() => void revoke(grantItem.grantId)}>{saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ShieldOff />}{t("confirmRevoke")}</Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => setPendingRevocation(null)} disabled={saving}>{t("cancel")}</Button></div></div> : <Button type="button" variant="outline" className="min-h-11" onClick={() => setPendingRevocation(grantItem.grantId)} disabled={saving}><ShieldOff />{t("revoke")}</Button>}
        </li>)}</ul>}
      </div>
    </div> : null}
  </section>
}
