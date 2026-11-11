/**
 * Web Animations and layout for jsdom: the card sits at (10, 20) 300×80, any
 * other box at (100, 200) 400×400; `land()` finishes every running flight.
 */
export function stubFlight() {
  const proto = HTMLElement.prototype as HTMLElement & { animate?: unknown }
  const originalAnimate = proto.animate
  const originalRect = proto.getBoundingClientRect
  const finishers: Array<() => void> = []
  const transforms: string[] = []
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const box = this.hasAttribute("data-help-video-widget")
      ? { left: 10, top: 20, width: 300, height: 80 }
      : { left: 100, top: 200, width: 400, height: 400 }
    return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON() {} } as DOMRect
  }
  proto.animate = function (keyframes: Keyframe[]) {
    const last = keyframes[keyframes.length - 1]
    if (typeof last?.transform === "string") transforms.push(last.transform)
    const finished = new Promise<void>((resolve) => finishers.push(resolve))
    return { finished } as unknown as Animation
  }
  return {
    lastTransform: () => transforms[transforms.length - 1],
    flights: () => transforms.length,
    land: () => finishers.splice(0).forEach((finish) => finish()),
    restore: () => {
      proto.animate = originalAnimate
      proto.getBoundingClientRect = originalRect
    },
  }
}
