import { lstat, readFile } from "node:fs/promises"
import { join } from "node:path"
import { IdentityRegistryError } from "./contract"
import { identityRuntimeKeys } from "./runtime-keys"

/** Server-owned deployment evidence; never accept a directory, marker or keys
 * from an HTTP body. Development trees without an immutable marker refuse. */
export async function assertIdentityActivationRuntime(directory = process.cwd()): Promise<string> {
  try {
    for (const name of [".deploy-sha", ".identity-backend-contract.json"]) {
      const stat = await lstat(join(directory, name))
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) || stat.size > 512) throw new Error()
    }
    const sha = (await readFile(join(directory, ".deploy-sha"), "utf8")).trim()
    const marker = JSON.parse(await readFile(join(directory, ".identity-backend-contract.json"), "utf8"))
    if (!/^[a-f0-9]{40}$/.test(sha) || !marker || Object.keys(marker).length !== 3 || marker.version !== 1
      || marker.contract !== "identity-canonical-auth/v1" || marker.artifactSha !== sha) throw new Error()
    const keys = identityRuntimeKeys()
    if (!keys.mobile || !keys.proof) throw new Error()
    return sha
  } catch { throw new IdentityRegistryError("IDENTITY_ACTIVATION_RUNTIME_UNAVAILABLE") }
}
