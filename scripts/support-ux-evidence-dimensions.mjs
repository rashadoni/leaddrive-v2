export const SUPPORT_EVIDENCE_VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900, hasTouch: false },
  tablet: { width: 1024, height: 900, hasTouch: true },
  "narrow-tablet": { width: 768, height: 900, hasTouch: true },
  mobile: { width: 375, height: 812, hasTouch: true },
  "desktop-1366": { width: 1366, height: 768, hasTouch: false },
})

const legacyViewports = new Set(["desktop", "tablet", "narrow-tablet", "mobile"])
const visionDeficiencies = new Set(["standard", "protanopia", "deuteranopia", "tritanopia"])

function selection(value, fallback, allowed, label) {
  const selected = new Set((value ?? fallback).split(",").map((item) => item.trim()).filter(Boolean))
  if (selected.size === 0) throw new Error(label + " must select at least one value")
  for (const item of selected) {
    if (!allowed.has(item)) throw new Error(label + " contains unsupported value: " + item)
  }
  return selected
}

export function supportEvidenceViewports(value) {
  return selection(value, "desktop,tablet,narrow-tablet,mobile", new Set(Object.keys(SUPPORT_EVIDENCE_VIEWPORTS)), "SUPPORT_EVIDENCE_VIEWPORTS")
}

export function supportEvidenceVisionDeficiencies(value) {
  return selection(value, "standard", visionDeficiencies, "SUPPORT_EVIDENCE_VISION_DEFICIENCIES")
}

export function supportEvidenceDimensions(viewportName, visionDeficiency = "standard") {
  const viewport = Object.hasOwn(SUPPORT_EVIDENCE_VIEWPORTS, viewportName) ? SUPPORT_EVIDENCE_VIEWPORTS[viewportName] : null
  if (!viewport) throw new Error("Unsupported Support evidence viewport: " + viewportName)
  if (!visionDeficiencies.has(visionDeficiency)) throw new Error("Unsupported Support evidence vision deficiency: " + visionDeficiency)
  return {
    viewport: viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    expectsTouch: viewport.hasTouch,
    visionDeficiency,
  }
}

export function supportEvidenceCaptureDimensions(viewports, visions) {
  return [...viewports].flatMap((viewport) => [...visions].map((vision) => supportEvidenceDimensions(viewport, vision)))
}

export function validateSupportEvidenceInteractionDimensions(interactionMode, viewports, visions) {
  if (!new Set(["read-only", "mutating"]).has(interactionMode)) {
    throw new Error("SUPPORT_EVIDENCE_INTERACTION_MODE must be read-only or mutating")
  }
  const dimensions = supportEvidenceCaptureDimensions(viewports, visions)
  if (interactionMode === "mutating" && dimensions.some((dimension) => !legacyViewports.has(dimension.viewport) || dimension.visionDeficiency !== "standard")) {
    throw new Error("Optional Support viewport and vision dimensions require read-only interaction mode")
  }
}

export function supportEvidenceSupportsLegacyBaseline(dimensions) {
  return legacyViewports.has(dimensions.viewport) && dimensions.visionDeficiency === "standard"
}

export function supportEvidenceDimensionsMatch(current, baseline) {
  if (!baseline || current.viewport !== baseline.viewport) return false
  // Earlier artifacts used the original four fixed viewport names and standard
  // vision only. New opt-in dimensions require their explicit metadata.
  const legacyVision = Object.hasOwn(baseline, "visionDeficiency") ? baseline.visionDeficiency : "standard"
  const legacy = supportEvidenceSupportsLegacyBaseline({ viewport: baseline.viewport, visionDeficiency: legacyVision }) ? SUPPORT_EVIDENCE_VIEWPORTS[baseline.viewport] : null
  const baselineVision = Object.hasOwn(baseline, "visionDeficiency") ? baseline.visionDeficiency : (legacy ? "standard" : null)
  const baselineWidth = Object.hasOwn(baseline, "viewportWidth") ? baseline.viewportWidth : legacy?.width
  const baselineHeight = Object.hasOwn(baseline, "viewportHeight") ? baseline.viewportHeight : (baseline.metrics?.viewportHeight ?? legacy?.height)
  const baselineTouch = Object.hasOwn(baseline, "expectsTouch") ? baseline.expectsTouch : legacy?.hasTouch
  return current.visionDeficiency === baselineVision
    && current.viewportWidth === baselineWidth
    && current.viewportHeight === baselineHeight
    && current.expectsTouch === baselineTouch
    && (baseline.metrics?.viewportWidth === undefined || baseline.metrics.viewportWidth === current.viewportWidth)
    && (baseline.metrics?.viewportHeight === undefined || baseline.metrics.viewportHeight === current.viewportHeight)
}

export function supportEvidenceScreenshotName(parts, visionDeficiency) {
  if (!visionDeficiencies.has(visionDeficiency)) throw new Error("Unsupported Support evidence vision deficiency: " + visionDeficiency)
  const suffix = visionDeficiency === "standard" ? [] : [visionDeficiency]
  return [...parts, ...suffix].join("-").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() + ".png"
}

export async function applySupportVisionDeficiency(page, visionDeficiency) {
  if (!visionDeficiencies.has(visionDeficiency)) throw new Error("Unsupported Support evidence vision deficiency: " + visionDeficiency)
  if (visionDeficiency === "standard") return
  // Keep the session attached until the page closes so emulation remains in
  // force through every navigation and screenshot. A failed CDP call fails the
  // cell; unsupported emulation must never be reported as a standard capture.
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setEmulatedVisionDeficiency", { type: visionDeficiency })
}
