/**
 * Thin index over the coverage inventory so `validate.ts` and the tests
 * share one lookup and one «product areas that must meet the target» list.
 */
import { DEMO_JOURNEY_COVERAGE, coverageAreaFor, computeCoverage, DEMO_COVERAGE_TARGET_PERCENT, type DemoCoverageArea } from "./coverage"
import { DEMO_PRODUCT_AREAS } from "./types"

export { coverageAreaFor, computeCoverage, DEMO_COVERAGE_TARGET_PERCENT }

export const DEMO_PRODUCT_AREAS_WITH_COVERAGE: readonly DemoCoverageArea[] = DEMO_PRODUCT_AREAS.map((area) => {
  const entry = DEMO_JOURNEY_COVERAGE.find((candidate) => candidate.area === area)
  if (!entry) throw new Error(`Coverage inventory is missing product area "${area}"`)
  return entry
})
