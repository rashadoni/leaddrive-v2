"use client"

import Link from "next/link"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, GitCompareArrows, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type { WorkforcePolicyVersionComparison } from "@/lib/workforce/policy-version-comparison"

type Choice = {
  id: string; name: string; version: number; status: "DRAFT" | "ACTIVE" | "RETIRED"
  teamId: string | null; team: { name: string } | null
}
type Search = { policies: Choice[]; query: string; limit: number; hasMore: boolean }
const fields = ["expectedWorkSeconds", "lateGraceSeconds", "undertimeToleranceSeconds", "overtimeThresholdSeconds", "longPauseThresholdSeconds"] as const
function validSearch(value: Search, query: string): boolean {
  return Boolean(value && value.query === query && value.limit === 20 && typeof value.hasMore === "boolean"
    && Array.isArray(value.policies) && value.policies.length <= 20
    && new Set(value.policies.map(row => row.id)).size === value.policies.length
    && value.policies.every(row => row && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 191
      && typeof row.name === "string" && row.name.trim().length > 0 && row.name.length <= 160
      && Number.isSafeInteger(row.version) && row.version > 0 && ["DRAFT", "ACTIVE", "RETIRED"].includes(row.status)
      && (row.teamId === null || typeof row.teamId === "string")
      && (row.team === null || (typeof row.team?.name === "string" && row.team.name.trim().length > 0))))
}
function validComparison(value: WorkforcePolicyVersionComparison, from: Choice, to: Choice): boolean {
  const seconds = (n: unknown) => n === null || (typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
  return Boolean(value && value.basis === "RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL"
    && value.from?.id === from.id && value.to?.id === to.id && value.scope?.teamId === from.teamId
    && typeof value.opaqueDefinitionChanged === "boolean" && Array.isArray(value.fields) && value.fields.length === fields.length
    && fields.every(field => value.fields.filter(row => row.field === field).length === 1)
    && value.fields.every(row => seconds(row.before) && seconds(row.after) && row.changed === (row.before !== row.after)
      && row.deltaSeconds === (row.before === null || row.after === null ? null : row.after - row.before)))
}

export function WorkforcePolicyVersionComparisonPage() {
  const { data: session, status } = useSession()
  const userId = session?.user?.id ?? "", organizationId = String(session?.user?.organizationId ?? "")
  return <ComparisonForSession key={JSON.stringify([status, userId, organizationId])} status={status} userId={userId} organizationId={organizationId} />
}

function ComparisonForSession({ status, userId, organizationId }: {
  status: "loading" | "authenticated" | "unauthenticated"; userId: string; organizationId: string
}) {
  const t = useTranslations("workforcePolicyVersionComparison"), locale = useLocale()
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<Search | null>(null)
  const [from, setFrom] = useState<Choice | null>(null), [to, setTo] = useState<Choice | null>(null)
  const [comparison, setComparison] = useState<WorkforcePolicyVersionComparison | null>(null)
  const [searching, setSearching] = useState(false), [comparing, setComparing] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null), [comparisonError, setComparisonError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const alive = useRef(false), requests = useRef({ search: 0, compare: 0 })
  const controllers = useRef<{ search: AbortController | null; compare: AbortController | null }>({ search: null, compare: null })
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controllers.current.search?.abort(); controllers.current.compare?.abort() }
  }, [])
  function deny() {
    controllers.current.search?.abort(); controllers.current.compare?.abort()
    requests.current.search++; requests.current.compare++
    setDenied(true); setSearch(null); setFrom(null); setTo(null); setComparison(null)
    setSearching(false); setComparing(false); setSearchError(null); setComparisonError(null)
  }
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = query.trim()
    if (q.length < 2 || q.length > 100 || /[\u0000-\u001f]/u.test(q)) { setSearchError(t("queryHint")); return }
    controllers.current.search?.abort()
    const controller = new AbortController(), request = ++requests.current.search
    controllers.current.search = controller; setSearching(true); setSearch(null); setSearchError(null)
    const current = () => alive.current && !controller.signal.aborted && requests.current.search === request
    try {
      const response = await fetch("/api/v1/workforce/configuration/policies/search?" + new URLSearchParams({ q }), { credentials: "same-origin", signal: controller.signal })
      const body = await response.json().catch(() => ({}))
      if (!current()) return
      if (response.status === 403) { deny(); return }
      if (!response.ok || !body.success || !validSearch(body.data, q)) throw new Error("POLICY_SEARCH_FAILED")
      setSearch(body.data)
    } catch { if (current()) setSearchError(t("searchFailed")) }
    finally { if (current()) setSearching(false) }
  }
  const choices = Array.from(new Map([...(search?.policies ?? []), ...(from ? [from] : []), ...(to ? [to] : [])].map(row => [row.id, row])).values())
  function choose(side: "from" | "to", id: string) {
    controllers.current.compare?.abort(); requests.current.compare++
    setComparison(null); setComparisonError(null); setComparing(false)
    const choice = choices.find(row => row.id === id) ?? null
    if (side === "from") setFrom(choice); else setTo(choice)
  }
  const pairValid = Boolean(from && to && from.id !== to.id && from.version !== to.version && from.teamId === to.teamId)
  async function compare() {
    if (!from || !to || !pairValid) return
    controllers.current.compare?.abort()
    const controller = new AbortController(), request = ++requests.current.compare
    controllers.current.compare = controller; setComparison(null); setComparisonError(null); setComparing(true)
    const current = () => alive.current && !controller.signal.aborted && requests.current.compare === request
    try {
      const response = await fetch("/api/v1/workforce/configuration/policies/compare?" + new URLSearchParams({ from: from.id, to: to.id }), { credentials: "same-origin", signal: controller.signal })
      const body = await response.json().catch(() => ({}))
      if (!current()) return
      if (response.status === 403) { deny(); return }
      if (!response.ok || !body.success || !validComparison(body.data?.comparison, from, to)) throw new Error("POLICY_COMPARISON_FAILED")
      setComparison(body.data.comparison)
    } catch { if (current()) setComparisonError(t("compareFailed")) }
    finally { if (current()) setComparing(false) }
  }
  const label = (choice: Choice) => `${choice.name} · ${t("version", { value: number.format(choice.version) })} · ${choice.teamId === null ? t("organizationScope") : choice.team?.name ?? t("teamUnavailable")} · ${t("statuses." + choice.status)}`
  const ready = status === "authenticated" && Boolean(userId) && Boolean(organizationId)
  return <section className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t("subtitle")}</p></div><Button asChild variant="outline" className="min-h-11"><Link href="/workforce/configuration"><ArrowLeft aria-hidden="true" />{t("back")}</Link></Button></div>
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">{t("boundary")}</p>
    {!ready || denied ? <p role="status" className="rounded-lg border p-4 text-sm">{t(denied ? "denied" : status === "loading" ? "sessionLoading" : "signIn")}</p> : <>
      <form onSubmit={find} className="space-y-3"><label htmlFor="workforce-policy-version-query" className="block text-sm font-medium">{t("searchLabel")}</label><div className="flex flex-col gap-3 sm:flex-row"><Input id="workforce-policy-version-query" value={query} onChange={event => setQuery(event.target.value)} minLength={2} maxLength={100} required aria-describedby="workforce-policy-version-query-hint" className="min-h-11 sm:max-w-xl" /><Button type="submit" disabled={searching} className="min-h-11">{searching ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}{t(searching ? "searching" : "search")}</Button></div><p id="workforce-policy-version-query-hint" className="text-sm text-muted-foreground">{t("queryHint")}</p></form>
      {searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}
      {search ? <div role="status" className="text-sm text-muted-foreground"><p>{t(search.policies.length ? "searchResults" : "empty", { query: search.query, count: number.format(search.policies.length) })}</p>{search.hasMore ? <p className="mt-1">{t("refine")}</p> : null}</div> : null}
      <div className="grid gap-4 sm:grid-cols-2">{(["from", "to"] as const).map(side => <Select key={side} id={"workforce-policy-version-" + side} label={t(side)} value={(side === "from" ? from : to)?.id ?? ""} onChange={event => choose(side, event.target.value)} className="min-h-11"><option value="">{t("choose")}</option>{choices.map(choice => <option key={choice.id} value={choice.id}>{label(choice)}</option>)}</Select>)}</div>
      <p className="text-sm text-muted-foreground">{t("pairHint")}</p>
      <Button type="button" onClick={() => void compare()} disabled={!pairValid || comparing} className="min-h-11">{comparing ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <GitCompareArrows aria-hidden="true" />}{t(comparing ? "comparing" : "compare")}</Button>
      {comparisonError ? <p role="alert" className="text-sm text-destructive">{comparisonError}</p> : null}
      {comparison ? <WorkforcePolicyComparisonTable comparison={comparison} /> : null}
    </>}
  </section>
}

