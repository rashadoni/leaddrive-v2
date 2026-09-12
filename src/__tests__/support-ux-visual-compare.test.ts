import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"
import {
  compareScreenshotPixels,
  visualChangedPixelRatioThreshold,
} from "../../scripts/support-ux-visual-compare.mjs"

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "support-ux-visual-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeSolidPng(filePath: string, width: number, height: number, background: { r: number; g: number; b: number }) {
  await sharp({ create: { width, height, channels: 3, background } }).png().toFile(filePath)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Support UX visual comparison", () => {
  it("accepts a small dynamic region within the documented tolerance", async () => {
    const directory = await temporaryDirectory()
    const baseline = path.join(directory, "baseline.png")
    const actual = path.join(directory, "actual.png")
    await writeSolidPng(baseline, 100, 100, { r: 255, g: 255, b: 255 })
    await sharp(baseline)
      .composite([{ input: { create: { width: 5, height: 5, channels: 3, background: { r: 0, g: 0, b: 0 } } }, left: 0, top: 0 }])
      .png()
      .toFile(actual)

    const result = await compareScreenshotPixels(actual, baseline)
    expect(result.status).toBe("matched")
    expect(result.changedPixelRatio).toBeLessThanOrEqual(visualChangedPixelRatioThreshold)
  })

  it("rejects a material pixel change", async () => {
    const directory = await temporaryDirectory()
    const baseline = path.join(directory, "baseline.png")
    const actual = path.join(directory, "actual.png")
    await writeSolidPng(baseline, 100, 100, { r: 255, g: 255, b: 255 })
    await sharp(baseline)
      .composite([{ input: { create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } }, left: 0, top: 0 }])
      .png()
      .toFile(actual)

    const result = await compareScreenshotPixels(actual, baseline)
    expect(result.status).toBe("changed")
    expect(result.reason).toBe("pixel_delta_exceeded")
  })

  it("rejects changed screenshot dimensions", async () => {
    const directory = await temporaryDirectory()
    const baseline = path.join(directory, "baseline.png")
    const actual = path.join(directory, "actual.png")
    await writeSolidPng(baseline, 100, 100, { r: 255, g: 255, b: 255 })
    await writeSolidPng(actual, 99, 100, { r: 255, g: 255, b: 255 })

    const result = await compareScreenshotPixels(actual, baseline)
    expect(result).toMatchObject({ status: "changed", reason: "dimensions_changed" })
  })
})
