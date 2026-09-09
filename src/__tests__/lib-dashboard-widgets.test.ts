/**
 * Tests for I2 Dashboard Builder slice 1 — widget contracts + validation.
 * Pure functional, no Prisma, no network.
 */
import { describe, it, expect } from "vitest"
import {
  WIDGET_CATALOG,
  WIDGET_SPECS_BY_TYPE,
  validateWidgetConfig,
  validateLayout,
  type WidgetInstance,
  type DashboardLayoutPayload,
  type WidgetType,
} from "@/lib/dashboard/widgets"

function widget(overrides: Partial<WidgetInstance> = {}): WidgetInstance {
  return {
    id: "w1",
    type: "kpi_card",
    title: "Revenue",
    position: { x: 0, y: 0, w: 3, h: 2 },
    config: { metric: "revenue.total" },
    ...overrides,
  }
}

function layout(widgets: WidgetInstance[], cols = 12): DashboardLayoutPayload {
  return { version: 1, cols, widgets }
}

describe("I2 widgets — catalog integrity", () => {
  it("all 15 widget types catalogued", () => {
    expect(WIDGET_CATALOG.length).toBeGreaterThanOrEqual(15)
  })

  it("every type appears exactly once", () => {
    const types = WIDGET_CATALOG.map(w => w.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it("every spec has non-empty label, category, description", () => {
    for (const spec of WIDGET_CATALOG) {
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.category.length).toBeGreaterThan(0)
      expect(spec.description.length).toBeGreaterThan(0)
    }
  })

  it("minSize <= maxSize for every spec", () => {
    for (const spec of WIDGET_CATALOG) {
      expect(spec.minSize.w).toBeLessThanOrEqual(spec.maxSize.w)
      expect(spec.minSize.h).toBeLessThanOrEqual(spec.maxSize.h)
    }
  })

  it("WIDGET_SPECS_BY_TYPE map matches catalog", () => {
    expect(WIDGET_SPECS_BY_TYPE.size).toBe(WIDGET_CATALOG.length)
    for (const spec of WIDGET_CATALOG) {
      expect(WIDGET_SPECS_BY_TYPE.get(spec.type)).toBe(spec)
    }
  })
})

describe("I2 widgets — validateWidgetConfig", () => {
  it("accepts a valid kpi_card", () => {
    expect(validateWidgetConfig(widget())).toEqual([])
  })

  it("rejects unknown widget type", () => {
    const w = widget({ type: "not_a_type" as WidgetType })
    const issues = validateWidgetConfig(w)
    expect(issues[0].message).toContain("Unknown widget type")
  })

  it("requires title", () => {
    const w = widget({ title: "" })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message.includes("title"))).toBe(true)
  })

  it("requires id", () => {
    const w = widget({ id: "" })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message.includes("id"))).toBe(true)
  })

  it("flags missing required config field", () => {
    const w = widget({ config: {} }) // kpi_card requires `metric`
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "metric")).toBe(true)
  })

  it("flags wrong config field type", () => {
    const w = widget({ config: { metric: 42 } }) // metric must be string
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "metric" && i.message.includes("string"))).toBe(true)
  })

  it("flags select value not in options", () => {
    const w = widget({ config: { metric: "x", compareTo: "two_years_ago" } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "compareTo")).toBe(true)
  })

  it("accepts valid select value", () => {
    const w = widget({ config: { metric: "x", compareTo: "previous_year" } })
    expect(validateWidgetConfig(w)).toEqual([])
  })

  it("flags non-number for number config field", () => {
    const w = widget({
      type: "kpi_trend",
      config: { metric: "x", lookbackDays: "30" }, // string, not number
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "lookbackDays")).toBe(true)
  })

  it("flags NaN as invalid number", () => {
    const w = widget({
      type: "kpi_trend",
      config: { metric: "x", lookbackDays: NaN },
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "lookbackDays")).toBe(true)
  })

  it("rejects position width below widget min", () => {
    const w = widget({
      type: "line_chart", // min w=4
      title: "Chart",
      position: { x: 0, y: 0, w: 2, h: 4 }, // width 2 < min 4
      config: { savedReportId: "r1", xField: "x", yField: "y" },
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "position.w")).toBe(true)
  })

  it("rejects position width above widget max", () => {
    const w = widget({
      type: "kpi_card", // max w=6
      position: { x: 0, y: 0, w: 8, h: 2 },
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "position.w")).toBe(true)
  })

  it("rejects negative x", () => {
    const w = widget({ position: { x: -1, y: 0, w: 3, h: 2 } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "position.x")).toBe(true)
  })

  it("rejects widget overflowing grid columns", () => {
    const w = widget({ position: { x: 11, y: 0, w: 4, h: 2 } }) // 11+4 > 12
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message.includes("overflows"))).toBe(true)
  })

  it("does NOT throw when position is missing — pushes issue, returns cleanly", () => {
    const w = widget({ position: undefined as unknown as WidgetInstance["position"] })
    expect(() => validateWidgetConfig(w)).not.toThrow()
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message === "Position is required")).toBe(true)
  })

  it("rejects non-numeric position field (e.g. string '5' bypass)", () => {
    const w = widget({
      position: { x: "5" as unknown as number, y: 0, w: 3, h: 2 },
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "position" && i.message.includes("finite numbers"))).toBe(true)
    // and does NOT push range-violation issues (we stopped at the type guard)
    expect(issues.some(i => i.field === "position.x")).toBe(false)
  })

  it("rejects NaN in position", () => {
    const w = widget({ position: { x: NaN, y: 0, w: 3, h: 2 } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message.includes("finite numbers"))).toBe(true)
  })

  it("rejects Infinity in position", () => {
    const w = widget({ position: { x: 0, y: 0, w: Infinity, h: 2 } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.message.includes("finite numbers"))).toBe(true)
  })

  it("accepts optional boolean config field", () => {
    const w = widget({
      type: "area_chart",
      position: { x: 0, y: 0, w: 6, h: 4 },
      config: { savedReportId: "r1", xField: "x", yField: "y", stacked: true },
    })
    expect(validateWidgetConfig(w)).toEqual([])
  })

  it("flags non-boolean for boolean field", () => {
    const w = widget({
      type: "area_chart",
      position: { x: 0, y: 0, w: 6, h: 4 },
      config: { savedReportId: "r1", xField: "x", yField: "y", stacked: "yes" },
    })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "stacked")).toBe(true)
  })

  it("treats empty string as missing for required field", () => {
    const w = widget({ config: { metric: "" } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "metric" && i.message.includes("required"))).toBe(true)
  })

  it("treats null as missing for required field", () => {
    const w = widget({ config: { metric: null as unknown as string } })
    const issues = validateWidgetConfig(w)
    expect(issues.some(i => i.field === "metric")).toBe(true)
  })
})

