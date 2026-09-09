"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { createPortal } from "react-dom"
import { Mic } from "lucide-react"
import { useTranslations } from "next-intl"

/**
 * Global voice orb — the assistant as a presence rather than a page.
 *
 * Mounted once in the dashboard layout so it follows the user across sections.
 * That raises two problems this component exists to solve.
 *
 * 1. WHO SEES IT. The layout is a client component and cannot run the
 *    server-only pilot gate, so access is asked for over a tiny endpoint. It is
 *    a visibility hint only — /session and /read re-check on every call, so
 *    faking the answer buys a button that fails on click.
 *
 *    The ask WAITS for the session. Fired on mount it races the cookie: the
 *    endpoint calls auth(), finds no user yet, and truthfully answers
 *    {allowed:false} — and since nothing retries, the orb stays hidden for the
 *    life of that page. The owner reported it as "other sections have the
 *    microphone, this one does not"; it was not the section but the load, and a
 *    heavy page (a task list of 1531 rows) loses the race more often than a
 *    light one. The dashboard layout already gates its children on the same
 *    condition for the same reason.
 *
 * 2. WHAT IT COSTS. Mounting WebRTC voice code on every dashboard route would
 *    put it in front of every page load. So until the first click this renders a
 *    plain button that imports nothing; the click arms it, the real console
 *    mounts and auto-starts. The user still presses once.
 */
const VoiceConsole = dynamic(() => import("./voice-console").then((m) => m.VoiceConsole), {
  ssr: false,
})

/**
 * Warm the console chunk and report whether it arrived.
 *
 * The failure this exists for is real and was hit in production: a deploy
 * replaces the built chunks while a tab still holds the old page from the
 * service worker cache. The click then asks for a file that no longer exists,
 * the dynamic import rejects, and `next/dynamic` renders nothing — no error, no
 * connection. From the outside the button simply does not work, which is the
 * worst possible failure for a control whose only feedback is that it lights up.
 */
async function loadConsole(): Promise<boolean> {
  try {
    await import("./voice-console")
    return true
  } catch {
    return false
  }
}

interface VoiceOrbProps {
  showFloatingLauncher?: boolean
  inlineLauncherAvailable?: boolean
}

export function VoiceOrb({
  showFloatingLauncher = true,
  inlineLauncherAvailable = false,
}: VoiceOrbProps) {
  const t = useTranslations("voice")
  const { status } = useSession()
  const [allowed, setAllowed] = useState(false)
  const [armed, setArmed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null)
  const [inlineHostVisible, setInlineHostVisible] = useState(false)

  useEffect(() => {
    if (status !== "authenticated") return
    let cancelled = false
    fetch("/api/v1/ai/voice/access", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { allowed: false }))
      .then((d) => {
        if (!cancelled) setAllowed(Boolean(d?.allowed))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    if (showFloatingLauncher || !inlineLauncherAvailable) {
      setInlineHost(null)
      return
    }
    setInlineHost(document.getElementById("dashboard-voice-assistant-slot"))
  }, [inlineLauncherAvailable, showFloatingLauncher])

  /**
   * The in-flow launcher only counts while it is on screen.
   *
   * On dense MTM surfaces the control lives inside the AI bar at the top of the
   * content, which is the right place for it — until the user scrolls. The bar
   * leaves the viewport, and with it the only way to start the assistant: the
   * owner reported it as "other sections have a microphone, this one does not",
   * looking at a task list scrolled a few rows down. Watching the host means the
   * floating orb comes back exactly when the in-flow one cannot be reached, and
   * stays out of the way of the sticky MTM controls whenever it can.
   */
  useEffect(() => {
    if (!inlineHost) {
      setInlineHostVisible(false)
      return
    }
    if (typeof IntersectionObserver === "undefined") {
      setInlineHostVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInlineHostVisible(entry?.isIntersecting === true),
      { threshold: 0 },
    )
    observer.observe(inlineHost)
    return () => observer.disconnect()
  }, [inlineHost])

  if (!allowed) return null
  const inlineReachable = Boolean(inlineHost) && inlineHostVisible
  const floating = showFloatingLauncher || !inlineReachable
  const activeInlineHost = floating ? null : inlineHost
  // Keep the console component mounted across navigation so an active media
  // session is not torn down. Only its control moves from a floating overlay
  // into the in-flow AI bar on dense MTM work surfaces.
  if (armed) {
    return (
      <VoiceConsole
        variant="orb"
        autoStart
        showFloatingOrb={floating}
        orbPortalTarget={activeInlineHost}
      />
    )
  }
  // Nothing to render only when a host was expected, exists, and is on screen
  // while something else owns it — otherwise one of the two placements applies.
  if (!floating && !activeInlineHost) return null

  // Pre-arm placeholder. Matches the console's idle orb exactly so the click
  // does not visibly swap one control for another.
  const launcher = (
    <div className={activeInlineHost
      ? "relative flex shrink-0 flex-col items-center"
      : "fixed bottom-24 right-6 z-50 flex flex-col items-center gap-2"}
    >
      <button
        type="button"
        onClick={() => {
          setLoadFailed(false)
          void loadConsole().then((ok) => (ok ? setArmed(true) : setLoadFailed(true)))
        }}
        data-testid="voice-assistant-launcher"
        data-placement={activeInlineHost ? "inline" : "floating"}
        aria-label={loadFailed ? t("staleBuild") : t("start")}
        title={loadFailed ? t("staleBuild") : t("start")}
        className={`relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeInlineHost ? "h-11 w-11" : "h-14 w-14"}`}
      >
        <span className={`relative flex items-center justify-center rounded-full text-white shadow-lg shadow-black/20 animate-[pulse_3s_ease-in-out_infinite] ${loadFailed ? "bg-destructive" : "bg-muted-foreground/70"} ${activeInlineHost ? "h-11 w-11" : "h-14 w-14"}`}>
          <Mic className="h-5 w-5" />
        </span>
      </button>

      {loadFailed && (
        <span
          className={activeInlineHost
            ? "absolute right-0 top-full z-20 mt-2 w-52 rounded-md bg-destructive px-2 py-1 text-center text-[11px] leading-tight text-destructive-foreground shadow-sm"
            : "max-w-[13rem] rounded-md bg-destructive px-2 py-1 text-center text-[11px] leading-tight text-destructive-foreground shadow-sm"}
          aria-live="polite"
        >
          {t("staleBuild")}
        </span>
      )}
    </div>
  )

  return activeInlineHost ? createPortal(launcher, activeInlineHost) : launcher
}
