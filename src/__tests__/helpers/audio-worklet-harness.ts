import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

export type WorkletPort = {
  onmessage: ((event: { data: unknown }) => void) | null
  messages: unknown[]
  postMessage: (message: unknown) => void
}

export type WorkletInstance = {
  port: WorkletPort
  process: (inputs: Float32Array[][], outputs?: Float32Array[][]) => boolean
  count?: number
  capacity?: number
}

export function loadAudioWorkletProcessor(
  path: string,
  contextSampleRate: number,
): new (options?: unknown) => WorkletInstance {
  let Processor: (new (options?: unknown) => WorkletInstance) | null = null
  class AudioWorkletProcessor {
    port: WorkletPort = {
      onmessage: null,
      messages: [],
      postMessage: (message) => { this.port.messages.push(message) },
    }
  }
  runInNewContext(readFileSync(path, "utf8"), {
    AudioWorkletProcessor,
    Float32Array,
    Math,
    Number,
    sampleRate: contextSampleRate,
    registerProcessor: (_name: string, implementation: new (options?: unknown) => WorkletInstance) => {
      Processor = implementation
    },
  })
  if (!Processor) throw new Error(`Worklet did not register: ${path}`)
  return Processor
}

export function processMonoSignal(
  processor: WorkletInstance,
  samples: Float32Array,
  blockSize = 128,
): void {
  for (let offset = 0; offset < samples.length; offset += blockSize) {
    const block = new Float32Array(blockSize)
    block.set(samples.subarray(offset, offset + blockSize))
    processor.process([[block]])
  }
}

export function messagesByType<T extends { type: string }>(
  processor: WorkletInstance,
  type: T["type"],
): T[] {
  return processor.port.messages.filter(
    (message): message is T => (message as { type?: string }).type === type,
  )
}

