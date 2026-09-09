"use client"

/**
 * KPI Arena — the floating-bubble canvas (Crypto Bubbles style).
 *
 * Each agent is a TRANSLUCENT orb on a dark canvas: a faint radial tint (dark
 * centre → colour concentrated at the rim) under a bright, glowing coloured
 * ring, with the % printed bold in white. BOTH colour AND radius scale with
 * attainmentPct (red→green + small→large in parallel): a 100% agent is a
 * dramatically bigger green orb, 0% is the smallest red one. Absolute scale (not
 * normalised to the group max) so 100% always reads as "the best".
 *
 * Motion: a d3-force simulation with weak centring + a perpetual per-tick
 * "wander" impulse + wall bounce, so bubbles genuinely drift and jostle (not
 * settle). Node objects are REUSED across period/group changes (keyed by agent
 * id) so positions persist — switching the period smoothly re-settles + recolours
 * instead of teleporting. Tick writes transforms straight to the DOM (refs) so
 * the 60fps loop never triggers a React re-render.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  forceCollide,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force"
import { attainmentColor } from "@/lib/leaderboard/colors"
import type { NormalizedAgent } from "@/lib/leaderboard/types"

interface BubbleNode extends SimulationNodeDatum {
  id: string
  r: number
  agent: NormalizedAgent
}

const MIN_R = 20
const MAX_R = 112
/** Below this radius the full name does not fit inside the orb, so it is printed
 *  underneath instead. Orbs used to fall into a dead band here: too small for the
 *  name, too big for the under-label, so they rendered as bare initials — and that
 *  band is exactly the at-risk/critical range (~22-54%), the agents a manager most
 *  needs to identify by name. */
const NAME_INSIDE_R = 52
/** Vertical room reserved under an orb that carries an under-label. */
const UNDER_LABEL_PAD = 18

/** Radius from KPI attainment %. Super-linear so 100% dwarfs the mid-pack and
 *  0% is a small dot; capped at 110% so over-achievers cluster at the top size. */
function radiusForAttainment(pct: number): number {
  const t = Math.max(0, Math.min(110, pct)) / 110
  return MIN_R + (MAX_R - MIN_R) * Math.pow(t, 1.5)
}

