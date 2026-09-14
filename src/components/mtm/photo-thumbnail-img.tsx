"use client"

import { useEffect, useState, type ImgHTMLAttributes } from "react"
import { mtmPhotoRetryUrl } from "@/lib/mtm/photo-thumbnail-url"

export const MTM_PHOTO_RETRY_DELAY_MS = 1500

/**
 * A field photo tile that survives one transient failure. The thumbnail proxy
 * answers 503/429 when its render queue or download budget is full; `<img>`
 * cannot see the status, so the first error retries once after a short delay
 * and only a second error is reported (e.g. as "file missing").
 */
export function PhotoThumbnailImg({ src, onFinalError, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string
  onFinalError?: () => void
}) {
  const [attempt, setAttempt] = useState<0 | 1 | "waiting">(0)

  useEffect(() => {
    setAttempt(0)
  }, [src])

  useEffect(() => {
    if (attempt !== "waiting") return
    const timer = setTimeout(() => setAttempt(1), MTM_PHOTO_RETRY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [attempt])

  return (
    <img
      {...props}
      alt={props.alt ?? ""}
      src={attempt === 1 ? mtmPhotoRetryUrl(src) : src}
      onError={() => {
        if (attempt === 0) setAttempt("waiting")
        else if (attempt === 1) onFinalError?.()
      }}
    />
  )
}
