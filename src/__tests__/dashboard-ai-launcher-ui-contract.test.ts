import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { dashboardAssistantVisibility } from "@/lib/dashboard-assistant-visibility"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("dashboard AI launcher placement", () => {
  const layout = source("src/app/(dashboard)/layout.tsx")
  const panel = source("src/components/ai-assistant-panel.tsx")
  const search = source("src/components/ai/content-search-bar.tsx")
  const voice = source("src/components/ai/voice-orb.tsx")
  const voiceConsole = source("src/components/ai/voice-console.tsx")

  it("suppresses floating overlays on active MTM work surfaces", () => {
    expect(layout).toContain("<AiAssistantPanel showFloatingLauncher={showFloatingAiLauncher} />")
    expect(layout).toContain("showFloatingLauncher={showFloatingVoiceOrb}")
    expect(layout).toContain("inlineLauncherAvailable={contentSearchVisible}")
    expect(layout).toContain("{contentSearchVisible && <ContentSearchBar />}")
    // The dashboard hides the shared bar only while its hero is showing a Da
    // Vinci field. Pinned as two facts rather than one literal line: the
    // leaderboard is unconditional, the dashboard is not.
    expect(layout).toContain('pathname.startsWith("/leaderboard")')
    expect(layout).toContain("isDashboardHome && heroCommandVisible")
    expect(layout).toContain("heroCommandVisible: isDashboardHome && heroCommandVisible")
    expect(panel).toContain("showFloatingLauncher = true")
    expect(panel).toContain("!open && showFloatingLauncher")
    expect(voice).toContain("showFloatingLauncher = true")
    expect(voice).toContain("inlineLauncherAvailable = false")
    expect(voice).toContain("[inlineLauncherAvailable, showFloatingLauncher]")
    expect(voice).toContain("fixed bottom-24 right-6 z-50")
    expect(search).toContain('id="dashboard-voice-assistant-slot"')
  })

  it("keeps voice mounted while moving its control out of MTM work actions", () => {
    expect(voice).toContain("if (armed) {")
    // `floating`, not `showFloatingLauncher`: the in-flow placement only holds
    // while its host is on screen — see the scrolled-away case in
    // voice-orb-session-race.
    expect(voice).toContain("showFloatingOrb={floating}")
    expect(voice).toContain("orbPortalTarget={activeInlineHost}")
    expect(voice).toContain("createPortal(launcher, activeInlineHost)")
    expect(voiceConsole).toContain("if (orbPortalTarget) return createPortal(orbControl, orbPortalTarget)")
    expect(voiceConsole).toContain("if (!showFloatingOrb) return null")
    expect(voiceConsole).toContain('inline ? "h-11 w-11" : "h-14 w-14"')
    expect(voiceConsole).toContain("const showInlineMessage = Boolean(error || notice || micSilent || transcriptionWarning)")
    expect(voiceConsole).toContain("showInlineMessage")
    expect(voice).toContain('data-placement={activeInlineHost ? "inline" : "floating"}')
    expect(voiceConsole).toContain('data-placement={inline ? "inline" : "floating"}')
  })

  it("keeps the panel reachable from the in-flow search or blocked-page fallback", () => {
    expect(search).toContain('window.dispatchEvent(new CustomEvent("davinci:open"')
    expect(panel).toContain('window.addEventListener("davinci:open"')
    expect(panel).toContain('data-testid="ai-assistant-launcher"')
    expect(panel).toContain("aria-label={uiText.title}")
  })

  // `ai` and `orb` are separate because they are no longer the same answer:
  // while the hero owns a Da Vinci field the floating button is a second door
  // to one room, but the voice orb is a different modality and stays.
  it.each([
    { name: "MTM root", pathname: "/mtm", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: true, ai: false, orb: false },
    { name: "MTM workflow", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: true, ai: false, orb: false },
    { name: "blocked MTM", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: true, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: true, orb: true },
    { name: "hydrating MTM", pathname: "/mtm", childrenReady: false, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: false },
    { name: "leaderboard", pathname: "/leaderboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: false, visible: false, ai: true, orb: true },
    // The greeting widget is on: the hero's field is the entry point, so the
    // floating button goes and the shared bar stays hidden.
    { name: "dashboard with hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: true, visible: false, ai: false, orb: true },
    // The tenant switched the greeting off: the shared bar comes back and the
    // floating button with it. Losing every in-flow entry would be the bug.
    { name: "dashboard without hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: true, ai: true, orb: true },
    // A blocked module renders no hero at all, so the fallback must survive
    // even if the flag is still set from the previous render.
    { name: "blocked dashboard", pathname: "/dashboard", childrenReady: true, moduleBlocked: true, hideContentSearch: true, heroCommandVisible: true, visible: false, ai: true, orb: true },
    { name: "regular page", pathname: "/customers", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: true, ai: true, orb: true },
  ])("keeps $name assistant entry points intentional", ({ ai, orb, visible, ...input }) => {
    expect(dashboardAssistantVisibility(input)).toEqual({
      contentSearchVisible: visible,
      showFloatingAiLauncher: ai,
      showFloatingVoiceOrb: orb,
    })
  })
})