describe("I2 widgets — validateLayout", () => {
  it("accepts a valid empty layout", () => {
    const r = validateLayout(layout([]))
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
  })

  it("accepts a valid single-widget layout", () => {
    const r = validateLayout(layout([widget()]))
    expect(r.valid).toBe(true)
  })

  it("rejects unsupported version", () => {
    const r = validateLayout({ version: 99 as 1, cols: 12, widgets: [] })
    expect(r.valid).toBe(false)
    expect(r.issues[0].message).toContain("version")
  })

  it("rejects invalid cols", () => {
    expect(validateLayout({ version: 1, cols: 0, widgets: [] }).valid).toBe(false)
    expect(validateLayout({ version: 1, cols: 13, widgets: [] }).valid).toBe(false)
    expect(validateLayout({ version: 1, cols: 12.5 as unknown as number, widgets: [] }).valid).toBe(false)
  })

  it("rejects non-array widgets", () => {
    const r = validateLayout({ version: 1, cols: 12, widgets: "not array" as unknown as WidgetInstance[] })
    expect(r.valid).toBe(false)
  })

  it("detects duplicate widget ids", () => {
    const r = validateLayout(layout([widget({ id: "w1" }), widget({ id: "w1", position: { x: 3, y: 0, w: 3, h: 2 } })]))
    expect(r.valid).toBe(false)
    expect(r.issues.some(i => i.message.includes("Duplicate"))).toBe(true)
  })

  it("detects overlapping widgets", () => {
    const a = widget({ id: "a", position: { x: 0, y: 0, w: 4, h: 3 } })
    const b = widget({ id: "b", position: { x: 2, y: 1, w: 4, h: 3 } }) // overlaps with a
    const r = validateLayout(layout([a, b]))
    expect(r.valid).toBe(false)
    expect(r.issues.some(i => i.message.includes("overlap"))).toBe(true)
  })

  it("accepts side-by-side widgets that touch but don't overlap", () => {
    const a = widget({ id: "a", position: { x: 0, y: 0, w: 3, h: 2 } })
    const b = widget({ id: "b", position: { x: 3, y: 0, w: 3, h: 2 } })
    const r = validateLayout(layout([a, b]))
    expect(r.valid).toBe(true)
  })

  it("accepts vertically stacked widgets that touch", () => {
    const a = widget({ id: "a", position: { x: 0, y: 0, w: 3, h: 2 } })
    const b = widget({ id: "b", position: { x: 0, y: 2, w: 3, h: 2 } })
    const r = validateLayout(layout([a, b]))
    expect(r.valid).toBe(true)
  })

  it("aggregates issues across widgets", () => {
    const broken1 = widget({ id: "a", config: {} }) // missing metric
    const broken2 = widget({ id: "b", title: "", position: { x: 5, y: 0, w: 3, h: 2 } }) // missing title
    const r = validateLayout(layout([broken1, broken2]))
    expect(r.valid).toBe(false)
    expect(r.issues.filter(i => i.widgetId === "a").length).toBeGreaterThan(0)
    expect(r.issues.filter(i => i.widgetId === "b").length).toBeGreaterThan(0)
  })
})
