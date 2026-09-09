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

  // Таблица переписана после решения владельца убрать оранжевую строку и
  // плавающую кнопку со всех внутренних страниц. Теперь у строки ровно одно
  // место — главная с выключенным приветствием, — а плавающей кнопки нет
  // нигде. Голосовой шар не трогали: другая модальность, закрыт списком
  // пилота. На MTM он снова плавает, потому что встроенная посадка держалась
  // на слоте внутри строки поиска, а строки там больше нет.
  it.each([
    { name: "MTM root", pathname: "/mtm", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "MTM workflow", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "blocked MTM", pathname: "/mtm/routes", childrenReady: true, moduleBlocked: true, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: true },
    { name: "hydrating MTM", pathname: "/mtm", childrenReady: false, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: false, ai: false, orb: false },
    { name: "leaderboard", pathname: "/leaderboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: false, visible: false, ai: false, orb: true },
    // Приветствие включено: поле в нём и есть вход, строка не нужна.
    { name: "dashboard with hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: true, heroCommandVisible: true, visible: false, ai: false, orb: true },
    // Единственный случай, когда строка появляется: тенант выключил
    // приветствие, и без строки на главной не осталось бы входа из потока.
    { name: "dashboard without hero", pathname: "/dashboard", childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false, visible: true, ai: false, orb: true },
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

  it("keeps the shared search bar off every page except the dashboard", () => {
    for (const pathname of ["/customers", "/deals", "/mtm", "/leaderboard", "/invoices", "/tickets"]) {
      expect(
        dashboardAssistantVisibility({ pathname, childrenReady: true, moduleBlocked: false, hideContentSearch: false, heroCommandVisible: false }).contentSearchVisible,
      ).toBe(false)
    }
  })
})
