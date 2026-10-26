#!/usr/bin/env node
/**
 * Packs extensions/e-qaime/ into public/downloads/leaddrive-e-qaime.zip, the
 * file Finance → «E-qaimə» offers for installation. Deterministic: the same
 * sources give the same bytes, so `--check` can tell a stale zip from a fresh
 * one (src/__tests__/e-qaime-extension.test.ts runs it).
 *
 *   node scripts/e-qaime-extension/pack.mjs           write the zip
 *   node scripts/e-qaime-extension/pack.mjs --check   exit 1 if the zip is stale
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
export const SOURCE = path.join(ROOT, "extensions/e-qaime")
export const TARGET = path.join(ROOT, "public/downloads/leaddrive-e-qaime.zip")
const FOLDER = "leaddrive-e-qaime"
const FIXED_DATE = new Date("2026-01-01T00:00:00Z")

export function sourceFiles(dir = SOURCE, prefix = "") {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    return statSync(full).isDirectory() ? sourceFiles(full, rel) : [rel]
  })
}

export async function buildZip() {
  const zip = new JSZip()
  for (const rel of sourceFiles()) {
    zip.file(`${FOLDER}/${rel}`, readFileSync(path.join(SOURCE, rel)), { date: FIXED_DATE, createFolders: false })
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" })
}

async function main() {
  const bytes = await buildZip()
  if (process.argv.includes("--check")) {
    const current = existsSync(TARGET) ? readFileSync(TARGET) : null
    if (!current || !current.equals(bytes)) {
      console.error(`${path.relative(ROOT, TARGET)} is stale: run node scripts/e-qaime-extension/pack.mjs`)
      process.exit(1)
    }
    console.log("e-qaime extension zip is up to date")
    return
  }
  mkdirSync(path.dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, bytes)
  console.log(`wrote ${path.relative(ROOT, TARGET)} (${bytes.length} bytes)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
