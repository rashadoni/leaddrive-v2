import { defaultCache } from "@serwist/next/worker"
import { Serwist, NetworkOnly } from "serwist"
// Relative, not the `@/` alias: the service worker is compiled by serwist in a
// separate pass whose resolver does not necessarily carry the tsconfig paths.
import { isAuthStateDependentRequest } from "./lib/sw-network-only"

declare const self: any

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Serve /offline for any navigation request that fails (network down).
  // /offline is precached via additionalPrecacheEntries in next.config.ts so
  // it is always available from the precache even when fully offline.
  fallbacks: {
    entries: [
      {
        matcher({ request }: { request: Request }) {
          return request.destination === "document"
        },
        url: "/offline",
      },
    ],
  },
  runtimeCaching: [
    // Map resources — always fetch from network, never cache via SW. This
    // includes CARTO's vector style, TileJSON, MVT tiles, glyphs and sprites
    // as well as the raster fallback.
    {
      matcher: /^https:\/\/(?:(?:[a-z0-9-]+\.)?basemaps\.cartocdn\.com\/(?:rastertiles|vector|gl|fonts)\/|.*\.tile\.openstreetmap\.org\/.*\.png(?:\?.*)?$)/i,
      handler: new NetworkOnly(),
    },
    // Anything whose response depends on auth/tenant state — ALWAYS from the
    // network. This covers document navigations (so a new deploy is picked up
    // immediately instead of serving a cached HTML doc whose stale asset hashes
    // pull the OLD css/js bundle), the App Router's RSC fetches, and same-origin
    // /api traffic. See src/lib/sw-network-only.ts for why each one is here;
    // the RSC case is what made a successful login bounce back to /login.
    // A network failure still falls back to /offline via `fallbacks` above.
    {
      matcher: ({ request, url }: { request: Request; url: URL }) =>
        isAuthStateDependentRequest(request, url, self.location.origin),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()

// ─── Web Push (§4 option C) ───
// Fires even when the browser window/tab is closed, as long as the OS is online.
self.addEventListener("push", (event: any) => {
  let data: any = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    try { data = { title: "LeadDrive", body: event.data?.text?.() || "New activity" } } catch {}
  }
  const title = data.title || "LeadDrive"
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    tag: data.tag || "ld-push",
    data: { url: data.url || "/" },
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event: any) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows: any[]) => {
      for (const c of windows) {
        try {
          const u = new URL(c.url)
          if (u.pathname === targetUrl || u.pathname.startsWith(targetUrl)) {
            return c.focus()
          }
        } catch {}
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
