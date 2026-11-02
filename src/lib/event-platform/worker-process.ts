import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { PassThrough, Writable } from "node:stream"
import { createKafkaBridgeChannel, KafkaBridgeError, type KafkaBridgeChannel } from "./kafka-bridge"

export interface KafkaWorkerExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Inactive lifecycle primitive. The trusted caller owns executable/config/env
 * admission. This module invokes that factory once and selects no command,
 * shell, process group, retry, offset reset or service. Private output is not logs.
 */
export function createSupervisedKafkaChannel(input: {
  spawn: () => ChildProcessWithoutNullStreams
  stopGraceMs?: number
  killGraceMs?: number
  timeoutMs?: number
}): { channel: KafkaBridgeChannel; exited: Promise<KafkaWorkerExit>; abort(): Promise<void> } {
  const stopGrace = input.stopGraceMs ?? 2000
  const killGrace = input.killGraceMs ?? 1000
  const timeout = input.timeoutMs ?? 35_000
  for (const value of [stopGrace, killGrace]) {
    if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new KafkaBridgeError()
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000 || typeof input.spawn !== "function") {
    throw new KafkaBridgeError()
  }
  let child: ChildProcessWithoutNullStreams
  try { child = input.spawn() } catch { throw new KafkaBridgeError() }

  let closed = false, failed = false, aborted = false, escalated = false, termSent = false
  let settling = false
  let closeResult: Readonly<KafkaWorkerExit> | undefined
  let resolveExit!: (exit: Readonly<KafkaWorkerExit>) => void
  let rejectExit!: (error: KafkaBridgeError) => void
  const exited = new Promise<KafkaWorkerExit>((resolve, reject) => { resolveExit = resolve; rejectExit = reject })
  // A caller may use only channel.close(). Observe rejection here as well so
  // failure to confirm reaping never becomes an unhandled promise rejection.
  void exited.catch(() => {})
  child.once("close", (code, signal) => {
    closed = true
    closeResult = Object.freeze({ code, signal })
    if (!settling) { settling = true; resolveExit(closeResult) }
  })
  child.on("error", () => {
    failed = true
    void abort().catch(() => {})
  })

  const privateOutput = new PassThrough({ highWaterMark: 64 * 1024 })
  privateOutput.on("error", () => { /* private read() owns the sanitized failure */ })
  const privateInput = new Writable({
    highWaterMark: 1024,
    write(chunk, encoding, callback) {
      try { child.stdin.write(chunk, encoding, callback) } catch { callback(new KafkaBridgeError()) }
    },
  })
  // The bridge destroys its own streams on close. Keep the real stdin alive
  // until stop() explicitly ends it, and stdout until actual child close:
  // Java's finally may still write REVOKE, otherwise causing SIGPIPE.
  privateOutput.once("close", () => {
    child.stdout.unpipe(privateOutput)
    child.stdout.resume()
  })
  child.stdout.on("error", () => { failed = true; privateOutput.destroy(new KafkaBridgeError()); void abort().catch(() => {}) })
  child.stdin.on("error", () => { failed = true; privateInput.destroy(new KafkaBridgeError()); void abort().catch(() => {}) })
  child.stderr.on("error", () => { failed = true; void abort().catch(() => {}) })
  // Drain without buffering or logging: stderr can contain credentials or data.
  child.stderr.resume()
  child.stdout.pipe(privateOutput)

  let stopping: Promise<void> | undefined
  let wakeGrace: (() => void) | undefined
  function signal(signal: "SIGTERM" | "SIGKILL") {
    if (closed) return
    if (signal === "SIGTERM") { if (termSent) return; termSent = true }
    try { child.kill(signal) } catch { failed = true }
  }
  async function waitClose(milliseconds: number, interruptible = false): Promise<boolean> {
    if (closed) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        exited,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, milliseconds)
          if (interruptible) wakeGrace = resolve
        }),
      ])
    } finally { if (timer) clearTimeout(timer); if (interruptible) wakeGrace = undefined }
    return closed
  }
  function stop(): Promise<void> {
    // Publish the shared promise before any stream callback can re-enter stop.
    if (!stopping) stopping = Promise.resolve().then(async () => {
      try { child.stdin.end() } catch { failed = true }
      child.stdout.unpipe(privateOutput)
      child.stdout.resume()
      if (!closed && !aborted) await waitClose(stopGrace, true)
      if (!closed) {
        escalated = true
        signal("SIGTERM")
        await waitClose(killGrace)
      }
      if (!closed) {
        escalated = true
        signal("SIGKILL")
        await waitClose(killGrace)
      }
      if (!closed) {
        if (!settling) { settling = true; rejectExit(new KafkaBridgeError()) }
        // Timeout is NOT reaping. Release only owned pipe resources and fail.
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
        throw new KafkaBridgeError()
      }
    })
    return stopping
  }
  async function abort() {
    aborted = true
    privateOutput.destroy(); privateInput.destroy()
    signal("SIGTERM")
    wakeGrace?.()
    await stop()
    if (failed) throw new KafkaBridgeError()
  }
  const channel = createKafkaBridgeChannel({
    stdout: privateOutput,
    stdin: privateInput,
    timeoutMs: timeout,
    async terminate() {
      await stop()
      if (failed || aborted || escalated || !closeResult || closeResult.code !== 0 || closeResult.signal !== null) {
        throw new KafkaBridgeError()
      }
    },
  })
  return Object.freeze({ channel, exited, abort })
}
