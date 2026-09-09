/**
 * Social Monitoring — каноническая классификация ошибок collector/adapter (CR-1).
 *
 * До этого модуля `failureClass` был произвольной строкой из места вызова, а
 * circuit breaker обрабатывал любую ошибку одинаково (фиксированные 15 минут).
 * Здесь сырой текст ошибки (и, при наличии, HTTP-статус) сводится к одному из
 * устойчивых классов с рекомендованным поведением retry/quarantine и понятным
 * оператору действием.
 *
 * Чистый модуль: без Prisma, env и побочных эффектов — легко тестируется.
 */

export type CollectorErrorClass =
  | "TRANSIENT" // сетевой сбой, 5xx, timeout — повторить с backoff
  | "RATE_LIMIT" // 429/quota — дольше backoff, уважать retry-after
  | "AUTH" // 401/403, истёкший/отозванный токен — нужно переподключение
  | "POLICY" // capability/policy/ToS отказ — нужен proof или изменение политики
  | "BUDGET" // исчерпан бюджет — блок платного вызова до сброса
  | "PERMANENT" // schema drift, not-found, malformed — dead-letter/quarantine
  | "UNKNOWN"

export interface CollectorErrorClassification {
  class: CollectorErrorClass
  /** Имеет ли смысл автоматический повтор без вмешательства оператора. */
  retryable: boolean
  /**
   * Route должен быть выведен из ротации (BLOCKED) до внешнего исправления:
   * ошибка не самоизлечивается повтором (auth/policy/permanent).
   */
  quarantine: boolean
  /** Базовый cooldown (сек) до применения backoff и jitter. */
  cooldownSeconds: number
  /** Нормализованный machine-код причины. */
  reasonCode: string
  /** Понятное оператору следующее действие. */
  operatorAction: string
}

interface ErrorRule {
  cls: CollectorErrorClass
  pattern: RegExp
}

// Порядок важен: более специфичные и «жёсткие» классы проверяются раньше.
// Разделитель слов `[\s_-]?` покрывает и пробелы ("rate limit"), и snake/kebab
// ("capability_proof", "bad-gateway").
const ERROR_RULES: ErrorRule[] = [
  { cls: "BUDGET", pattern: /budget|max[\s_-]?total[\s_-]?charge|charge.*exceed|spend.*exceed|quota[\s_-]?budget|budget[\s_-]?exhaust|insufficient[\s_-]?funds|payment[\s_-]?required|402/i },
  { cls: "AUTH", pattern: /unauthor|forbidden|invalid[\s_-]?(token|grant|credential)|token.*(expir|invalid|revok|missing)|(expir|revok).*token|oauth|reconnect|401|403|access[\s_-]?denied|permission[\s_-]?denied/i },
  { cls: "RATE_LIMIT", pattern: /rate[\s_-]?limit|ratelimit|429|too[\s_-]?many[\s_-]?requests|quota.*(exceed|reach)|quota[\s_-]?exceeded|throttl/i },
  { cls: "POLICY", pattern: /policy|capability[\s_-]?proof|capability[\s_-]?(invalid|missing)|not[\s_-]?allowed|blocked[\s_-]?by[\s_-]?policy|tos\b|terms[\s_-]?of[\s_-]?service|no[\s_-]?adapter|manual[\s_-]?task|not[\s_-]?permitted|research[\s_-]?only/i },
  { cls: "PERMANENT", pattern: /schema[\s_-]?drift|not[\s_-]?found|404|410|gone|deleted|malformed|invalid[\s_-]?response|parse[\s_-]?error|unexpected[\s_-]?(token|response)|unsupported|no[\s_-]?such|does[\s_-]?not[\s_-]?exist/i },
  // dead_page/proxy — сбои fetch-слоя Bright Data. ВАЖНО: dead_page у facebook —
  // доказанный false negative (2026-07-21: все 7 «мёртвых» страниц живы и
  // слинкованы с сайтов самих медиа; FB login-wall неотличим для скрейпера от
  // несуществующей страницы). Карантин живой страницы = тихий пропуск новостей,
  // поэтому оба кода retryable: circuit с экспоненциальным backoff ограничивает
  // платные повторы (~центы), а actionable lastError держит сбой видимым.
  { cls: "TRANSIENT", pattern: /timeout|timed[\s_-]?out|econnreset|etimedout|econnrefused|enotfound|socket[\s_-]?hang|network|fetch[\s_-]?failed|temporar|transient|provider[\s_-]?(?:outage|blocked)|request[\s_-]?blocked|circuit[\s_-]?open|service[\s_-]?unavailable|bad[\s_-]?gateway|gateway[\s_-]?timeout|50[0234]|proxy|dead[\s_-]?page/i },
]

