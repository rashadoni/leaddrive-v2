"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

/**
 * "Connect WhatsApp with Meta" — Meta's Embedded Signup dialog (lib/whatsapp-embedded-signup).
 *
 * The browser part is only what has to happen in the browser: load Meta's SDK, open the dialog with
 * LeadDrive's Embedded Signup configuration, collect the code from FB.login and the account/number ids
 * from Meta's `WA_EMBEDDED_SIGNUP` message, and hand all three to the server inside the code's 30-second
 * lifetime. Renders nothing until the server says the feature is configured, so the manual credential
 * form below keeps working exactly as before on servers without it.
 */
export type WhatsAppEmbeddedSignupLabels = {
  title: string
  description: string
  button: string
  working: string
  connected: string
  paymentHint: string
  cancelled: string
  failed: string
}

type SdkLoginResponse = { authResponse?: { code?: string } | null }
type FacebookSdk = {
  init: (options: Record<string, unknown>) => void
  login: (callback: (response: SdkLoginResponse) => void, options: Record<string, unknown>) => void
}
type SignupSession = { wabaId: string; phoneNumberId: string; businessId: string | null }
export type WhatsAppEmbeddedSignupStatus =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "connected"; number: string }
  | { kind: "error"; message: string }

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js"

function loadSdk(appId: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB)
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error("Meta SDK did not start"))
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" })
      resolve(window.FB)
    }
    if (document.querySelector(`script[src="${SDK_SRC}"]`)) return
    const script = document.createElement("script")
    script.src = SDK_SRC
    script.async = true
    script.defer = true
    script.crossOrigin = "anonymous"
    script.onerror = () => reject(new Error("Meta SDK could not be loaded"))
    document.body.appendChild(script)
  })
}

/** Meta's session message, or null for anything else posted to the window. */
export function readSignupMessage(origin: string, raw: unknown): SignupSession | "cancel" | null {
  let host = ""
  try {
    host = new URL(origin).hostname
  } catch {
    return null
  }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null
  let data: unknown = raw
  if (typeof data === "string") {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== "object") return null
  const message = data as { type?: unknown; event?: unknown; data?: Record<string, unknown> }
  if (message.type !== "WA_EMBEDDED_SIGNUP") return null
  if (message.event === "CANCEL") return "cancel"
  const wabaId = String(message.data?.waba_id ?? "")
  const phoneNumberId = String(message.data?.phone_number_id ?? "")
  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) return null
  const businessId = message.data?.business_id ? String(message.data.business_id) : null
  return { wabaId, phoneNumberId, businessId }
}

/**
 * Meta's Embedded Signup as a hook, so any element can start it — the channel catalog's WhatsApp tile
 * is the button itself. `availability` is "unavailable" when the server has no Embedded Signup
 * configuration (WHATSAPP_EMBEDDED_SIGNUP_*): the caller then offers manual setup instead.
 */
export function useWhatsAppEmbeddedSignup({
  cancelledMessage,
  failedMessage,
  onConnected,
}: {
  cancelledMessage: string
  failedMessage: string
  onConnected?: (channelId: string, number: string) => void
}) {
  // undefined: still asking the server; null: not configured here.
  const [config, setConfig] = useState<{ appId: string; configId: string } | null | undefined>(undefined)
  const [status, setStatus] = useState<WhatsAppEmbeddedSignupStatus>({ kind: "idle" })
  const session = useRef<SignupSession | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/v1/channels/whatsapp/embedded-signup")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { configured?: boolean; appId?: string; configId?: string } | null) => {
        if (!alive) return
        setConfig(json?.configured && json.appId && json.configId ? { appId: json.appId, configId: json.configId } : null)
      })
      .catch(() => {
        if (alive) setConfig(null)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const result = readSignupMessage(event.origin, event.data)
      if (result === "cancel") setStatus({ kind: "error", message: cancelledMessage })
      else if (result) session.current = result
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [cancelledMessage])

  const finish = async (code: string) => {
    // Meta posts the session message around the same time as the login callback; give it a moment.
    for (let i = 0; i < 20 && !session.current; i += 1) await new Promise((r) => setTimeout(r, 250))
    const picked = session.current
    if (!picked) {
      setStatus({ kind: "error", message: failedMessage })
      return
    }
    try {
      const res = await fetch("/api/v1/channels/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ...picked }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; channelId?: string; displayPhoneNumber?: string | null; error?: string }
      if (!res.ok || !json.ok || !json.channelId) {
        setStatus({ kind: "error", message: json.error || failedMessage })
        return
      }
      const number = json.displayPhoneNumber || picked.phoneNumberId
      setStatus({ kind: "connected", number })
      onConnected?.(json.channelId, number)
    } catch {
      setStatus({ kind: "error", message: failedMessage })
    }
  }

  const start = async () => {
    if (!config || status.kind === "working") return
    session.current = null
    setStatus({ kind: "working" })
    try {
      const sdk = await loadSdk(config.appId)
      // The SDK requires a plain (non-async) callback.
      sdk.login(
        (response) => {
          const code = response?.authResponse?.code
          if (code) void finish(code)
          else setStatus({ kind: "error", message: cancelledMessage })
        },
        {
          config_id: config.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: "3" },
        },
      )
    } catch {
      setStatus({ kind: "error", message: failedMessage })
    }
  }

  const availability: "loading" | "ready" | "unavailable" = config === undefined ? "loading" : config ? "ready" : "unavailable"
  return { availability, status, start }
}

export function WhatsAppEmbeddedSignup({
  labels,
  onConnected,
  fallback = null,
}: {
  labels: WhatsAppEmbeddedSignupLabels
  onConnected?: (channelId: string) => void
  /** Shown instead once the server says Embedded Signup is not configured. */
  fallback?: ReactNode
}) {
  const { availability, status, start } = useWhatsAppEmbeddedSignup({
    cancelledMessage: labels.cancelled,
    failedMessage: labels.failed,
    onConnected: (channelId) => onConnected?.(channelId),
  })

  if (availability === "unavailable") return <>{fallback}</>
  if (availability === "loading") return null

  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="whatsapp-embedded-signup">
      <p className="text-xs font-medium text-emerald-900">{labels.title}</p>
      <p className="text-xs text-emerald-800">{labels.description}</p>
      {status.kind === "connected" ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-emerald-800">{labels.connected.replace("{number}", status.number)}</p>
          <p className="text-xs text-emerald-800">
            {labels.paymentHint}{" "}
            <a className="underline" href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer">
              WhatsApp Manager
            </a>
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={status.kind === "working"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-70"
        >
          {status.kind === "working" && <Loader2 className="h-4 w-4 animate-spin" />}
          {status.kind === "working" ? labels.working : labels.button}
        </button>
      )}
      {status.kind === "error" && <p className="text-xs text-red-700">{status.message}</p>}
    </div>
  )
}
