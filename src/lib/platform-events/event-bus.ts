/**
 * In-memory pub/sub bus — N14 Phase 5 slice 1.
 *
 * Per-process event delivery. Per-org topic isolation — a subscriber
 * to org A never sees org B's events. Listener errors are caught and
 * logged so one misbehaving subscriber doesn't break the fan-out.
 *
 * Slice 2 swaps the in-memory store for Redis Streams behind the
 * `PublishSubscribeBus` interface. Existing callers (publish route +
 * Apex bridge + CDC middleware) don't change — only the bus
 * implementation.
 *
 * Singleton: a single process-wide `defaultBus` is exported so the
 * publish route and any in-process subscriber see the same events.
 * Tests can build their own InMemoryEventBus instance for isolation.
 */
import type {
  BusEvent,
  BusSubscription,
  EventListener,
  PublishSubscribeBus,
  SubscribeOptions,
} from "./types"

interface InternalSubscription {
  id: number
  organizationId: string
  /** When undefined, listener fires for every event in the org. */
  eventName?: string
  listener: EventListener
}

export class InMemoryEventBus implements PublishSubscribeBus {
  private subscriptions = new Map<number, InternalSubscription>()
  private nextId = 1

  publish(event: BusEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.organizationId !== event.organizationId) continue
      if (sub.eventName !== undefined && sub.eventName !== event.eventName) continue
      // Fire-and-forget: a slow listener can't block the publisher.
      // Errors are caught here so one bad listener doesn't poison the
      // rest of the fan-out.
      Promise.resolve()
        .then(() => sub.listener(event))
        .catch(err => {
          // eslint-disable-next-line no-console
          console.error(
            `[platform-events] listener for org=${event.organizationId} event=${event.eventName} threw:`,
            err
          )
        })
    }
  }

  subscribe(opts: SubscribeOptions): BusSubscription {
    const id = this.nextId++
    const sub: InternalSubscription = {
      id,
      organizationId: opts.organizationId,
      eventName: opts.eventName,
      listener: opts.listener,
    }
    this.subscriptions.set(id, sub)
    const subscriptions = this.subscriptions
    return {
      unsubscribe() {
        subscriptions.delete(id)
      },
    }
  }

  /** Test helper — number of live subscriptions. */
  _size(): number {
    return this.subscriptions.size
  }

  /** Test helper — drop all subscriptions. */
  _clearForTesting(): void {
    this.subscriptions.clear()
  }
}

/**
 * Process-wide singleton. The publish route emits here; in-process
 * subscribers (slice-2 Apex bridge, slice-2 CDC) consume from here.
 * Slice 2 will replace this with a Redis-backed instance behind the
 * same interface — only this export's value changes.
 */
export const defaultBus: InMemoryEventBus = new InMemoryEventBus()
