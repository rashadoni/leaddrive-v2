import { getDemoModules } from "./catalog"
import { DEMO_JOURNEY_MODULES, isDemoJourneyModuleId } from "./journey/modules"

/**
 * The names of what a request asked to see. A guided-demo request carries the
 * demo's modules (journey/modules.ts) — the form's choice since 2026-10-18;
 * an older one, or a module playlist picked in Demo Center, the catalog's.
 * Some ids are in both lists («marketing», «omnichannel», «contracts»): the
 * guided demo's name wins, since that is what the prospect ticked.
 */
export function requestedModuleNames(ids: readonly string[]): string[] {
  const names: string[] = []
  for (const id of ids) {
    if (isDemoJourneyModuleId(id)) {
      names.push(DEMO_JOURNEY_MODULES.find((module) => module.id === id)!.title)
      continue
    }
    const [catalog] = getDemoModules([id])
    if (catalog) names.push(catalog.title)
  }
  return names
}
