/**
 * Guided demo journey — contract tests (Phase A).
 *
 * Keeps the scenario honest against the real product: anchors must exist on
 * the real pages, routes must be real sidebar entries inside the four
 * visible groups, every included inventory section must be demonstrated,
 * coverage must meet the 80 % target per product area, the state chain must
 * be walkable, and intro clips marked available must exist on disk.
 */
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  DEMO_ANCHORS,
  DEMO_BUILT_AREAS,
  DEMO_COVERAGE_TARGET_PERCENT,
  DEMO_JOURNEY_SCENARIOS,
  DEMO_JOURNEY_STATES,
  DEMO_JOURNEY_TRANSITIONS,
  DEMO_PRODUCT_AREAS_WITH_COVERAGE,
  PROSPECT_TO_CLOSED_WON,
  applyTransition,
  canTransition,
  computeCoverage,
  getDemoJourneyScenario,
  journeyProgressPercent,
  validateJourneyManifest,
  type DemoJourneyState,
} from "@/lib/demo-center/journey"

const ROOT = process.cwd()
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

/** Sidebar group label → group-module id, for the four groups the demo shows. */
const NAV_GROUP_TO_MODULE: Record<string, string> = {
  CRM: "crm",
  Sales: "sales",
  Communication: "omnichannel",
  Marketing: "marketing",
}

/** Pulls `{ href, group }` pairs out of nav-items.ts without importing it
 *  (the module drags lucide icons and permission helpers into node). */
function navEntries(): Array<{ href: string; group: string }> {
  const source = read("src/lib/nav-items.ts")
  const entries: Array<{ href: string; group: string }> = []
  // Every nav entry writes `href` before `group`; `[^{}]*?` keeps the pair
  // inside one object literal so a group is never borrowed from a neighbour.
  const pattern = /href:\s*"([^"]+)"[^{}]*?group:\s*"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const [, href, group] = match
    if (!entries.some((entry) => entry.href === href)) entries.push({ href, group })
  }
  return entries
}

const manifest = PROSPECT_TO_CLOSED_WON

