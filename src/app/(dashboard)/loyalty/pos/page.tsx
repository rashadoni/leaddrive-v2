"use client"

/**
 * Loyalty POS — the counter scan flow.
 *
 * Staff scan a member's QR card (camera, via the BarcodeDetector API where
 * available) OR type the member number, we resolve the member
 * (/loyalty-accounts/resolve), then award points for a purchase
 * (/loyalty-accounts/award). Camera is optional — manual entry always works,
 * so the page is usable on any device/browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { ScanLine, Camera, X, Check, RefreshCw, Gift, AlertCircle } from "lucide-react"
import type { PreviewEarnRule, PreviewTier } from "@/lib/loyalty/preview"
import { suggestPosAward } from "@/lib/loyalty/ux"

interface Member {
  accountId: string | null
  contactId: string
  name: string | null
  email: string | null
  points: number
  lifetimePoints: number
  tier: string | null
}

// BarcodeDetector is shipped by Chromium browsers; not in lib.dom types.
type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike
  }
}

export default function LoyaltyPosPage() {
  const t = useTranslations("slice2.loyaltyPos")
  const tc = useTranslations("slice2.common")

  const [code, setCode] = useState("")
  const [member, setMember] = useState<Member | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [points, setPoints] = useState("")
  const [purchaseAmount, setPurchaseAmount] = useState("")
  const [manualOverride, setManualOverride] = useState(false)
  const [awarding, setAwarding] = useState(false)
  const [awarded, setAwarded] = useState<{ awarded: number; balance: number; tier: string | null; tierChanged: boolean } | null>(null)

  const [scanning, setScanning] = useState(false)
  const [rules, setRules] = useState<PreviewEarnRule[]>([])
  const [tiers, setTiers] = useState<PreviewTier[]>([])
  const [ruleLoadFailed, setRuleLoadFailed] = useState(false)
  const [cameraCapabilityChecked, setCameraCapabilityChecked] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  useEffect(() => {
    setCameraSupported(Boolean(window.BarcodeDetector && navigator.mediaDevices?.getUserMedia))
    setCameraCapabilityChecked(true)
  }, [])

  const resolve = useCallback(
    async (scanned: string) => {
      const value = scanned.trim()
      if (!value) return
      stopCamera()
      setResolving(true)
      setError(null)
      setAwarded(null)
      try {
        const r = await fetch("/api/v1/loyalty-accounts/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: value }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error === "ambiguous_code" ? t("errorAmbiguous") : j.error === "Member not found" ? t("errorNotFound") : j.error || tc("errorGeneric"))
        setMember(j.member)
        setPurchaseAmount("")
        setManualOverride(false)
        setPoints("")
      } catch (e) {
        setMember(null)
        setError(e instanceof Error ? e.message : tc("errorGeneric"))
      } finally {
        setResolving(false)
      }
    },
    [stopCamera, t, tc],
  )

  const startCamera = useCallback(async () => {
    if (!cameraSupported || !window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCameraUnavailable(true)
      setError(t("errorCamera"))
      return
    }
    setError(null)
    setCameraUnavailable(false)
    setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] })
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0 && codes[0].rawValue) {
            resolve(codes[0].rawValue)
            return
          }
        } catch {
          /* a transient detect error — keep scanning */
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      stopCamera()
      setCameraUnavailable(true)
      setError(t("errorCamera"))
    }
  }, [cameraSupported, resolve, stopCamera, t])

  useEffect(() => () => stopCamera(), [stopCamera])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/v1/loyalty-earn-rules").then((r) => r.json()),
      fetch("/api/v1/loyalty-tiers").then((r) => r.json()),
    ])
      .then(([rulesJson, tiersJson]) => {
        if (!cancelled) {
          setRules(rulesJson.rules ?? [])
          setTiers(tiersJson.tiers ?? [])
          setRuleLoadFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) setRuleLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const suggested = useMemo(
    () =>
      suggestPosAward({
        amount: Number(purchaseAmount),
        currency: "AZN",
        memberTier: member?.tier ?? null,
        rules,
        tiers,
      }),
    [member?.tier, purchaseAmount, rules, tiers],
  )

  async function award() {
    if (!member) return
    const n = manualOverride ? Number(points) : suggested.points
    if (!manualOverride && Number(purchaseAmount) <= 0) {
      setError(t("errorAmount"))
      return
    }
    if (!manualOverride && suggested.source === "no_rule") {
      setError(t("errorNoMatchingRule"))
      return
    }
    if (!Number.isInteger(n) || n <= 0) {
      setError(t("errorPoints"))
      return
    }
    setAwarding(true)
    setError(null)
    try {
      const r = await fetch("/api/v1/loyalty-accounts/award", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: member.contactId, points: n, reason: "POS purchase" }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || tc("errorGeneric"))
      setAwarded({ awarded: j.awarded ?? n, balance: j.points, tier: j.tier, tierChanged: !!j.tierChanged })
      setMember({ ...member, accountId: j.accountId, points: j.points, tier: j.tier })
      setPoints("")
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setAwarding(false)
    }
  }

  function reset() {
    stopCamera()
    setMember(null)
    setCode("")
    setPoints("")
    setPurchaseAmount("")
    setManualOverride(false)
    setError(null)
    setAwarded(null)
  }

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScanLine className="w-8 h-8 text-primary" />
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-2">{t("subtitle")}</p>
      </header>

      {error && (
        <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </MotionCard>
      )}

      {(rules.length === 0 || ruleLoadFailed) && (
        <MotionCard className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{t("setupMissingTitle")}</p>
              <p className="mt-1 text-xs leading-5 opacity-90">{t("setupMissingDesc")}</p>
              <Link href="/loyalty/earn-rules" className="mt-3 inline-flex rounded-md bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                {t("setupMissingCta")}
              </Link>
            </div>
          </div>
        </MotionCard>
      )}

      {!member ? (
        <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-xl">
          {scanning ? (
            <div className="space-y-3">
              <video ref={videoRef} className="w-full rounded-lg bg-black aspect-square object-cover" muted playsInline />
              <button onClick={stopCamera} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm hover:bg-muted">
                <X className="w-4 h-4" /> {t("stopScan")}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {cameraCapabilityChecked && cameraSupported && (
                <button onClick={startCamera} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90">
                  <Camera className="w-5 h-5" /> {t("scanCamera")}
                </button>
              )}
              {cameraCapabilityChecked && !cameraSupported && (
                <div className="rounded-lg border border-dashed border-zinc-300 bg-muted/40 p-4 text-sm text-muted-foreground dark:border-zinc-700">
                  <p className="font-medium text-foreground">{t("errorCamera")}</p>
                  <p className="mt-1 text-xs leading-5">{t("cameraUnsupportedDesc")}</p>
                </div>
              )}
              {cameraUnavailable && cameraSupported && (
                <div className="rounded-lg border border-dashed border-zinc-300 bg-muted/40 p-4 text-sm text-muted-foreground dark:border-zinc-700">
                  <p className="font-medium text-foreground">{t("cameraPermissionTitle")}</p>
                  <p className="mt-1 text-xs leading-5">{t("cameraPermissionDesc")}</p>
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-muted-foreground">{t("manualLabel")}</label>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && resolve(code)}
                    placeholder={t("manualPlaceholder")}
                    className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono uppercase"
                  />
                  <button onClick={() => resolve(code)} disabled={resolving || !code.trim()} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
                    {resolving ? tc("loading") : t("find")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </MotionCard>
      ) : (
        <MotionCard className="p-5 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-4">
          {/* Member */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{member.name || member.email || member.contactId}</p>
              <p className="text-sm text-muted-foreground">
                {member.points.toLocaleString()} {t("pts")}
                {member.tier ? ` · ${member.tier}` : ""}
                {member.accountId === null ? ` · ${t("newMember")}` : ""}
              </p>
            </div>
            <button onClick={reset} className="p-1.5 rounded hover:bg-muted" aria-label={tc("close")}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {awarded ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 flex items-center gap-3">
              <Check className="w-6 h-6 text-green-600" />
              <div>
                <p className="font-semibold text-green-700 dark:text-green-400">{t("awardedTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("awardedBody", { awarded: awarded.awarded.toLocaleString(), points: awarded.balance.toLocaleString() })}</p>
                {awarded.tierChanged && awarded.tier && (
                  <p className="mt-1 text-xs font-medium text-green-700 dark:text-green-300">{t("tierChanged", { tier: awarded.tier })}</p>
                )}
              </div>
            </div>
          ) : null}

          {/* Award form */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/70 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t("currentPoints")}</p>
              <p className="font-mono font-semibold">{member.points.toLocaleString()} {t("pts")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("currentTier")}</p>
              <p className="font-semibold">{member.tier || t("noTier")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-xs font-medium">{t("purchaseAmount")}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={purchaseAmount}
                onChange={(e) => setPurchaseAmount(e.target.value)}
                placeholder={t("purchaseAmountPlaceholder")}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
              />
            </div>
            <div className={`rounded-lg border p-3 text-sm ${suggested.source === "no_rule" ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-zinc-200 bg-background dark:border-zinc-700"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{t("suggestedPoints")}</span>
                <span className="font-mono text-lg font-bold">{suggested.points.toLocaleString()} {t("pts")}</span>
              </div>
              <p className="mt-1 text-xs opacity-80">
                {suggested.source === "no_rule"
                  ? t("noMatchingRule")
                  : t("formula", {
                      amount: Number(purchaseAmount || 0).toLocaleString(),
                      base: suggested.base.toLocaleString(),
                      multiplier: suggested.multiplier.toLocaleString(),
                      points: suggested.points.toLocaleString(),
                    })}
              </p>
              {suggested.ruleName && <p className="mt-1 text-xs text-muted-foreground">{t("matchedRule", { rule: suggested.ruleName })}</p>}
            </div>
            <button
              type="button"
              onClick={() => setManualOverride(!manualOverride)}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {manualOverride ? t("hideManualOverride") : t("showManualOverride")}
            </button>
            {manualOverride && (
              <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <label className="block text-xs font-medium">{t("manualAwardLabel")}</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  placeholder={t("awardPlaceholder")}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
            )}
            <button
              onClick={award}
              disabled={awarding || (!manualOverride && (!purchaseAmount || suggested.points <= 0)) || (manualOverride && !points)}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Gift className="w-4 h-4" /> {awarding ? tc("saving") : t("awardBtn")}
            </button>
          </div>

          <button onClick={reset} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm hover:bg-muted">
            <RefreshCw className="w-4 h-4" /> {t("nextMember")}
          </button>
        </MotionCard>
      )}
    </div>
  )
}
