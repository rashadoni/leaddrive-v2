import * as Sentry from "@sentry/nextjs"
import { scrubDemoTokens } from "./src/lib/demo-center/telemetry"

function isPrivateDemoHref(href?: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return new URL(href || window.location.href, window.location.origin).pathname.startsWith("/demo-access/")
  } catch {
    return false
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
  beforeSend: scrubDemoTokens,
  beforeSendTransaction: scrubDemoTokens,
  integrations: [
    Sentry.browserTracingIntegration(),
    ...(!isPrivateDemoHref() ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })] : []),
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
})

export function onRouterTransitionStart(href: string, navigationType: string) {
  if (isPrivateDemoHref(href)) {
    // A demo URL is a bearer credential. Stop without forceFlush so any
    // buffered replay is destroyed before the private route renders.
    void Sentry.getReplay()?.stop()
  }
  Sentry.captureRouterTransitionStart(href, navigationType)
}
