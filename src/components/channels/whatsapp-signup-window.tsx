"use client"

import { useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { runEmbeddedSignupDialog } from "@/components/channels/whatsapp-embedded-signup"
import { WHATSAPP_SIGNUP_RELAY_TYPE } from "@/lib/whatsapp-signup-window"

/**
 * The app-host half of WhatsApp Embedded Signup for tenant hosts (lib/whatsapp-signup-window).
 *
 * Meta's dialog needs a click inside THIS window — the tenant's click opened the window, and a browser
 * blocks a second popup opened without one — so the window shows a single button. The result goes to the
 * tab that opened it, at `returnOrigin` only (checked on the server before this renders), then the
 * window closes itself.
 */
export type WhatsAppSignupWindowLabels = {
  title: string
  description: string
  button: string
  working: string
  done: string
  cancelled: string
  failed: string
  notFromCatalog: string
  notConfigured: string
}

type Phase = "idle" | "working" | "done" | "cancelled" | "failed"

export function WhatsAppSignupWindow({
  config,
  returnOrigin,
  labels,
}: {
  config: { appId: string; configId: string } | null
  returnOrigin: string | null
  labels: WhatsAppSignupWindowLabels
}) {
  const [phase, setPhase] = useState<Phase>("idle")

  if (!config) return <Shell title={labels.title}><p className="text-sm text-muted-foreground">{labels.notConfigured}</p></Shell>
  if (!returnOrigin) return <Shell title={labels.title}><p className="text-sm text-muted-foreground">{labels.notFromCatalog}</p></Shell>

  const post = (message: Record<string, unknown>): boolean => {
    const opener = window.opener as Window | null
    if (!opener || opener.closed) return false
    opener.postMessage({ type: WHATSAPP_SIGNUP_RELAY_TYPE, ...message }, returnOrigin)
    return true
  }

  const start = () => {
    if (phase === "working") return
    if (!window.opener) {
      setPhase("failed")
      return
    }
    setPhase("working")
    void runEmbeddedSignupDialog(config).then((outcome) => {
      if (outcome.kind === "connected") {
        const delivered = post({ result: "connected", code: outcome.code, ...outcome.session })
        setPhase(delivered ? "done" : "failed")
        if (delivered) window.close()
      } else {
        post({ result: outcome.kind })
        setPhase(outcome.kind === "cancel" ? "cancelled" : "failed")
      }
    })
  }

  return (
    <Shell title={labels.title}>
      <p className="text-sm text-muted-foreground">{labels.description}</p>
      {phase === "done" ? (
        <p className="text-sm font-medium text-emerald-700">{labels.done}</p>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={phase === "working"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-70"
        >
          {phase === "working" && <Loader2 className="h-4 w-4 animate-spin" />}
          {phase === "working" ? labels.working : labels.button}
        </button>
      )}
      {phase === "cancelled" && <p className="text-sm text-red-700">{labels.cancelled}</p>}
      {phase === "failed" && <p className="text-sm text-red-700">{labels.failed}</p>}
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  )
}
