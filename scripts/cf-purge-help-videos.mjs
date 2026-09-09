#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import process from "node:process"

const DEFAULT_APP_ENV_FILE = "/etc/leaddrive/app.env"
const DEFAULT_ENV_FILE = process.env.APP_ENV_FILE || DEFAULT_APP_ENV_FILE
const DEFAULT_BASE_URL = "https://app.leaddrivecrm.org/api/help-videos"
// Current Cloudflare single-file purge limit for Free/Pro/Business plans.
const MAX_URLS_PER_REQUEST = 100
const FILE_PATTERN = /^[a-z0-9-]+\.(az|en|ru)\.(VOICE\.mp4|poster\.jpg)$/

function usage() {
  return [
    "Usage:",
    "  node scripts/cf-purge-help-videos.mjs --version <asset-version> [options] <file>...",
    "",
    "Options:",
    `  --env <path>       dotenv file (default: ${DEFAULT_ENV_FILE})`,
    `  --base-url <url>   public help-video base URL (default: ${DEFAULT_BASE_URL})`,
    "  --dry-run          print URLs without calling Cloudflare",
    "",
    "Required environment variables (process env wins over the dotenv file):",
    "  CLOUDFLARE_ZONE_ID",
    "  CLOUDFLARE_API_TOKEN",
  ].join("\n")
}

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    baseUrl: DEFAULT_BASE_URL,
    version: "",
    dryRun: false,
    files: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--help" || arg === "-h") {
      console.log(usage())
      process.exit(0)
    }
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (arg === "--env" || arg === "--base-url" || arg === "--version") {
      const value = argv[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      index += 1
      if (arg === "--env") options.envFile = value
      if (arg === "--base-url") options.baseUrl = value
      if (arg === "--version") options.version = value
      continue
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`)
    options.files.push(arg)
  }

  return options
}

function parseDotenv(contents) {
  const values = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("export ")) line = line.slice("export ".length).trim()

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    let value = match[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }

  return values
}

async function loadDotenv(path) {
  let contents
  try {
    contents = await readFile(path, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }

  for (const [key, value] of Object.entries(parseDotenv(contents))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function normalizedBaseUrl(raw) {
  const url = new URL(raw)
  if (url.protocol !== "https:") throw new Error("--base-url must use https")
  if (url.username || url.password) throw new Error("--base-url must not contain credentials")
  return url.toString().replace(/\/$/, "")
}

function buildUrls(baseUrl, version, files) {
  if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) {
    throw new Error("--version must contain only letters, numbers, dots, underscores, or hyphens")
  }
  if (files.length === 0) throw new Error("At least one help-video filename is required")

  const uniqueFiles = [...new Set(files)]
  for (const file of uniqueFiles) {
    if (!FILE_PATTERN.test(file)) throw new Error(`Invalid help-video filename: ${file}`)
  }

  return uniqueFiles.map(
    (file) => `${baseUrl}/${encodeURIComponent(file)}?v=${encodeURIComponent(version)}`,
  )
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function purgeBatch({ zoneId, token, files }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files }),
    },
  )

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare returned HTTP ${response.status} with a non-JSON response`)
  }

  if (!response.ok || payload?.success !== true) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown error"}`).join("; ")
      : "unknown error"
    throw new Error(`Cloudflare purge failed (HTTP ${response.status}): ${details}`)
  }

  return payload?.result?.id ?? "unknown"
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await loadDotenv(options.envFile)

  const baseUrl = normalizedBaseUrl(options.baseUrl)
  const urls = buildUrls(baseUrl, options.version, options.files)

  if (options.dryRun) {
    console.log(JSON.stringify({ files: urls }, null, 2))
    return
  }

  const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim()
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (!zoneId) throw new Error(`CLOUDFLARE_ZONE_ID is missing from the environment or ${options.envFile}`)
  if (!token) throw new Error(`CLOUDFLARE_API_TOKEN is missing from the environment or ${options.envFile}`)

  let purged = 0
  for (const batch of chunks(urls, MAX_URLS_PER_REQUEST)) {
    const requestId = await purgeBatch({ zoneId, token, files: batch })
    purged += batch.length
    console.log(`Cloudflare purge accepted: batch=${batch.length} total=${purged}/${urls.length} request=${requestId}`)
  }
}

main().catch((error) => {
  console.error(`Cloudflare help-video purge failed: ${error.message}`)
  process.exitCode = 1
})
