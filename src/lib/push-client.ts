/**
 * Browser-side helpers: ask permission, register push subscription with the
 * service worker, POST the subscription to /api/v1/push/subscribe.
 *
 * Idempotent — calling registerPush() a second time on the same browser
 * upserts the existing endpoint, doesn't duplicate.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export async function registerPush(headers: Record<string, string> = {}): Promise<{ ok: boolean; error?: string }> {
  if (!(await isPushSupported())) return { ok: false, error: "unsupported" }
  if (Notification.permission === "denied") return { ok: false, error: "denied" }
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission)
    if (perm !== "granted") return { ok: false, error: "permission-declined" }
  }

  // Fetch the VAPID public key from the server
  const keyRes = await fetch("/api/v1/push/vapid-key", { headers })
  const keyJson = await keyRes.json().catch(() => null)
  if (!keyJson?.success) return { ok: false, error: "no-vapid-key" }

  // Make sure SW is registered and ready (Serwist auto-registers sw.js)
  const reg = await navigator.serviceWorker.ready

  // Subscribe (or re-use existing subscription)
  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyJson.data.publicKey) as unknown as BufferSource,
    })
  }

  const json = subscription.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "bad-subscription" }

  const res = await fetch("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ endpoint, keys: { p256dh, auth } }),
  })
  if (!res.ok) return { ok: false, error: `http-${res.status}` }

  return { ok: true }
}

export async function unregisterPush(headers: Record<string, string> = {}): Promise<void> {
  if (!(await isPushSupported())) return
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try {
    await fetch(`/api/v1/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
      method: "DELETE",
      headers,
    })
  } catch {}
  await sub.unsubscribe().catch(() => {})
}
