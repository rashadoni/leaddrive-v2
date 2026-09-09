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
  const isDashboardHome = pathname === "/dashboard"

  // Решение владельца: ни оранжевой строки поиска, ни плавающей кнопки на
  // внутренних страницах быть не должно. На главной есть поле Da Vinci в
  // приветствии, и его достаточно; советник, кроме того, открывается из
  // бокового меню на любой странице.
  //
  // Поэтому общая строка живёт ТОЛЬКО на главной и только как замена полю —
  // когда виджет приветствия выключен тенантом. Без этой оговорки тот, кто
  // выключил приветствие, остался бы вообще без входа в советника из потока
  // страницы; ровно это и защищал прежний фолбэк.
  const contentSearchVisible =
    childrenReady && !moduleBlocked && isDashboardHome && !hideContentSearch

  // Голосовой шар — другая модальность и он закрыт списком пилота, поэтому
  // остаётся. Его прежняя встроенная посадка держалась на строке поиска
  // (слот dashboard-voice-assistant-slot внутри неё): там, где строки больше
  // нет, шару некуда встраиваться, и он снова плавает.
  const showFloatingAssistants = !isMtmRoute || (childrenReady && !contentSearchVisible)

  return {
    contentSearchVisible,
    // Поле оставлено, а не удалено: панель советника по-прежнему смонтирована
    // и слушает событие davinci:open от строки поиска. Это единственный
    // выключатель, если владелец захочет кнопку обратно.
    showFloatingAiLauncher: false,
    showFloatingVoiceOrb: showFloatingAssistants,
  }
}
