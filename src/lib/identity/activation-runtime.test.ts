import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, writeFile, rm, chmod, symlink, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertIdentityActivationRuntime } from "./activation-runtime"
const sha = "a".repeat(40)
let root: string | undefined
async function fixture() {
  root = await mkdtemp(join(tmpdir(), "identity-runtime-"))
  await writeFile(join(root, ".deploy-sha"), sha, { mode: 0o600 })
  await writeFile(join(root, ".identity-backend-contract.json"), JSON.stringify({ version: 1, contract: "identity-canonical-auth/v1", artifactSha: sha }), { mode: 0o600 })
  vi.stubEnv("IDENTITY_MOBILE_SESSION_KEYS", JSON.stringify({ active: "mobile", keys: { mobile: "11".repeat(32) } }))
  vi.stubEnv("IDENTITY_PHONE_PROOF_KEYS", JSON.stringify({ active: "proof", keys: { proof: "22".repeat(32) } }))
  return root
}
afterEach(async () => { vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); root = undefined })
describe("activation deployment admission", () => {
  it("requires the SHA-bound compatible artifact and independent configured keys", async () => {
    expect(await assertIdentityActivationRuntime(await fixture())).toBe(sha)
  })
  it.each(["missing", "wrong-sha", "writable", "symlink", "missing-proof-key", "shared-key", "unknown-contract"])("refuses %s without revealing configuration", async reason => {
    const directory = await fixture(), file = join(directory, ".identity-backend-contract.json")
    if (reason === "missing") await unlink(file)
    if (reason === "wrong-sha") await writeFile(join(directory, ".deploy-sha"), "b".repeat(40))
    if (reason === "writable") await chmod(file, 0o666)
    if (reason === "symlink") { await unlink(file); await symlink(join(directory, ".deploy-sha"), file) }
    if (reason === "missing-proof-key") vi.stubEnv("IDENTITY_PHONE_PROOF_KEYS", "")
    if (reason === "shared-key") vi.stubEnv("IDENTITY_PHONE_PROOF_KEYS", JSON.stringify({ active: "proof", keys: { proof: "11".repeat(32) } }))
    if (reason === "unknown-contract") await writeFile(file, JSON.stringify({ version: 1, contract: "future", artifactSha: sha }))
    await expect(assertIdentityActivationRuntime(directory)).rejects.toMatchObject({ message: "IDENTITY_ACTIVATION_RUNTIME_UNAVAILABLE" })
  })
})
