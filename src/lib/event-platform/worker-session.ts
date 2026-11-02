import { KafkaBridgeError, runKafkaBridge, type KafkaBridgeChannel } from "./kafka-bridge"

type BridgeInput = Parameters<typeof runKafkaBridge>[0]

/** Resources owned exclusively by ONE session; never the application's DB pool. */
export interface KafkaWorkerResources {
  readonly channel: KafkaBridgeChannel
  readonly createProcessor: BridgeInput["createProcessor"]
  /** Called only after processBatch/its actual SQL transaction has settled. */
  release(): Promise<void>
}

/**
 * Inactive, finite canary lifecycle, not a service or a production launcher.
 * The trusted synchronous factory must admit its config before connecting and
 * clean up partial acquisition if it throws. It owns credentials, restricted
 * database clients and the supervised channel; no global env/Prisma fallback.
 *
 * stop/deadline revoke ACKs immediately, then WAIT for the bridge and active
 * SQL to settle before releasing connections. They do not roll back a COMMIT
 * or reset Kafka offsets. A stopped run always rejects, even if SQL committed.
 * Database adapters must enforce their own transaction timeouts (Fund uses
 * maxWait=5s/timeout=15s); this wrapper cannot cancel an arbitrary callback.
 * maxDurationMs is the intake/ACK deadline, not a claim about SQL cancellation.
 */
export function startKafkaWorkerSession(input: {
  clusterId: string
  groupId: string
  topic: string
  maxRecords: number
  maxDurationMs: number
  open(): KafkaWorkerResources
  signal?: AbortSignal
}): { readonly done: Promise<Readonly<{ processed: number }>>; stop(): void } {
  const { clusterId, groupId, topic, maxRecords, maxDurationMs, signal } = input
  if (![clusterId, groupId, topic].every(value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,249}$/.test(value))
    || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 600_000
    || typeof input.open !== "function") {
    throw new KafkaBridgeError()
  }
  const open = input.open.bind(input)
  const controller = new AbortController()
  let finished = false
  const stop = () => { if (!finished) controller.abort() }
  signal?.addEventListener("abort", stop, { once: true })
  if (signal?.aborted) stop()
  const deadline = setTimeout(stop, maxDurationMs)
  // Start on the next microtask: immediate stop must not acquire any resources.
  const done = Promise.resolve().then(async () => {
    let resources: KafkaWorkerResources | undefined
    let result: Readonly<{ processed: number }> | undefined
    let failed = false
    try {
      if (controller.signal.aborted) throw new KafkaBridgeError()
      resources = open()
      result = await runKafkaBridge({ channel: resources.channel, clusterId, groupId, topic,
        maxRecords, createProcessor: resources.createProcessor.bind(resources), signal: controller.signal })
    } catch { failed = true }
    finally {
      // runKafkaBridge has finished processBatch AND channel.close here. Do not
      // race it against a timer and disconnect beneath a still-active COMMIT.
      if (resources) {
        try { await resources.release() } catch { failed = true }
      }
      clearTimeout(deadline)
      signal?.removeEventListener("abort", stop)
      finished = true
    }
    if (failed || controller.signal.aborted || !result) throw new KafkaBridgeError()
    return result
  })
  // The operator may attach done after startup/stop. Never leak raw rejections.
  void done.catch(() => {})
  return Object.freeze({ done, stop })
}
