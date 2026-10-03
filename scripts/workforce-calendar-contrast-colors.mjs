// This is color math for the bounded hosted text observations, not a page-wide
// accessibility assertion. Paint that the browser collector cannot resolve
// remains NOT_PROVEN. WCAG ratios are compared without rounding:
// https://www.w3.org/TR/WCAG22/#contrast-minimum
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance

/** @typedef {'PASS' | 'FAIL' | 'NOT_PROVEN'} ContrastStatus */
/** @typedef {[number, number]} Interval */
/** @typedef {[Interval, Interval, Interval]} Channels */
/** @typedef {{code: string, path: string, reason?: string}} ContrastFailure */
/** @typedef {{alpha: number, channels: Channels}} ParsedColor */
/**
 * @typedef {object} ContrastRunResult
 * @property {number} index
 * @property {ContrastStatus} status
 * @property {number} threshold
 * @property {ContrastFailure[]} failures
 * @property {Channels | null} background
 * @property {Channels | null} effectiveForeground
 * @property {{background: Interval, effectiveForeground: Interval} | null} luminanceBounds
 * @property {number | null} ratioLower
 * @property {number | null} ratioUpper
 * @property {number | null} opaqueAncestorIndex
 */
/**
 * @typedef {object} ContrastEvaluation
 * @property {ContrastStatus} status
 * @property {ContrastFailure[]} failures
 * @property {ContrastRunResult[]} runs
 * @property {number | null} minimumRatioLower
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** @param {unknown} value @returns {value is number} */
function positiveCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

/** @param {unknown} value @param {string} path @param {ContrastFailure[]} failures */
function collectReportedFailures(value, path, failures) {
  if (!Array.isArray(value)) {
    failures.push({ code: "missing-failure-list", path })
    return
  }
  Array.from(value).forEach((reason, index) => {
    failures.push(typeof reason === "string" && reason.length > 0
      ? { code: "reported-paint-failure", path: `${path}[${index}]`, reason }
      : { code: "invalid-reported-failure", path: `${path}[${index}]` })
  })
}

/** @param {unknown} value @param {string} path @param {ContrastFailure[]} failures @returns {ParsedColor | null} */
function parseColor(value, path, failures) {
  if (!isRecord(value)) {
    failures.push({ code: "missing-resolved-color", path })
    return null
  }
  if (Object.hasOwn(value, "unsupportedReason")) {
    failures.push({ code: "unsupported-resolved-color", path })
    return null
  }
  if (typeof value.raw !== "string" || !value.raw.trim()
    || !["resolved-srgb-exact", "off-dom-srgb-canvas-unorm8"].includes(value.conversion)) {
    failures.push({ code: "unverified-color-conversion", path })
    return null
  }
  const alpha = value.alpha
  const channels = value.channels
  if (typeof alpha !== "number" || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    failures.push({ code: "invalid-color-alpha", path: `${path}.alpha` })
    return null
  }
  if (!Array.isArray(channels) || channels.length !== 3) {
    failures.push({ code: "invalid-color-channels", path: `${path}.channels` })
    return null
  }
  for (const [index, interval] of channels.entries()) {
    if (!Array.isArray(interval) || interval.length !== 2
      || interval.some(channel => typeof channel !== "number" || !Number.isFinite(channel))
      || interval[0] < 0 || interval[1] > 1 || interval[0] > interval[1]) {
      failures.push({ code: "invalid-color-interval", path: `${path}.channels[${index}]` })
      return null
    }
  }
  return {
    alpha,
    channels: [
      [channels[0][0], channels[0][1]],
      [channels[1][0], channels[1][1]],
      [channels[2][0], channels[2][1]],
    ],
  }
}

/** @param {Channels} foreground @param {number} alpha @param {Channels} background @returns {Channels} */
function composite(foreground, alpha, background) {
  /** @param {number} index @returns {Interval} */
  const channel = index => [
    alpha * foreground[index][0] + (1 - alpha) * background[index][0],
    alpha * foreground[index][1] + (1 - alpha) * background[index][1],
  ]
  return [channel(0), channel(1), channel(2)]
}

