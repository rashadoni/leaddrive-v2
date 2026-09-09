"use client"

/**
 * CLM Slice 2b — Public e-sign portal page.
 *
 * Route: /sign/[token]
 * Outside the (dashboard) group — no sidebar, no app chrome, no auth redirect.
 * The HMAC token in the URL IS the only authentication; the server re-verifies
 * it on every API call.
 *
 * Features:
 *   - Loads the contract via GET /api/v1/sign/[token]
 *   - Displays contract body (read-only, scrollable)
 *   - Two signature capture modes: typed (cursive CSS) + drawn (canvas)
 *   - Sign + Decline actions
 *   - Terminal state screens (already signed / declined / expired / invalid)
 *   - i18n via next-intl (en/ru/az, no dashboard deps)
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignerData {
  fullName: string
  email: string
  status: string
}

interface EnvelopeData {
  subject: string
  message: string | null
  status: string
  expiresAt: string | null
}

interface ContractData {
  title: string
  contractNumber: string
  renderedBody: string | null
}

type PortalState =
  | { phase: "loading" }
  | { phase: "error"; code: number; message: string }
  | { phase: "ready"; signer: SignerData; envelope: EnvelopeData; contract: ContractData; canSignNow: boolean }
  | { phase: "signed" }
  | { phase: "declined" }

type SignMode = "typed" | "drawn"

// ─── Canvas signature component ───────────────────────────────────────────────

function DrawCanvas({
  onPathChange,
}: {
  onPathChange: (svgPath: string, width: number, height: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const pathPoints = useRef<Array<{ x: number; y: number; type: "M" | "L" }>>([])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    if ("touches" in e) {
      const touch = e.touches[0]
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const buildSvgPath = () => {
    if (pathPoints.current.length === 0) return ""
    return pathPoints.current
      .map((p) => `${p.type}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ")
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    isDrawing.current = true
    const pos = getPos(e, canvas)
    pathPoints.current.push({ ...pos, type: "M" })
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const pos = getPos(e, canvas)
    pathPoints.current.push({ ...pos, type: "L" })
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = "#1a1a2e"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.stroke()
  }

  const endDraw = () => {
    if (!isDrawing.current) return
    isDrawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    const svgPath = buildSvgPath()
    if (svgPath) {
      onPathChange(svgPath, canvas.width, canvas.height)
    }
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    pathPoints.current = []
    onPathChange("", canvas.width, canvas.height)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        className="w-full border border-zinc-300 rounded-lg bg-white touch-none cursor-crosshair"
        style={{ touchAction: "none" }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <button
        type="button"
        onClick={clearCanvas}
        className="text-sm text-zinc-500 hover:text-zinc-800 underline"
      >
        Clear
      </button>
    </div>
  )
}

// ─── Decline dialog ───────────────────────────────────────────────────────────

function DeclineDialog({
  t,
  onConfirm,
  onCancel,
  loading,
}: {
  t: ReturnType<typeof useTranslations>
  onConfirm: (reason: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [reason, setReason] = useState("")

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-lg font-semibold text-zinc-900">{t("declineDialogTitle")}</h3>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            {t("declineReasonLabel")}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("declineReasonPlaceholder")}
            rows={3}
            maxLength={500}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
          >
            {t("declineCancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "…" : t("declineConfirm")}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SignPortalPage() {
  const params = useParams()
  const rawToken = params.token as string
  const t = useTranslations("signPortal")

  const [state, setState] = useState<PortalState>({ phase: "loading" })
  const [signMode, setSignMode] = useState<SignMode>("typed")
  const [typedName, setTypedName] = useState("")
  const [drawnPath, setDrawnPath] = useState("")
  const [drawnSize, setDrawnSize] = useState({ width: 600, height: 180 })
  const [signing, setSigning] = useState(false)
  const [decliningOpen, setDecliningOpen] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  // Load on mount
  useEffect(() => {
    if (!rawToken) return
    setState({ phase: "loading" })

    fetch(`/api/v1/sign/${encodeURIComponent(rawToken)}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          setState({ phase: "error", code: res.status, message: json.error ?? "Error" })
          return
        }
        const { signer, envelope, contract, canSignNow } = json.data
        setState({ phase: "ready", signer, envelope, contract, canSignNow: canSignNow !== false })
        setTypedName(signer.fullName ?? "")
      })
      .catch(() => {
        setState({ phase: "error", code: 0, message: "Network error" })
      })
  }, [rawToken])

  const handleDrawChange = useCallback(
    (svgPath: string, width: number, height: number) => {
      setDrawnPath(svgPath)
      setDrawnSize({ width, height })
    },
    []
  )

  const handleSign = async () => {
    if (signing) return
    setSignError(null)

    let method: string
    let payload: Record<string, unknown>

    if (signMode === "typed") {
      if (!typedName.trim()) {
        setSignError("Please type your full name to sign.")
        return
      }
      method = "typed"
      payload = { typedName: typedName.trim(), font: "dancing-script" }
    } else {
      if (!drawnPath) {
        setSignError("Please draw your signature.")
        return
      }
      method = "drawn"
      payload = { svgPath: drawnPath, widthPx: drawnSize.width, heightPx: drawnSize.height }
    }

    setSigning(true)
    try {
      const res = await fetch(`/api/v1/sign/${encodeURIComponent(rawToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, payload }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSignError(json.error ?? "Failed to sign. Please try again.")
        return
      }
      setState({ phase: "signed" })
    } catch {
      setSignError("Network error. Please try again.")
    } finally {
      setSigning(false)
    }
  }

  const handleDeclineConfirm = async (reason: string) => {
    if (declining) return
    setDeclining(true)
    try {
      const res = await fetch(`/api/v1/sign/${encodeURIComponent(rawToken)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      })
      const json = await res.json()
      if (!res.ok) {
        setDecliningOpen(false)
        setSignError(json.error ?? "Failed to decline. Please try again.")
        return
      }
      setState({ phase: "declined" })
    } catch {
      setSignError("Network error. Please try again.")
    } finally {
      setDeclining(false)
      setDecliningOpen(false)
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (state.phase === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-zinc-500">{t("loading")}</p>
        </div>
      </div>
    )
  }

  if (state.phase === "error") {
    let msg: string
    if (state.code === 410) msg = t("errorExpired")
    else if (state.code === 409) {
      // already signed or declined
      msg = state.message.includes("signed") ? t("errorAlreadySigned") : t("errorAlreadyDeclined")
    } else {
      msg = t("errorInvalidToken")
    }

    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-zinc-200 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-zinc-700 text-base">{msg}</p>
        </div>
      </div>
    )
  }

  if (state.phase === "signed") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-zinc-200 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-900">{t("successTitle")}</h2>
          <p className="text-zinc-600 text-sm">{t("successMessage")}</p>
        </div>
      </div>
    )
  }

  if (state.phase === "declined") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-zinc-200 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-900">{t("declinedTitle")}</h2>
          <p className="text-zinc-600 text-sm">{t("declinedMessage")}</p>
        </div>
      </div>
    )
  }

  // phase === "ready"
  const { signer, envelope, contract, canSignNow } = state

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="font-semibold text-zinc-800 text-sm">{t("documentTitle")}</span>
          </div>
          <div className="text-sm text-zinc-500">
            <span className="font-medium text-zinc-700">{t("signedBy")}:</span>{" "}
            {signer.fullName}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Envelope info */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-4 space-y-1">
          <p className="font-semibold text-indigo-900 text-base">{envelope.subject}</p>
          {envelope.message && (
            <p className="text-indigo-700 text-sm">{envelope.message}</p>
          )}
          <p className="text-xs text-indigo-500 font-medium uppercase tracking-wide mt-1">
            #{contract.contractNumber} — {contract.title}
          </p>
        </div>

        {/* Contract body */}
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-zinc-100 px-5 py-3">
            <h2 className="text-sm font-medium text-zinc-700">{contract.title}</h2>
          </div>
          <div className="px-6 py-6 max-h-[480px] overflow-y-auto">
            {contract.renderedBody ? (
              <div
                className="prose prose-sm prose-zinc max-w-none text-zinc-800 leading-relaxed whitespace-pre-wrap"
                // renderedBody is org-internal rich text — safe to display as text
              >
                {contract.renderedBody}
              </div>
            ) : (
              <p className="text-zinc-400 italic text-sm">No document body available.</p>
            )}
          </div>
        </div>

        {/* Waiting for earlier signers */}
        {!canSignNow && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-amber-800 text-sm">{t("waitingForEarlierSigners")}</p>
              <p className="text-amber-700 text-sm mt-0.5">{t("waitingForEarlierSignersHint")}</p>
            </div>
          </div>
        )}

        {/* Signature capture */}
        {canSignNow && (
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6 space-y-5">
          <p className="text-sm text-zinc-600">{t("scrollToSign")}</p>

          {/* Mode tabs */}
          <div className="flex gap-1 bg-zinc-100 rounded-lg p-1 w-fit">
            {(["typed", "drawn"] as SignMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSignMode(mode)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  signMode === mode
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {mode === "typed" ? t("tabTyped") : t("tabDrawn")}
              </button>
            ))}
          </div>

          {/* Typed mode */}
          {signMode === "typed" && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-zinc-700">
                {t("typeNameLabel")}
              </label>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={t("typeNamePlaceholder")}
                maxLength={200}
                className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {typedName.trim() && (
                <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50">
                  <p
                    className="text-3xl text-zinc-800"
                    style={{ fontFamily: "'Dancing Script', cursive" }}
                  >
                    {typedName}
                  </p>
                </div>
              )}
              <p className="text-xs text-zinc-400">{t("typeNameHint")}</p>
            </div>
          )}

          {/* Drawn mode */}
          {signMode === "drawn" && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">{t("drawCanvasHint")}</p>
              <DrawCanvas onPathChange={handleDrawChange} />
            </div>
          )}

          {/* Error */}
          {signError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {signError}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSign}
              disabled={signing}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signing ? t("signingInProgress") : t("signButton")}
            </button>
            <button
              type="button"
              onClick={() => setDecliningOpen(true)}
              disabled={signing || declining}
              className="px-5 py-2.5 rounded-lg border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
            >
              {t("declineButton")}
            </button>
          </div>
        </div>
        )}
      </main>

      {/* Decline dialog */}
      {decliningOpen && (
        <DeclineDialog
          t={t}
          onConfirm={handleDeclineConfirm}
          onCancel={() => setDecliningOpen(false)}
          loading={declining}
        />
      )}

      {/* Google Font for typed signature */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;600&display=swap');
      `}</style>
    </div>
  )
}