describe("Guided journey manifest: prospect-to-closed-won v1", () => {
  it("satisfies the scenario contract", () => {
    expect(validateJourneyManifest(manifest)).toEqual([])
  })

  it("is the only approved scenario and is looked up safely", () => {
    expect(Object.keys(DEMO_JOURNEY_SCENARIOS)).toEqual(["prospect-to-closed-won"])
    expect(getDemoJourneyScenario("prospect-to-closed-won")).toBe(manifest)
    expect(getDemoJourneyScenario("salesforce-clone")).toBeNull()
    expect(getDemoJourneyScenario("__proto__")).toBeNull()
    expect(getDemoJourneyScenario("constructor")).toBeNull()
  })

  it("shows only the four groups the owner chose and only real sidebar routes", () => {
    expect(manifest.navGroups).toEqual(["crm", "sales", "omnichannel", "marketing"])
    const entries = navEntries()
    expect(entries.length).toBeGreaterThan(100)
    for (const route of manifest.visibleRoutes) {
      const entry = entries.find((candidate) => candidate.href === route)
      expect(entry, `${route} must be a real sidebar entry`).toBeDefined()
      expect(NAV_GROUP_TO_MODULE[entry!.group], `${route} sits in group "${entry!.group}", outside the demo scope`)
        .toBeDefined()
    }
    const inScope = entries.filter((entry) => NAV_GROUP_TO_MODULE[entry.group])
    // The whole point of the limited version: the prospect sees a handful of
    // pages, not the full navigation of the four groups.
    expect(manifest.visibleRoutes.length).toBeLessThanOrEqual(8)
    expect(inScope.length).toBeGreaterThan(manifest.visibleRoutes.length * 4)
  })

  it("keeps every section on a visible route and in a visible group", () => {
    for (const section of manifest.sections) {
      if (section.navGroup === "demo") continue
      expect(manifest.navGroups).toContain(section.navGroup)
      expect(manifest.visibleRoutes).toContain(section.route.replace(/\/\[[a-zA-Z]+\]$/, ""))
    }
  })

  it("tells the story in the agreed order", () => {
    expect(manifest.sections.map((section) => section.id)).toEqual([
      "orientation",
      "source",
      "conversation",
      "ai-reply",
      "lead-created",
      "lead-qualified",
      "ai-call",
      "task",
      "deal",
      "quote",
      "closed-won",
      "summary",
    ])
  })

  it("keeps the call exercise off in v1 and truthfully skipped, never faked", () => {
    expect(manifest.capabilities.liveCall).toBe(false)
    expect(manifest.capabilities.phoneVerification).toBe(false)
    const call = manifest.sections.find((section) => section.id === "ai-call")!
    expect(call.exitStates).toEqual(["CALL_SKIPPED"])
    const transitions = call.steps.filter((step) => step.completion.kind === "transition")
    expect(transitions.map((step) => (step.completion as { to: string }).to)).toEqual(["CALL_SKIPPED"])
    expect(call.steps.some((step) => step.analyticsEvent === "call.consent_shown")).toBe(true)
  })

  it("never lets an action step complete just by being viewed", () => {
    for (const section of manifest.sections) {
      for (const step of section.steps) {
        if (step.action === "observe" || step.action === "wait") {
          expect(step.completion.kind, step.id).toBe("viewed")
        } else {
          expect(step.completion.kind, step.id).not.toBe("viewed")
        }
      }
    }
  })

  it("uses Azerbaijani prospect copy without Cyrillic or reference-product names", () => {
    const texts: string[] = [manifest.title, manifest.summary]
    for (const section of manifest.sections) {
      texts.push(section.title, section.summary, section.skippedNotice ?? "", section.intro?.caption ?? "")
      texts.push(...(section.assistantPrompts ?? []))
      for (const step of section.steps) {
        texts.push(step.title, step.instruction, step.result ?? "", step.fallback ?? "")
      }
    }
    for (const text of texts) {
      expect(text, text).not.toMatch(/[А-Яа-яЁё]/)
      expect(text.toLowerCase(), text).not.toContain("salesforce")
      expect(text, text).not.toMatch(/\bTODO\b|lorem ipsum/i)
    }
  })
})

describe("Guided journey anchors", () => {
  it("names only kebab-case ids with a label", () => {
    for (const [id, anchor] of Object.entries(DEMO_ANCHORS)) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      expect(anchor.label.trim(), id).not.toBe("")
    }
  })

  it("every anchor with a scene is actually rendered by it", () => {
    for (const [id, anchor] of Object.entries(DEMO_ANCHORS)) {
      if (!anchor.scene) continue
      const full = path.join(ROOT, anchor.scene)
      expect(existsSync(full), `anchor "${id}" → missing scene ${anchor.scene}`).toBe(true)
      expect(readFileSync(full, "utf8").includes(`data-tour-id="${id}"`), `${anchor.scene} does not render "${id}"`).toBe(true)
    }
  })

  it("every listed product file really carries the shared id", () => {
    for (const [id, anchor] of Object.entries(DEMO_ANCHORS)) {
      for (const file of anchor.productFiles) {
        const full = path.join(ROOT, file)
        expect(existsSync(full), `anchor "${id}" → ${file}`).toBe(true)
        const source = readFileSync(full, "utf8")
        expect(
          source.includes(`data-tour-id="${id}"`) || source.includes(`tourId="${id}"`),
          `${file} is listed for "${id}" but does not carry it`,
        ).toBe(true)
      }
    }
  })

  it("a built area may not leave any of its step anchors unrendered", () => {
    for (const section of manifest.sections) {
      if (!DEMO_BUILT_AREAS.includes(section.area)) continue
      for (const step of section.steps) {
        const anchor = DEMO_ANCHORS[step.anchor]
        expect(anchor, step.anchor).toBeDefined()
        expect(anchor.scene, `"${step.id}" points at "${step.anchor}", which no built scene renders`).not.toBeNull()
      }
    }
  })

  it("keeps the demo chrome's own copy Azerbaijani too", () => {
    // The manifest test above covers scenario copy; the guide panel, coach
    // mark and summary read from strings.ts, which no locale file guards.
    const strings = read("src/components/demo-center/journey/strings.ts")
    const body = strings.slice(strings.indexOf("DEMO_JOURNEY_STRINGS"))
    for (const literal of body.match(/"[^"\\]*"|`[^`\\]*`/g) ?? []) {
      expect(literal, literal).not.toMatch(/[А-Яа-яЁё]/)
      expect(literal.toLowerCase(), literal).not.toContain("salesforce")
    }
  })

  it("the renderer registers a scene for every section of a built area", () => {
    const player = read("src/components/demo-center/journey/demo-journey-player.tsx")
    const map = player.slice(player.indexOf("const SCENES"), player.indexOf("export interface DemoJourneyPlayerProps"))
    expect(map.length).toBeGreaterThan(0)
    for (const section of manifest.sections) {
      if (!DEMO_BUILT_AREAS.includes(section.area)) continue
      const registered = map.includes(`"${section.id}":`) || map.includes(`${section.id}:`)
      expect(registered, `section "${section.id}" is in a built area but the renderer has no scene for it`).toBe(true)
    }
  })
})

