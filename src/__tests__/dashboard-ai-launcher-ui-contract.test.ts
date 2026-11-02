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
    expect(layout).toContain("{contentSearchVisible && <ContentSearchBar compact={compactSupportSearch} />}")
    // The shell still guards the retired bar through the central visibility
    // policy. Existing search entry points remain mounted independently.
    expect(layout).toContain("<CommandSearch />")
    expect(source("src/components/dashboard/dashboard-welcome.tsx")).toContain('className="dashboard-welcome-command"')
    expect(layout).toContain('pathname.startsWith("/leaderboard")')
    expect(layout).toContain("isDashboardHome && heroCommandVisible")
    expect(layout).toContain("heroCommandVisible: isDashboardHome && heroCommandVisible")
    // While the dashboard loads, its skeleton holds the hero field; saying
    // "no field" then flashed the orange shared bar on every open.
    const dashboardPage = source("src/app/(dashboard)/dashboard/page.tsx")
    expect(dashboardPage).toContain("setHeroCommandVisible(loading || showGreeting)")
    expect(dashboardPage).not.toContain("setHeroCommandVisible(showGreeting && !loading)")
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
    expect(voiceConsole).toContain('inline ? "h-9 w-9" : "h-14 w-14"')
    // The inline line appears only when there is something to say. Its list of
    // conditions grows as new warnings are added (unapplied noise suppression,
    // 2026-09-20), so pin that each one participates rather than their order —
    // the previous literal broke on an addition that was entirely correct.
    const inlineMessage = voiceConsole.match(/const showInlineMessage = Boolean\(([^)]*)\)/)
    expect(inlineMessage, "showInlineMessage must stay a single Boolean of the message conditions")
      .not.toBeNull()
    for (const condition of ["error", "notice", "micSilent", "transcriptionWarning", "noiseSuppressionOff"]) {
      expect(inlineMessage?.[1], condition).toContain(condition)
    }
    expect(voiceConsole).toContain("showInlineMessage")
    expect(voice).toContain('data-placement={activeInlineHost ? "inline" : "floating"}')
    expect(voiceConsole).toContain('data-placement={inline ? "inline" : "floating"}')
  })

  it("docks the microphone in the header instead of over page content", () => {
    // Owner report 2026-09-14: the floating orb covered row menus, priority
    // labels, period buttons and chart labels on every MTM page. The header
    // hosts it now; gating is untouched — the slot is empty for anyone the
    // pilot gate does not allow.
    const header = source("src/components/header.tsx")
    expect(header).toContain('id="header-voice-assistant-slot"')
    expect(header).toContain("flex shrink-0 items-center empty:hidden")
    expect(header.indexOf('id="header-voice-assistant-slot"')).toBeGreaterThan(header.indexOf('data-testid="global-header-actions"'))
    expect(header.indexOf('id="header-voice-assistant-slot"')).toBeLessThan(header.indexOf("<NotificationBell />"))
    // No z-index on the header: `relative z-30` lifted it over dialogs that
    // render in place inside positioned page wrappers (review of PR #206).
    expect(header).not.toMatch(/data-testid="global-header"[\s\S]{0,200}className="[^"]*\bz-\d/)
    expect(voice).toContain('document.getElementById("header-voice-assistant-slot")')
    // The header host is never gated on an IntersectionObserver: the slot is
    // display:none while empty, and a display:none box never intersects.
    expect(voice).toContain('if (inlineHost.id === "header-voice-assistant-slot") return')
    expect(voice).toContain("const inlineReachable = hostIsHeader || (Boolean(inlineHost) && inlineHostVisible)")
    // The status line is portalled to <body> below dialogs instead.
    // …into a layer inside the shell's own stacking context, so in-place
    // dialogs (z-[60]) still cover it; <body> would sit above all of them.
    const status = source("src/components/ai/voice-inline-status.tsx")
    expect(status).toContain("createPortal(")
    expect(status).toContain('VOICE_STATUS_LAYER_ID = "dashboard-voice-status-layer"')
    expect(status).toContain("fixed z-50")
    const statusLayer = layout.match(/<div\b[^>]*\bid="dashboard-voice-status-layer"[^>]*\/>/)?.[0]
    expect(statusLayer).toContain('data-crm-workspace=""')
    expect(layout.indexOf('id="dashboard-voice-status-layer"')).toBeGreaterThan(layout.indexOf('className="relative z-[2] flex h-screen min-w-0"'))
    expect(voiceConsole).toContain("<VoiceInlineStatus")
    expect(voice).toContain("<VoiceInlineStatus")
    expect(voiceConsole).not.toContain("absolute right-0 top-full z-20")
    expect(voice).not.toContain("absolute right-0 top-full z-20")
    // The fallback slot in the AI bar keeps a box while empty for the same reason.
    expect(search).not.toMatch(/id="dashboard-voice-assistant-slot"[\s\S]{0,120}empty:hidden/)
    // Placement only: the access check and the lazy console are unchanged.
    expect(voice).toContain('fetch("/api/v1/ai/voice/access", { credentials: "same-origin" })')
    expect(voice).toContain("if (!allowed) return null")
  })

  it("keeps the panel reachable from the in-flow search or blocked-page fallback", () => {
    expect(search).toContain('window.dispatchEvent(new CustomEvent("davinci:open"')
    expect(panel).toContain('window.addEventListener("davinci:open"')
    expect(panel).toContain('data-testid="ai-assistant-launcher"')
    expect(panel).toContain("aria-label={uiText.title}")
  })

  // Дублирующая строка удалена в том числе с главной. Проверяем также
  // загрузку и выключенное приветствие, сохраняя отдельную voice-политику.
  it.each([
    { name: "MTM root", pathname: "/mtm", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "MTM workflow", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "blocked MTM", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: true, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "hydrating MTM", pathname: "/mtm", childrenReady: false, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: false },
    { name: "leaderboard", pathname: "/leaderboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: false, visible: false, ai: false, orb: true },
    // Приветствие включено: поле в нём и есть вход, строка не нужна.
    { name: "dashboard with hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: true, visible: false, ai: false, orb: true },
    { name: "dashboard without hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "hydrating dashboard", pathname: "/dashboard", childrenReady: false, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "blocked dashboard", pathname: "/dashboard", childrenReady: true, moduleBlocked: true, hideContentSearch: true, heroCommandVisible: true, visible: false, ai: false, orb: true },
    // Обычная внутренняя страница — то, на что жаловался владелец: ни строки,
    // ни кнопки.
    { name: "regular page", pathname: "/customers", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
  ])("keeps $name assistant entry points intentional", ({ ai, orb, visible, ...input }) => {
    expect(dashboardAssistantVisibility(input)).toEqual({
      contentSearchVisible: visible,
      showFloatingAiLauncher: ai,
      showFloatingVoiceOrb: orb,
    })
  })

  it("never shows the floating Da Vinci button, on any page", () => {
    // Негативный якорь. Без него таблица выше «зелёная» и при возврате кнопки
    // на одной ветке условия: строк много, забыть одну легко.
    const paths = ["/dashboard", "/customers", "/mtm", "/mtm/routes", "/leaderboard", "/invoices"]
    for (const pathname of paths) {
      for (const moduleBlocked of [false, true]) {
        for (const heroCommandVisible of [false, true]) {
          const v = dashboardAssistantVisibility({ pathname, childrenReady: true, moduleBlocked, hideContentSearch: false, heroCommandVisible })
          expect(v.showFloatingAiLauncher).toBe(false)
        }
      }
    }
  })

  it("keeps the retired search bar absent throughout loading and hero changes", () => {
    for (const pathname of ["/dashboard", "/customers", "/deals", "/mtm", "/leaderboard", "/invoices", "/tickets"]) {
      for (const childrenReady of [false, true]) {
        for (const heroCommandVisible of [false, true]) {
          expect(
            dashboardAssistantVisibility({ pathname, childrenReady, moduleBlocked: false, hideContentSearch: heroCommandVisible, heroCommandVisible }).contentSearchVisible,
          ).toBe(false)
        }
      }
    }
  })
})
