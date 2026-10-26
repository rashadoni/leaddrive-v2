"use client"
import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IdentitySelfBootstrapConflicts, type IdentitySelfBootstrapConflict } from "@/lib/identity/self-bootstrap-conflict"
const errorMessages: Record<string, string> = {
  IDENTITY_PASSWORD_WEAK: "identitySetupPasswordWeak",
  IDENTITY_CODE_INVALID: "identitySetupCodeInvalid",
  IDENTITY_SELF_BOOTSTRAP_PHONE_INVALID: "identitySetupPhoneInvalid",
  IDENTITY_SELF_BOOTSTRAP_PHONE_MISMATCH: "identitySetupPhoneMismatch",
  IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT: "identitySetupPhoneConflict",
  IDENTITY_SELF_BOOTSTRAP_TENANT_ADMIN_REQUIRED: "identitySetupTenantAdminRequired",
  IDENTITY_SELF_BOOTSTRAP_CARD_REVIEW_REQUIRED: "identitySetupCardReviewRequired",
  IDENTITY_SELF_BOOTSTRAP_STATE_REVIEW_REQUIRED: "identitySetupCardReviewRequired",
  IDENTITY_SELF_BOOTSTRAP_APPLICATION_UNAVAILABLE: "identitySetupApplicationUnavailable",
  IDENTITY_SELF_BOOTSTRAP_TENANT_DISABLED: "identitySetupUnavailable",
  IDENTITY_ACTIVATION_RUNTIME_UNAVAILABLE: "identitySetupUnavailable",
  IDENTITY_CODE_DELIVERY_UNAVAILABLE: "identitySetupDeliveryFailed",
  IDENTITY_PROOF_RESEND_LATER: "identitySetupRateLimit",
  IDENTITY_ADMIN_REQUIRED: "identitySetupSessionRequired",
}
type Review = { name: string; phone: string; sourceRevision: string; applications: Array<{ application: string; role: string }> }
/** All code/password state stays in memory. Each step uses the current private
 * cookie/MFA context; no public mobile setup capability can bootstrap an admin. */