export function BubbleArena({
  agents,
  height = 580,
  selectedId,
  onSelect,
}: {
  agents: NormalizedAgent[]
  height?: number
  selectedId?: string | null
  onSelect?: (agent: NormalizedAgent) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  // agent ids whose avatar URL failed to load → fall back to the text label
  const [failedAv, setFailedAv] = useState<Set<string>>(() => new Set())
  // keyboard-focused orb id → draw a visible focus ring (the browser's default
  // outline on an SVG <g> is unreliable/invisible, so we render our own).
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // honour the OS "reduce motion" setting: when on, the sim settles once then
  // stops instead of drifting forever. Lazy-init from the media query (component
  // is ssr:false, so window exists) to avoid a flash of motion before settling.
  const [reduceMotion, setReduceMotion] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  const groupRefs = useRef(new Map<string, SVGGElement>())
  const simRef = useRef<Simulation<BubbleNode, undefined> | null>(null)
  // Persisted node objects keyed by agent id → positions survive period/group
  // switches so bubbles re-settle smoothly instead of teleporting.
  const nodesRef = useRef(new Map<string, BubbleNode>())
  // Last width the nodes were laid out at → when it changes (the 900 default
  // becomes the real measured width, or the window resizes) we proportionally
  // remap x so the cluster re-centres + fills the canvas instead of staying
  // stuck on the side it was first seeded into.
  const prevWidthRef = useRef(width)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.max(320, Math.round(w)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Track the OS reduce-motion preference live (user can toggle it mid-session).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduceMotion(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  const nodes = useMemo<BubbleNode[]>(() => {
    const prev = nodesRef.current
    const map = new Map<string, BubbleNode>()
    for (const a of agents) {
      const r = radiusForAttainment(a.attainmentPct)
      const old = prev.get(a.id)
      if (old) {
        old.r = r
        old.agent = a
        map.set(a.id, old)
      } else {
        map.set(a.id, { id: a.id, r, agent: a })
      }
    }
    nodesRef.current = map
    return [...map.values()]
  }, [agents])

  useEffect(() => {
    if (nodes.length === 0) return
    const cx = width / 2
    const cy = height / 2
    const SPEED = 0.45 // constant glide speed (px/tick) — smooth, no per-frame jitter
    // Width changed (e.g. the 900 default → the real measured width, or a resize):
    // proportionally remap every already-placed node's x into the new width so the
    // cluster re-centres and spreads to fill the canvas, instead of staying piled
    // on the side it was first seeded into (the left-bias bug).
    const prevW = prevWidthRef.current
    if (prevW > 0 && Math.abs(width - prevW) > 1) {
      const scale = width / prevW
      for (const n of nodes) {
        if (n.x !== undefined) n.x = n.x * scale
      }
    }
    prevWidthRef.current = width
    // Seed new nodes spread across the FULL canvas (not a tight central blob) + a
    // one-time random-direction velocity. Existing nodes keep their position +
    // velocity (smooth on period switch).
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) {
        n.x = cx + (Math.random() - 0.5) * (width - 2 * n.r) * 0.9
        n.y = cy + (Math.random() - 0.5) * (height - 2 * n.r) * 0.88
      }
      if (n.vx === undefined || n.vy === undefined || (n.vx === 0 && n.vy === 0)) {
        const a = Math.random() * Math.PI * 2
        n.vx = Math.cos(a) * SPEED
        n.vy = Math.sin(a) * SPEED
      }
    }

    // Collision-only sim: bubbles glide at a constant speed and bounce; d3 just
    // resolves overlaps. No charge/centring/random — that was the jitter source.
    // reduce-motion: damp hard + let alpha cool to a stop after one settle, so
    // the field resolves overlaps once and then freezes (no perpetual drift).
    const sim = forceSimulation<BubbleNode>(nodes)
      .force("collide", forceCollide<BubbleNode>((d) => d.r + 3).strength(0.5))
      .velocityDecay(reduceMotion ? 0.4 : 0.02) // damped vs near-frictionless glide
      .alphaTarget(reduceMotion ? 0 : 0.3)
      .alphaDecay(reduceMotion ? 0.05 : 0) // cool to a stop vs never cool

    sim.on("tick", () => {
      for (const n of nodes) {
        let vx = n.vx ?? 0
        let vy = n.vy ?? 0
        // Default mode holds a steady gentle glide (smoothly, NOT via per-frame
        // randomness). In reduce-motion we skip this re-injection so the velocity
        // damps and the sim stops — one settle, then static.
        if (!reduceMotion) {
          let sp = Math.hypot(vx, vy)
          if (sp < 1e-4) {
            const a = Math.random() * Math.PI * 2
            vx = Math.cos(a) * SPEED
            vy = Math.sin(a) * SPEED
            sp = SPEED
          }
          const MIN = 0.3
          const MAX = 0.6
          if (sp < MIN) {
            vx *= MIN / sp
            vy *= MIN / sp
          } else if (sp > MAX) {
            vx *= MAX / sp
            vy *= MAX / sp
          }
        }
        let x = n.x ?? cx
        let y = n.y ?? cy
        // reflect off the walls (smooth bounce)
        if (x < n.r) {
          x = n.r
          vx = Math.abs(vx)
        } else if (x > width - n.r) {
          x = width - n.r
          vx = -Math.abs(vx)
        }
        // Orbs too small for an inside name print it UNDER the orb (n.r+12) —
        // reserve room at the bottom so that label never clips (a 0% agent drifts
        // low, so this matters).
        const bottomPad = n.r < NAME_INSIDE_R ? UNDER_LABEL_PAD : 0
        if (y < n.r) {
          y = n.r
          vy = Math.abs(vy)
        } else if (y > height - n.r - bottomPad) {
          y = height - n.r - bottomPad
          vy = -Math.abs(vy)
        }
        n.x = x
        n.y = y
        n.vx = vx
        n.vy = vy
        const el = groupRefs.current.get(n.id)
        if (el) el.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)})`)
      }
    })

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [nodes, width, height, reduceMotion])

  if (agents.length === 0) return null

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="select-none"
        role="img"
        aria-label="KPI leaderboard bubbles"
      >
        <defs>
          {nodes.map((n, i) => {
            const { hue } = attainmentColor(n.agent.attainmentPct)
            const avR = Math.min(n.r * 0.3, 18)
            return (
              <Fragment key={n.id}>
                <radialGradient id={`lb-grad-${i}`} cx="40%" cy="38%" r="68%">
                  {/* Crypto-Bubbles neon donut: dark core, then a THICK saturated
                      rim band at high opacity so the colour reads vivid (not glassy). */}
                  <stop offset="0%" stopColor={`hsl(${hue} 80% 48%)`} stopOpacity="0.05" />
                  <stop offset="50%" stopColor={`hsl(${hue} 85% 46%)`} stopOpacity="0.22" />
                  <stop offset="84%" stopColor={`hsl(${hue} 92% 52%)`} stopOpacity="0.74" />
                  <stop offset="100%" stopColor={`hsl(${hue} 96% 60%)`} stopOpacity="0.96" />
                </radialGradient>
                {n.agent.avatar && n.r >= 46 && (
                  <clipPath id={`lb-av-${i}`}>
                    <circle r={avR} cy={-n.r * 0.5} />
                  </clipPath>
                )}
              </Fragment>
            )
          })}
          {/* shared glass overlays — top-left sheen + vertical volume shading */}
          <radialGradient id="lb-sheen" cx="33%" cy="24%" r="60%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lb-depth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="55%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {nodes.map((n, i) => {
          const c = attainmentColor(n.agent.attainmentPct)
          const isSel = selectedId === n.id
          const isFocused = focusedId === n.id
          // Always print the % (even on the smallest 0% orb); the name goes inside
          // only when the orb is big enough to hold it in full, otherwise under the
          // orb. Every orb also carries a <title> hover tooltip.
          const showName = n.r >= NAME_INSIDE_R
          const nameSize = Math.max(10, Math.min(17, n.r / 4))
          const pctSize = Math.max(13, Math.min(26, n.r / 2.6))
          const avR = Math.min(n.r * 0.3, 18)
          const avCy = -n.r * 0.5
          const hasAvatar = !!n.agent.avatar && n.r >= 46 && !failedAv.has(n.id)
          return (
            <g
              key={n.id}
              ref={(el) => {
                if (el) groupRefs.current.set(n.id, el)
                else groupRefs.current.delete(n.id)
              }}
              className="cursor-pointer"
              style={{ outline: "none" }}
              onClick={() => onSelect?.(n.agent)}
              tabIndex={0}
              role="button"
              aria-label={`${n.agent.name}: ${Math.round(n.agent.attainmentPct)}%`}
              onFocus={() => setFocusedId(n.id)}
              onBlur={() => setFocusedId((cur) => (cur === n.id ? null : cur))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect?.(n.agent)
              }}
            >
              {/* native hover tooltip — every orb is identifiable even at min radius */}
              <title>{`${n.agent.name} — ${Math.round(n.agent.attainmentPct)}%`}</title>
              {/* ── glass orb stack ── */}
              {/* 1. near-black core base — deeper so the saturated rim pops (3D sphere) */}
              <circle r={n.r} fill="rgba(3,5,10,0.66)" style={{ pointerEvents: "none" }} />
              {/* 2. colour tint concentrated at the rim — also the click/hit
                   target (the other layers are pointerEvents:none, so clicks
                   pass through to this filled circle → onSelect on the <g>). */}
              <circle r={n.r} fill={`url(#lb-grad-${i})`} />
              {/* 3. vertical volume shading (darker bottom → spherical depth) */}
              <circle r={n.r} fill="url(#lb-depth)" style={{ pointerEvents: "none" }} />
              {/* 4. broad top-left glass sheen */}
              <circle r={n.r} fill="url(#lb-sheen)" style={{ pointerEvents: "none" }} />
              {/* 5. crisp specular shine spot */}
              <ellipse
                cx={-n.r * 0.3}
                cy={-n.r * 0.42}
                rx={n.r * 0.26}
                ry={n.r * 0.14}
                fill="rgba(255,255,255,0.55)"
                style={{ pointerEvents: "none" }}
              />
              {/* 6. glowing Fresnel ring on top — neon halo like Crypto Bubbles:
                   a tight bright inner glow + a wide soft outer halo (layered). */}
              <circle
                r={n.r}
                fill="none"
                stroke={isSel ? "#fff" : c.ring}
                strokeWidth={isSel ? 4 : 2.5}
                style={{
                  filter: `drop-shadow(0 0 ${Math.max(4, n.r * 0.14)}px hsl(${c.hue} 96% 62% / 0.95)) drop-shadow(0 0 ${Math.max(12, n.r * 0.5)}px hsl(${c.hue} 92% 52% / 0.55))`,
                  transition: "stroke 0.5s ease, filter 0.5s ease",
                }}
              />
              {/* visible keyboard-focus ring — the browser's default SVG outline
                  is unreliable, so draw an explicit dashed ring around the orb. */}
              {isFocused && (
                <circle
                  r={n.r + 6}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  // dark halo so the white ring stays visible on bright (green) orbs
                  style={{ pointerEvents: "none", filter: "drop-shadow(0 0 2.5px rgba(0,0,0,0.95))" }}
                />
              )}
              {/* 7. agent avatar (top of the orb) — coin-icon style; falls back to text */}
              {hasAvatar && (
                <>
                  <image
                    href={n.agent.avatar as string}
                    x={-avR}
                    y={avCy - avR}
                    width={avR * 2}
                    height={avR * 2}
                    clipPath={`url(#lb-av-${i})`}
                    preserveAspectRatio="xMidYMid slice"
                    onError={() => setFailedAv((s) => new Set(s).add(n.id))}
                    style={{ pointerEvents: "none" }}
                  />
                  <circle
                    r={avR}
                    cy={avCy}
                    fill="none"
                    stroke="rgba(255,255,255,0.6)"
                    strokeWidth={1.5}
                    style={{ pointerEvents: "none" }}
                  />
                </>
              )}
              {showName && (
                <text
                  y={-pctSize * 0.32}
                  textAnchor="middle"
                  fontSize={nameSize}
                  fontWeight={600}
                  fill="#fff"
                  style={{ pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
                >
                  {n.agent.name}
                </text>
              )}
              <text
                y={showName ? pctSize * 0.62 : pctSize * 0.34}
                textAnchor="middle"
                fontSize={pctSize}
                fontWeight={800}
                fill="#fff"
                style={{ pointerEvents: "none", textShadow: "0 1px 4px rgba(0,0,0,0.75)" }}
              >
                {Math.round(n.agent.attainmentPct)}%
              </text>
              {/* name printed UNDER the orb whenever it does not fit inside — so a
                  low-attainment agent is still identified by name, not initials. */}
              {!showName && (
                <text
                  y={n.r + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="rgba(255,255,255,0.85)"
                  style={{ pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                >
                  {n.agent.name}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
