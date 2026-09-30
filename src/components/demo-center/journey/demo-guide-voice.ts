"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"

/**
 * The talking guide's player: one audio element for the whole demo.
 *
 * Off until the prospect turns it on — a browser plays sound only after a
 * click, and the click on «Bələdçini səsləndir» is that click (the first
 * recording starts inside it). One element is reused for every recording, so
 * a phone that unlocked it once keeps playing the next step's narration
 * without asking again. A new recording always cuts the previous one: the
 * guide never talks over itself.
 *
 * The choice is remembered in this browser only; storage that throws (a
 * private window) simply means it starts off again.
 *
 * The switch sits in two places — the coach card and the guide panel — and
 * both drive this one module-level element, so there is never a second voice.
 */
const PREF_KEY = "ld_demo_guide_voice"

// The last choice, kept in memory too: where storage throws, the switch still
// works for the page's lifetime.
let remembered = false
const listeners = new Set<() => void>()

// One element for the page, whichever switch started it; paused when the
// last component using it goes away.
let sharedAudio: HTMLAudioElement | null = null
let users = 0

function readPref(): boolean {
  try {
    const stored = window.localStorage.getItem(PREF_KEY)
    return stored === null ? remembered : stored === "on"
  } catch {
    return remembered
  }
}

function writePref(on: boolean) {
  remembered = on
  try {
    window.localStorage.setItem(PREF_KEY, on ? "on" : "off")
  } catch {
    // Remembering across visits is a convenience, not a requirement.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface GuideVoice {
  readonly on: boolean
  /** Turns the voice on (playing `startWith` inside the click) or off. */
  readonly toggle: (startWith?: string | null) => void
  /** Plays a recording when the voice is on; a no-op otherwise. */
  readonly play: (url: string) => void
  readonly stop: () => void
}

export function useGuideVoice(): GuideVoice {
  // The server renders it off; the browser's remembered choice applies after hydration.
  const on = useSyncExternalStore(subscribe, readPref, () => false)

  const start = useCallback((url: string) => {
    if (!sharedAudio) sharedAudio = new Audio()
    sharedAudio.pause()
    sharedAudio.src = url
    // A missing recording or a blocked autoplay leaves the guide silent, never broken.
    void sharedAudio.play().catch(() => {})
  }, [])

  const stop = useCallback(() => {
    sharedAudio?.pause()
  }, [])

  const play = useCallback((url: string) => {
    if (readPref()) start(url)
  }, [start])

  const toggle = useCallback((startWith?: string | null) => {
    const next = !readPref()
    writePref(next)
    if (next && startWith) start(startWith)
    if (!next) stop()
  }, [start, stop])

  useEffect(() => {
    users += 1
    return () => {
      users -= 1
      if (users === 0) sharedAudio?.pause()
    }
  }, [])

  return { on, toggle, play, stop }
}
