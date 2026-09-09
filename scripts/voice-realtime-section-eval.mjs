#!/usr/bin/env node

import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..")
const EVAL_LOCALES = ["ru", "az"]
const EVAL_ACTIONS = ["navigate", "explain"]
const EXPECTED_TOOL_BY_ACTION = {
  navigate: "navigate_to_section",
  explain: "explain_section",
}

const DEFAULTS = Object.freeze({
  live: false,
  limit: null,
  delayMs: 1_000,
  batchSize: 16,
  timeoutMs: 30_000,
  model: "retired",
})

function boundedInteger(raw, name, minimum, maximum) {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_out_of_range`)
  }
  return parsed
}

export function parseEvalArguments(argv) {
  const options = { ...DEFAULTS }
  for (const argument of argv) {
    if (argument === "--live") {
      throw new Error("live_mode_retired")
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true
      continue
    }
    const [name, raw] = argument.split("=", 2)
    if (raw === undefined) throw new Error("unknown_argument")
    if (name === "--limit") options.limit = boundedInteger(raw, "limit", 1, 10_000)
    else if (name === "--delay-ms") options.delayMs = boundedInteger(raw, "delay_ms", 50, 5_000)
    else if (name === "--batch-size") options.batchSize = boundedInteger(raw, "batch_size", 1, 32)
    else if (name === "--timeout-ms") options.timeoutMs = boundedInteger(raw, "timeout_ms", 5_000, 120_000)
    else if (name === "--model") throw new Error("live_mode_retired")
    else throw new Error("unknown_argument")
  }
  return options
}

export async function loadRealtimeVoiceContract() {
  const { createServer } = await import("vite")
  const server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: { alias: { "@": path.join(REPOSITORY_ROOT, "src") } },
    // This server exists to transpile two TypeScript modules once and is
    // closed immediately after, so it can never consume a file-change event —
    // but Vite's default dev-server watcher still walks the whole repository
    // and registers an inotify handle per file before the first
    // `ssrLoadModule` returns. That walk, not the transpile, is where the time
    // goes, and it scales with how much junk sits beside the source.
    //
    // Measured 2026-09-07, `loadRealtimeVoiceContract()` alone:
    //   watcher off, idle 8-core box     boot 170 ms + load 1.4 s = 1.6 s
    //   watcher on,  CI box (clean tree) ~3 s, and past 15 s under CI load
    //   watcher on,  dev box (14 git worktrees)  never finishes: it dies with
    //                                     ENOSPC on the inotify handle limit
    //
    // So the wrapping vitest suite was not slow because CI was busy; being
    // busy only decided which day it noticed. Raising that suite's own timeout
    // treats a repository-sized directory walk as a fact of life.
    server: { middlewareMode: true, watch: null },
  })
  try {
    const contractModule = await server.ssrLoadModule("/src/lib/ai/voice/realtime-tool-contract.ts")
    const aliasesModule = await server.ssrLoadModule("/src/lib/ai/voice/section-aliases.ts")
    // One payload per evaluated language, because that is what the product
    // sends: the section label catalog carries the session's own language only,
    // so evaluating a Russian prompt against the Azerbaijani payload would
    // measure a contract no user is ever given.
    const toolsByLocale = Object.fromEntries(
      EVAL_LOCALES.map((locale) => [locale, contractModule.voiceTools(undefined, locale)]),
    )
    return {
      tools: toolsByLocale[EVAL_LOCALES[0]],
      toolsByLocale,
      matrix: contractModule.REALTIME_SECTION_LOCALE_MATRIX,
      resolveAlias: aliasesModule.resolveVoiceSectionAlias,
    }
  } finally {
    await server.close()
  }
}

function promptFor(locale, action, alias) {
  if (locale === "az") {
    return action === "navigate"
      ? `«${alias}» bölməsini aç.`
      : `«${alias}» bölməsinin nə üçün olduğunu izah et.`
  }
  return action === "navigate"
    ? `Открой раздел «${alias}».`
    : `Объясни, для чего нужен раздел «${alias}».`
}

/** Build two deterministic, non-customer prompts for every RU/AZ section. */
export function buildSectionEvalCases(matrix) {
  const cases = []
  for (const [section, locales] of Object.entries(matrix)) {
    for (const locale of EVAL_LOCALES) {
      const aliases = locales?.[locale]?.aliases
      const alias = Array.isArray(aliases) ? aliases.at(-1) : null
      for (const action of EVAL_ACTIONS) {
        cases.push({
          id: `${locale}:${action}:${section}`,
          locale,
          action,
          section,
          alias,
          prompt: typeof alias === "string" ? promptFor(locale, action, alias) : "",
          expectedTool: EXPECTED_TOOL_BY_ACTION[action],
        })
      }
    }
  }
  return cases
}

function enumValues(tool, property) {
  const value = tool?.parameters?.properties?.[property]?.enum
  return Array.isArray(value) ? value : []
}

export function runStaticSectionAudit({ tools, matrix, resolveAlias }) {
  const cases = buildSectionEvalCases(matrix)
  const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  const sections = Object.keys(matrix)
  const navigationSections = new Set(enumValues(toolsByName.navigate_to_section, "section"))
  const explanationSections = new Set(enumValues(toolsByName.explain_section, "section"))
  const mismatches = []

  for (const section of sections) {
    if (!navigationSections.has(section)) mismatches.push(`${section}:navigation_enum`)
    if (!explanationSections.has(section)) mismatches.push(`${section}:explanation_enum`)
    for (const locale of EVAL_LOCALES) {
      const entry = matrix[section]?.[locale]
      if (!entry || !Array.isArray(entry.aliases) || entry.aliases.length === 0) {
        mismatches.push(`${section}:${locale}:aliases`)
        continue
      }
      if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
        mismatches.push(`${section}:${locale}:summary`)
      }
      const deterministicAlias = entry.aliases.at(-1)
      const resolved = resolveAlias(deterministicAlias, locale)
      if (resolved?.status !== "resolved" || resolved.section !== section) {
        mismatches.push(`${section}:${locale}:route`)
      }
    }
  }

  for (const testCase of cases) {
    if (!testCase.alias || !testCase.prompt) mismatches.push(`${testCase.id}:prompt`)
  }

  return {
    mode: "static",
    status: mismatches.length === 0 ? "pass" : "fail",
    sections: sections.length,
    locales: EVAL_LOCALES.length,
    cases: cases.length,
    mismatches: mismatches.length,
    mismatchIds: mismatches.slice(0, 20),
    liveRequests: 0,
    crmToolsExecuted: 0,
  }
}

export function stableSignal(result) {
  return `VOICE_REALTIME_SECTION_EVAL=${result.status.toUpperCase()} mode=${result.mode} sections=${result.sections} cases=${result.cases} mismatches=${result.mismatches}`
}

export function sanitizedFailureReason(error) {
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : ""
  return /^[a-z0-9_]+$/i.test(message) ? message : "eval_failed"
}

function printHelp() {
  console.log(`Usage:
  node scripts/voice-realtime-section-eval.mjs

Static mode makes zero provider requests. The former live provider mode is retired.`)
}

async function main() {
  const options = parseEvalArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const contract = await loadRealtimeVoiceContract()
  const staticResult = runStaticSectionAudit(contract)
  if (staticResult.status !== "pass") {
    console.log(JSON.stringify(staticResult))
    console.log(stableSignal(staticResult))
    process.exitCode = 1
    return
  }

  const result = staticResult
  console.log(JSON.stringify(result))
  console.log(stableSignal(result))
  if (result.status !== "pass") process.exitCode = 1
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedAsScript) {
  main().catch((error) => {
    const reason = sanitizedFailureReason(error)
    console.error(`VOICE_REALTIME_SECTION_EVAL=FAIL reason=${reason}`)
    process.exitCode = 1
  })
}
