import * as Sentry from "@sentry/nextjs"
import { minimizeSentryEnvelope, privateSentryOptions } from "./src/lib/telemetry/sentry-privacy"

function isPrivateDemoHref(href?: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return new URL(href || window.location.href, window.location.origin).pathname.startsWith("/demo-access/")
  } catch {
    return false
  }
}

const client = Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
  ...privateSentryOptions,
  integrations: [
    Sentry.browserTracingIntegration(),
    // Replay is disabled until its separate payload contract is privacy-reviewed.
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
})
client?.on("beforeEnvelope", minimizeSentryEnvelope)

export function onRouterTransitionStart(href: string, navigationType: string) {
  if (isPrivateDemoHref(href)) {
    // A demo URL is a bearer credential. Stop without forceFlush so any
    // buffered replay is destroyed before the private route renders.
    void Sentry.getReplay()?.stop()
  }
  Sentry.captureRouterTransitionStart(href, navigationType)
}
