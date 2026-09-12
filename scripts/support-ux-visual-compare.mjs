import sharp from "sharp"

export const visualPixelDeltaThreshold = 24
export const visualChangedPixelRatioThreshold = 0.005

export async function compareScreenshotPixels(actualPath, baselinePath) {
  const [actual, baseline] = await Promise.all([
    sharp(actualPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(baselinePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  const actualShape = `${actual.info.width}x${actual.info.height}x${actual.info.channels}`
  const baselineShape = `${baseline.info.width}x${baseline.info.height}x${baseline.info.channels}`
  if (actualShape !== baselineShape) {
    return {
      status: "changed",
      reason: "dimensions_changed",
      actualShape,
      baselineShape,
      changedPixelRatio: 1,
      meanChannelDelta: null,
    }
  }

  const pixelCount = actual.info.width * actual.info.height
  let changedPixels = 0
  let channelDeltaTotal = 0
  for (let offset = 0; offset < actual.data.length; offset += actual.info.channels) {
    let pixelDelta = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(actual.data[offset + channel] - baseline.data[offset + channel])
      channelDeltaTotal += delta
      pixelDelta = Math.max(pixelDelta, delta)
    }
    if (pixelDelta > visualPixelDeltaThreshold) changedPixels += 1
  }
  const changedPixelRatio = changedPixels / pixelCount
  return {
    status: changedPixelRatio <= visualChangedPixelRatioThreshold ? "matched" : "changed",
    reason: changedPixelRatio <= visualChangedPixelRatioThreshold ? "within_tolerance" : "pixel_delta_exceeded",
    actualShape,
    baselineShape,
    changedPixels,
    pixelCount,
    changedPixelRatio,
    meanChannelDelta: channelDeltaTotal / (pixelCount * 3),
    pixelDeltaThreshold: visualPixelDeltaThreshold,
    changedPixelRatioThreshold: visualChangedPixelRatioThreshold,
  }
}
