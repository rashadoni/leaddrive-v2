import { NextResponse } from "next/server"
import { MtmMediaObjectLifecycleError } from "@/lib/mtm/media-object-lifecycle"
import { MtmMediaObjectStorageError } from "@/lib/mtm/media-object-storage"

function boundedRetryAfter(value: number | null, fallback: number): string {
  const candidate = value ?? fallback
  return String(Math.max(1, Math.min(300, Math.ceil(candidate))))
}

/** Map safe lifecycle errors without exposing a bucket, key or provider error. */
export function mtmMediaObjectUploadFailureResponse(error: unknown): NextResponse | null {
  if (error instanceof MtmMediaObjectLifecycleError) {
    return NextResponse.json(
      {
        error: "This media upload needs recovery. Keep the local file and retry from Sync Center.",
        code: error.code,
      },
      { status: 409 },
    )
  }
  if (!(error instanceof MtmMediaObjectStorageError)) return null
  if (error.code === "MTM_MEDIA_OBJECT_STORAGE_RATE_LIMITED") {
    return NextResponse.json(
      { error: "Media upload is busy. Please retry later.", code: error.code },
      { status: 429, headers: { "Retry-After": boundedRetryAfter(error.retryAfterSeconds, 30) } },
    )
  }
  if (error.code === "MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED") {
    return NextResponse.json(
      { error: "Media upload could not be verified. Keep the local file and use Sync Center recovery.", code: error.code },
      { status: 409 },
    )
  }
  return NextResponse.json(
    { error: "Media storage is temporarily unavailable. Keep the local file and retry.", code: error.code },
    { status: 503, headers: { "Retry-After": boundedRetryAfter(error.retryAfterSeconds, error.code.endsWith("CONFIG_INVALID") ? 60 : 5) } },
  )
}

/** A committed object never falls back to legacy disk when this response is returned. */
export function mtmMediaObjectReadFailureResponse(error: unknown): NextResponse | null {
  if (error instanceof MtmMediaObjectLifecycleError || (error instanceof MtmMediaObjectStorageError && error.code === "MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")) {
    return NextResponse.json(
      { error: "Media file is unavailable", code: "MTM_MEDIA_OBJECT_RECOVERY_REQUIRED" },
      { status: 410 },
    )
  }
  if (!(error instanceof MtmMediaObjectStorageError)) return null
  if (error.code === "MTM_MEDIA_OBJECT_STORAGE_RATE_LIMITED") {
    return NextResponse.json(
      { error: "Media download is busy. Please retry later.", code: error.code },
      { status: 429, headers: { "Retry-After": boundedRetryAfter(error.retryAfterSeconds, 30) } },
    )
  }
  return NextResponse.json(
    { error: "Media storage is temporarily unavailable. Please retry.", code: error.code },
    { status: 503, headers: { "Retry-After": boundedRetryAfter(error.retryAfterSeconds, error.code.endsWith("CONFIG_INVALID") ? 60 : 5) } },
  )
}
