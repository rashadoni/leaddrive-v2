"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { validWorkforcePolicyEmployeeImpactReceipt, type WorkforcePolicyImpactSource } from "@/lib/workforce/policy-employee-impact-receipt"
import type { WorkforcePolicyEmployeeImpactPreview } from "@/lib/workforce/policy-employee-impact-preview"

/** Parent selection and actual session identity remount this on-demand aggregate read. */
export function WorkforcePolicyEmployeeImpactSection({ source, blocked, onDenied }: {
  source: WorkforcePolicyImpactSource | null; blocked: boolean; onDenied: (reason: "session" | "permission") => void
}) {
  const t = useTranslations("workforcePolicyEmployeeImpact"), comparison = useTranslations("workforcePolicyVersionComparison"), locale = useLocale()
  const [preview, setPreview] = useState<WorkforcePolicyEmployeeImpactPreview | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null)
  const alive = useRef(false), latest = useRef(0), controller = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort() }
  }, [])
  async function load() {
    if (!source || blocked) return
    controller.current?.abort()
    const pending = new AbortController(), request = ++latest.current
    controller.current = pending; setPreview(null); setLoading(true); setError(null)
    const current = () => alive.current && !pending.signal.aborted && latest.current === request
    const timeout = setTimeout(() => pending.abort(), 30000)
    try {
      const response = await fetch(`/api/v1/workforce/configuration/policies/${encodeURIComponent(source.id)}/employee-impact`,
        { credentials: "same-origin", signal: pending.signal })
      const body = await response.json().catch(() => ({}))
      if (!current()) return
      if (response.status === 401 || response.status === 403) { onDenied(response.status === 401 ? "session" : "permission"); return }
      if (!response.ok || body.success !== true || !validWorkforcePolicyEmployeeImpactReceipt(body.data?.preview, source)) {
        setError(t(response.status === 409 && body.code === "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED" ? "limit" : "failed")); return
      }
      setPreview(body.data.preview)
    } catch { if (alive.current && latest.current === request) setError(t("failed")) }
    finally {
      clearTimeout(timeout)
      if (alive.current && latest.current === request) setLoading(false)
    }
  }
  const number = new Intl.NumberFormat(locale), seconds = (v: number | null) => v === null ? comparison("notSet") : comparison("seconds", { value: number.format(v) })
  return <section aria-labelledby="workforce-policy-employee-impact-title" aria-busy={loading} className="space-y-4 break-words rounded-lg border p-4">
    <div><h2 id="workforce-policy-employee-impact-title" className="font-semibold">{t("title")}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("hint")}</p></div>
    <Button type="button" onClick={() => void load()} disabled={!source || blocked || loading} className="min-h-11">
      {loading ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}{t(loading ? "loading" : "preview")}
    </Button>
    {!source ? <p className="text-sm text-muted-foreground">{t("chooseDraft")}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {preview ? <div role="status" className="space-y-4 text-sm leading-6">
      <p className="font-medium">{t("selected", { name: preview.draft.name, version: number.format(preview.draft.version), date: preview.draft.effectiveFrom })}</p>
      <p className="text-muted-foreground">{t("observed", { timezone: preview.timezone,
        time: new Intl.DateTimeFormat(locale, { timeZone: preview.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.observedAt)) })}</p>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">{t("boundary")}</p>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{Object.entries(preview.counts).map(([key, value]) => <div key={key}>
        <dt className="text-muted-foreground">{t("counts." + key)}</dt><dd className="font-medium tabular-nums">{number.format(value)}</dd>
      </div>)}</dl>
      <p className="text-muted-foreground">{t("membership")}</p>
      <details><summary className="min-h-11 cursor-pointer font-medium">{t("groups", { count: number.format(preview.groups.length) })}</summary>
        <div className="mt-3 space-y-5">{preview.groups.map(group => <section key={group.before?.id ?? "uncovered"} className="space-y-2">
          <h3 className="font-medium">{group.before ? t("beforePolicy", { name: group.before.name, version: number.format(group.before.version), count: number.format(group.count) }) : t("newCoverage", { count: number.format(group.count) })}</h3>
          <div role="region" aria-label={t("tableLabel")} tabIndex={0} className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full min-w-[600px] text-left text-sm"><caption className="sr-only">{t("tableLabel")}</caption>
              <thead className="border-b bg-muted/40"><tr>{["field", "before", "after", "delta"].map(key => <th key={key} scope="col" className="px-3 py-3 font-medium">{comparison(key)}</th>)}</tr></thead>
              <tbody className="divide-y">{group.fields.map(row => <tr key={row.field}>
                <th scope="row" className="px-3 py-3 font-medium">{comparison("fields." + row.field)}</th>
                <td className="px-3 py-3 tabular-nums">{group.before ? seconds(row.before) : t("noBaseline")}</td>
                <td className="px-3 py-3 tabular-nums">{seconds(row.after)}</td>
                <td className="px-3 py-3 tabular-nums">{row.deltaSeconds === null ? comparison("notComparable") : seconds(row.deltaSeconds)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {group.opaqueDefinitionChanged ? <p className="text-muted-foreground">{t("opaque")}</p> : null}
        </section>)}</div>
      </details>
    </div> : null}
  </section>
}
