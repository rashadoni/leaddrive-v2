"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkforcePolicyFutureWindowPreview } from "@/lib/workforce/policy-future-window-preview"

type Choice = { id: string; name: string; version: number; status: string; teamId: string | null }
type Preview = WorkforcePolicyFutureWindowPreview & { timezone: string; observedAt: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
function dateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const date = new Date(value + "T00:00:00.000Z")
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function window(value: unknown): value is Preview["draft"] {
  return object(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 191
    && typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 160
    && typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0
    && dateKey(value.effectiveFrom) && (value.effectiveTo === null || (dateKey(value.effectiveTo) && value.effectiveTo >= value.effectiveFrom))
}
function predecessor(value: unknown): value is NonNullable<Preview["predecessor"]> {
  return window(value) && object(value) && dateKey(value.projectedEffectiveTo)
}
function validPreview(value: unknown, choice: Choice): value is Preview {
  if (!object(value) || value.basis !== "RECORDED_SCOPE_WINDOWS_ONLY_NO_EMPLOYEE_IMPACT_OR_APPROVAL"
    || value.canonicalActivationRequired !== true || value.guaranteedAtActivation !== false
    || !dateKey(value.currentDate) || typeof value.timezone !== "string" || value.timezone.length > 100
    || typeof value.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.observedAt)
    || !Number.isFinite(new Date(value.observedAt).getTime())
    || !window(value.draft) || value.draft.id !== choice.id || value.draft.version !== choice.version
    || value.draft.effectiveFrom <= value.currentDate || value.draft.effectiveTo !== null
    || !object(value.scope) || value.scope.teamId !== choice.teamId
    || value.scope.kind !== (choice.teamId === null ? "ORGANIZATION" : "TEAM")
    || !object(value.projectedWindow) || value.projectedWindow.effectiveFrom !== value.draft.effectiveFrom || value.projectedWindow.effectiveTo !== null
    || !Array.isArray(value.recordedWindows) || value.recordedWindows.length > 100 || !value.recordedWindows.every(window)) return false
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(new Date(value.observedAt)) } catch { return false }
  const rows = value.recordedWindows
  if (new Set([choice.id, ...rows.map(row => row.id)]).size !== rows.length + 1
    || new Set([choice.version, ...rows.map(row => row.version)]).size !== rows.length + 1) return false
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1]
    if (previous.effectiveFrom >= rows[index].effectiveFrom || previous.effectiveTo === null || previous.effectiveTo >= rows[index].effectiveFrom) return false
  }
  if (rows.length === 0) return value.predecessor === null
  if (!predecessor(value.predecessor)) return false
  const previous = value.predecessor, last = rows[rows.length - 1]
  const close = new Date(value.draft.effectiveFrom + "T00:00:00.000Z"); close.setUTCDate(close.getUTCDate() - 1)
  return previous.id === last.id && previous.version === last.version && previous.name === last.name
    && previous.effectiveFrom === last.effectiveFrom && previous.effectiveTo === last.effectiveTo
    && last.effectiveFrom <= previous.projectedEffectiveTo
    && (last.effectiveTo === null || last.effectiveTo >= value.draft.effectiveFrom)
    && previous.projectedEffectiveTo === close.toISOString().slice(0, 10)
}

/** Parent session/selection keys remount this read; permission/session denials clear the whole parent. */
export function WorkforcePolicyFutureWindowSection({ choice, onDenied }: { choice: Choice | null; onDenied: (reason: "session" | "permission") => void }) {
  const t = useTranslations("workforcePolicyFutureWindowPreview"), locale = useLocale()
  const [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(false), latest = useRef(0), controller = useRef<AbortController | null>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort() }
  }, [])
  async function load() {
    if (!choice || choice.status !== "DRAFT") return
    controller.current?.abort()
    const pending = new AbortController(), request = ++latest.current
    controller.current = pending; setPreview(null); setLoading(true); setError(null)
    const current = () => alive.current && !pending.signal.aborted && latest.current === request
    try {
      const response = await fetch(`/api/v1/workforce/configuration/policies/${encodeURIComponent(choice.id)}/window-preview`, { credentials: "same-origin", signal: pending.signal })
      const body = await response.json().catch(() => ({}))
      if (!current()) return
      if (response.status === 401 || response.status === 403) { onDenied(response.status === 401 ? "session" : "permission"); return }
      if (response.status === 409) {
        const keys: Record<string, string> = { WORKFORCE_POLICY_WINDOW_CONFLICT: "conflict", WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED: "limit",
          WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT: "notFuture", WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID: "integrity" }
        const key = typeof body.code === "string" && Object.prototype.hasOwnProperty.call(keys, body.code) ? keys[body.code] : "failed"
        setError(t(key)); return
      }
      if (!response.ok || !body.success || !validPreview(body.data?.preview, choice)) throw new Error("WINDOW_PREVIEW_FAILED")
      setPreview(body.data.preview)
    } catch { if (current()) setError(t("failed")) }
    finally { if (current()) setLoading(false) }
  }
  const number = new Intl.NumberFormat(locale)
  return <section aria-labelledby="workforce-policy-future-window-title" className="space-y-4 break-words rounded-lg border p-4" aria-busy={loading}>
    <div><h2 id="workforce-policy-future-window-title" className="font-semibold">{t("title")}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("hint")}</p></div>
    <Button type="button" onClick={() => void load()} disabled={!choice || choice.status !== "DRAFT" || loading} className="min-h-11">{loading ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}{t(loading ? "loading" : "preview")}</Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {preview ? <div role="status" className="space-y-4 text-sm leading-6">
      <p>{t("selected", { name: preview.draft.name, version: number.format(preview.draft.version) })}</p>
      <p className="text-muted-foreground">{t("observed", { date: preview.currentDate, timezone: preview.timezone,
        time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: preview.timezone }).format(new Date(preview.observedAt)) })}</p>
      <dl className="space-y-3"><div><dt className="font-medium">{t("newWindow")}</dt><dd><time dateTime={preview.projectedWindow.effectiveFrom}>{preview.projectedWindow.effectiveFrom}</time> — {t("openEnded")}</dd></div>
        <div><dt className="font-medium">{t("predecessor")}</dt><dd>{preview.predecessor ? t("close", { name: preview.predecessor.name, version: number.format(preview.predecessor.version), date: preview.predecessor.projectedEffectiveTo }) : t("noPredecessor")}</dd></div></dl>
      <details><summary className="min-h-11 cursor-pointer font-medium">{t("recorded", { count: number.format(preview.recordedWindows.length) })}</summary>
        <ul className="mt-2 space-y-2">{preview.recordedWindows.map(row => <li key={row.id} className="break-words">{t("record", { name: row.name, version: number.format(row.version), from: row.effectiveFrom, to: row.effectiveTo ?? t("openEnded") })}</li>)}</ul>
      </details>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">{t("boundary")}</p>
    </div> : null}
  </section>
}
