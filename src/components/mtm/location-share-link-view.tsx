"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { formatTime } from "@/lib/format-date"
import { getOffsetMinutes, timezoneOffsetLabel } from "@/lib/timezone"
import {
  LOCATION_SHARE_LINK_MAX_AGE_SECONDS,
  isLocationShareLinkEndOfDay,
  isLocationShareLinkToken,
  locationShareLinkTimezone,
} from "@/lib/mtm/location-share-link"

/** While the map's own code is still on its way: words in its place, not an empty grey box. */
function MapLoading() {
  const t = useTranslations("mtmLocationShareLink")
  return (
    <p role="status" className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground" data-testid="location-share-link-map-loading">
      {t("loading")}
    </p>
  )
}

const LocationShareLinkMap = dynamic(() => import("./location-share-link-map"), { ssr: false, loading: () => <MapLoading /> })

/** An open page asks twice a minute, while somebody is looking at it. */
const POLL_INTERVAL_MS = 30_000
/**
 * A question that has had no answer for this long has none. A phone on a poor
 * connection does not fail a request, it hangs it — for minutes — and the page
 * would otherwise stand there saying nothing while asking nothing.
 */
const REQUEST_DEADLINE_MS = 15_000
/** After «too many requests» nothing is asked for at least this long, whatever the answer says. */
const RATE_LIMIT_WAIT_MS = 60_000
/** …and for no longer than this, whatever it says: a wild number must not silence the page for good. */
const RATE_LIMIT_WAIT_MAX_MS = 10 * 60_000
/**
 * The server never hands over a point older than this. The page holds itself
 * to the same: a point it has kept while its questions went unanswered stops
 * being shown as «сейчас» at the same age.
 */
const POSITION_MAX_AGE_MS = LOCATION_SHARE_LINK_MAX_AGE_SECONDS * 1_000

/** A moment on the visitor's device, read off both of its clocks at once. */
interface Stamp {
  /** The steady clock: never jumps, and stands still while a phone sleeps. */
  mono: number
  /** The clock on the wall: goes on through sleep, and can be set to anything. */
  wall: number
}

const stamp = (): Stamp => ({ mono: performance.now(), wall: Date.now() })

/**
 * How long ago a stamp was taken: the larger of what the two clocks say.
 *
 * The steady clock alone is not enough on a phone: locked for an hour, it has
 * counted a few seconds, and the page would wake up calling an hour-old point
 * «3 минуты назад» and not ask, having «just asked». The wall clock covers
 * the sleep. Set back, it is outvoted by the steady one; set forward, it only
 * makes the page hide a point sooner and ask the server sooner — it cannot
 * end the page (see `tick`).
 */
const elapsedSince = (taken: Stamp): number => Math.max(0, performance.now() - taken.mono, Date.now() - taken.wall)

/** What the page shows of an answer — each field read by name, nothing carried along. */
interface Shown {
  name: string
  organizationName: string
  expiresAtMs: number
  /** The organization's zone: every time on the page is printed in it. */
  timezone: string
  /** The server's clock when it answered; the page counts time from here, not from the phone's own clock. */
  generatedAtMs: number
  /** Where the employee is — only when the answer had a position to show. */
  position: { latitude: number; longitude: number; recordedAtMs: number } | null
}

interface Snapshot extends Shown {
  /** The moment the answer arrived, on the visitor's device. */
  receivedAt: Stamp
}

/** The page's clock: the server's moment in the answer it holds, plus the time that has passed here since. */
const pageNow = (held: Snapshot): number => held.generatedAtMs + elapsedSince(held.receivedAt)

const moment = (value: unknown): number | null => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}
const within = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit

/**
 * The two answers that have something to show, or null for anything else.
 * An answer that says «here he is» without a point that can be drawn is not
 * an answer: the marker is never put where the page had to guess.
 */
function readAnswer(body: unknown): Shown | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const { success, state, data } = body as Record<string, unknown>
  if (success !== true || (state !== "AVAILABLE" && state !== "UNAVAILABLE")) return null
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const row = data as Record<string, unknown>
  const expiresAtMs = moment(row.expiresAt)
  const generatedAtMs = moment(row.generatedAt)
  if (typeof row.name !== "string" || typeof row.organizationName !== "string" || expiresAtMs == null || generatedAtMs == null) return null
  const shown = {
    name: row.name.trim(),
    organizationName: row.organizationName.trim(),
    expiresAtMs,
    timezone: locationShareLinkTimezone(row.timezone),
    generatedAtMs,
  }
  if (state === "UNAVAILABLE") return { ...shown, position: null }
  const recordedAtMs = moment(row.recordedAt)
  if (!within(row.latitude, 90) || !within(row.longitude, 180) || recordedAtMs == null) return null
  return { ...shown, position: { latitude: row.latitude, longitude: row.longitude, recordedAtMs } }
}

