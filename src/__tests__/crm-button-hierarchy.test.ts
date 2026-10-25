import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { findButtonViolations, scanCrmButtons } from "../../scripts/check-crm-button-hierarchy.mjs"

describe("CRM action hierarchy source guard", () => {
  it("keeps every action/background pair neutral and readable in either theme", () => {
    const css = readFileSync("src/app/crm-workspace.css", "utf8")
    const pairs = [...css.matchAll(/\{([^{}]*--crm-action:[^{}]*)\}/g)]
    expect(pairs.length).toBeGreaterThanOrEqual(3)
    const luminance = (lightness: number) => {
      const value = lightness / 100
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    for (const [, block] of pairs) {
      const foreground = block.match(/--crm-action-foreground:\s*0 0% ([\d.]+)%;/)
      expect(foreground).not.toBeNull()
      for (const property of ["crm-action", "crm-action-hover"]) {
        const background = block.match(new RegExp(`--${property}:\\s*0 0% ([\\d.]+)%;`))
        expect(background).not.toBeNull()
        const values = [luminance(Number(background![1])), luminance(Number(foreground![1]))]
        expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("covers every CRM route and shared component without unclassified exceptions", () => {
    const result = scanCrmButtons()
    expect(result.files).toBeGreaterThan(700)
    expect(result.problems).toEqual([])
  })

  it.each([
    ['<Button variant={activeFilter === key ? "default" : "outline"} />', "selection-uses-primary"],
    ['<button className="bg-primary text-primary-foreground">Save</button>', "native-primary-without-shared-style"],
    ['<Button className="bg-orange-600 text-white">Save</Button>', "local-action-colour"],
    ['<Button className="text-white">Save</Button>', "fixed-white-text-breaks-dark-primary"],
    ['<a className="bg-[#EA580C]">Create</a>', "local-action-colour"],
  ])("detects a future bypass: %s", (source, rule) => {
    expect(findButtonViolations(source).map(item => item.rule)).toContain(rule)
  })

  it("allows the shared styles, selected controls and explicit semantic actions", () => {
    const source = `<><Button>Save</Button>
      <Button variant={selected ? "selected" : "outline"}>Filter</Button>
      <button data-crm-button="default" className="bg-primary text-primary-foreground">Create</button>
      <Button data-crm-color-role="call" className="bg-emerald-600 text-white">Answer</Button>
      <Button variant="destructive">Delete</Button></>`
    expect(findButtonViolations(source)).toEqual([])
  })

  it("does not accept an invented semantic exception", () => {
    expect(findButtonViolations('<Button data-crm-color-role="ignore" className="bg-orange-600" />')).not.toEqual([])
  })
})
