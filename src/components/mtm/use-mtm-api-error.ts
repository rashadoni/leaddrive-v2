"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { mtmApiErrorKey } from "@/lib/mtm/api-error-message"

/**
 * Localized explanation for an MTM API refusal. Pass the parsed JSON body and,
 * when known, the HTTP status: `explain(body, response.status)`.
 */
export function useMtmApiError() {
  const t = useTranslations("mtmApiErrors")
  return useCallback((body: unknown, status?: number | null) => t(mtmApiErrorKey(body, status)), [t])
}
