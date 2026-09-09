"use client"

import { useEffect, useRef, useState } from "react"

interface UseCountUpOptions {
  end: number
  duration?: number // ms, default 1200
  delay?: number // ms before start, default 0
  decimals?: number // decimal places, default 0
}

export function useCountUp({ end, duration = 1200, delay = 0, decimals = 0 }: UseCountUpOptions): string {
  const [current, setCurrent] = useState(0)
  const startTime = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  // Last settled value: refetches animate from it (not from 0), so a stats
  // reload doesn't flash "0 → N" and read as data loss. Mount still counts up.
  const fromRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    // Unchanged value or prefers-reduced-motion: snap to the final value on the
    // next frame (async — avoids a synchronous setState inside the effect body).
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (end === from || reduceMotion) {
      const id = requestAnimationFrame(() => {
        setCurrent(end)
        fromRef.current = end
      })
      return () => cancelAnimationFrame(id)
    }

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp
        const elapsed = timestamp - startTime.current
        const progress = Math.min(elapsed / duration, 1)
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3)
        setCurrent(from + eased * (end - from))

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate)
        } else {
          setCurrent(end)
          fromRef.current = end
        }
      }

      startTime.current = null
      rafRef.current = requestAnimationFrame(animate)
    }, delay)

    return () => {
      clearTimeout(timeout)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [end, duration, delay])

  return decimals > 0
    ? current.toFixed(decimals)
    : Math.round(current).toLocaleString()
}
