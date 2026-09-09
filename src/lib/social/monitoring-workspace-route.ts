export type MonitoringWorkspaceRoute =
  | { kind: "directory" }
  | {
      kind: "brand"
      monitoringId: string
      subjectId?: string
      name: string
    }
  | { kind: "all" }

export type MonitoringWorkspaceRouteOptions = {
  view?: string | null
}

const WORKSPACE_PARAM_KEYS = [
  "monitoringId",
  "scope",
  "subjectId",
  "subjectName",
  "view",
] as const

function trimmed(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ""
  return normalized || null
}

function normalizedToolView(value: string | null | undefined): string | null {
  const view = trimmed(value)
  return view && view !== "monitors" ? view : null
}

/**
 * Resolves the workspace shell independently from the tool shown inside it.
 *
 * A monitoring ID is authoritative so old `scenario:*` profiles and profiles
 * without a subject remain addressable. Without one, an explicit all-brand
 * scope or any legacy tool URL belongs to the all-brand workspace.
 */
export function parseMonitoringWorkspaceRoute(
  params: URLSearchParams,
): MonitoringWorkspaceRoute {
  const monitoringId = trimmed(params.get("monitoringId"))

  if (monitoringId) {
    const subjectId = trimmed(params.get("subjectId"))
    const name = trimmed(params.get("subjectName")) ?? monitoringId

    return {
      kind: "brand",
      monitoringId,
      ...(subjectId ? { subjectId } : {}),
      name,
    }
  }

  const scope = trimmed(params.get("scope"))
  const view = trimmed(params.get("view"))
  if (scope === "all" || (view !== null && view !== "monitors")) {
    return { kind: "all" }
  }

  return { kind: "directory" }
}

/**
 * Returns canonical workspace parameters without mutating the supplied query.
 * Filters not owned by the workspace (for example platform, date, or search)
 * are deliberately preserved.
 */
export function applyMonitoringWorkspaceRoute(
  currentParams: URLSearchParams,
  route: MonitoringWorkspaceRoute,
  options: MonitoringWorkspaceRouteOptions = {},
): URLSearchParams {
  const params = new URLSearchParams(currentParams)

  for (const key of WORKSPACE_PARAM_KEYS) params.delete(key)

  if (route.kind === "directory") {
    // Каталог должен быть адресуемым: голый URL зарезервирован под первый
    // визит (редирект на обзор), поэтому каталог явно несёт view=monitors —
    // так перезагрузка страницы каталога не телепортирует в обзор.
    params.set("view", "monitors")
    return params
  }

  if (route.kind === "all") {
    params.set("scope", "all")
    params.set("view", normalizedToolView(options.view) ?? "overview")
    return params
  }

  const monitoringId = trimmed(route.monitoringId)
  const name = trimmed(route.name)
  if (!monitoringId) {
    throw new TypeError("A brand workspace requires a non-blank monitoringId")
  }
  if (!name) {
    throw new TypeError("A brand workspace requires a non-blank name")
  }

  params.set("monitoringId", monitoringId)
  const subjectId = trimmed(route.subjectId)
  if (subjectId) params.set("subjectId", subjectId)
  params.set("subjectName", name)

  const view = normalizedToolView(options.view)
  if (view) params.set("view", view)

  return params
}

export function buildMonitoringWorkspaceSearch(
  currentParams: URLSearchParams,
  route: MonitoringWorkspaceRoute,
  options?: MonitoringWorkspaceRouteOptions,
): string {
  const search = applyMonitoringWorkspaceRoute(currentParams, route, options).toString()
  return search ? `?${search}` : ""
}