/** How long to stay silent after a 429: what the answer asks for, held between a minute and ten. */
function rateLimitWaitMs(response: Response, body: Record<string, unknown> | null): number {
  const asked = Number(body?.retryAfterSeconds ?? response.headers.get("Retry-After"))
  const ms = Number.isFinite(asked) ? asked * 1_000 : 0
  return Math.min(RATE_LIMIT_WAIT_MAX_MS, Math.max(RATE_LIMIT_WAIT_MS, ms))
}

/** How long ago, in the units the page has words for. */
function ago(recordedAtMs: number, nowMs: number): { unit: "justNow" } | { unit: "minutes" | "hours"; count: number } {
  const minutes = Math.floor(Math.max(0, nowMs - recordedAtMs) / 60_000)
  if (minutes < 1) return { unit: "justNow" }
  if (minutes < 60) return { unit: "minutes", count: minutes }
  return { unit: "hours", count: Math.floor(minutes / 60) }
}

/**
 * The page behind a «ссылка на местоположение»: what somebody with the link
 * and no account sees. A name, the organization, a map with where that one
 * employee is now, when the coordinate was recorded and until when the link
 * works — and nothing else, because the page is given nothing else.
 *
 * Three things it can say, in plain words:
 *   - the map, «Координата записана в 14:05 · 3 минуты назад», «Ссылка
 *     действует до 18:00»;
 *   - «Сейчас местоположение недоступно» — the link works and there is
 *     nothing to show. Why is not said: the server does not tell, on purpose;
 *   - «Ссылка больше не работает» — and from then on the server is never
 *     asked again.
 *
 * It asks twice a minute while it is being looked at, not at all in a hidden
 * tab, and after «too many requests» waits a minute instead of trying again.
 * «N минут назад» is counted from the server's clock in the answer plus the
 * time that has passed on this page — a phone whose own clock is wrong still
 * reads the right age — and every time of day is printed in the organization's
 * zone, with the zone named when it is not the visitor's own.
 *
 * That the link is over is the server's to say, never the page's own clock:
 * when the link's time is up by that clock the position goes and the server
 * is asked, and a phone whose clock was set a day ahead finds its working
 * link still working. And the server has to say it twice of a link the page
 * was just shown working (see `goneSaid`).
 */
