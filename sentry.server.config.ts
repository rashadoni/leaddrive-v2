import * as Sentry from "@sentry/nextjs"
import { scrubDemoTokens } from "./src/lib/demo-center/telemetry"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Capture 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Disable debug in production
  debug: false,
  beforeSend: scrubDemoTokens,
  beforeSendTransaction: scrubDemoTokens,
})
