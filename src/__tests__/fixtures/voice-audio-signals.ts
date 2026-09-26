type SignalOptions = {
  sampleRate?: number
  seconds?: number
  amplitude?: number
}

function lengthFor({ sampleRate = 48_000, seconds = 0.5 }: SignalOptions): number {
  return Math.max(1, Math.round(sampleRate * seconds))
}

export function silence(options: SignalOptions = {}): Float32Array {
  return new Float32Array(lengthFor(options))
}

export function tone(
  frequency: number,
  options: SignalOptions = {},
): Float32Array {
  const { sampleRate = 48_000, amplitude = 0.2 } = options
  const result = new Float32Array(lengthFor(options))
  for (let index = 0; index < result.length; index += 1) {
    result[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  }
  return result
}

export function ringtone(options: SignalOptions = {}): Float32Array {
  const first = tone(440, options)
  const second = tone(480, options)
  const result = new Float32Array(first.length)
  for (let index = 0; index < result.length; index += 1) {
    const cadence = Math.floor(index / 4_800) % 2 === 0 ? 1 : 0
    result[index] = cadence * ((first[index] ?? 0) + (second[index] ?? 0)) / 2
  }
  return result
}

export function keyboardImpulses(options: SignalOptions = {}): Float32Array {
  const { amplitude = 0.4 } = options
  const result = new Float32Array(lengthFor(options))
  for (let start = 1_200; start < result.length; start += 3_600) {
    for (let offset = 0; offset < 96 && start + offset < result.length; offset += 1) {
      result[start + offset] = amplitude * Math.exp(-offset / 18) * (offset % 2 === 0 ? 1 : -1)
    }
  }
  return result
}

export function seededOfficeNoise(options: SignalOptions = {}): Float32Array {
  const { amplitude = 0.04 } = options
  const result = new Float32Array(lengthFor(options))
  let state = 0x1a2b3c4d
  let smoothed = 0
  for (let index = 0; index < result.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const white = (state / 0xffff_ffff) * 2 - 1
    smoothed = (smoothed * 0.92) + (white * 0.08)
    result[index] = smoothed * amplitude
  }
  return result
}

export const SYNTHETIC_BACKGROUND_FIXTURES = {
  silence,
  instrumental_tone: () => tone(220),
  ringtone,
  keyboard: keyboardImpulses,
  office_noise: seededOfficeNoise,
} as const