export function LocationShareLinkView({ token }: { token: string }) {
  const t = useTranslations("mtmLocationShareLink")
  const locale = useLocale()
  // Not a link of ours: said at once, and the server is not asked.
  const wellFormed = isLocationShareLinkToken(token)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [gone, setGone] = useState(!wellFormed)
  const [notice, setNotice] = useState<"rateLimited" | "connectionLost" | null>(null)
  const [asking, setAsking] = useState(false)
  const [nowMs, setNowMs] = useState<number | null>(null)
  /** The server said «больше не работает» once, of a link that worked a moment ago: it is being asked once more. */
  const [doubting, setDoubting] = useState(false)
  /** How many times «Обновить» was pressed: each press brings the map back to the marker. */
  const [pressed, setPressed] = useState(0)
  const snapshotRef = useRef<Snapshot | null>(null)
  const goneRef = useRef(!wellFormed)
  const inFlightRef = useRef<{ controller: AbortController; byHand: boolean } | null>(null)
  const lastAskedRef = useRef<Stamp | null>(null)
  const silentRef = useRef<{ since: Stamp; forMs: number } | null>(null)
  /** Set with `doubting`; `due` once the half-minute is up and the second question may be asked. */
  const doubtRef = useRef<{ due: boolean } | null>(null)

  /** The link is over. Whatever was on screen goes, and nothing is asked from here on. */
  const stop = useCallback(() => {
    goneRef.current = true
    snapshotRef.current = null
    doubtRef.current = null
    inFlightRef.current?.controller.abort()
    setSnapshot(null)
    setNotice(null)
    setDoubting(false)
    setGone(true)
  }, [])

  /** Takes the position off the screen; who it is and until when the link works stay. Only an answer brings a position back. */
  const hidePosition = useCallback(() => {
    const held = snapshotRef.current
    if (!held?.position) return
    const next = { ...held, position: null }
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  /** Moves the page's clock: the server's moment in the last answer plus the time since it arrived. */
  const tick = useCallback(() => {
    const held = snapshotRef.current
    if (!held) return
    const now = pageNow(held)
    setNowMs(now)
    // The link's time is up — by this device's clock. No position is shown
    // from here; whether the link is over the server says, to the question
    // that follows every tick. The page does not end itself: a clock that
    // jumped forward would end a link that works, for good.
    if (now >= held.expiresAtMs) hidePosition()
  }, [hidePosition])

  /**
   * The server's own «больше не работает».
   *
   * Believed at once when the page has nothing to lose by it: it holds no
   * answer yet (the link was opened dead), or the link's time is up by the
   * page's clock as well.
   *
   * Said of a link the page was shown working a moment ago, it may be the
   * server stumbling — the route answers these same bytes for anything that
   * goes wrong inside it. One such answer takes the position off the screen
   * at once and is checked once more half a minute later; only the second
   * ends the page. «Обновить» pressed inside that half-minute asks, and its
   * answer is neither the end nor a new count.
   */
  const goneSaid = useCallback(() => {
    const held = snapshotRef.current
    if (!held || pageNow(held) >= held.expiresAtMs) return stop()
    const doubt = doubtRef.current
    if (doubt?.due) return stop()
    hidePosition()
    setNotice(null)
    if (doubt) return
    doubtRef.current = { due: false }
    setDoubting(true)
  }, [hidePosition, stop])

  const ask = useCallback(async (byHand: boolean) => {
    if (goneRef.current) return
    const silent = silentRef.current
    if (silent && elapsedSince(silent.since) < silent.forMs) return
    // In doubt the page itself waits out the half-minute; a person may ask sooner.
    const doubt = doubtRef.current
    if (doubt && !doubt.due && !byHand) return
    const running = inFlightRef.current
    if (running) {
      // One question at a time. A press does not queue behind the page's own
      // question, which may be hanging: that one is dropped for the press's.
      if (!byHand || running.byHand) return
      running.controller.abort()
    }
    lastAskedRef.current = stamp()
    const controller = new AbortController()
    const request = { controller, byHand }
    inFlightRef.current = request
    if (byHand) setAsking(true)
    let timedOut = false
    const deadline = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_DEADLINE_MS)
    try {
      const response = await fetch(`/api/v1/public/location-share/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      if (controller.signal.aborted) {
        // Cut off by the deadline while the answer was still arriving: said, like any other answer that did not come.
        if (timedOut) setNotice("connectionLost")
        return
      }
      // Only on the server's own word: a 404 of anything else on the way is a failed question, not the end of the link.
      if (response.status === 404 && body?.state === "GONE") return goneSaid()
      if (response.status === 429) {
        silentRef.current = { since: stamp(), forMs: rateLimitWaitMs(response, body) }
        setNotice("rateLimited")
        return
      }
      const shown = response.ok ? readAnswer(body) : null
      if (!shown) {
        // What is on screen stays, and goes on ageing by the page's clock.
        setNotice("connectionLost")
        return
      }
      const next = { ...shown, receivedAt: stamp() }
      snapshotRef.current = next
      // The link works: whatever «больше не работает» came before was not the end of it.
      doubtRef.current = null
      setDoubting(false)
      setSnapshot(next)
      setNowMs(next.generatedAtMs)
      setNotice(null)
    } catch {
      // A question dropped on purpose — the page closed, a press took its place — is not a failure. One the deadline cut off is.
      if (timedOut || !controller.signal.aborted) setNotice("connectionLost")
    } finally {
      window.clearTimeout(deadline)
      if (inFlightRef.current === request) inFlightRef.current = null
      if (byHand) setAsking(false)
    }
  }, [goneSaid, token])

  useEffect(() => {
    if (gone) return
    void ask(false)
    const interval = window.setInterval(() => {
      tick()
      // Nobody is looking: nobody is asked. The clock above still moves.
      if (document.visibilityState === "visible") void ask(false)
    }, POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      tick()
      // Back in front of somebody: asked at once, unless it was asked a moment ago.
      const asked = lastAskedRef.current
      if (!asked || elapsedSince(asked) >= POLL_INTERVAL_MS) void ask(false)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
      inFlightRef.current?.controller.abort()
    }
  }, [ask, gone, tick])

  // The second question of a doubt, half a minute after the first «больше не работает».
  useEffect(() => {
    if (!doubting) return
    const timer = window.setTimeout(() => {
      const doubt = doubtRef.current
      if (!doubt) return
      doubt.due = true
      // In a hidden tab it waits, like every other question, for somebody to look.
      if (document.visibilityState === "visible") void ask(false)
    }, POLL_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [ask, doubting])

  const now = nowMs ?? snapshot?.generatedAtMs ?? null
  const position = snapshot?.position && now != null && now - snapshot.position.recordedAtMs <= POSITION_MAX_AGE_MS
    ? snapshot.position
    : null
  const clock = (ms: number) => formatTime(ms, locale, { hour: "2-digit", minute: "2-digit", timeZone: snapshot?.timezone })
  const age = position && now != null ? ago(position.recordedAtMs, now) : null
  // The zone is named only to somebody whose own clock reads differently.
  const anotherClock = snapshot != null && now != null
    && getOffsetMinutes(snapshot.timezone, new Date(now)) !== -new Date(now).getTimezoneOffset()
  const state = gone ? "gone" : !snapshot ? "loading" : position ? "available" : "unavailable"
  const said = notice === "rateLimited" ? t("rateLimited") : notice === "connectionLost" ? t("connectionLost") : null
  const refresh = (
    <button
      type="button"
      onClick={() => {
        // Asked for by hand: the map also comes back to the marker, wherever the visitor had dragged it.
        setPressed((count) => count + 1)
        void ask(true)
      }}
      // Asked to wait a minute: the button comes back with the next answer.
      disabled={asking || notice === "rateLimited"}
      data-testid="location-share-link-refresh"
      className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
    >
      {asking ? t("refreshing") : t("refresh")}
    </button>
  )

  return (
    <main data-testid="location-share-link" data-state={state} className="flex min-h-dvh flex-col bg-background text-foreground">
      {gone ? (
        <section className="m-auto w-full max-w-md px-4 py-10 text-center" data-testid="location-share-link-gone">
          <h1 className="text-xl font-semibold">{t("gone.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("gone.hint")}</p>
        </section>
      ) : !snapshot ? (
        <section className="m-auto w-full max-w-md px-4 py-10 text-center" data-testid="location-share-link-loading">
          <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
          {said ? (
            <>
              <p role="status" className="mt-2 text-sm text-amber-700" data-testid="location-share-link-notice">{said}</p>
              <div className="mt-4">{refresh}</div>
            </>
          ) : (
            <p role="status" className="mt-2 text-sm text-muted-foreground">{t("loading")}</p>
          )}
        </section>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col sm:px-4 sm:py-4">
          <header className="px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("pageTitle")}</p>
            <h1 className="mt-1 break-words text-xl font-semibold" data-testid="location-share-link-name">{snapshot.name}</h1>
            {snapshot.organizationName ? (
              <p className="mt-0.5 break-words text-sm text-muted-foreground" data-testid="location-share-link-organization">
                {t("organization", { organization: snapshot.organizationName })}
              </p>
            ) : null}
            {position && age ? (
              <p className="mt-2 text-sm font-medium" data-testid="location-share-link-recorded">
                {t("recordedAt", {
                  time: clock(position.recordedAtMs),
                  ago: age.unit === "justNow" ? t("ago.justNow") : t(`ago.${age.unit}`, { count: age.count }),
                })}
              </p>
            ) : null}
          </header>
          {position ? (
            // The map fills the width of a phone, edge to edge, and whatever height the screen has left.
            <section
              aria-label={t("mapLabel")}
              data-testid="location-share-link-map"
              className="relative isolate min-h-[280px] flex-1 overflow-hidden border-y border-zinc-200 bg-muted sm:rounded-lg sm:border"
            >
              <LocationShareLinkMap latitude={position.latitude} longitude={position.longitude} name={snapshot.name} recentreKey={pressed} />
            </section>
          ) : (
            <section className="mx-4 rounded-lg border border-zinc-200 bg-muted/40 p-4 sm:mx-0" data-testid="location-share-link-unavailable">
              <h2 className="text-base font-semibold">{t("unavailable.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("unavailable.hint")}</p>
            </section>
          )}
          {/* On a phone the last line clears the bar a finger swipes home with. */}
          <footer className="space-y-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-0 sm:pb-0">
            <p className="text-sm font-medium" data-testid="location-share-link-expires">
              {/* Every link ends with the organization's day at the latest; as a clock that moment reads «до 00:00». */}
              {isLocationShareLinkEndOfDay(new Date(snapshot.expiresAtMs), snapshot.timezone)
                ? t("expiresAtEndOfDay")
                : t("expiresAt", { time: clock(snapshot.expiresAtMs) })}
            </p>
            {anotherClock && now != null ? (
              <p className="text-xs text-muted-foreground" data-testid="location-share-link-timezone">
                {t("timezoneNote", { timezone: timezoneOffsetLabel(snapshot.timezone, new Date(now)) })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2">
              {refresh}
              {/* Without a position the words above have already said that the page checks by itself. */}
              {position ? <span className="text-xs text-muted-foreground">{t("autoRefresh")}</span> : null}
            </div>
            {said ? <p role="status" className="pt-1 text-sm text-amber-700" data-testid="location-share-link-notice">{said}</p> : null}
          </footer>
        </div>
      )}
    </main>
  )
}