describe("Guided journey coverage", () => {
  /** Hand-checked numbers; docs/demo-guided-journey.md quotes them. Change
   *  both on purpose, never one to make the other pass. */
  const EXPECTED: Record<string, { included: number; total: number; percent: number }> = {
    campaigns: { included: 5, total: 6, percent: 83 },
    inbox: { included: 8, total: 10, percent: 80 },
    leads: { included: 18, total: 21, percent: 86 },
    tasks: { included: 11, total: 13, percent: 85 },
    deals: { included: 14, total: 17, percent: 82 },
    quotes: { included: 8, total: 10, percent: 80 },
  }

  it("meets the 80 % target in every shown product area", () => {
    for (const area of DEMO_PRODUCT_AREAS_WITH_COVERAGE) {
      const result = computeCoverage(area)
      expect(result.percent, `${area.area}: ${result.included}/${result.total}`)
        .toBeGreaterThanOrEqual(DEMO_COVERAGE_TARGET_PERCENT)
      expect(result, area.area).toEqual({ area: area.area, ...EXPECTED[area.area] })
    }
  })

  it("explains every exclusion and demonstrates every inclusion", () => {
    const covered = new Set(manifest.sections.flatMap((section) => section.steps.flatMap((step) => step.covers)))
    for (const area of DEMO_PRODUCT_AREAS_WITH_COVERAGE) {
      const ids = new Set<string>()
      for (const section of area.sections) {
        expect(section.id.startsWith(`${area.area}.`), section.id).toBe(true)
        expect(ids.has(section.id), `duplicate ${section.id}`).toBe(false)
        ids.add(section.id)
        if (section.included) {
          expect(section.kind, section.id).toBeDefined()
          expect(covered.has(section.id), `${section.id} is included but never demonstrated`).toBe(true)
        } else {
          expect(section.reason?.trim(), section.id).toBeTruthy()
        }
      }
    }
  })
})

