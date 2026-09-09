export interface DashboardAssistantVisibilityInput {
  pathname: string
  childrenReady: boolean
  moduleBlocked: boolean
  hideContentSearch: boolean
  /**
   * The dashboard hero's "ask Da Vinci" field is on screen. Only ever true on
   * the dashboard itself; see `DashboardHeroProvider`.
   */
  heroCommandVisible?: boolean
}

export interface DashboardAssistantVisibility {
  contentSearchVisible: boolean
  showFloatingAiLauncher: boolean
  showFloatingVoiceOrb: boolean
}

export function dashboardAssistantVisibility({
  pathname,
  childrenReady,
  moduleBlocked,
  hideContentSearch,
  heroCommandVisible = false,
}: DashboardAssistantVisibilityInput): DashboardAssistantVisibility {
  const isMtmRoute = pathname === "/mtm" || pathname.startsWith("/mtm/")
  const contentSearchVisible = childrenReady && !moduleBlocked && !hideContentSearch
  // Regular MTM work surfaces already have an in-flow AI entry point and use
  // sticky controls near the screen edge. Keep both floating assistants away
  // from those actions. A blocked MTM page has no in-flow search, so restore
  // the floating launchers after session hydration instead of stranding AI.
  const showFloatingAssistants = !isMtmRoute || (childrenReady && !contentSearchVisible)

  // The dashboard hero's command field opens the same Da Vinci panel as the
  // floating button, so while it is on screen the button is a second door to
  // one room — the duplication the owner objected to. The voice orb stays: it
  // is a different modality, and it is pilot-gated so it renders nothing for
  // almost everyone.
  //
  // Keyed on the field actually being visible, not on the route: the hero is a
  // switchable widget now, and a tenant who turns the greeting off must keep a
  // way to reach the assistant.
  const heroOwnsTheAssistant = heroCommandVisible && !moduleBlocked

  return {
    contentSearchVisible,
    showFloatingAiLauncher: showFloatingAssistants && !heroOwnsTheAssistant,
    showFloatingVoiceOrb: showFloatingAssistants,
  }
}
