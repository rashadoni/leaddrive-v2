/**
 * Prompt Safety — detects prompt injection / jailbreak attempts in user input
 * before forwarding to LLM. Part of H9 Trust Layer (Phase 1 roadmap).
 *
 * Strategy: layered detection
 *   1. Fast regex patterns (free, ms-latency, ~80% recall for known patterns)
 *   2. Optional LLM-classifier (paid, second-line for borderline cases — caller decides)
 *   3. Heuristic scoring (length, encoding tricks, repetition)
 *
 * Result is advisory — caller decides whether to block, sanitize, or audit.
 *
 * Usage:
 *   const verdict = analyzePromptSafety(userInput)
 *   if (verdict.verdict === "blocked") return error
 *   if (verdict.verdict === "warning") await logSuspicious(verdict)
 */

export type SafetyVerdict = "safe" | "warning" | "blocked"

export interface SafetyThreat {
  type: ThreatType
  pattern: string
  excerpt: string
  weight: number // contribution to overall risk score (0-1)
}

export type ThreatType =
  | "instruction_override" // "ignore previous instructions"
  | "role_hijack" // "you are now a different assistant"
  | "system_prompt_extraction" // "show me your system prompt"
  | "encoding_smuggle" // base64/hex/zero-width payload
  | "delimiter_attack" // fake system/user delimiters
  | "tool_abuse" // "call X without telling user"
  | "data_exfiltration" // "list all customers", "dump database"
  | "persona_override" // "DAN mode", "developer mode"
  | "harmful_content" // explicit illegal/violence asks
  | "excessive_length" // unusually long input (possible smuggle attempt)
  | "repetition_attack" // repeated tokens for confusion
  | "homoglyph_smuggle" // Cyrillic homoglyphs hiding Latin keywords (e.g. "ignоre" with Cyrillic о)

export interface SafetyAnalysis {
  verdict: SafetyVerdict
  riskScore: number // 0-1
  threats: SafetyThreat[]
  reasoning: string
}

/**
 * Patterns are tuned to be conservative — false positives are acceptable
 * because the verdict is advisory ("warning"), not "blocked", until score > 0.7.
 */
