"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"

/**
 * The talking guide's player: one audio element for the whole demo.
 *
 * On from the start (owner, 2026-10-18: «как открывается демо, сразу гид
 * с ним говорил»). The prospect reaches the player by a click — «Təsdiqlə
 * və demonu aç», a module card — and a page that was clicked may play sound,
 * so the first step speaks at once. Where the browser still refuses (the
 * page was reloaded, nothing clicked yet), the refusal is not swallowed: the
 * switch turns into «Bələdçini dinləyin», and that click starts the voice.
 * Turning it off is remembered in this browser only.
 *
 * One element is reused for every recording, so a phone that unlocked it
 * once keeps playing the next step's narration without asking again. A new
 * recording always cuts the previous one: the guide never talks over itself.
 *
 * The switch sits in two places — the coach card and the guide panel — and
 * both drive this one module-level element, so there is never a second voice.
 */
const PREF_KEY = "ld_demo_guide_voice"

/**
 * Recordings play this much faster than they were recorded. At 1.0 the owner
 * found the guide «очень медленно разговаривает» (2026-10-18); the pitch is
 * kept, so it sounds like a brisker speaker, not a sped-up tape.
 */
export const DEMO_GUIDE_VOICE_RATE = 1.25

// The last choice, kept in memory too: where storage throws, the switch still
// works for the page's lifetime.
let remembered = true
// The browser refused to start the last recording without a click.
let blocked = false
let lastUrl: string | null = null
// A spoken Da Vinci answer arrives as a file, not a path (assistant/voice):
// its address lives until the next recording replaces it.
let blobUrl: string | null = null
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

function notify() {
  for (const listener of listeners) listener()
}

function setBlocked(next: boolean) {
  if (blocked === next) return
  blocked = next
  notify()
}

function readBlocked(): boolean {
  return blocked
}

function writePref(on: boolean) {
  remembered = on
  try {
    window.localStorage.setItem(PREF_KEY, on ? "on" : "off")
  } catch {
    // Remembering across visits is a convenience, not a requirement.
  }
  if (!on) blocked = false
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface GuideVoice {
  readonly on: boolean
  /** On, but the browser would not start it without a click: show the button that does. */
  readonly blocked: boolean
  /** The click the browser asked for: plays what the guide was about to say. */
  readonly unblock: () => void
  /** Turns the voice on (playing `startWith` inside the click) or off. */
  readonly toggle: (startWith?: string | null) => void
  /** Plays a recording when the voice is on; a no-op otherwise. */
  readonly play: (url: string) => void
  /** Plays audio the server just made (a spoken answer) through the same element, when the voice is on. */
  readonly playBlob: (audio: Blob) => void
  readonly stop: () => void
}

export function useGuideVoice(): GuideVoice {
  // The server renders it off; the browser's remembered choice applies after hydration.
  const on = useSyncExternalStore(subscribe, readPref, () => false)
  const isBlocked = useSyncExternalStore(subscribe, readBlocked, () => false)

  const start = useCallback((url: string) => {
    if (!sharedAudio) sharedAudio = new Audio()
    const audio = sharedAudio
    audio.pause()
    if (blobUrl && blobUrl !== url) {
      URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
    lastUrl = url
    audio.src = url
    // Loading a source resets the rate to the default one, so both are set.
    audio.defaultPlaybackRate = DEMO_GUIDE_VOICE_RATE
    audio.playbackRate = DEMO_GUIDE_VOICE_RATE
    audio.preservesPitch = true
    // A missing recording leaves the guide silent, never broken; a refused
    // start is shown, because a guide that is «on» and says nothing reads as
    // a demo without a voice.
    void Promise.resolve(audio.play())
      .then(() => setBlocked(false))
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "NotAllowedError") setBlocked(true)
      })
  }, [])

  const unblock = useCallback(() => {
    if (lastUrl) start(lastUrl)
  }, [start])

  const stop = useCallback(() => {
    sharedAudio?.pause()
  }, [])

  const play = useCallback((url: string) => {
    if (readPref()) start(url)
  }, [start])

  const playBlob = useCallback((audio: Blob) => {
    if (!readPref()) return
    const url = URL.createObjectURL(audio)
    start(url)
    blobUrl = url
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
      if (users === 0) {
        // The demo is gone: let the element go with it, and the refusal too.
        sharedAudio?.pause()
        sharedAudio = null
        blocked = false
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        blobUrl = null
      }
    }
  }, [])

  return { on, blocked: on && isBlocked, unblock, toggle, play, playBlob, stop }
}
