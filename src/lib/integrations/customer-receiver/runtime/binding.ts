import { readFileSync } from "node:fs"
import { z } from "zod"
import type { ReceiverBinding } from "../delivery"

/**
 * Operator-owned runtime binding. It is read from a server-side file named by
 * CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE — never from a request body, a CRM
 * row or the session draft API. A draft save/import cannot create or enable it.
 *
 * Two independent process switches gate the runtime on top of the binding:
 * CUSTOMER_RECEIVER_CAPTURE_ENABLED=on and CUSTOMER_RECEIVER_DELIVERY_ENABLED=on.
 * Missing file, missing switch or an invalid file all mean "disabled".
 */
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
const secretFile = z.string().min(1).max(512).regex(/^\/[A-Za-z0-9_./-]+$/).refine((value) => !value.split("/").includes(".."))

export const runtimeBindingSchema = z.object({
  integrationId: id,
  organizationId: id,
  environment: z.enum(["TEST", "PROD"]),
  enabled: z.boolean(),
  contractApproved: z.boolean(),
  /** Confirmed by the receiving party; recorded, never inferred from HTTP 2xx. */
  durableIdempotencyConfirmed: z.boolean(),
  /** Exact approved builder revision; a later draft edit does not change it. */
  profile: z.object({ draftId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/), revision: z.number().int().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  target: z.object({ origin: z.string().max(300), privateIpv4: z.string().max(15) }).strict().nullable(),
  credentials: z.object({ accessTokenFile: secretFile, certificateFile: secretFile, privateKeyFile: secretFile, caFile: secretFile }).strict().nullable(),
  payloadTtlHours: z.number().int().min(1).max(336),
  securityLogRetentionDays: z.number().int().min(30).max(365),
  /** Unresolved ambiguous outcomes at which the destination stops claiming. */
  pauseAfterUncertain: z.number().int().min(1).max(100),
}).strict()

export const runtimeBindingsFileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  bindings: z.array(runtimeBindingSchema).max(20),
}).strict().superRefine((file, context) => {
  const keys = file.bindings.map((entry) => `${entry.organizationId}/${entry.integrationId}/${entry.environment}`)
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "duplicate_binding" })
})

export type RuntimeBinding = z.infer<typeof runtimeBindingSchema>

export type RuntimeSwitches = { capture: boolean; delivery: boolean }

export function runtimeSwitches(env: Record<string, string | undefined> = process.env): RuntimeSwitches {
  return { capture: env.CUSTOMER_RECEIVER_CAPTURE_ENABLED === "on", delivery: env.CUSTOMER_RECEIVER_DELIVERY_ENABLED === "on" }
}

/** Fail closed: unreadable or invalid configuration yields no bindings. */
export function loadRuntimeBindings(env: Record<string, string | undefined> = process.env, read: (path: string) => string = (path) => readFileSync(path, "utf8")): { bindings: RuntimeBinding[]; error: "not_configured" | "unreadable" | "invalid" | null } {
  const path = env.CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE
  if (!path) return { bindings: [], error: "not_configured" }
  let raw: string
  try { raw = read(path) } catch { return { bindings: [], error: "unreadable" } }
  try {
    const parsed = runtimeBindingsFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { bindings: parsed.data.bindings, error: null } : { bindings: [], error: "invalid" }
  } catch { return { bindings: [], error: "invalid" } }
}

/** Shape expected by the existing kernel validators (validateBinding & co). */
export function kernelBinding(binding: RuntimeBinding): ReceiverBinding {
  return { integrationId: binding.integrationId, organizationId: binding.organizationId, environment: binding.environment, enabled: binding.enabled, contractApproved: binding.contractApproved }
}

export function receiverDestination(binding: Pick<RuntimeBinding, "integrationId" | "environment">) {
  return `customer-receiver:${binding.integrationId}:${binding.environment}`
}

export function captureAllowed(binding: RuntimeBinding, switches: RuntimeSwitches) {
  return switches.capture && binding.enabled && binding.contractApproved
}

export function deliveryAllowed(binding: RuntimeBinding, switches: RuntimeSwitches) {
  return switches.delivery && binding.enabled && binding.contractApproved && binding.target !== null && binding.credentials !== null
}
