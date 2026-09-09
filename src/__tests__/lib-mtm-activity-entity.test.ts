import { describe, expect, it } from "vitest"
import { mtmActivityEntityKey, mtmActivityEntityText } from "@/lib/mtm/activity-entity"

const t = (key: string) => `<${key}>`

describe("activity journal object names (field UX audit C12)", () => {
  it("recognises singular, plural and prefixed spellings as one object", () => {
    expect(mtmActivityEntityKey("visit")).toBe("visit")
    expect(mtmActivityEntityKey("visits")).toBe("visit")
    expect(mtmActivityEntityKey("mtm_route")).toBe("route")
    expect(mtmActivityEntityKey("  TASKS ")).toBe("task")
  })

  it("calls an internal object a record instead of printing its table name", () => {
    // `mtm_pharmacy_promotion_execution` is not a word in any language the
    // product speaks.
    expect(mtmActivityEntityKey("mtm_pharmacy_promotion_execution")).toBeNull()
    expect(mtmActivityEntityText({ entity: "mtm_pharmacy_promotion_execution", entityId: "abc" }, t).label)
      .toBe("<entity.record>")
  })

  it("keeps the id out of the line and in the tooltip", () => {
    // Six characters of a cuid told the reader nothing and could not be looked
    // up either; support still gets the whole id on hover.
    const text = mtmActivityEntityText({ entity: "visit", entityId: "cm2xk9f4f0001" }, t)
    expect(text.label).toBe("<entity.visit>")
    expect(text.label).not.toContain("cm2xk")
    expect(text.title).toBe("cm2xk9f4f0001")
  })

  it("has no tooltip when there is no id", () => {
    expect(mtmActivityEntityText({ entity: "task", entityId: null }, t).title).toBeNull()
    expect(mtmActivityEntityText({ entity: "task", entityId: "   " }, t).title).toBeNull()
    expect(mtmActivityEntityText({}, t)).toEqual({ label: "<entity.record>", title: null })
  })
})