/** @param {number} channel */
function linearize(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** @param {Channels} channels @returns {Interval} */
function luminance(channels) {
  /** @param {number} endpoint */
  const value = endpoint => 0.2126 * linearize(channels[0][endpoint])
    + 0.7152 * linearize(channels[1][endpoint])
    + 0.0722 * linearize(channels[2][endpoint])
  return [value(0), value(1)]
}

/** @param {Interval} foreground @param {Interval} background @returns {Interval} */
function contrastBounds(foreground, background) {
  const [foregroundLow, foregroundHigh] = foreground
  const [backgroundLow, backgroundHigh] = background
  // Foreground/background may share an uncertain backdrop. Treating the two
  // intervals independently enlarges the possibilities, which is conservative
  // for acceptance. When they overlap, contrast 1 remains possible.
  if (foregroundHigh < backgroundLow) {
    return [(backgroundLow + 0.05) / (foregroundHigh + 0.05),
      (backgroundHigh + 0.05) / (foregroundLow + 0.05)]
  }
  if (backgroundHigh < foregroundLow) {
    return [(foregroundLow + 0.05) / (backgroundHigh + 0.05),
      (foregroundHigh + 0.05) / (backgroundLow + 0.05)]
  }
  return [1, Math.max((foregroundHigh + 0.05) / (backgroundLow + 0.05),
    (backgroundHigh + 0.05) / (foregroundLow + 0.05))]
}

/** @param {unknown} font */
function thresholdFor(font) {
  if (!isRecord(font)) return 4.5
  const size = typeof font.sizePx === "number" && Number.isFinite(font.sizePx) ? font.sizePx : null
  const weight = typeof font.weight === "number" && Number.isFinite(font.weight)
    && font.weight >= 1 && font.weight <= 1000 ? font.weight : null
  return size !== null && (size >= 24 || (size >= 18.666666666666668 && weight !== null && weight >= 700)) ? 3 : 4.5
}

/** @param {unknown} value @param {number} index @returns {ContrastRunResult} */
function evaluateRun(value, index) {
  const path = `runs[${index}]`
  /** @type {ContrastRunResult} */
  const result = {
    index, status: "NOT_PROVEN", threshold: thresholdFor(isRecord(value) ? value.font : null),
    failures: [], background: null, effectiveForeground: null, luminanceBounds: null,
    ratioLower: null, ratioUpper: null, opaqueAncestorIndex: null,
  }
  if (!isRecord(value)) {
    result.failures.push({ code: "missing-text-run", path })
    return result
  }
  collectReportedFailures(value.failures, `${path}.failures`, result.failures)
  if (!positiveCount(value.fragments) || !positiveCount(value.textLength)) {
    result.failures.push({ code: "nonpositive-rendered-text-run", path })
  }
  if (!isRecord(value.font) || typeof value.font.family !== "string" || !value.font.family.trim()) {
    result.failures.push({ code: "missing-text-font-observation", path: `${path}.font` })
  }
  const foreground = parseColor(value.foreground, `${path}.foreground`, result.failures)
  if (!Array.isArray(value.backgroundLayers) || value.backgroundLayers.length === 0) {
    result.failures.push({ code: "missing-backdrop-chain", path: `${path}.backgroundLayers` })
    return result
  }
  // Validate ALL ancestors, including those behind the nearest opaque layer:
  // unsupported effects must not be hidden by a convenient inner background.
  const layers = Array.from(value.backgroundLayers, (layer, depth) =>
    parseColor(layer, `${path}.backgroundLayers[${depth}]`, result.failures))
  if (!foreground || layers.some(layer => layer === null)) return result
  const opaqueIndex = layers.findIndex(layer => layer.alpha === 1)
  if (opaqueIndex < 0) {
    result.failures.push({ code: "opaque-backdrop-not-observed", path: `${path}.backgroundLayers` })
    return result
  }
  result.opaqueAncestorIndex = opaqueIndex
  let background = layers[opaqueIndex].channels
  for (let depth = opaqueIndex - 1; depth >= 0; depth--) {
    background = composite(layers[depth].channels, layers[depth].alpha, background)
  }
  result.background = background
  result.effectiveForeground = composite(foreground.channels, foreground.alpha, background)
  result.luminanceBounds = {
    background: luminance(background), effectiveForeground: luminance(result.effectiveForeground),
  }
  const [lower, upper] = contrastBounds(result.luminanceBounds.effectiveForeground, result.luminanceBounds.background)
  result.ratioLower = lower
  result.ratioUpper = upper
  if (result.failures.length > 0) return result
  if (lower >= result.threshold) {
    result.status = "PASS"
  } else if (upper < result.threshold) {
    result.status = "FAIL"
    result.failures.push({ code: "contrast-below-threshold", path })
  } else {
    result.failures.push({ code: "contrast-interval-crosses-threshold", path })
  }
  return result
}

/**
 * Evaluate only the serialized actual browser observations. Invalid, empty or
 * unsupported observations never turn into a vacuous contrast PASS.
 * @param {unknown} observation
 * @returns {ContrastEvaluation}
 */
export function evaluateTextContrast(observation) {
  /** @type {ContrastEvaluation} */
  const result = { status: "NOT_PROVEN", failures: [], runs: [], minimumRatioLower: null }
  if (!isRecord(observation)) {
    result.failures.push({ code: "missing-text-observation", path: "observation" })
    return result
  }
  collectReportedFailures(observation.failures, "failures", result.failures)
  if (!isRecord(observation.theme) || !isRecord(observation.state) || observation.state.stable !== true) {
    result.failures.push({ code: "missing-stable-theme-state-observation", path: "observation" })
  }
  if (observation.expectedTextMatched !== true || !positiveCount(observation.textLength)) {
    result.failures.push({ code: "required-rendered-text-not-proven", path: "observation" })
  }
  if (!positiveCount(observation.textNodes) || !positiveCount(observation.renderedFragments)) {
    result.failures.push({ code: "nonpositive-rendered-text-observation", path: "observation" })
  }
  if (!Array.isArray(observation.runs) || observation.runs.length === 0) {
    result.failures.push({ code: "missing-rendered-text-runs", path: "runs" })
    return result
  }
  if (observation.runs.length !== observation.textNodes) {
    result.failures.push({ code: "text-node-count-mismatch", path: "runs" })
  }
  const fragments = observation.runs.reduce((total, run) =>
    total + (isRecord(run) && positiveCount(run.fragments) ? run.fragments : 0), 0)
  if (!Number.isSafeInteger(fragments) || fragments !== observation.renderedFragments
    || observation.renderedFragments < observation.textNodes) {
    result.failures.push({ code: "rendered-fragment-count-mismatch", path: "renderedFragments" })
  }
  result.runs = Array.from(observation.runs, evaluateRun)
  const calculatedLowerBounds = result.runs.flatMap(run => run.ratioLower === null ? [] : [run.ratioLower])
  result.minimumRatioLower = calculatedLowerBounds.length ? Math.min(...calculatedLowerBounds) : null
  const observationFailures = result.failures.length
  result.failures.push(...result.runs.flatMap(run => run.failures))
  result.status = result.runs.some(run => run.status === "FAIL") ? "FAIL"
    : observationFailures === 0 && result.runs.every(run => run.status === "PASS") ? "PASS" : "NOT_PROVEN"
  return result
}