export function IdentitySelfBootstrap({ onClose }: { onClose: () => void }) {
  const p = useTranslations("personnel"), locale = useLocale()
  const [phone, setPhone] = useState("+994"), [review, setReview] = useState<Review | null>(null)
  const [proof, setProof] = useState<string | null>(null), [code, setCode] = useState(""), [setup, setSetup] = useState<string | null>(null)
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState("")
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [done, setDone] = useState(false)
  const [conflicts, setConflicts] = useState<IdentitySelfBootstrapConflict[]>([])
  const request = useRef<string | null>(null)
  async function run(action: "review" | "request" | "confirm" | "finish") {
    if (busy || done) return
    if (action === "finish" && password !== repeat) { setError("identitySetupPasswordMismatch"); return }
    const body = action === "review" ? { action, phone } : action === "request" ? {
      action, phone: review?.phone, sourceRevision: review?.sourceRevision, requestId: request.current ??= crypto.randomUUID(), language: locale,
    } : action === "confirm" ? { action, proofId: proof, code } : { action, setupToken: setup, password }
    setBusy(true); setError(null); setConflicts([])
    try {
      const response = await fetch("/api/v1/identity/self-bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        if (action === "review" && response.status === 409 && result?.error === "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT") {
          const details = IdentitySelfBootstrapConflicts.safeParse(result.conflicts)
          if (details.success) setConflicts(details.data)
        }
        const known = typeof result?.error === "string" && Object.hasOwn(errorMessages, result.error)
          ? errorMessages[result.error] : null
        setError(response.status === 429 ? "identitySetupRateLimit"
          : known ?? (response.status === 401 ? "identitySetupSessionRequired" : "identitySetupFailed"))
        return
      }
      if (action === "review") {
        if (typeof result.data?.sourceRevision !== "string" || !Array.isArray(result.data?.applications)) throw new Error("REVIEW")
        setReview(result.data); request.current = null
      } else if (action === "request") {
        if (typeof result.data?.proofId !== "string") throw new Error("PROOF")
        setProof(result.data.proofId)
        if (result.data.delivery === "FAILED") setError("identitySetupDeliveryFailed")
      } else if (action === "confirm") {
        if (typeof result.data?.setupToken !== "string") throw new Error("SETUP")
        setSetup(result.data.setupToken); setCode("")
      } else if (result.data?.signInRequired === true) {
        setDone(true); setPassword(""); setRepeat(""); setSetup(null); setProof(null)
      } else throw new Error("COMPLETION")
    } catch { setError("identitySetupFailed") }
    finally { setBusy(false) }
  }
  return <div className="max-w-prose space-y-3 rounded-xl border p-4 text-sm" data-testid="identity-self-bootstrap" aria-busy={busy}>
    <p className="font-medium">{p("identitySetupTitle")}</p>
    {done ? <>
      <p>{p("identitySetupDone")}</p>
      <Button asChild type="button" className="min-h-11 rounded-full"><Link href="/login?callbackUrl=%2Fmtm%2Fattendance%2Fpeople" prefetch={false}>{p("identitySetupLogin")}</Link></Button>
    </> : <>
      <p>{p("identitySetupHint")}</p>
      {!review ? <>
        <label className="block space-y-2"><span>{p("identitySetupOwnPhone")}</span><Input type="tel" autoComplete="tel" maxLength={40} value={phone} disabled={busy} onChange={e => { setPhone(e.target.value); setConflicts([]); setError(null) }} /></label>
        <Button type="button" disabled={busy} onClick={() => run("review")}>{p("identitySetupReview")}</Button>
      </> : !proof ? <>
        <p>{p("identitySetupPerson", { name: review.name, phone: review.phone })}</p>
        <ul>{review.applications.map(a => <li key={a.application}>{p(a.application === "CRM" ? "identitySetupCrm" : a.application === "TIME" ? "identitySetupTime" : "identitySetupField", { role: a.role })}</li>)}</ul>
        <Button type="button" disabled={busy} onClick={() => run("request")}>{p("identitySetupSend")}</Button>
      </> : !setup ? <>
        <p>{p("identitySetupCodeHint")}</p>
        <label className="block space-y-2"><span>{p("identitySetupCode")}</span><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></label>
        <Button type="button" disabled={busy || !/^\d{6}$/.test(code)} onClick={() => run("confirm")}>{p("identitySetupConfirm")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { setProof(null); setReview(null); setCode(""); request.current = null; setError(null) }}>{p("identitySetupRestart")}</Button>
      </> : <>
        <p>{p("identitySetupPasswordHint")}</p>
        <label className="block space-y-2"><span>{p("identitySetupPassword")}</span><Input type="password" autoComplete="new-password" maxLength={72} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        <label className="block space-y-2"><span>{p("identitySetupPasswordRepeat")}</span><Input type="password" autoComplete="new-password" maxLength={72} value={repeat} disabled={busy} onChange={e => setRepeat(e.target.value)} /></label>
        <Button type="button" disabled={busy || !password || !repeat} onClick={() => run("finish")}>{p("identitySetupFinish")}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => {
          setProof(null); setReview(null); setSetup(null); setPassword(""); setRepeat(""); setCode(""); request.current = null; setError(null)
        }}>{p("identitySetupRestart")}</Button>
      </>}
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{p("cancel")}</Button>
    </>}
    {error ? <p role="alert" className="text-destructive">{p(error)}</p> : null}
    {conflicts.length > 0 ? <div className="space-y-2" data-testid="identity-phone-conflicts">
      <p>{p("identitySetupConflictsHint")}</p>
      <ul className="space-y-2">{conflicts.map(profile => <li key={`${profile.kind}:${profile.id}`} className="rounded-lg border p-3">
        <p className="font-medium">{profile.name}</p>
        <p>{p(profile.kind === "crm" ? "identitySetupConflictCrm" : profile.kind === "time" ? "identitySetupConflictTime" : "identitySetupConflictField")}
          {!profile.active ? ` · ${p("identitySetupConflictInactive")}` : ""}</p>
        {profile.kind !== "crm" ? <p>{profile.ownerName === null
          ? p("identitySetupConflictUnlinked") : p("identitySetupConflictOwner", { name: profile.ownerName })}</p> : null}
        <Link className="inline-flex min-h-11 items-center underline" target="_blank" rel="noopener noreferrer" prefetch={false}
          href={profile.kind === "crm" ? "/settings/users" : profile.kind === "time"
            ? `/mtm/attendance/people/${encodeURIComponent(profile.id)}` : `/mtm/agents/${encodeURIComponent(profile.id)}`}>
          {p(profile.kind === "crm" ? "identitySetupConflictOpenUsers" : "identitySetupConflictOpenCard")}
        </Link>
      </li>)}</ul>
      {conflicts.length === 6 ? <p>{p("identitySetupConflictMore")}</p> : null}
    </div> : null}
  </div>
}
