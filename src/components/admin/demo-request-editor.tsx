"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Check, Clock3, KeyRound, RotateCcw, Send, ShieldX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ModuleOption { id: string; title: string; summary: string }
interface GrantSummary {
  id: string
  status: string
  moduleIds: string[]
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
  const validRequested = requestedModuleIds.filter((id) => modules.some((module) => module.id === id))
  const [selected, setSelected] = useState<string[]>(validRequested)
  const [linkValidDays, setLinkValidDays] = useState(7)
  const [sessionMinutes, setSessionMinutes] = useState(120)
  const [inactivityMinutes, setInactivityMinutes] = useState(30)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const latestGrant = grants[0]
  const selectedModules = useMemo(() => selected.map((id) => modules.find((module) => module.id === id)).filter(Boolean) as ModuleOption[], [modules, selected])

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
    if (!selected.length) return setError("Select at least one module before issuing access.")
    setBusy("issue")
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`/api/v1/admin/demo-requests/${requestId}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleIds: selected,
          linkValidDays,
          sessionDurationMinutes: sessionMinutes,
          inactivityMinutes,
          locale: "az",
        }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || "The demo could not be issued")
      setSuccess(`Access email sent with ${selected.length} selected module${selected.length === 1 ? "" : "s"}.`)
      router.refresh()
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "The demo could not be issued")
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
        body: JSON.stringify({ reason: "Revoked from Demo Center" }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || "Access could not be revoked")
      setSuccess("Demo access revoked immediately.")
      router.refresh()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Access could not be revoked")
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
      if (!response.ok) throw new Error(result.error || "Request could not be rejected")
      setSuccess("Request rejected and every open grant revoked.")
      router.refresh()
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Request could not be rejected")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">1 · Build the playlist</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">Choose from 19 demos</h2>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(modules.map((module) => module.id))}>Select all</Button>
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

      <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">2 · Set the story order</p>
        {selectedModules.length ? (
          <ol className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {selectedModules.map((module, index) => (
              <li key={module.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{module.title}</span>
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(module.id, -1)} aria-label={`Move ${module.title} earlier`}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" size="icon" disabled={index === selectedModules.length - 1} onClick={() => move(module.id, 1)} aria-label={`Move ${module.title} later`}><ArrowDown className="h-4 w-4" /></Button>
              </li>
            ))}
          </ol>
        ) : <p className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">Select modules above to create the prospect&apos;s private playlist.</p>}
      </section>

      <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">3 · Issue one session</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Setting label="Link valid for" suffix="days" value={linkValidDays} onChange={setLinkValidDays} min={1} max={30} />
          <Setting label="Session limit" suffix="minutes" value={sessionMinutes} onChange={setSessionMinutes} min={15} max={240} />
          <Setting label="Idle timeout" suffix="minutes" value={inactivityMinutes} onChange={setInactivityMinutes} min={5} max={60} />
        </div>
        <div className="mt-5 flex flex-col gap-3 rounded-xl bg-zinc-900 p-5 text-zinc-100 sm:flex-row sm:items-center sm:justify-between dark:bg-zinc-100 dark:text-zinc-900">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-orange-400" />
            <div><p className="text-sm font-semibold">OTP + one browser + one session</p><p className="mt-1 max-w-xl text-xs leading-5 text-zinc-400 dark:text-zinc-600">Opening the email does not consume access. Reissuing creates a fresh token and revokes the previous open grant.</p></div>
          </div>
          <Button type="button" disabled={busy !== null || !selected.length || requestStatus === "REJECTED"} onClick={issueDemo} className="shrink-0 bg-orange-600 text-white hover:bg-orange-700">
            {busy === "issue" ? <Clock3 className="h-4 w-4 animate-spin" /> : latestGrant ? <RotateCcw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {latestGrant ? "Reissue and send" : "Issue and send"}
          </Button>
        </div>
        {success ? <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="h-4 w-4" />{success}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </section>

      {grants.length ? (
        <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
          <h2 className="text-base font-semibold">Issued access</h2>
          <div className="mt-4 space-y-3">
            {grants.map((grant) => (
              <div key={grant.id} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{grant.status.replaceAll("_", " ")}</Badge><span className="text-xs text-zinc-500">{grant.moduleIds.length} modules</span></div>
                  <p className="mt-2 text-xs text-zinc-500">Expires {new Date(grant.expiresAt).toLocaleString("en-GB")}{grant.openedAt ? ` · opened ${new Date(grant.openedAt).toLocaleString("en-GB")}` : ""}</p>
                </div>
                {!CLOSED_GRANT_STATUSES.has(grant.status) && grant.status !== "DELIVERY_FAILED" ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => revoke(grant.id)}><ShieldX className="h-4 w-4" />Revoke access</Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {requestStatus !== "REJECTED" ? (
        <details className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-600">Reject this request</summary>
          <form action={reject} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input required minLength={3} maxLength={500} name="reason" placeholder="Reason recorded in the admin history" />
            <Button type="submit" variant="destructive" disabled={busy !== null}>Reject and revoke</Button>
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
