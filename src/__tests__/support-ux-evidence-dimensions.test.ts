import { describe, expect, it, vi } from "vitest"

import {
  applySupportVisionDeficiency,
  supportEvidenceCaptureDimensions,
  supportEvidenceDimensions,
  supportEvidenceDimensionsMatch,
  supportEvidenceScreenshotName,
  supportEvidenceSupportsLegacyBaseline,
  supportEvidenceViewports,
  supportEvidenceVisionDeficiencies,
  validateSupportEvidenceInteractionDimensions,
} from "../../scripts/support-ux-evidence-dimensions.mjs"

describe("Support UX optional capture dimensions", () => {
  it("preserves the original four default viewports with standard vision", () => {
    const dimensions = supportEvidenceCaptureDimensions(supportEvidenceViewports(), supportEvidenceVisionDeficiencies())
    expect(dimensions.map((item) => item.viewport)).toEqual(["desktop", "tablet", "narrow-tablet", "mobile"])
    expect(dimensions.map((item) => item.visionDeficiency)).toEqual(Array(4).fill("standard"))
    expect(dimensions.map((item) => [item.viewportWidth, item.viewportHeight, item.expectsTouch])).toEqual([
      [1440, 900, false], [1024, 900, true], [768, 900, true], [375, 812, true],
    ])
  })

  it("captures the exact additional desktop with mouse/keyboard in every selected vision state", () => {
    const dimensions = supportEvidenceCaptureDimensions(supportEvidenceViewports("desktop-1366"), supportEvidenceVisionDeficiencies("standard,protanopia,deuteranopia,tritanopia"))
    expect(dimensions).toHaveLength(4)
    for (const item of dimensions) expect(item).toMatchObject({ viewport: "desktop-1366", viewportWidth: 1366, viewportHeight: 768, expectsTouch: false })
    expect(dimensions.map((item) => item.visionDeficiency)).toEqual(["standard", "protanopia", "deuteranopia", "tritanopia"])
  })

  it.each(["", " ", "desktop-1367", "desktop,unknown", "__proto__"])("rejects an unsupported viewport selection %j", (value) => {
    expect(() => supportEvidenceViewports(value)).toThrow()
  })

  it.each(["", " ", "blurredVision", "standard,unknown"])("rejects an unsupported vision selection %j", (value) => {
    expect(() => supportEvidenceVisionDeficiencies(value)).toThrow()
  })

  it("preserves the original mutating matrix and admits optional dimensions for read-only capture", () => {
    expect(() => validateSupportEvidenceInteractionDimensions("mutating", supportEvidenceViewports(), supportEvidenceVisionDeficiencies())).not.toThrow()
    expect(() => validateSupportEvidenceInteractionDimensions("read-only", supportEvidenceViewports("desktop-1366"), supportEvidenceVisionDeficiencies("standard,protanopia,deuteranopia,tritanopia"))).not.toThrow()
  })

  it.each([
    ["desktop-1366", "standard"],
    ["desktop,desktop-1366", "standard"],
    ["desktop", "protanopia"],
    ["mobile", "standard,deuteranopia"],
    ["tablet", "tritanopia"],
  ])("rejects optional dimensions %s / %s before mutating workflows run", (viewport, vision) => {
    expect(() => validateSupportEvidenceInteractionDimensions("mutating", supportEvidenceViewports(viewport), supportEvidenceVisionDeficiencies(vision))).toThrow("require read-only interaction mode")
  })

  it("rejects an unrecognized interaction mode", () => {
    expect(() => validateSupportEvidenceInteractionDimensions("", supportEvidenceViewports(), supportEvidenceVisionDeficiencies())).toThrow("must be read-only or mutating")
  })

  it("retains standard filenames and separates simulated captures", () => {
    const parts = ["service-desk", "agent", "en", "light", "desktop", "typical"]
    expect(supportEvidenceScreenshotName(parts, "standard")).toBe("service-desk-agent-en-light-desktop-typical.png")
    expect(supportEvidenceScreenshotName(parts, "protanopia")).toBe("service-desk-agent-en-light-desktop-typical-protanopia.png")
    expect(supportEvidenceScreenshotName(parts, "deuteranopia")).not.toBe(supportEvidenceScreenshotName(parts, "tritanopia"))
  })

  it("admits earlier standard artifacts only for their original fixed viewport dimensions", () => {
    const current = supportEvidenceDimensions("desktop")
    expect(supportEvidenceDimensionsMatch(current, { viewport: "desktop", metrics: { viewportHeight: 900 } })).toBe(true)
    expect(supportEvidenceDimensionsMatch(current, { viewport: "desktop", metrics: { viewportHeight: 768 } })).toBe(false)
    expect(supportEvidenceDimensionsMatch(supportEvidenceDimensions("desktop", "protanopia"), { viewport: "desktop" })).toBe(false)
    expect(supportEvidenceDimensionsMatch(supportEvidenceDimensions("desktop-1366"), { viewport: "desktop-1366" })).toBe(false)
  })

  it("requires explicit metadata for optional vision captures even on a legacy viewport name", () => {
    const current = supportEvidenceDimensions("desktop", "protanopia")
    expect(supportEvidenceDimensionsMatch(current, { ...current })).toBe(true)
    expect(supportEvidenceDimensionsMatch(current, { viewport: "desktop", visionDeficiency: "protanopia" })).toBe(false)
    for (const key of ["viewportWidth", "viewportHeight", "expectsTouch", "visionDeficiency"] as const) {
      const incomplete: Record<string, unknown> = { ...current }
      delete incomplete[key]
      expect(supportEvidenceDimensionsMatch(current, incomplete)).toBe(false)
    }
    expect(supportEvidenceSupportsLegacyBaseline(supportEvidenceDimensions("desktop"))).toBe(true)
    expect(supportEvidenceSupportsLegacyBaseline(current)).toBe(false)
    expect(supportEvidenceSupportsLegacyBaseline(supportEvidenceDimensions("desktop-1366"))).toBe(false)
  })

  it("rejects changed pixel dimensions, input modality or vision even when viewport names match", () => {
    const current = supportEvidenceDimensions("desktop-1366", "deuteranopia")
    expect(supportEvidenceDimensionsMatch(current, { ...current })).toBe(true)
    for (const change of [{ viewportWidth: 1440 }, { viewportHeight: 900 }, { expectsTouch: true }, { visionDeficiency: "protanopia" }, { viewport: "desktop" }]) {
      expect(supportEvidenceDimensionsMatch(current, { ...current, ...change })).toBe(false)
    }
    expect(supportEvidenceDimensionsMatch(current, null)).toBe(false)
  })

  it("does not treat malformed new metadata as an older standard artifact", () => {
    const current = supportEvidenceDimensions("desktop")
    for (const change of [{ viewportWidth: null }, { viewportHeight: null }, { expectsTouch: null }, { visionDeficiency: null }]) {
      expect(supportEvidenceDimensionsMatch(current, { ...current, ...change })).toBe(false)
    }
    expect(supportEvidenceDimensionsMatch(current, { ...current, metrics: { viewportWidth: 1366, viewportHeight: 768 } })).toBe(false)
  })

  it("applies simulated vision through CDP and propagates unsupported engine failures", async () => {
    const session = { send: vi.fn().mockResolvedValue(undefined) }
    const context = { newCDPSession: vi.fn().mockResolvedValue(session) }
    const page = { context: () => context }
    await applySupportVisionDeficiency(page, "protanopia")
    expect(context.newCDPSession).toHaveBeenCalledWith(page)
    expect(session.send).toHaveBeenCalledWith("Emulation.setEmulatedVisionDeficiency", { type: "protanopia" })
    session.send.mockRejectedValueOnce(new Error("CDP unsupported"))
    await expect(applySupportVisionDeficiency(page, "tritanopia")).rejects.toThrow("CDP unsupported")
  })

  it("keeps standard capture free of extra CDP operations", async () => {
    const context = { newCDPSession: vi.fn() }
    await applySupportVisionDeficiency({ context: () => context }, "standard")
    expect(context.newCDPSession).not.toHaveBeenCalled()
  })
})
