"use client"
import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
type Review = { name: string; phone: string; sourceRevision: string; applications: Array<{ application: string; role: string }> }
/** All code/password state stays in memory. Each step uses the current private
 * cookie/MFA context; no public mobile setup capability can bootstrap an admin. */
export function IdentitySelfBootstrap({ onClose }: { onClose: () => void }) {
  const p = useTranslations("personnel"), locale = useLocale()
  const [phone, setPhone] = useState("+994"), [review, setReview] = useState<Review | null>(null)
  const [proof, setProof] = useState<string | null>(null), [code, setCode] = useState(""), [setup, setSetup] = useState<string | null>(null)
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState("")
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [done, setDone] = useState(false)
  const request = useRef<string | null>(null)
  async function run(action: "review" | "request" | "confirm" | "finish") {
    if (busy || done) return
    if (action === "finish" && password !== repeat) { setError("identitySetupPasswordMismatch"); return }
    const body = action === "review" ? { action, phone } : action === "request" ? {
      action, phone: review?.phone, sourceRevision: review?.sourceRevision, requestId: request.current ??= crypto.randomUUID(), language: locale,
    } : action === "confirm" ? { action, proofId: proof, code } : { action, setupToken: setup, password }
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/v1/identity/self-bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        setError(result?.error === "IDENTITY_PASSWORD_WEAK" ? "identitySetupPasswordWeak"
          : result?.error === "IDENTITY_CODE_INVALID" ? "identitySetupCodeInvalid"
          : response.status === 429 ? "identitySetupRateLimit" : "identitySetupFailed")
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
        <label className="block space-y-2"><span>{p("identitySetupOwnPhone")}</span><Input type="tel" autoComplete="tel" maxLength={40} value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} /></label>
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
  </div>
}
