"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { FileText, Loader2, Play, X } from "lucide-react"

import { Button } from "@/components/ui/button"

type CallJournalRecord = {
  id: string
  transcription: string | null
  recordingPlaybackUrl: string | null
}

type CallJournalCandidate = {
  id?: unknown
  transcription?: unknown
  recordingPlaybackUrl?: unknown
}

export function CallJournalDetail() {
  const t = useTranslations("voip")
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const callId = searchParams.get("call")
  const [call, setCall] = useState<CallJournalRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    if (!callId) {
      setCall(null)
      setLoading(false)
      setLoadFailed(false)
      return
    }

    const controller = new AbortController()
    setCall(null)
    setLoading(true)
    setLoadFailed(false)

    void (async () => {
      try {
        const response = await fetch(`/api/v1/calls?id=${encodeURIComponent(callId)}&limit=1`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(String(response.status))

        const payload = await response.json() as { data?: CallJournalCandidate[] }
        const candidate = Array.isArray(payload.data) ? payload.data[0] : null
        // If the API ever regresses and ignores the id filter, do not turn its
        // newest visible row into the requested call. A deep-link either names
        // this exact record or shows unavailable.
        if (candidate?.id !== callId) {
          if (!controller.signal.aborted) setCall(null)
          return
        }

        const protectedRecordingPath = `/api/v1/calls/${encodeURIComponent(callId)}/recording`
        if (!controller.signal.aborted) {
          setCall({
            id: callId,
            transcription: typeof candidate.transcription === "string"
              ? candidate.transcription
              : null,
            // Accept only the same protected route the API derives. A raw
            // provider URL must never become a browser link, even if a future
            // server response is accidentally widened.
            recordingPlaybackUrl: candidate.recordingPlaybackUrl === protectedRecordingPath
              ? protectedRecordingPath
              : null,
          })
        }
      } catch (error) {
        if (!controller.signal.aborted && (error as { name?: unknown })?.name !== "AbortError") {
          setLoadFailed(true)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [callId, retryVersion])

  // Effects run after render. When the URL changes from call A to call B,
  // state can still contain A for that render even though the old request is
  // already guarded below. Never pair cached details with a different URL.
  const visibleCall = call?.id === callId ? call : null

  if (!callId) return null

  return (
    <section
      aria-labelledby="call-journal-detail-title"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/30">
            <FileText className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 id="call-journal-detail-title" className="text-base font-semibold">
            {t("journal.title")}
          </h2>
        </div>
        <Link
          href={pathname}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {t("journal.close")}
        </Link>
      </div>

      {loading || (call !== null && !visibleCall) ? (
        <div role="status" aria-live="polite" className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("journal.loading")}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{t("journal.loadError")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => setRetryVersion((value) => value + 1)}
          >
            {t("journal.retry")}
          </Button>
        </div>
      ) : !visibleCall ? (
        <p className="mt-4 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
          {t("journal.unavailable")}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.34fr)]">
          <div className="min-w-0 rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">{t("journal.transcript")}</h3>
            {visibleCall.transcription ? (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                {visibleCall.transcription}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("journal.transcriptUnavailable")}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">{t("journal.recording")}</h3>
            {visibleCall.recordingPlaybackUrl ? (
              <a
                href={visibleCall.recordingPlaybackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {t("journal.openRecording")}
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("journal.recordingUnavailable")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
