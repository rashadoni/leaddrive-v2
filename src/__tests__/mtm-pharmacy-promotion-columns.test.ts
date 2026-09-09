import { describe, expect, it } from "vitest"
import {
  PHARMACY_PROMOTION_SECONDARY_COLUMNS,
  pharmacyPromotionColumnsFromParam,
} from "@/lib/mtm/pharmacy-promotion-columns"

describe("SWM-09 registry column preferences", () => {
  it("restores the complete supporting view when no preference exists", () => {
    expect([...pharmacyPromotionColumnsFromParam(null)])
      .toEqual([...PHARMACY_PROMOTION_SECONDARY_COLUMNS])
  })

  it("keeps only whitelisted columns in saved URL state", () => {
    expect([...pharmacyPromotionColumnsFromParam(" employee,source ,not-a-column")])
      .toEqual(["employee", "source"])
  })

  it("fails safely to the complete view when a stale preference has no supported columns", () => {
    expect([...pharmacyPromotionColumnsFromParam("legacyColumn,anotherLegacyColumn")])
      .toEqual([...PHARMACY_PROMOTION_SECONDARY_COLUMNS])
  })
})
