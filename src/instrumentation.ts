/**
 * Next.js instrumentation initializes observability only.
 *
 * Scheduled jobs are intentionally external to the web process. Production's
 * managed crontab calls the CRON_SECRET-protected endpoints, while PostgreSQL
 * SystemJobLease provides cross-process fencing and run telemetry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // `ws` reaches the server bundle through @google/genai, and it looks for an
    // optional native helper (`bufferutil`) with a try/require. webpack
    // resolves that require to an empty module instead of letting it throw, so
    // `ws` believes the helper is there and calls a function that is not:
    // every frame of 48 bytes or more died with "b.mask is not a function".
    // Found on production 2026-10-08 by the voice provider check, the first
    // server code to open a socket through the SDK. `ws` reads this
    // variable when its module is first evaluated - on the first request that
    // needs it, always after this hook - and then uses its own JavaScript
    // masking, which is all it ever had here: the helper is not installed.
    process.env.WS_NO_BUFFER_UTIL ??= "1"
    await import("../sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
import * as Sentry from "@sentry/nextjs"