const CLASS_DEFAULTS: Record<CollectorErrorClass, Omit<CollectorErrorClassification, "reasonCode">> = {
  TRANSIENT: {
    class: "TRANSIENT",
    retryable: true,
    quarantine: false,
    cooldownSeconds: 120,
    operatorAction: "Временный upstream-сбой — повтор с backoff; вмешательство не нужно, пока не станет устойчивым.",
  },
  RATE_LIMIT: {
    class: "RATE_LIMIT",
    retryable: true,
    quarantine: false,
    cooldownSeconds: 900,
    operatorAction: "Достигнут rate/quota limit — замедлить cadence или дождаться сброса квоты.",
  },
  AUTH: {
    class: "AUTH",
    retryable: false,
    quarantine: true,
    cooldownSeconds: 3600,
    operatorAction: "Ошибка авторизации — переподключить аккаунт / обновить токен, затем пересобрать маршрут.",
  },
  POLICY: {
    class: "POLICY",
    retryable: false,
    quarantine: true,
    cooldownSeconds: 3600,
    operatorAction: "Заблокировано policy/capability — зафиксировать verified capability proof или изменить политику источника.",
  },
  BUDGET: {
    class: "BUDGET",
    retryable: false,
    quarantine: false,
    cooldownSeconds: 3600,
    operatorAction: "Проверить внутренний лимит tenant и баланс/тариф внешнего провайдера; после пополнения повторить запуск.",
  },
  PERMANENT: {
    class: "PERMANENT",
    retryable: false,
    quarantine: true,
    cooldownSeconds: 21600,
    operatorAction: "Невосстановимый payload/schema — quarantine и ручной разбор (dead-letter).",
  },
  UNKNOWN: {
    class: "UNKNOWN",
    retryable: true,
    quarantine: false,
    cooldownSeconds: 300,
    operatorAction: "Неклассифицированная ошибка — проверить логи run-а перед повтором.",
  },
}

function classFromHttpStatus(status: number): CollectorErrorClass | null {
  if (status === 401 || status === 403) return "AUTH"
  if (status === 402) return "BUDGET"
  if (status === 429) return "RATE_LIMIT"
  if (status === 404 || status === 410) return "PERMANENT"
  if (status >= 500) return "TRANSIENT"
  if (status >= 400) return "POLICY"
  return null
}

export function classifyCollectorError(
  rawError: string | null | undefined,
  opts: { httpStatus?: number | null } = {},
): CollectorErrorClassification {
  const raw = typeof rawError === "string" ? rawError.trim() : ""
  const reasonCode = raw ? raw.slice(0, 120) : opts.httpStatus ? `http_${opts.httpStatus}` : "unknown"

  // HTTP-статус имеет приоритет над свободным текстом, если он однозначен.
  if (typeof opts.httpStatus === "number" && Number.isFinite(opts.httpStatus)) {
    const httpClass = classFromHttpStatus(opts.httpStatus)
    if (httpClass) return { ...CLASS_DEFAULTS[httpClass], reasonCode }
  }

  if (raw) {
    for (const rule of ERROR_RULES) {
      if (rule.pattern.test(raw)) return { ...CLASS_DEFAULTS[rule.cls], reasonCode }
    }
  }

  return { ...CLASS_DEFAULTS.UNKNOWN, reasonCode }
}

/** Детерминированный jitter [0,1) из идентификатора маршрута — де-коррелирует разные маршруты без RNG. */
export function deterministicJitterFraction(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

const MAX_COOLDOWN_SECONDS = 21600 // 6 часов

/**
 * Экспоненциальный backoff с детерминированным ±25% jitter.
 * attempt=1 для первого открытия circuit после порога.
 */
export function computeCircuitCooldownSeconds(
  baseSeconds: number,
  attempt: number,
  jitterFraction: number,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt))
  const grown = Math.min(MAX_COOLDOWN_SECONDS, baseSeconds * 2 ** (safeAttempt - 1))
  const clampedJitter = Math.min(0.999, Math.max(0, jitterFraction))
  const multiplier = 0.75 + 0.5 * clampedJitter // [0.75, 1.25)
  return Math.max(1, Math.round(grown * multiplier))
}

// Config-class failures: no provider was actually hit (budget gate closed,
// route plans missing/blocked, live-routing flag off, discovery input absent).
// Retrying is free of spend AND the retry itself is the repair path — the
// collector recompiles route plans and re-checks budget gates on every run.
const INFRA_CONFIG_ERROR_PATTERN = new RegExp(
  "^(paid_route_(budget_unconfigured|daily_budget_exhausted|monthly_budget_exhausted|run_quota_exhausted|budget_cap_too_low)"
  + "|source_routes_partial_or_pending|source_route_plan_blocked"
  + "|bright_data_(live_routing_disabled|token_missing|price_unconfigured|discovery_input_missing)"
  + "|manual_collection_required|collector_not_configured)",
)

export function isInfraConfigError(error: string | null | undefined): boolean {
  return typeof error === "string" && INFRA_CONFIG_ERROR_PATTERN.test(error.trim())
}
