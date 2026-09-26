"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { DEFAULT_CURRENCY } from "@/lib/currency"

/**
 * The currency new records start in for the signed-in organisation, from
 * GET /api/v1/organization/default-currency (src/lib/org-default-currency.ts).
 *
 * Not `DEFAULT_CURRENCY`: in the browser that constant is "USD" whatever the
 * server or the organisation says, because Next.js inlines NEXT_PUBLIC_* at
 * build time and the build never sets it.
 *
 * null until it has loaded. A form keeps its placeholder until then, and must
 * not overwrite a currency the user — or a picked deal — has already set.
 * Loaded once per organisation and page; a failed load is retried next mount.
 */
const pending = new Map<string, Promise<string | null>>()
const loaded = new Map<string, string>()

function load(orgKey: string): Promise<string | null> {
  let request = pending.get(orgKey)
  if (!request) {
    request = fetch("/api/v1/organization/default-currency")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const code = json?.data?.defaultCurrency
        if (typeof code === "string" && /^[A-Z]{3}$/.test(code)) {
          loaded.set(orgKey, code)
          return code
        }
        pending.delete(orgKey)
        return null
      })
      .catch(() => {
        pending.delete(orgKey)
        return null
      })
    pending.set(orgKey, request)
  }
  return request
}

export function useOrgDefaultCurrency(): string | null {
  const { data: session } = useSession()
  const orgKey = (session?.user as { organizationId?: string } | undefined)?.organizationId ?? ""
  const [code, setCode] = useState<string | null>(() => loaded.get(orgKey) ?? null)
  useEffect(() => {
    let alive = true
    setCode(loaded.get(orgKey) ?? null)
    void load(orgKey).then((value) => {
      if (alive && value) setCode(value)
    })
    return () => {
      alive = false
    }
  }, [orgKey])
  return code
}

/**
 * A form's currency field. Editing a record, it holds the record's own
 * currency; creating one, it takes the organisation's currency as soon as that
 * has loaded — unless the user or a picked deal already chose one, which is
 * never overwritten. `resetCurrency()` starts a new record (or loads one, given
 * its currency). `DEFAULT_CURRENCY` is only the placeholder for the first
 * moments before the answer arrives.
 */
export function useCurrencyField(recordCurrency?: string | null) {
  const orgCurrency = useOrgDefaultCurrency()
  const [currency, setValue] = useState<string>(() => recordCurrency || orgCurrency || DEFAULT_CURRENCY)
  const chosen = useRef(Boolean(recordCurrency))
  // Read by resetCurrency, which stays the same function for the component's
  // life so a form can call it from its own open/reset effect without that
  // effect re-running — and wiping what was typed — when the answer arrives.
  const latestOrgCurrency = useRef(orgCurrency)
  useEffect(() => {
    latestOrgCurrency.current = orgCurrency
    if (orgCurrency && !chosen.current) setValue(orgCurrency)
  }, [orgCurrency])
  const setCurrency = useCallback((code: string) => {
    chosen.current = true
    setValue(code)
  }, [])
  const resetCurrency = useCallback((code?: string | null) => {
    chosen.current = Boolean(code)
    setValue(code || latestOrgCurrency.current || DEFAULT_CURRENCY)
  }, [])
  return { currency, setCurrency, resetCurrency, orgCurrency }
}

/** Tests only: forget every cached answer. */
export function resetOrgDefaultCurrencyCache(): void {
  pending.clear()
  loaded.clear()
}