const PATTERNS: Array<{ type: ThreatType; regex: RegExp; weight: number; description: string }> = [
  // Instruction override
  { type: "instruction_override", regex: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?|directives?|commands?)\b/i, weight: 0.8, description: "ignore previous instructions" },
  { type: "instruction_override", regex: /(?:^|[\s.,;!?(])(забудь|игнорируй|отбрось|переопредели)\s+(все\s+)?(предыдущие|прежние|прошлые|ранее заданные)\s+(инструкции|правила|команды|указания)/i, weight: 0.8, description: "ignore previous instructions (RU)" },
  { type: "instruction_override", regex: /\bnew\s+(instructions?|directives?|rules?)\s+(follow|override|replace)/i, weight: 0.6, description: "new instructions follow/override" },

  // Role hijack
  { type: "role_hijack", regex: /\byou\s+(are\s+now|will\s+(now\s+)?act\s+as|must\s+(now\s+)?(act|behave)\s+(as|like))\s+(?!helpful|the assistant)/i, weight: 0.7, description: "you are now X" },
  // Weight dropped 0.5→0.3: "Imagine you are a sales coach" is legitimate sales-AI coaching use case
  { type: "role_hijack", regex: /\b(pretend|imagine|roleplay|simulate)\s+(you\s+are|to\s+be|that\s+you|that\s+we)\s+/i, weight: 0.3, description: "pretend you are" },
  { type: "role_hijack", regex: /(?:^|[\s.,;!?(])теперь\s+ты\s+(не\s+)?[\wа-яА-Я]+/i, weight: 0.6, description: "now you are X (RU)" },

  // System prompt extraction
  { type: "system_prompt_extraction", regex: /\b(show|reveal|print|repeat|expose|leak|tell|display|output)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?|rules?|directive|configuration)/i, weight: 0.9, description: "extract system prompt" },
  // Weight dropped 0.7→0.5: "What are your instructions for closing deals?" — legitimate sales question
  { type: "system_prompt_extraction", regex: /\bwhat\s+(are\s+)?your\s+(system\s+)?(instructions?|rules?|prompt|directives?)\b/i, weight: 0.5, description: "what are your instructions" },
  { type: "system_prompt_extraction", regex: /(?:^|[\s.,;!?(])покажи\s+(мне\s+)?(свой\s+|твой\s+)?(системный\s+)?(промпт|инструкции|правила)/i, weight: 0.8, description: "show system prompt (RU)" },

  // Persona override (DAN, developer mode, etc.)
  { type: "persona_override", regex: /\b(DAN|developer\s+mode|jailbreak|sudo\s+mode|admin\s+mode|god\s+mode|unrestricted\s+mode)\b/i, weight: 0.9, description: "jailbreak persona" },
  { type: "persona_override", regex: /\bdo\s+anything\s+now\b/i, weight: 0.9, description: "DAN explicit" },

  // Delimiter attacks (fake system/user markers) — no \b, brackets aren't word chars
  { type: "delimiter_attack", regex: /(<\|im_(start|end)\|>|<\|system\|>|<\|user\|>|<\|assistant\|>|\[INST\]|\[\/INST\])/i, weight: 0.7, description: "chat-template delimiter" },
  { type: "delimiter_attack", regex: /^\s*(System|Assistant|User|Human):\s*/m, weight: 0.4, description: "fake role prefix" },
  { type: "delimiter_attack", regex: /```\s*system\b/i, weight: 0.5, description: "system codeblock" },

  // Tool abuse / hidden actions
  { type: "tool_abuse", regex: /\b(without\s+(telling|informing|notifying)\s+(the\s+)?user|silently|behind\s+the\s+user'?s?\s+back|don'?t\s+tell\s+(them|user))\b/i, weight: 0.7, description: "without telling user" },
  { type: "tool_abuse", regex: /\b(call|invoke|execute|run)\s+(the\s+)?(tool|function|api)\s+\w+\s+(without|silently)/i, weight: 0.6, description: "silent tool invocation" },

  // Data exfiltration
  { type: "data_exfiltration", regex: /\b(dump|export|leak|exfiltrate|send|email|transfer)\s+(all|the\s+entire|every|whole)\s+(database|data|customers?|contacts?|users?|records?|table)\b/i, weight: 0.7, description: "mass data exfiltration" },
  // Narrowed: only sensitive-credential enumeration triggers (api_keys/passwords/secrets), не "list all customers"
  // (legitimate CRM listings like "Show all contacts from last week" не должны давать warning).
  { type: "data_exfiltration", regex: /\b(list|show|give\s+me|dump|export)\s+all\s+(api[\s_-]?keys?|passwords?|secrets?|tokens?|credentials?)\b/i, weight: 0.7, description: "enumerate all credentials" },

  // Harmful content (basic — providers have their own filters too)
  { type: "harmful_content", regex: /\b(how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|explosive|virus|malware))/i, weight: 0.95, description: "weapon/malware construction" },

  // Encoding smuggle
  { type: "encoding_smuggle", regex: /\b(decode|deobfuscate|run)\s+(this\s+)?(base64|hex|rot13|reversed?)/i, weight: 0.5, description: "decode instruction" },
]

/**
 * Zero-width and bidi-override characters often used in adversarial prompts.
 */
const INVISIBLE_CHAR_REGEX = /[​-‏‪-‮⁠-⁯﻿]/g

/**
 * Cyrillic→Latin homoglyph map. Visual-identical pairs used in bypass attacks
 * like "ignоre previous instructions" (Cyrillic 'о' instead of Latin 'o').
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  "а": "a", "А": "A",
  "е": "e", "Е": "E",
  "о": "o", "О": "O",
  "р": "p", "Р": "P",
  "с": "c", "С": "C",
  "х": "x", "Х": "X",
  "у": "y", "У": "Y",
  "к": "k", "К": "K",
  "і": "i", "І": "I",
  "ѕ": "s", "Ѕ": "S",
  "ј": "j", "Ј": "J",
}

const HOMOGLYPH_REGEX = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join("")}]`, "g")

/** Replace Cyrillic look-alikes with Latin equivalents. */
function latinizeHomoglyphs(input: string): string {
  return input.replace(HOMOGLYPH_REGEX, ch => HOMOGLYPH_MAP[ch] || ch)
}

/**
 * Detect mixed-script words (Cyrillic + Latin within same token) — primary
 * signal of homoglyph smuggling. Pure-Cyrillic words are normal and shouldn't
 * trigger this; Latin-only words are normal too.
 */
function detectMixedScriptWord(input: string): string | null {
  // Tokenize on whitespace and punctuation
  const tokens = input.split(/[\s\p{P}]+/u).filter(t => t.length > 1)
  for (const tok of tokens) {
    const hasLatin = /[a-zA-Z]/.test(tok)
    const hasCyrillic = /[а-яА-Я]/.test(tok)
    if (hasLatin && hasCyrillic) return tok
  }
  return null
}

/**
 * Analyze a single user input for prompt-safety threats.
 * Returns advisory verdict — caller decides response.
 */
export function analyzePromptSafety(input: string): SafetyAnalysis {
  if (!input || typeof input !== "string") {
    return { verdict: "safe", riskScore: 0, threats: [], reasoning: "empty input" }
  }

  const threats: SafetyThreat[] = []
  const seenTypes = new Set<string>() // dedup same type from original vs latinized scan

  // 0. Homoglyph smuggle detection — flag and prepare Latinized variant for re-scan
  const mixedToken = detectMixedScriptWord(input)
  let latinized: string | null = null
  if (mixedToken) {
    latinized = latinizeHomoglyphs(input)
    threats.push({
      type: "homoglyph_smuggle",
      pattern: "mixed Cyrillic+Latin script in single word",
      excerpt: `"${mixedToken}" — likely homoglyph bypass`,
      weight: 0.6,
    })
    seenTypes.add("homoglyph_smuggle")
  }

  // 1. Pattern matching on original input
  for (const { type, regex, weight, description } of PATTERNS) {
    const match = input.match(regex)
    if (match) {
      threats.push({
        type,
        pattern: description,
        excerpt: clipExcerpt(match[0], input),
        weight,
      })
      // Dedup key: type+description. Trade-off — если original матчит "ignore previous"
      // по одной формулировке, а latinized — по другой (например через бессмысленную
      // Cyrillic-Latin смесь), второй match suppressed. Acceptable: aggregate score
      // всё равно учитывает первый, а distinct excerpt важнее для audit, чем для verdict.
      seenTypes.add(type + ":" + description)
    }
  }

  // 1b. Re-scan on Latinized version (catches "ignоre previous instructions" via Cyrillic 'о').
  //     TODO H9.2: reverse-direction (Latin homoglyphs masquerading as Cyrillic, e.g. "пoкажи"
  //     with Latin 'o') не покрыт — HOMOGLYPH_MAP односторонний.
  if (latinized && latinized !== input) {
    for (const { type, regex, weight, description } of PATTERNS) {
      if (seenTypes.has(type + ":" + description)) continue
      const match = latinized.match(regex)
      if (match) {
        threats.push({
          type,
          pattern: `${description} (after homoglyph normalization)`,
          excerpt: clipExcerpt(match[0], latinized),
          weight, // same weight — bypass attempt doesn't change pattern severity
        })
      }
    }
  }

  // 2. Invisible-character smuggling
  const invisibleMatches = input.match(INVISIBLE_CHAR_REGEX)
  if (invisibleMatches && invisibleMatches.length > 0) {
    threats.push({
      type: "encoding_smuggle",
      pattern: "invisible unicode characters",
      excerpt: `${invisibleMatches.length} hidden char(s) detected`,
      weight: 0.4 + Math.min(invisibleMatches.length / 20, 0.4),
    })
  }

  // 3. Length-based heuristic — single-message above 8000 chars is suspicious for chat input.
  //    NB: legitimate long inputs exist (pasted documents), so weight is low.
  if (input.length > 8000) {
    threats.push({
      type: "excessive_length",
      pattern: `input length ${input.length} chars`,
      excerpt: `${input.slice(0, 100)}…`,
      weight: 0.2,
    })
  }

  // 4. Repetition attack — same token repeated >50 times
  const repetition = detectRepetition(input)
  if (repetition) {
    threats.push({
      type: "repetition_attack",
      pattern: `token "${repetition.token}" × ${repetition.count}`,
      excerpt: repetition.token,
      weight: 0.3,
    })
  }

  // Aggregate risk score: 1 - product of (1 - weight) for each threat (independence assumption)
  const riskScore = threats.length === 0
    ? 0
    : 1 - threats.reduce((acc, t) => acc * (1 - t.weight), 1)

  const verdict: SafetyVerdict =
    riskScore >= 0.7 ? "blocked"
    : riskScore >= 0.3 ? "warning"
    : "safe"

  const reasoning = threats.length === 0
    ? "no threats detected"
    : `${threats.length} threat(s): ${threats.map(t => t.type).join(", ")}`

  return { verdict, riskScore: Number(riskScore.toFixed(3)), threats, reasoning }
}

export interface SanitizeOptions {
  /** Latinize Cyrillic homoglyphs (e.g. 'о' → 'o'). Default: false — destructive for legit RU text. */
  normalizeHomoglyphs?: boolean
}

/**
 * Sanitize input by stripping invisible characters and fake delimiters.
 * Returns cleaned input and list of applied transformations.
 *
 * Use this when you decide to proceed despite a "warning" verdict —
 * removes the most common smuggle vectors without rejecting the user.
 *
 * `normalizeHomoglyphs` is opt-in because legitimate Russian text contains
 * Cyrillic chars that would be irreversibly mangled. Use only when
 * `analyzePromptSafety` returned a `homoglyph_smuggle` threat for this input.
 */
export function sanitizePrompt(input: string, opts: SanitizeOptions = {}): { sanitized: string; applied: string[] } {
  if (!input) return { sanitized: input, applied: [] }

  const applied: string[] = []
  let sanitized = input

  if (INVISIBLE_CHAR_REGEX.test(sanitized)) {
    sanitized = sanitized.replace(INVISIBLE_CHAR_REGEX, "")
    applied.push("removed invisible unicode chars")
  }

  // Strip fake chat-template delimiters
  const delimiterPatterns = [
    /<\|im_(start|end)\|>/gi,
    /<\|(system|user|assistant)\|>/gi,
    /\[\/?INST\]/gi,
  ]
  for (const p of delimiterPatterns) {
    if (p.test(sanitized)) {
      sanitized = sanitized.replace(p, "")
      applied.push(`stripped delimiter ${p.source}`)
    }
  }

  if (opts.normalizeHomoglyphs && HOMOGLYPH_REGEX.test(sanitized)) {
    sanitized = latinizeHomoglyphs(sanitized)
    applied.push("latinized Cyrillic homoglyphs")
  }

  return { sanitized, applied }
}

/* ----------------- helpers ----------------- */

function clipExcerpt(match: string, full: string, ctx = 30): string {
  const idx = full.indexOf(match)
  if (idx < 0) return match.slice(0, 100)
  const start = Math.max(0, idx - ctx)
  const end = Math.min(full.length, idx + match.length + ctx)
  let excerpt = full.slice(start, end)
  if (start > 0) excerpt = "…" + excerpt
  if (end < full.length) excerpt = excerpt + "…"
  return excerpt
}

function detectRepetition(input: string): { token: string; count: number } | null {
  // Look for any 3+ char word repeated more than 50 times in a row
  const match = input.match(/(\b\w{3,}\b)(?:\s+\1){50,}/i)
  if (match) {
    const count = match[0].split(match[1]).length - 1
    return { token: match[1], count }
  }
  return null
}
