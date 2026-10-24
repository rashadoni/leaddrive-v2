import phase from "./release-phase.json"

/** Immutable artifact phase: backend A remains compatible when UI B is rolled back. */
export const BOOKING_WORKSPACE_ENABLED = phase.mode === "workspace"
