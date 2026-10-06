import * as Sentry from "@sentry/nextjs"
import { minimizeSentryEnvelope, privateSentryOptions } from "./src/lib/telemetry/sentry-privacy"

const client = Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Capture 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Disable debug in production
  debug: false,
  ...privateSentryOptions,
})
client?.on("beforeEnvelope", minimizeSentryEnvelope)
