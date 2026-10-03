// Serialized by Playwright into the disposable hosted browser. This collector
// reads the real text owners and every ancestor; it never changes page styles,
// focus, theme or application state. Only the off-DOM canvas normalizes colors.
export async function collectRenderedTextContrast(element, options) {
  const failures = []
  const scalar = (token, scale = 1) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(token)) throw new Error("unresolved-color-component")
    const value = Number.parseFloat(token) / (token.endsWith("%") ? 100 : scale)
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("out-of-range-color-component")
    return value
  }
  function color(raw) {
    try {
      const resolved = /^(rgb|rgba|color)\((.*)\)$/i.exec(raw)
      if (resolved && (resolved[1] !== "color" || /^srgb\s/.test(resolved[2]))) {
        const isSrgb = resolved[1] === "color"
        const pieces = resolved[2].replace(/^srgb\s+/, "").trim().split(/\s*\/\s*/)
        if (pieces.length > 2) throw new Error("malformed-resolved-color")
        const values = pieces[0].split(/[\s,]+/)
        if (values.length === 4 && pieces.length === 1) pieces.push(values.pop())
        if (values.length !== 3) throw new Error("malformed-resolved-color")
        const channels = values.map(token => scalar(token, isSrgb ? 1 : 255)).map(value => [value, value])
        return { raw, alpha: pieces[1] === undefined ? 1 : scalar(pieces[1]), channels, conversion: "resolved-srgb-exact" }
      }
      // Only absolute, resolved CSS colors enter native conversion. Relative
      // colors/variables/none/currentColor and unsupported syntax fail closed.
      const absolute = /^(oklch|oklab|lch|lab)\(([^/]+?)(?:\s*\/\s*([^/]+))?\)$/.exec(raw)
      if (!absolute || !/^[\d\s.+%eE\-a-z]+$/.test(absolute[2]) || /(?:none|calc|var|from)/.test(absolute[2])) {
        throw new Error("unsupported-computed-color-space")
      }
      const alpha = absolute[3] === undefined ? 1 : scalar(absolute[3].trim())
      const opaque = `${absolute[1]}(${absolute[2].trim()})`
      if (!CSS.supports("color", opaque)) throw new Error("unsupported-native-color-conversion")
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true })
      if (!context || context.getContextAttributes().colorSpace !== "srgb") throw new Error("unsupported-canvas-color-space")
      context.fillStyle = "#010203"
      context.fillStyle = opaque
      const first = context.fillStyle
      context.fillStyle = "#040506"
      context.fillStyle = opaque
      if (first !== context.fillStyle) throw new Error("canvas-rejected-resolved-color")
      context.globalCompositeOperation = "copy"
      context.fillRect(0, 0, 1, 1)
      const data = context.getImageData(0, 0, 1, 1, { colorSpace: "srgb", pixelFormat: "rgba-unorm8" })
      if (data.colorSpace !== "srgb" || !(data.data instanceof Uint8ClampedArray) || data.data[3] !== 255) {
        throw new Error("unsupported-canvas-precision")
      }
      // One full 8-bit step is deliberately conservative. The interval must
      // pass in its entirety; conversion uncertainty cannot round up a PASS.
      const channels = [...data.data].slice(0, 3).map(value => [Math.max(0, value - 1) / 255, Math.min(255, value + 1) / 255])
      return { raw, alpha, channels, conversion: "off-dom-srgb-canvas-unorm8", channelUncertainty: 1 / 255 }
    } catch (error) {
      return { raw, unsupportedReason: error.message }
    }
  }
  const properties = ["color", "webkitTextFillColor", "backgroundColor", "backgroundImage", "opacity", "mixBlendMode", "filter", "backdropFilter", "webkitBackdropFilter", "maskImage", "webkitMaskImage", "fontSize", "fontWeight", "fontFamily", "textShadow", "boxShadow", "visibility", "display"]
  function styles(node) {
    const computed = getComputedStyle(node)
    const values = Object.fromEntries(properties.map(key => [key, computed[key] ?? ""]))
    // Outset focus rings do not paint the text backdrop. Inset shadows could,
    // so they remain unsupported; unrelated ring transitions do not delay text.
    if (!values.boxShadow.includes("inset")) values.boxShadow = "no-inset-shadow"
    return values
  }
  const owners = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let renderedFragments = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || node.parentElement.closest("svg")) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length
    if (!fragments) continue
    renderedFragments += fragments
    owners.push({ owner: node.parentElement, textLength: node.textContent.trim().length, fragments })
  }
  const chains = owners.map(({ owner }) => {
    const chain = []
    for (let node = owner; node; node = node.parentElement) chain.push(node)
    return chain
  })
  const snapshots = () => chains.map(chain => chain.map(node => styles(node)))
  let previous = snapshots()
  let stable = false
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const current = snapshots()
    const activePaintAnimation = chains.some(chain => chain.some(node => node.getAnimations().some(animation => {
      if (animation.playState !== "running") return false
      const frames = animation.effect?.getKeyframes() ?? []
      return frames.some(frame => Object.keys(frame).some(key => /color|opacity|filter|background|mask/i.test(key)))
    })))
    if (JSON.stringify(previous) === JSON.stringify(current) && !activePaintAnimation) { stable = true; break }
    previous = current
  }
  if (!stable) failures.push("computed-paint-not-stable")
  const html = document.documentElement
  const htmlStyle = getComputedStyle(html)
  const theme = { htmlClass: html.className, colorScheme: htmlStyle.colorScheme, forcedColors: matchMedia("(forced-colors: active)").matches, wideColorGamut: matchMedia("(color-gamut: p3)").matches, deviceScaleFactor: devicePixelRatio, forceLightAncestor: Boolean(element.closest(".force-light")), dashboardWallpaper: html.hasAttribute("data-wallpaper") && html.getAttribute("data-wallpaper-scope") === "dashboard", fontsStatus: document.fonts.status }
  if (!html.classList.contains("light") || html.classList.contains("dark") || theme.colorScheme !== "light" || theme.forcedColors || theme.wideColorGamut || theme.forceLightAncestor || theme.dashboardWallpaper || theme.fontsStatus !== "loaded") {
    failures.push("default-light-srgb-fixture-not-proven")
  }
  const state = { focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"), disabled: element.matches(":disabled"), hovered: element.matches(":hover"), active: element.matches(":active"), stable }
  if (options.focused && !state.focused) failures.push("required-native-focus-missing")
  if (options.enabled && state.disabled) failures.push("required-enabled-control-disabled")
  const text = element.innerText
  const expectedTextMatched = options.expectedTexts.every(expected => text.includes(expected))
  if (!expectedTextMatched) failures.push("required-rendered-text-mismatch")
  if (!owners.length || !renderedFragments) failures.push("no-rendered-text-runs")
  const runs = owners.map(({ owner, textLength, fragments }, index) => {
    const own = styles(owner)
    const runFailures = []
    const layers = chains[index].map((node, depth) => {
      const style = styles(node)
      if (Number(style.opacity) !== 1) runFailures.push(`unsupported-group-opacity:${depth}`)
      if (style.visibility !== "visible" || style.display === "none") runFailures.push(`non-visible-text-chain:${depth}`)
      for (const property of ["backgroundImage", "filter", "backdropFilter", "webkitBackdropFilter", "maskImage", "webkitMaskImage", "textShadow"]) {
        if (style[property] && style[property] !== "none") runFailures.push(`unsupported-${property}:${depth}`)
      }
      if (style.mixBlendMode !== "normal") runFailures.push(`unsupported-blend-mode:${depth}`)
      if (style.boxShadow.includes("inset")) runFailures.push(`unsupported-inset-shadow:${depth}`)
      for (const pseudo of ["::before", "::after"]) {
        const paint = getComputedStyle(node, pseudo)
        if (!["none", "normal"].includes(paint.content) && paint.display !== "none" && paint.visibility !== "hidden") runFailures.push(`unsupported-generated-paint:${depth}:${pseudo}`)
      }
      const background = color(style.backgroundColor)
      if (background.unsupportedReason) runFailures.push(`${background.unsupportedReason}:${depth}`)
      return { tag: node.tagName, depth, ...background }
    })
    const foreground = color(own.webkitTextFillColor || own.color)
    if (foreground.unsupportedReason) runFailures.push(foreground.unsupportedReason)
    return { tag: owner.tagName, textLength, fragments, foreground, backgroundLayers: layers, font: { sizePx: Number.parseFloat(own.fontSize), weight: Number(own.fontWeight), family: own.fontFamily }, failures: runFailures }
  })
  return { theme, state, expectedTextMatched, textLength: text.length, textNodes: owners.length, renderedFragments, runs, failures }
}
