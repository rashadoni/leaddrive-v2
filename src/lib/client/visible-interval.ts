/**
 * A poll that asks the server only while somebody can see the tab.
 *
 * Measured on production 2026-10-27: an open CRM tab sent ~28 requests a
 * minute to the shell's pollers, and a hidden one still ~17 (incoming calls
 * every 5 s, the inbox badge every 20 s, the web-chat count every 30 s). Each
 * such request cost the single web process ~0.05 s of its one core, so about
 * fifty open tabs filled it — and people keep several tabs open while looking
 * at one. A hidden tab has nobody to show a badge, a toast or a call popup to;
 * what reaches a person who is elsewhere is web push, sent by the server.
 *
 * `tick` runs every `intervalMs` while `document.visibilityState` is
 * "visible". A tick that falls while the tab is hidden is skipped and
 * remembered: the tab coming back runs it at once and restarts the interval,
 * so whatever was missed is on screen the moment the person returns rather
 * than up to an interval later. `firstTickAfterMs` schedules the first tick
 * (0 = right after mount); a tab opened in the background takes it when it is
 * first shown.
 *
 * Returns the stop function for the effect's cleanup.
 */
export function startVisibleInterval(
  tick: () => void,
  intervalMs: number,
  options: { firstTickAfterMs?: number } = {},
): () => void {
  let missed = false
  const run = () => {
    if (document.visibilityState !== "visible") {
      missed = true
      return
    }
    missed = false
    tick()
  }

  let interval = setInterval(run, intervalMs)
  const first = options.firstTickAfterMs === undefined
    ? undefined
    : setTimeout(run, options.firstTickAfterMs)

  const onVisibilityChange = () => {
    if (!missed || document.visibilityState !== "visible") return
    clearInterval(interval)
    interval = setInterval(run, intervalMs)
    run()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    clearInterval(interval)
    if (first !== undefined) clearTimeout(first)
    document.removeEventListener("visibilitychange", onVisibilityChange)
  }
}
