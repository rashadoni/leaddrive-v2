"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { mtmApiErrorIsSpecific, mtmApiErrorKey } from "@/lib/mtm/api-error-message"

/**
 * Localized explanation for an MTM API refusal. Pass the parsed JSON body and,
 * when known, the HTTP status: `explain(body, response.status)`.
 */
export function useMtmApiError() {
  const t = useTranslations("mtmApiErrors")
  return useCallback((body: unknown, status?: number | null) => t(mtmApiErrorKey(body, status)), [t])
}

/** A specific localized explanation, or `fallback` when the refusal has none. */
export function explainMtmApiErrorOr(
  explain: (body: unknown, status?: number | null) => string,
  body: unknown,
  status: number,
  fallback: string,
): string {
  return mtmApiErrorIsSpecific(body, status) ? explain(body, status) : fallback
}
