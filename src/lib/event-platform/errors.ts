export class AggregateVersionConflictError extends Error {
  readonly code = "EVENT_AGGREGATE_VERSION_CONFLICT"
  constructor(message = "Aggregate version changed; retry the command") {
    super(message)
    this.name = "AggregateVersionConflictError"
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED"
  constructor(message = "Idempotency-Key was already used with a different request") {
    super(message)
    this.name = "IdempotencyConflictError"
  }
}

export class EventIntegrityConflictError extends Error {
  readonly code = "EVENT_PAYLOAD_HASH_CONFLICT"
  constructor(message = "The same event ID was observed with a different payload hash") {
    super(message)
    this.name = "EventIntegrityConflictError"
  }
}

export class ReplayEffectFenceError extends Error {
  readonly code = "REPLAY_EFFECT_FENCED"
  constructor(message = "External effects are disabled while replay mode is active") {
    super(message)
    this.name = "ReplayEffectFenceError"
  }
}

export class ProjectionControlConflictError extends Error {
  readonly code = "PROJECTION_CONTROL_CONFLICT"
  constructor(message = "Projection replay state changed or failed its promotion contract") {
    super(message)
    this.name = "ProjectionControlConflictError"
  }
}
