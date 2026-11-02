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
}: DashboardAssistantVisibilityInput): DashboardAssistantVisibility {
  const isMtmRoute = pathname === "/mtm" || pathname.startsWith("/mtm/")

  // Решение владельца: убрать дублирующую строку AI-поиска полностью,
  // включая загрузку главной и выключенное приветствие. Поиск в шапке,
  // поле приветствия и вход в советника из меню остаются самостоятельными.
  const contentSearchVisible = false

  // Голосовой шар — другая модальность и он закрыт списком пилота, поэтому
  // остаётся. Его прежняя встроенная посадка держалась на строке поиска
  // (слот dashboard-voice-assistant-slot внутри неё): там, где строки больше
  // нет, шару некуда встраиваться, и он снова плавает.
  const showFloatingAssistants = !isMtmRoute || (childrenReady && !contentSearchVisible)

  return {
    contentSearchVisible,
    // Панель советника по-прежнему слушает davinci:open от существующих
    // входов, но дополнительной плавающей кнопки нет.
    showFloatingAiLauncher: false,
    showFloatingVoiceOrb: showFloatingAssistants,
  }
}
