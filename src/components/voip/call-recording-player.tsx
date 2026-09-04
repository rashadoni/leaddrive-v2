"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type PlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error"

function durationLabel(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—"
  return `${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, "0")}`
}

export function CallRecordingPlayer({
  url,
  callDurationSeconds,
  callLabel,
}: {
  url: string | null
  callDurationSeconds: number | null
  callLabel: string
}) {
  const t = useTranslations("voip")
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlaybackState>("idle")
  const [mediaDuration, setMediaDuration] = useState<number | null>(null)

  if (!url) {
    return <span className="text-xs text-muted-foreground">{t("recordingUnavailable")}</span>
  }

  const retry = () => {
    const audio = audioRef.current
    if (!audio) return
    setState("loading")
    audio.load()
  }

  const status = state === "loading"
    ? t("recordingLoading")
    : state === "error"
      ? t("recordingError")
      : state === "playing"
        ? t("recordingPlaying")
        : state === "paused"
          ? t("recordingPaused")
          : state === "ended"
            ? t("recordingEnded")
            : t("recordingReady")

  return (
    <div className="min-w-[13rem] max-w-[18rem]">
      <audio
        ref={audioRef}
        controls
        preload="none"
        src={url}
        aria-label={t("recordingFor", { call: callLabel })}
        className="h-10 w-full max-w-full"
        onLoadStart={() => setState("loading")}
        onCanPlay={() => setState("ready")}
        onPlaying={() => setState("playing")}
        onPause={() => setState((current) => current === "ended" ? current : "paused")}
        onEnded={() => setState("ended")}
        onWaiting={() => setState("loading")}
        onError={() => setState("error")}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration
          setMediaDuration(Number.isFinite(duration) ? Math.round(duration) : null)
        }}
      />
      <div className="mt-1 flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span>{status} · {durationLabel(mediaDuration ?? callDurationSeconds)}</span>
        {state === "error" && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={retry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("retry")}
          </Button>
        )}
      </div>
    </div>
  )
}