export function WorkforcePolicyComparisonTable({ comparison }: { comparison: WorkforcePolicyVersionComparison }) {
  const t = useTranslations("workforcePolicyVersionComparison"), locale = useLocale()
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const seconds = (value: number | null) => value === null ? t("notSet") : t("seconds", { value: number.format(value) })
  return <section aria-labelledby="workforce-policy-version-result" className="space-y-3 rounded-lg border p-4">
    <h2 id="workforce-policy-version-result" className="font-semibold">{t("result")}</h2>
    <p className="text-sm text-muted-foreground">{t("direction", { from: comparison.from.name, fromVersion: number.format(comparison.from.version), to: comparison.to.name, toVersion: number.format(comparison.to.version) })}</p>
    <div role="region" aria-label={t("tableLabel")} tabIndex={0} className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full min-w-[600px] text-left text-sm"><caption className="sr-only">{t("tableLabel")}</caption><thead className="border-b bg-muted/40"><tr>{["field", "before", "after", "delta"].map(key => <th key={key} scope="col" className="px-3 py-3 font-medium">{t(key)}</th>)}</tr></thead><tbody className="divide-y">{comparison.fields.map(row => <tr key={row.field}><th scope="row" className="px-3 py-3 font-medium">{t("fields." + row.field)}</th><td className="px-3 py-3 tabular-nums">{seconds(row.before)}</td><td className="px-3 py-3 tabular-nums">{seconds(row.after)}</td><td className="px-3 py-3 tabular-nums">{row.deltaSeconds === null ? t("notComparable") : seconds(row.deltaSeconds)}</td></tr>)}</tbody></table>
    </div>
    <p className="text-sm text-muted-foreground">{t("integrityHint")}</p>
    {comparison.opaqueDefinitionChanged ? <p role="status" className="rounded-md bg-amber-500/10 p-3 text-sm">{t("opaqueChanged")}</p> : null}
  </section>
}
