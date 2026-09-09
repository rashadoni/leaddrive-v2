export function geminiVoiceMarker(phase: "minting" | "issued" | "connected", id: string): string {
  return `gemini:${phase}:${id}`
}

/** No provider conversation exists until the browser confirms Live setup. */
export function voiceMarkerIsPreConnection(marker: string | null): boolean {
  return marker === null
    || marker.startsWith("gemini:minting:")
    || marker.startsWith("gemini:issued:")
}
