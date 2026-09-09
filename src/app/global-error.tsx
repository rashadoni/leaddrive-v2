"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect, useState } from "react"

import { crashPageCopy } from "@/lib/crash-page-locale"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  // This component replaces the root layout, so there is no locale provider to
  // ask — it crashed too (audit C3 tail). The cookie the language switcher
  // writes survives, and it is read once: re-reading on every render would
  // change the page under someone who is already looking at an error.
  const [copy] = useState(() =>
    crashPageCopy(
      typeof document === "undefined"
        ? { cookie: null, languages: null }
        : { cookie: document.cookie, languages: navigator?.languages },
    ),
  )

  return (
    // The server has no cookie here and the client does, so the two disagree by
    // design; suppressing the warning is the point, not a workaround.
    <html lang={copy.locale} suppressHydrationWarning>
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>{copy.title}</h2>
          <button onClick={() => reset()} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  )
}