describe("Guided journey state machine", () => {
  it("has a row for every state and only known targets", () => {
    for (const state of DEMO_JOURNEY_STATES) {
      const targets = DEMO_JOURNEY_TRANSITIONS[state]
      expect(Array.isArray(targets), state).toBe(true)
      for (const target of targets) {
        expect(DEMO_JOURNEY_STATES).toContain(target)
        expect(target, `${state} loops on itself`).not.toBe(state)
      }
    }
  })

  it("walks the happy path and refuses to move out of terminal states", () => {
    const happyPath: DemoJourneyState[] = [
      "STARTED", "SOURCE_SEEN", "CONVERSATION_OPENED", "AI_REPLIED", "LEAD_CREATED", "LEAD_QUALIFIED",
      "CALL_SKIPPED", "TASK_CREATED", "DEAL_CREATED", "DEAL_ADVANCED", "QUOTE_CREATED", "QUOTE_SENT",
      "QUOTE_ACCEPTED", "CLOSED_WON", "COMPLETED",
    ]
    let state: DemoJourneyState = "PREPARED"
    for (const next of happyPath) {
      const result = applyTransition(state, next)
      expect(result.ok, `${state} → ${next}`).toBe(true)
      state = result.state
    }
    expect(applyTransition("COMPLETED", "STARTED").ok).toBe(false)
    expect(applyTransition("EXPIRED", "REVOKED").ok).toBe(false)
    expect(applyTransition("REVOKED", "EXPIRED").ok).toBe(false)
  })

  it("lets every live state expire or be revoked, and never redials after uncertainty", () => {
    for (const state of DEMO_JOURNEY_STATES) {
      const terminal = state === "COMPLETED" || state === "EXPIRED" || state === "REVOKED"
      expect(canTransition(state, "EXPIRED"), state).toBe(!terminal)
      expect(canTransition(state, "REVOKED"), state).toBe(!terminal)
    }
    expect(canTransition("CALL_ATTENTION_REQUIRED", "CALL_QUEUED")).toBe(false)
    expect(canTransition("CALL_ATTENTION_REQUIRED", "CALLING")).toBe(false)
    expect(canTransition("CALL_ATTENTION_REQUIRED", "TASK_CREATED")).toBe(true)
    expect(canTransition("LEAD_QUALIFIED", "CALLING")).toBe(false)
  })

  it("keeps every call outcome on the way to the task step", () => {
    for (const outcome of ["CALL_SKIPPED", "CALL_DECLINED", "CALL_RESULT_RECORDED", "CALL_NO_ANSWER", "CALL_BUSY", "CALL_BLOCKED", "CALL_FAILED", "CALL_ATTENTION_REQUIRED"] as const) {
      expect(DEMO_JOURNEY_TRANSITIONS[outcome]).toEqual(["TASK_CREATED"])
      expect(journeyProgressPercent(outcome)).toBe(journeyProgressPercent("CALL_SKIPPED"))
    }
  })

  it("reports progress from 0 to 100", () => {
    expect(journeyProgressPercent("PREPARED")).toBe(0)
    expect(journeyProgressPercent("COMPLETED")).toBe(100)
    expect(journeyProgressPercent("LEAD_CREATED")).toBeGreaterThan(journeyProgressPercent("AI_REPLIED"))
    expect(journeyProgressPercent("EXPIRED")).toBe(0)
  })
})

describe("Guided journey intro clips", () => {
  it("only marks clips available when the Azerbaijani file and poster exist", () => {
    for (const section of manifest.sections) {
      if (!section.intro) continue
      const video = path.join(ROOT, "video/player", `${section.intro.slug}.az.VOICE.mp4`)
      const poster = path.join(ROOT, "video/player", `${section.intro.slug}.az.poster.jpg`)
      if (section.intro.status === "available") {
        expect(existsSync(video), `${section.id}: ${video}`).toBe(true)
        expect(existsSync(poster), `${section.id}: ${poster}`).toBe(true)
      }
      expect(section.intro.caption.trim()).not.toBe("")
    }
  })
})

describe("The open demo", () => {
  const shell = read("src/components/demo-center/journey/open-demo.tsx")
  const guide = read("src/components/demo-center/journey/demo-journey-guide.tsx")
  const route = read("src/app/(marketing)/demo/start/page.tsx")

  /** Comments explain why the gate is absent, so they must not be searched
   *  for the very words that would prove it is present. */
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  it("opens the story with no gate: nothing is fetched, nothing is verified", () => {
    const body = code(shell) + code(route)
    for (const forbidden of ["fetch(", "/api/", "otpHash", "sessionHash", "demoGrant"]) {
      expect(body, forbidden).not.toContain(forbidden)
    }
    expect(shell).toContain('variant="open"')
    expect(route).toContain("OpenDemo")
  })

  it("keeps the paid assistant off for an unverified visitor", () => {
    // Only a granted session may spend a model call.
    expect(guide).toContain('variant !== "granted"')
  })

  it("serves no help-library media to an unverified visitor", () => {
    expect(guide).toContain('variant !== "open"')
  })

  it("does not post what the visitor types about themselves", () => {
    expect(shell).not.toContain("method:")
    expect(route).not.toContain("prisma")
  })

  it("stays out of search results", () => {
    expect(route).toContain("index: false")
  })
})
