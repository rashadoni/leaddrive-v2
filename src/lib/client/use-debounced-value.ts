"use client"

import { useEffect, useState } from "react"

/** Pause after the last keystroke before a search goes to the server. */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * The value as it was once it stopped changing for `delayMs`.
 *
 * For search boxes whose text goes to the server (a fetch, or the address bar
 * via router.replace — which is a server round trip in the app router too):
 * the input stays bound to the live value, the request follows the debounced
 * one. Typing "Bakı" is one request instead of four, and a half-typed word
 * never overwrites the answer for the whole one.
 *
 * Clearing the box is not delayed: an empty value goes through at once, so
 * the full list comes back as soon as the field is emptied.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  const immediate = value === "" || value === null || value === undefined
  useEffect(() => {
    // An emptied box is returned as is below; the stored value catches up on
    // the next tick, so typing again starts from "" and not from the old word.
    const timer = setTimeout(() => setDebounced(value), immediate ? 0 : delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs, immediate])
  return immediate ? value : debounced
}
