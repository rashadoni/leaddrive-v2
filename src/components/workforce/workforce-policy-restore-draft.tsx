"use client"

import { type FormEvent, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { validWorkforcePolicyRestoreReceipt, workforcePolicyRestoreDateKey,
  type WorkforcePolicyRestoreSource, type WorkforcePolicyRestoreRequest,
  type WorkforcePolicyRestoreReceipt } from "@/lib/workforce/policy-restore-receipt"

type Details = { name: string; effectiveFrom: string }
type Phase = "edit" | "review" | "pending" | "unknown" | "created"
const rejections: Record<string, { status: number; copy: string }> = {
  WORKFORCE_POLICY_RESTORE_INPUT_INVALID: { status: 400, copy: "invalid" },
  WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE: { status: 404, copy: "sourceUnavailable" },
  WORKFORCE_POLICY_RESTORE_SOURCE_CHANGED: { status: 409, copy: "sourceChanged" },
  WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID: { status: 409, copy: "integrity" },
  WORKFORCE_POLICY_RESTORE_NOT_FUTURE: { status: 409, copy: "notFuture" },
  WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT: { status: 409, copy: "conflict" },
}

/** Selection and session keys belong to the parent; a held write cannot change its source. */
export function WorkforcePolicyRestoreDraftSection({ source, onDenied, onHold }: {
  source: WorkforcePolicyRestoreSource | null
  onDenied: (reason: "session" | "permission") => void
  onHold: (held: boolean) => void
}) {
  const t = useTranslations("workforcePolicyRestoreDraft"), locale = useLocale()
  const [name, setName] = useState(""), [effectiveFrom, setEffectiveFrom] = useState("")
  const [phase, setPhase] = useState<Phase>("edit"), [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState<string | null>(null), [receipt, setReceipt] = useState<WorkforcePolicyRestoreReceipt | null>(null)
  const [abandonAcknowledged, setAbandonAcknowledged] = useState(false)
  const alive = useRef(false), inFlight = useRef(false), uncertain = useRef(false)
  const submitted = useRef<WorkforcePolicyRestoreRequest | null>(null), controller = useRef<AbortController | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort(); if (timeout.current) clearTimeout(timeout.current) }
  }, [])
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!source || phase !== "edit" || submitted.current) return
    const normalized = name.trim()
    if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)
      || !workforcePolicyRestoreDateKey(effectiveFrom)) { setError(t("invalid")); return }
    setDetails({ name: normalized, effectiveFrom }); setError(null); setPhase("review")
  }
  async function send(request: WorkforcePolicyRestoreRequest) {
    if (!source || inFlight.current || !alive.current) return
    inFlight.current = true; onHold(true); setPhase("pending"); setError(null); setAbandonAcknowledged(false)
    const pending = new AbortController(); controller.current = pending
    const current = () => alive.current && controller.current === pending
    const timer = setTimeout(() => {
      if (current()) { uncertain.current = true; inFlight.current = false; setPhase("unknown"); pending.abort() }
    }, 60_000)
    timeout.current = timer
    try {
      const response = await fetch(`/api/v1/workforce/configuration/policies/${encodeURIComponent(source.id)}/restore-draft`, {
        method: "POST", credentials: "same-origin", signal: pending.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      })
      if (!current()) return
      if (pending.signal.aborted) { uncertain.current = true; setPhase("unknown"); return }
      if (response.status === 401 || response.status === 403) { onDenied(response.status === 401 ? "session" : "permission"); return }
      const body = await response.json().catch(() => null)
      if (!current()) return
      if (pending.signal.aborted) { uncertain.current = true; setPhase("unknown"); return }
      if (body?.success === true && validWorkforcePolicyRestoreReceipt(body.data?.restore, response.status, source, request)) {
        setReceipt(body.data.restore); uncertain.current = false; setPhase("created"); onHold(false); return
      }
      const rejection = typeof body?.code === "string" && Object.hasOwn(rejections, body.code) ? rejections[body.code] : null
      if (!uncertain.current && body?.success !== true && rejection?.status === response.status) {
        submitted.current = null; setPhase("edit"); setDetails(null); setError(t(rejection.copy)); onHold(false); return
      }
      uncertain.current = true; setPhase("unknown")
    } catch { if (current()) { uncertain.current = true; setPhase("unknown") } }
    finally { clearTimeout(timer); if (current()) { inFlight.current = false; timeout.current = null } }
  }
  function confirm() {
    if (!source || !details || phase !== "review" || inFlight.current || submitted.current) return
    if (typeof globalThis.crypto?.randomUUID !== "function") { setError(t("unavailable")); return }
    let operationId: string
    try { operationId = globalThis.crypto.randomUUID() } catch { setError(t("unavailable")); return }
    const request = { operationId, expectedSourceVersion: source.version,
      expectedSourceDefinitionHash: source.definitionHash, ...details }
    submitted.current = Object.freeze(request) // Capture once, before the first network call.
    void send(request)
  }
  function abandon() {
    if (phase !== "unknown" || inFlight.current || !abandonAcknowledged) return
    controller.current?.abort(); controller.current = null
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = null
    submitted.current = null; uncertain.current = false; setDetails(null); setAbandonAcknowledged(false)
    setPhase("edit"); setError(null); onHold(false)
  }
  const number = new Intl.NumberFormat(locale), held = phase === "pending" || phase === "unknown"
  const scope = source?.teamId === null ? t("organizationScope") : source?.teamName ?? t("teamScope")
  return <section aria-labelledby="workforce-policy-restore-title" aria-busy={phase === "pending"} className="space-y-4 break-words rounded-lg border p-4">
    <div><h2 id="workforce-policy-restore-title" className="font-semibold">{t("title")}</h2><p className="mt-2 max-w-[72ch] text-sm leading-6 text-muted-foreground">{t("hint")}</p></div>
    {!source ? <p className="text-sm text-muted-foreground">{t("chooseSource")}</p> : <>
      <p className="text-sm leading-6">{t("source", { name: source.name, version: number.format(source.version), scope })}</p>
      {phase === "edit" ? <form onSubmit={review} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="workforce-policy-restore-name" className="text-sm font-medium">{t("name")}</label><Input id="workforce-policy-restore-name" value={name} onChange={event => setName(event.target.value)} maxLength={160} required className="min-h-11" /></div>
          <div className="space-y-2"><label htmlFor="workforce-policy-restore-date" className="text-sm font-medium">{t("date")}</label><Input id="workforce-policy-restore-date" type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} required aria-describedby="workforce-policy-restore-date-hint" className="min-h-11" /><p id="workforce-policy-restore-date-hint" className="text-sm leading-6 text-muted-foreground">{t("dateHint")}</p></div></div>
        <Button type="submit" variant="outline" className="min-h-11">{t("review")}</Button>
      </form> : null}
      {details && (phase === "review" || held) ? <div className="space-y-3 text-sm leading-6">
        <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="font-medium">{t("name")}</dt><dd>{details.name}</dd></div><div><dt className="font-medium">{t("date")}</dt><dd><time dateTime={details.effectiveFrom}>{details.effectiveFrom}</time></dd></div></dl>
        <p>{t("copy")}</p>
        {phase === "review" ? <div className="flex flex-wrap gap-3"><Button type="button" onClick={confirm} className="min-h-11">{t("create")}</Button><Button type="button" variant="outline" onClick={() => { setPhase("edit"); setDetails(null); setError(null) }} className="min-h-11">{t("edit")}</Button></div> : null}
      </div> : null}
      {phase === "pending" ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{t("pending")}</p> : null}
      {held ? <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">{t("navigation")}</p> : null}
      {phase === "unknown" ? <div className="space-y-4"><p role="alert" className="text-sm leading-6">{t("unknown")}</p><Button type="button" variant="outline" onClick={() => { if (submitted.current) void send(submitted.current) }} className="min-h-11">{t("retry")}</Button>
        <details><summary className="min-h-11 cursor-pointer text-sm font-medium">{t("abandon")}</summary><div className="mt-2 space-y-3"><label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input id="workforce-policy-restore-abandon" type="checkbox" checked={abandonAcknowledged} onChange={event => setAbandonAcknowledged(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />{t("abandonAcknowledgement")}</label><Button type="button" variant="outline" disabled={!abandonAcknowledged} onClick={abandon} className="min-h-11">{t("abandonConfirm")}</Button></div></details>
      </div> : null}
      {receipt ? <div role="status" className="space-y-2 text-sm leading-6"><p className="font-medium">{t(receipt.replayed ? "replayed" : "created")}</p><p>{t("creation", { name: receipt.creation.name, version: number.format(receipt.creation.version), date: receipt.creation.effectiveFrom })}</p><p className="max-w-[72ch] text-muted-foreground">{t("historical")}</p></div> : null}
    </>}
    {error ? <p role="alert" className="text-sm leading-6 text-destructive">{error}</p> : null}
    <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">{t("boundary")}</p>
  </section>
}
