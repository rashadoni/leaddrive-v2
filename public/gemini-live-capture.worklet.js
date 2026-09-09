class GeminiLiveCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const configuredRate = Number(options?.processorOptions?.targetSampleRate)
    this.targetSampleRate = Number.isFinite(configuredRate) && configuredRate > 0
      ? configuredRate
      : 16000
    this.ratio = sampleRate / this.targetSampleRate
    this.pending = []
    this.readPosition = 0
    // 512 samples at 16 kHz is 32 ms, inside Google's 20-40 ms guidance — and
    // that is a SAMPLE COUNT, so it is a different duration at a different
    // rate. At the telephone's 8 kHz the same 512 samples would be a 64 ms
    // burst that the station then has to cut into three 20 ms frames. A caller
    // running at another rate says what it wants; the assistant's path passes
    // nothing and keeps exactly the chunk it was tuned with.
    const configuredChunk = Number(options?.processorOptions?.chunkSamples)
    this.buffer = new Float32Array(
      Number.isFinite(configuredChunk) && configuredChunk >= 32 ? Math.floor(configuredChunk) : 512,
    )
    this.offset = 0
    this.speaking = false
    this.quietFrames = 0
  }

  emit(sample) {
    this.buffer[this.offset] = sample
    this.offset += 1
    if (this.offset !== this.buffer.length) return
    const chunk = this.buffer.slice()
    this.port.postMessage({ type: "audio", samples: chunk }, [chunk.buffer])
    this.offset = 0
  }

  resample(channel) {
    for (let i = 0; i < channel.length; i += 1) this.pending.push(channel[i])
    while (this.readPosition + 1 < this.pending.length) {
      const index = Math.floor(this.readPosition)
      const fraction = this.readPosition - index
      const first = this.pending[index]
      const second = this.pending[index + 1]
      this.emit(first + (second - first) * fraction)
      this.readPosition += this.ratio
    }
    const consumed = Math.floor(this.readPosition)
    if (consumed > 0) {
      this.pending.splice(0, consumed)
      this.readPosition -= consumed
    }
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true

    let energy = 0
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i]
      energy += value * value
    }
    this.resample(channel)

    // UI-only activity estimate. Gemini's server-side VAD remains authoritative.
    const rms = Math.sqrt(energy / Math.max(1, channel.length))
    if (rms >= 0.012) {
      this.quietFrames = 0
      if (!this.speaking) {
        this.speaking = true
        this.port.postMessage({ type: "activity", active: true })
      }
    } else if (this.speaking) {
      this.quietFrames += 1
      if (this.quietFrames >= 50) {
        this.speaking = false
        this.quietFrames = 0
        this.port.postMessage({ type: "activity", active: false })
      }
    }
    return true
  }
}

registerProcessor("gemini-live-capture", GeminiLiveCaptureProcessor)
