/**
 * The way of moving as a small round badge — car blue, on foot green,
 * standing amber, a break or a lost signal slate — for the live map's list and the rows of the day (owner,
 * 2026-11-01, of the mockup «MTM: движение на карте»). The same pictures and
 * colours as the markers on the maps.
 */
import { MTM_MOVEMENT_ICON_SVG, MTM_MOVEMENT_MARKER_COLORS, MTM_STILL_COLOR, MTM_STILL_ICON_SVG } from "@/lib/mtm/live-map-agent-marker"
import type { MtmMovementMode } from "@/lib/mtm/movement-mode"

export function MovementBadge({ mode, size = 20, testId }: { mode: MtmMovementMode | "BREAK" | "GAP"; size?: number; testId?: string }) {
  const picture = Math.round(size * 0.62)
  const still = mode === "BREAK" || mode === "GAP"
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      data-mode={mode}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, background: still ? MTM_STILL_COLOR : MTM_MOVEMENT_MARKER_COLORS[mode] }}
    >
      {/* Fixed strings of this build (live-map-agent-marker.ts): nothing from the server is drawn here. */}
      <svg viewBox="0 0 24 24" width={picture} height={picture} dangerouslySetInnerHTML={{ __html: still ? MTM_STILL_ICON_SVG[mode] : MTM_MOVEMENT_ICON_SVG[mode] }} />
    </span>
  )
}
