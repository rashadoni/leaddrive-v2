/**
 * Production keeps the PII master key only in its root-only env file: the
 * process environment names the file, and the key never reaches PM2's saved
 * dump or a child process. These cases pin both halves — the app reading the
 * file, and the deploy handing PM2 the file instead of the key.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decryptForTenant,
  encryptForTenant,
  isTenantPiiMasterKeyConfigured,
  resetMasterKekCache,
} from "@/lib/crypto/tenant-pii-encryption"

const KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const OTHER = "fedcba9876543210".repeat(4) // gitleaks:allow — synthetic test key
const ORG = "cmorgkeyfileaaaaaaaaaaaaa"

let directory: string
let saved: { key?: string; file?: string }

async function envFile(content: string) {
  const file = path.join(directory, "app.env")
  await writeFile(file, content)
  return file
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pii-master-key-"))
  saved = { key: process.env.TENANT_PII_MASTER_KEY, file: process.env.TENANT_PII_MASTER_KEY_FILE }
  delete process.env.TENANT_PII_MASTER_KEY
  delete process.env.TENANT_PII_MASTER_KEY_FILE
  resetMasterKekCache()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
  if (saved.key === undefined) delete process.env.TENANT_PII_MASTER_KEY
  else process.env.TENANT_PII_MASTER_KEY = saved.key
  if (saved.file === undefined) delete process.env.TENANT_PII_MASTER_KEY_FILE
  else process.env.TENANT_PII_MASTER_KEY_FILE = saved.file
  resetMasterKekCache()
})

describe("master key from the env file", () => {
  it("reads the key from the named file and decrypts what the variable encrypted", async () => {
    process.env.TENANT_PII_MASTER_KEY = KEY
    const ciphertext = encryptForTenant(ORG, "Rəşad Rəhimov")
    delete process.env.TENANT_PII_MASTER_KEY
    resetMasterKekCache()

    process.env.TENANT_PII_MASTER_KEY_FILE = await envFile(
      `# production env\nDATABASE_URL=postgres://x\nexport TENANT_PII_MASTER_KEY="${KEY}"\nNEXTAUTH_SECRET=y\n`,
    )
    expect(isTenantPiiMasterKeyConfigured()).toBe(true)
    expect(decryptForTenant(ORG, ciphertext)).toBe("Rəşad Rəhimov")
  })

  it("accepts the variable alongside only when it names the same key", async () => {
    process.env.TENANT_PII_MASTER_KEY_FILE = await envFile(`TENANT_PII_MASTER_KEY=${KEY}\n`)
    process.env.TENANT_PII_MASTER_KEY = KEY
    expect(isTenantPiiMasterKeyConfigured()).toBe(true)

    resetMasterKekCache()
    process.env.TENANT_PII_MASTER_KEY = OTHER
    expect(() => encryptForTenant(ORG, "x")).toThrow(/different keys/)
  })

  it("fails closed on a file without the key, a duplicated key or a missing file", async () => {
    process.env.TENANT_PII_MASTER_KEY_FILE = await envFile("NEXTAUTH_SECRET=y\n")
    expect(isTenantPiiMasterKeyConfigured()).toBe(false)

    resetMasterKekCache()
    process.env.TENANT_PII_MASTER_KEY_FILE = await envFile(`TENANT_PII_MASTER_KEY=${KEY}\nTENANT_PII_MASTER_KEY=${KEY}\n`)
    expect(() => encryptForTenant(ORG, "x")).toThrow(/more than once/)

    resetMasterKekCache()
    process.env.TENANT_PII_MASTER_KEY_FILE = path.join(directory, "absent.env")
    expect(isTenantPiiMasterKeyConfigured()).toBe(false)
  })

  it("never echoes the key in an error", async () => {
    process.env.TENANT_PII_MASTER_KEY_FILE = await envFile(`TENANT_PII_MASTER_KEY=${KEY}\n`)
    process.env.TENANT_PII_MASTER_KEY = OTHER
    try {
      encryptForTenant(ORG, "x")
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toContain(KEY)
      expect(String(error)).not.toContain(OTHER)
    }
  })
})

describe("deploy hands PM2 the file, not the key", () => {
  const deploy = readFileSync(path.join(process.cwd(), "scripts/server-deploy.sh"), "utf8")
  const mainStart = deploy.indexOf('pm2 start "$PM2_CONFIG"')

  it("unsets the key and exports the file right before the new artifact starts", () => {
    const preamble = deploy.slice(deploy.lastIndexOf('PM2_CONFIG="$APP_DIR/.next/standalone/ecosystem.config.cjs"', mainStart), mainStart)
    expect(mainStart).toBeGreaterThan(0)
    expect(preamble).toContain("export TENANT_PII_MASTER_KEY_FILE")
    expect(preamble).toContain("unset TENANT_PII_MASTER_KEY")
    expect(preamble).toContain('realpath -e -- "$APP_ENV_SOURCE_FILE"')
  })

  it("still validates the key in the env file before anything starts", () => {
    expect(deploy.indexOf("require_env TENANT_PII_MASTER_KEY")).toBeGreaterThan(0)
    expect(deploy.indexOf("require_env TENANT_PII_MASTER_KEY")).toBeLessThan(mainStart)
  })

  it("handoff recovery reloads the env file, so an older artifact still gets the variable", () => {
    const rollbackStart = deploy.indexOf('pm2 start "$rollback_config"')
    const reload = deploy.lastIndexOf('load_dotenv_file "$APP_ENV_FILE"', rollbackStart)
    expect(rollbackStart).toBeGreaterThan(0)
    expect(reload).toBeGreaterThan(0)
    expect(deploy.slice(reload, rollbackStart)).not.toContain("unset TENANT_PII_MASTER_KEY")
  })
})
