"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, Check, Clock3, Eye, KeyRound, RotateCcw, Send, ShieldX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PROSPECT_TO_CLOSED_WON, activeSections } from "@/lib/demo-center/journey"

interface ModuleOption { id: string; title: string; summary: string }
interface GrantSummary {
  id: string
  status: string
  moduleIds: string[]
  /** Issued for a guided scenario rather than a module playlist. */
  journey: boolean
  liveCallEnabled: boolean
  sentAt: string | null
  openedAt: string | null
  sessionStartedAt: string | null
  completedAt: string | null
  expiresAt: string
}

const CLOSED_GRANT_STATUSES = new Set(["COMPLETED", "EXPIRED", "REVOKED"])

export function DemoRequestEditor({
  requestId,
  requestStatus,
  requestedModuleIds,
  modules,
  grants,
}: {
  requestId: string
  requestStatus: string
  requestedModuleIds: string[]
  modules: ModuleOption[]
  grants: GrantSummary[]
}) {
  const router = useRouter()
  const t = useTranslations("admin.demoCenter")
  const locale = useLocale()
  const validRequested = requestedModuleIds.filter((id) => modules.some((module) => module.id === id))
  // What the prospect actually receives. The guided journey is the default:
  // the module playlist is the older shape the owner asked to replace, kept
  // selectable only so an in-flight request can still be served the way it
  // was planned.
  const [mode, setMode] = useState<"journey" | "modules">("journey")
  const [selected, setSelected] = useState<string[]>(validRequested)
  const [linkValidDays, setLinkValidDays] = useState(7)
  const [sessionMinutes, setSessionMinutes] = useState(120)
  const [inactivityMinutes, setInactivityMinutes] = useState(30)
  const [liveCall, setLiveCall] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const latestGrant = grants[0]
  const selectedModules = useMemo(() => selected.map((id) => modules.find((module) => module.id === id)).filter(Boolean) as ModuleOption[], [modules, selected])
  const previewHref = useMemo(() => {
    const params = new URLSearchParams({ modules: selected.join(",") })
    return `/demo-preview/${requestId}?${params.toString()}`
  }, [requestId, selected])
  // Guided journey preview — the replacement for the module playlist. It does
  // not depend on the module selection: the scenario decides what is shown.
  const journeyPreviewHref = `/demo-preview/${requestId}?scenario=prospect-to-closed-won`
  const journeySectionCount = activeSections(PROSPECT_TO_CLOSED_WON).length
  const journeyMinutes = PROSPECT_TO_CLOSED_WON.estimatedMinutes

  function toggle(moduleId: string) {
    setSuccess(null)
    setSelected((current) => current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId])
  }

  function move(moduleId: string, delta: -1 | 1) {
    setSelected((current) => {
      const from = current.indexOf(moduleId)
      const to = from + delta
      if (from < 0 || to < 0 || to >= current.length) return current
      const next = [...current]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }

  async function issueDemo() {
    const journey = mode === "journey"
    if (!journey && !selected.length) return setError(t("errSelectModule"))
    setBusy("issue")
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`/api/v1/admin/demo-requests/${requestId}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // A grant is one or the other; the API refuses both or neither.
          ...(journey ? { scenarioId: PROSPECT_TO_CLOSED_WON.scenarioId, liveCallEnabled: liveCall } : { moduleIds: selected }),
          linkValidDays,
          sessionDurationMinutes: sessionMinutes,
          inactivityMinutes,
          locale: "az",
        }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || t("errIssue"))
      setSuccess(journey
        ? t("okJourney", { sections: journeySectionCount })
        : t("okModules", { count: selected.length }))
      router.refresh()
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : t("errIssue"))
    } finally {
      setBusy(null)
    }
  }

  async function revoke(grantId: string) {
    setBusy(`revoke:${grantId}`)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/demo-grants/${grantId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: t("revokedFromCenter") }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || t("errRevoke"))
      setSuccess(t("okRevoked"))
      router.refresh()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t("errRevoke"))
    } finally {
      setBusy(null)
    }
  }

  async function reject(formData: FormData) {
    const reason = String(formData.get("reason") || "")
    setBusy("reject")
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/demo-requests/${requestId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || t("errReject"))
      setSuccess(t("okRejected"))
      router.refresh()
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : t("errReject"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">{t("step1")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => { setMode("journey"); setSuccess(null) }}
            aria-pressed={mode === "journey"}
            className={`rounded-xl border p-4 text-left transition-colors ${mode === "journey" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"}`}
          >
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{t("journeyTitle")}</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              {t("journeyBody", { sections: journeySectionCount, minutes: journeyMinutes })}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMode("modules"); setSuccess(null) }}
            aria-pressed={mode === "modules"}
            className={`rounded-xl border p-4 text-left transition-colors ${mode === "modules" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"}`}
          >
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{t("playlistTitle")}</span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              {t("playlistBody")}
            </span>
          </button>
        </div>
      </section>

      <section className={mode === "modules" ? "" : "hidden"}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">{t("step2")}</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("chooseModules")}</h2>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>{t("clear")}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(modules.map((module) => module.id))}>{t("selectAll")}</Button>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {modules.map((module) => {
            const order = selected.indexOf(module.id)
            const isSelected = order >= 0
            return (
              <button
                type="button"
                key={module.id}
                onClick={() => toggle(module.id)}
                aria-pressed={isSelected}
                className={`group min-h-24 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 ${isSelected ? "border-orange-500 bg-orange-50 text-zinc-950 dark:border-orange-700 dark:bg-orange-950/35 dark:text-orange-50" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold">{module.title}</span>
                  <span className={`flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${isSelected ? "bg-orange-600 text-white" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"}`}>{isSelected ? order + 1 : "+"}</span>
                </span>
                <span className="mt-2 block text-xs leading-5 text-zinc-500">{module.summary}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className={`border-t border-zinc-200 pt-7 dark:border-zinc-800 ${mode === "modules" ? "" : "hidden"}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">2 · {t("storyOrder")}</p>
        {selectedModules.length ? (
          <ol className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {selectedModules.map((module, index) => (
              <li key={module.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{module.title}</span>
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(module.id, -1)} aria-label={t("moveEarlier", { title: module.title })}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" disabled={index === selectedModules.length - 1} onClick={() => move(module.id, 1)} aria-label={t("moveLater", { title: module.title })}><ArrowDown className="h-4 w-4" /></Button>
              </li>
            ))}
          </ol>
        ) : <p className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{t("orderHint")}</p>}
      </section>

      <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">3 · {t("step3")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Setting label={t("linkValidFor")} suffix={t("days")} value={linkValidDays} onChange={setLinkValidDays} min={1} max={30} />
          <Setting label={t("sessionLimit")} suffix={t("minutes")} value={sessionMinutes} onChange={setSessionMinutes} min={15} max={240} />
          <Setting label={t("idleTimeout")} suffix={t("minutes")} value={inactivityMinutes} onChange={setInactivityMinutes} min={5} max={60} />
        </div>
        {mode === "journey" ? (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <input
              type="checkbox"
              checked={liveCall}
              onChange={(event) => setLiveCall(event.target.checked)}
              className="mt-1 h-4 w-4 accent-orange-600"
            />
            <span>
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("liveCallTitle")}</span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">{t("liveCallBody")}</span>
            </span>
          </label>
        ) : null}
        <div className="mt-5 flex flex-col gap-4 rounded-xl bg-zinc-900 p-5 text-zinc-100 lg:flex-row lg:items-center lg:justify-between dark:bg-zinc-100 dark:text-zinc-900">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-orange-400" />
            <div><p className="text-sm font-semibold">{t("issueTitle")}</p><p className="mt-1 max-w-xl text-xs leading-5 text-zinc-400 dark:text-zinc-600">{t("issueBody")}</p></div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* The preview always shows what "Issue and send" would deliver —
                two buttons here invited previewing one and issuing the other. */}
            {mode === "journey" ? (
              <Button asChild variant="outline" className="min-h-11 shrink-0 border-zinc-600 bg-transparent text-zinc-100 hover:bg-zinc-800 hover:text-white dark:border-zinc-400 dark:text-zinc-900 dark:hover:bg-zinc-200">
                <a href={journeyPreviewHref} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" />{t("previewJourney")}</a>
              </Button>
            ) : selected.length ? (
              <Button asChild variant="outline" className="min-h-11 shrink-0 border-zinc-600 bg-transparent text-zinc-100 hover:bg-zinc-800 hover:text-white dark:border-zinc-400 dark:text-zinc-900 dark:hover:bg-zinc-200">
                <a href={previewHref} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" />{t("previewSelected")}</a>
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled className="min-h-11 shrink-0 border-zinc-600 bg-transparent text-zinc-100 dark:border-zinc-400 dark:text-zinc-900"><Eye className="h-4 w-4" />{t("previewSelected")}</Button>
            )}
            <Button type="button" disabled={busy !== null || (mode === "modules" && !selected.length) || requestStatus === "REJECTED"} onClick={issueDemo} className="min-h-11 shrink-0 bg-orange-600 text-white hover:bg-orange-700">
              {busy === "issue" ? <Clock3 className="h-4 w-4 animate-spin" /> : latestGrant ? <RotateCcw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {latestGrant ? t("reissueAndSend") : t("issueAndSend")}
            </Button>
          </div>
        </div>
        {success ? <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="h-4 w-4" />{success}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </section>

      {grants.length ? (
        <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
          <h2 className="text-base font-semibold">{t("issuedAccess")}</h2>
          <div className="mt-4 space-y-3">
            {grants.map((grant) => (
              <div key={grant.id} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{grant.status.replaceAll("_", " ")}</Badge>
                    <span className="text-xs text-zinc-500">{grant.journey ? t("grantJourney") : t("grantModules", { count: grant.moduleIds.length })}</span>
                    {grant.liveCallEnabled ? <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-300">{t("liveCallOn")}</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {t("grantExpires", { date: new Date(grant.expiresAt).toLocaleString(locale) })}
                    {grant.openedAt ? ` · ${t("grantOpened", { date: new Date(grant.openedAt).toLocaleString(locale) })}` : ""}
                  </p>
                </div>
                {!CLOSED_GRANT_STATUSES.has(grant.status) && grant.status !== "DELIVERY_FAILED" ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => revoke(grant.id)}><ShieldX className="h-4 w-4" />{t("revokeAccess")}</Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {requestStatus !== "REJECTED" ? (
        <details className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-600">{t("rejectTitle")}</summary>
          <form action={reject} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input required minLength={3} maxLength={500} name="reason" placeholder={t("rejectReasonPlaceholder")} />
            <Button type="submit" variant="destructive" disabled={busy !== null}>{t("rejectAndRevoke")}</Button>
          </form>
        </details>
      ) : null}
    </div>
  )
}

function Setting({ label, suffix, value, onChange, min, max }: { label: string; suffix: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  const id = `demo-${label.toLowerCase().replaceAll(" ", "-")}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative"><Input id={id} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="pr-20 tabular-nums" /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-500">{suffix}</span></div>
    </div>
  )
}
