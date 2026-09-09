/**
 * The answer decides how long the buffer is, not the other way round.
 *
 * Gemini streams a spoken answer far faster than it plays, so the un-played
 * tail is the WHOLE remaining answer, not a network jitter cushion. A fixed
 * ring therefore does not bound latency — it bounds how long the assistant is
 * allowed to talk. It used to hold 30 seconds and report an overflow that the
 * console turned into a dropped call, which is why a detailed analytics answer
 * ended the conversation mid-sentence (measured in production 2026-08-21:
 * playback_overflow → session_stopped, right after two analytics tool calls).
 *
 * The ring now grows to hold whatever arrives and shrinks back the moment it
 * drains or the user interrupts. The remaining ceiling exists only so a
 * malfunctioning stream cannot exhaust memory; it is ten minutes of speech,
 * far past any answer a model with a token limit can produce.
 */
const ABSOLUTE_CEILING_SECONDS = 600

class GeminiLivePlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const configuredRate = Number(options?.processorOptions?.sourceSampleRate)
    this.sourceSampleRate = Number.isFinite(configuredRate) && configuredRate > 0
      ? configuredRate
      : 24000
    const configuredSeconds = Number(options?.processorOptions?.maxBufferedSeconds)
    // Only the STARTING size — growth is unbounded up to the ceiling below.
    const startingSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0
      ? configuredSeconds
      : 12
    this.baseCapacity = Math.max(2, Math.ceil(this.sourceSampleRate * startingSeconds))
    // A LIVE conversation is the opposite case to a spoken answer. There, the
    // whole reply arrives faster than it plays and every sample matters, so the
    // ring grows. Here a network stall would otherwise become permanent one-way
    // delay: the late audio still plays, just always late, for the rest of the
    // call. Past this depth the OLDEST samples go — a syllable lost once
    // instead of a delay added to every word after it. Absent (0) means the
    // answer behaviour, which is what the assistant keeps.
    const configuredLatency = Number(options?.processorOptions?.maxLatencySeconds)
    this.maxLatencySamples = Number.isFinite(configuredLatency) && configuredLatency > 0
      ? Math.max(2, Math.ceil(this.sourceSampleRate * configuredLatency))
      : 0
    this.ceiling = Math.max(this.baseCapacity, Math.ceil(this.sourceSampleRate * ABSOLUTE_CEILING_SECONDS))
    this.capacity = this.baseCapacity
    this.ring = new Float32Array(this.capacity)
    this.readIndex = 0
    this.writeIndex = 0
    this.count = 0
    this.readPosition = 0
    this.generation = Number(options?.processorOptions?.generation) || 0
    this.wasPlaying = false
    this.port.onmessage = (event) => this.onMessage(event.data)
  }

  clear() {
    // Release a grown ring as soon as it is not needed: an interrupt or a
    // finished answer returns the memory instead of holding the high-water
    // mark for the rest of the session.
    if (this.capacity !== this.baseCapacity) {
      this.capacity = this.baseCapacity
      this.ring = new Float32Array(this.capacity)
    }
    this.readIndex = 0
    this.writeIndex = 0
    this.count = 0
    this.readPosition = 0
    this.wasPlaying = false
  }

  /** Re-home the queued audio into a bigger ring. False only at the ceiling. */
  grow(required) {
    if (required > this.ceiling) return false
    let capacity = this.capacity
    while (capacity < required) capacity *= 2
    if (capacity > this.ceiling) capacity = this.ceiling
    const ring = new Float32Array(capacity)
    for (let i = 0; i < this.count; i += 1) ring[i] = this.ring[(this.readIndex + i) % this.capacity]
    this.ring = ring
    this.capacity = capacity
    this.readIndex = 0
    this.writeIndex = this.count
    this.port.postMessage({ type: "grew", generation: this.generation, capacity })
    return true
  }

  valueAt(offset) {
    return this.ring[(this.readIndex + offset) % this.capacity]
  }

  /** Drop the oldest `count` samples without disturbing what is playing next. */
  dropOldest(count) {
    const dropped = Math.min(count, this.count)
    this.readIndex = (this.readIndex + dropped) % this.capacity
    this.count -= dropped
    // readPosition is an offset INTO the queue, so it moves with the queue or
    // the next sample read is not the one that was meant to play.
    this.readPosition = Math.max(0, this.readPosition - dropped)
  }

  enqueue(samples) {
    if (samples.length === 0) return
    if (this.maxLatencySamples > 0) {
      const overflow = this.count + samples.length - this.maxLatencySamples
      if (overflow > 0) {
        this.dropOldest(overflow)
        this.port.postMessage({ type: "latency_trimmed", generation: this.generation, samples: overflow })
      }
    }
    const required = this.count + samples.length
    if (required > this.capacity && !this.grow(required)) {
      // Ten minutes of un-played speech means something upstream is broken.
      // Drop this chunk and say so — the answer loses its tail, the
      // conversation survives. The old code dropped the CALL instead.
      this.port.postMessage({ type: "overflow", generation: this.generation })
      return
    }
    for (let i = 0; i < samples.length; i += 1) {
      this.ring[this.writeIndex] = samples[i]
      this.writeIndex = (this.writeIndex + 1) % this.capacity
      this.count += 1
    }
    this.wasPlaying = this.count > 0
  }

  onMessage(message) {
    if (message?.type === "reset" && Number.isFinite(message.generation)) {
      this.clear()
      this.generation = message.generation
      return
    }
    if (message?.generation !== this.generation) return
    if (message?.type === "interrupt") {
      const wasPlaying = this.wasPlaying
      this.clear()
      if (wasPlaying) this.port.postMessage({ type: "drained", generation: this.generation })
      return
    }
    if (message?.type === "audio" && message.samples instanceof Float32Array) {
      this.enqueue(message.samples)
    }
  }

  process(_inputs, outputs) {
    const channel = outputs[0]?.[0]
    if (!channel) return true
    const step = this.sourceSampleRate / sampleRate
    let outputOffset = 0
    while (outputOffset < channel.length) {
      const index = Math.floor(this.readPosition)
      if (this.count < index + 2) break
      const fraction = this.readPosition - index
      const first = this.valueAt(index)
      const second = this.valueAt(index + 1)
      channel[outputOffset] = first + (second - first) * fraction
      outputOffset += 1
      this.readPosition += step
      const consumed = Math.min(Math.floor(this.readPosition), this.count - 1)
      if (consumed > 0) {
        this.readIndex = (this.readIndex + consumed) % this.capacity
        this.count -= consumed
        this.readPosition -= consumed
      }
    }
    channel.fill(0, outputOffset)
    if (this.wasPlaying && this.count < 2) {
      this.clear()
      this.port.postMessage({ type: "drained", generation: this.generation })
    }
    return true
  }
}

registerProcessor("gemini-live-playback", GeminiLivePlaybackProcessor)
