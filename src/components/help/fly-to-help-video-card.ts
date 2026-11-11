/**
 * A closed help-video window flies back up into the section's «Video dərslik»
 * card instead of vanishing (owner, 2026-11-11: «если закрывает кто-то, пусть
 * поднимается на своё место вверх»). The person sees where the video went and
 * where to open it again.
 *
 * Returns a promise that resolves when the window has landed; the caller
 * unmounts it then. Returns null — close right away, in the same tick — when
 * there is no card on the page (dismissed, or a page without one), no Web
 * Animations API (jsdom, old browsers) or «reduce motion»: closing never waits
 * on an animation that does not happen.
 */
export const HELP_VIDEO_CARD_SELECTOR = "[data-help-video-widget]"
export const FLY_TO_CARD_MS = 420

export function flyToHelpVideoCard(panel: HTMLElement | null, backdrop?: HTMLElement | null): Promise<void> | null {
  if (typeof window === "undefined" || !panel || typeof panel.animate !== "function") return null
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null

  const card = document.querySelector<HTMLElement>(HELP_VIDEO_CARD_SELECTOR)
  if (!card) return null

  const from = panel.getBoundingClientRect()
  const to = card.getBoundingClientRect()
  if (!from.width || !from.height || !to.width || !to.height) return null

  const dx = to.left - from.left
  const dy = to.top - from.top
  const sx = to.width / from.width
  const sy = to.height / from.height
  const easing = "cubic-bezier(0.4, 0, 0.2, 1)"

  const flight = panel.animate(
    [
      { transformOrigin: "top left", transform: "translate(0, 0) scale(1, 1)", opacity: 1 },
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35 },
    ],
    { duration: FLY_TO_CARD_MS, easing, fill: "forwards" },
  )
  // The dimmed backdrop clears — its colour, not its opacity: the window
  // inside it has to stay visible all the way up.
  if (backdrop && typeof backdrop.animate === "function") {
    const shade = getComputedStyle(backdrop)
    backdrop.animate(
      [
        { backgroundColor: shade.backgroundColor, backdropFilter: shade.backdropFilter || "none" },
        { backgroundColor: "rgba(0, 0, 0, 0)", backdropFilter: "blur(0px)" },
      ],
      { duration: FLY_TO_CARD_MS, easing, fill: "forwards" },
    )
  }

  return flight.finished.then(
    () => {
      // A short nod from the card: «it is here now».
      card.animate?.(
        [{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }],
        { duration: 260, easing: "ease-out" },
      )
    },
    () => undefined,
  )
}
