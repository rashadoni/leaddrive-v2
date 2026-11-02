import type { IdentitySessionSigningKey } from "./mobile-session"
import type { PhoneProofKey } from "./phone-proof"
import { IdentityRegistryError } from "./contract"

type KeySet = { active: string; keys: Map<string, Uint8Array> }
function parse(value: string | undefined): KeySet | null {
  if (!value) return null
  try {
    if (value.length > 1024) throw new Error()
    const input = JSON.parse(value)
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
      || typeof input.active !== "string" || !input.keys || typeof input.keys !== "object" || Array.isArray(input.keys)) throw new Error()
    const entries = Object.entries(input.keys)
    if (entries.length < 1 || entries.length > 3) throw new Error()
    const keys = new Map<string, Uint8Array>()
    for (const [id, material] of entries) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof material !== "string" || !/^[a-f0-9]{64}$/.test(material)) throw new Error()
      const bytes = Buffer.from(material, "hex")
      if (bytes.every(byte => byte === 0)) throw new Error()
      keys.set(id, bytes)
    }
    if (!keys.has(input.active)) throw new Error()
    return { active: input.active, keys }
  } catch { throw new IdentityRegistryError("IDENTITY_RUNTIME_KEY_CONFIGURATION_INVALID") }
}
/** Dedicated bounded key rings, with explicit active/retained IDs. Missing
 * configuration disables this runtime; no Auth.js/legacy JWT key fallback.
 * Environment values and parsing errors must never be returned or logged. */
export function identityRuntimeKeys(env: { IDENTITY_MOBILE_SESSION_KEYS?: string; IDENTITY_PHONE_PROOF_KEYS?: string } = process.env) {
  const mobile = parse(env.IDENTITY_MOBILE_SESSION_KEYS), proof = parse(env.IDENTITY_PHONE_PROOF_KEYS)
  if (mobile && proof) {
    const materials = new Set([...mobile.keys.values()].map(bytes => Buffer.from(bytes).toString("hex")))
    if ([...proof.keys.values()].some(bytes => materials.has(Buffer.from(bytes).toString("hex")))) throw new IdentityRegistryError("IDENTITY_RUNTIME_KEY_PURPOSE_COLLISION")
  }
  const mobileKey = (id: string): IdentitySessionSigningKey | null => {
    const material = mobile?.keys.get(id)
    return material ? { purpose: "IDENTITY_MOBILE_SESSION", id, material } : null
  }
  const proofKey = (id: string): PhoneProofKey | null => {
    const material = proof?.keys.get(id)
    return material ? { id, material } : null
  }
  return { mobile: mobile ? { active: mobileKey(mobile.active)!, resolve: mobileKey } : null,
    proof: proof ? { active: proofKey(proof.active)!, resolve: proofKey } : null }
}
