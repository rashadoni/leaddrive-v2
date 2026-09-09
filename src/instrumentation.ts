/**
 * Next.js instrumentation initializes observability only.
 *
 * Scheduled jobs are intentionally external to the web process. Production's
 * managed crontab calls the CRON_SECRET-protected endpoints, while PostgreSQL
 * SystemJobLease provides cross-process fencing and run telemetry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
import * as Sentry from "@sentry/nextjs"
