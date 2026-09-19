type ProcessingState = "on" | "off" | "unknown"
type CapabilityState = "yes" | "no" | "unknown"

export type MicrophoneProcessingSnapshot = {
  echoCancellation: { applied: ProcessingState; available: CapabilityState }
  noiseSuppression: { applied: ProcessingState; available: CapabilityState }
  autoGainControl: { applied: ProcessingState; available: CapabilityState }
  sampleRate: number | null
  channelCount: number | null
}

function appliedState(value: unknown): ProcessingState {
  if (value === true) return "on"
  if (value === false) return "off"
  return "unknown"
}

function capabilityState(value: unknown): CapabilityState {
  if (Array.isArray(value)) return value.includes(true) ? "yes" : "no"
  if (value === true) return "yes"
  if (value === false) return "no"
  return "unknown"
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null
}

export function readMicrophoneProcessingSnapshot(track: MediaStreamTrack): MicrophoneProcessingSnapshot {
  let settings: MediaTrackSettings = {}
  let capabilities: MediaTrackCapabilities = {}
  try { settings = track.getSettings?.() ?? {} } catch { /* optional browser API */ }
  try { capabilities = track.getCapabilities?.() ?? {} } catch { /* optional browser API */ }

  return {
    echoCancellation: {
      applied: appliedState(settings.echoCancellation),
      available: capabilityState(capabilities.echoCancellation),
    },
    noiseSuppression: {
      applied: appliedState(settings.noiseSuppression),
      available: capabilityState(capabilities.noiseSuppression),
    },
    autoGainControl: {
      applied: appliedState(settings.autoGainControl),
      available: capabilityState(capabilities.autoGainControl),
    },
    sampleRate: finiteInteger(settings.sampleRate),
    channelCount: finiteInteger(settings.channelCount),
  }
}

export function microphoneProcessingTrace(snapshot: MicrophoneProcessingSnapshot): string {
  const appliedCode: Record<ProcessingState, string> = { on: "1", off: "0", unknown: "u" }
  const capabilityCode: Record<CapabilityState, string> = { yes: "y", no: "n", unknown: "u" }
  const state = (value: { applied: ProcessingState; available: CapabilityState }) =>
    `${appliedCode[value.applied]}_${capabilityCode[value.available]}`
  return [
    "req_on",
    `ec_${state(snapshot.echoCancellation)}`,
    `ns_${state(snapshot.noiseSuppression)}`,
    `ag_${state(snapshot.autoGainControl)}`,
    `sr_${snapshot.sampleRate ?? "u"}`,
    `ch_${snapshot.channelCount ?? "u"}`,
  ].join(".")
}
