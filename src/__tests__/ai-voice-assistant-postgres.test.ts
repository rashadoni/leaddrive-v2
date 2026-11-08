/**
 * Голосовой помощник, проигранный БЕЗ голоса: те же разговоры, те же запросы,
 * настоящая база.
 *
 * Зачем это есть. 2026-11-05 владелец попросил добавить цену к сделке — сделка
 * не создалась; следом не создался и лид, «какой-то процесс занят». Все
 * юнит-тесты при этом были зелёными, потому что у них замокан Prisma, а дело
 * было не в одном запросе, а в ПОСЛЕДОВАТЕЛЬНОСТИ: черновик оставался жить в
 * сессии и отказывал всему следующему. Такое видно только там, где состояние
 * действительно сохраняется между запросами.
 *
 * Поэтому здесь по-настоящему всё, кроме микрофона: настоящие роуты
 * (`/actions/draft`, `/confirmation`, `/commit`, `/cancel`, `/actions/active`,
 * `/session/end`, крон-уборщик), настоящие CRM-команды, настоящий Postgres,
 * собранный из настоящей схемы. Голос заменён тем, чем он и является для
 * сервера, — цепочкой HTTP-запросов, которую шлёт вкладка пользователя.
 *
 * Что проверяется — весь срок жизни черновика, то есть ровно тот класс
 * проблем, из которого выросли обе поломки:
 *
 *   - поправка ДОПОЛНЯЕТ квитанцию: «добавь цену» не теряет названного раньше
 *     и не создаёт вторую квитанцию, а подтверждение записывает один раз оба
 *     поля;
 *   - другая задача ЗАМЕНЯЕТ квитанцию, а не упирается в неё;
 *   - крестик закрывает черновик в базе, а не только на экране;
 *   - конец разговора и уборщик брошенных сессий закрывают незавершённое;
 *   - брошенное исполнение (упал процесс между заявкой и записью) больше не
 *     запирает разговор навсегда — и в CRM от него не остаётся ничего;
 *   - живое исполнение по-прежнему неприкосновенно: ни поправкой, ни крестиком,
 *     ни концом разговора.
 *
 * Чего этот стенд не доказывает: `db push` строит таблицы без политик RLS и
 * без триггеров, поэтому здесь проверяется поведение кода, а не изоляция
 * тенанта (у неё свои проверки: scripts/rls/find-context-gaps.py и
 * `[RLS-GUARD]`). Env-allowlist голосового гейта и расходы на минуты тоже не
 * здесь — у них свои тесты.
 *
 * Запуск: AI_VOICE_ASSISTANT_TEST_DATABASE_URL — админское подключение, напр.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55611:5432 postgres:16
 *   AI_VOICE_ASSISTANT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55611/postgres
 * Без переменной набор пропускается. CI гоняет его в `static-checks` и ещё раз
 * в деплое («AI voice assistant database gate»), где
 * AI_VOICE_ASSISTANT_DB_GATE=required превращает отсутствие URL в падение,
 * чтобы гейт не позеленел молча.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.AI_VOICE_ASSISTANT_TEST_DATABASE_URL
if (!adminUrl && process.env.AI_VOICE_ASSISTANT_DB_GATE === "required") {
  throw new Error("AI_VOICE_ASSISTANT_TEST_DATABASE_URL is required by the AI voice assistant database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.AI_VOICE_ASSISTANT_TEST_DATABASE_URL
  if (!admin) return null
  const name = `ai_voice_assistant_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** Выключенные на время одного теста модули. */
const modulesOff = vi.hoisted(() => new Set<string>())

const ORG = "org-voice-lifecycle"
const USER = "user-voice-lifecycle"

const auth = vi.hoisted(() => ({
  orgId: "org-voice-lifecycle",
  userId: "user-voice-lifecycle",
  // Литерал, а не string: `AuthResult.role` — это Role, и команды исполнения
  // принимают личность целиком.
  role: "admin" as const,
  email: "owner@example.com",
  name: "Owner",
  // Человек за браузером, как его помечает requireSessionAuth: голосовой
  // путь принципиально session-only, интеграционному ключу он недоступен.
  principalType: "session" as const,
}))

// Личность берётся из сессии вкладки — именно это и проверяют другие тесты
// (api-ai-voice-*). Здесь под проверкой срок жизни черновика, поэтому вход
// отдаётся готовым, а остальное api-auth остаётся настоящим.
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(),
  // Личность читается заново на каждом запросе, как её читает настоящая
  // обёртка: в сценарии про чужую квитанцию за тем же сервером оказывается
  // другой сотрудник той же организации.
  requireSessionAuth: vi.fn(async () => ({ ...auth })),
  requireAuth: vi.fn(async () => ({ ...auth })),
  getSession: vi.fn(async () => ({ ...auth })),
  getOrgId: vi.fn(async () => ORG),
  // Все модули тенанта включены, кроме названных в `modulesOff`. Иначе
  // инструмент чтения отвечает `MODULE_NOT_ENABLED` и до своего читателя не
  // доходит вовсе — а он и есть предмет проверки. На первом наборе так молча
  // не проверились шесть инструментов из двадцати трёх: счета, тикеты, сводка
  // дня, маркетинг, входящие и поле. Отказ по невыкупленному модулю проверяет
  // отдельный тест ниже.
  getOrgModuleContext: vi.fn(async () => {
    // Список не переписывается руками: он собирается из реестра модулей и из
    // самого меню (модуль, фича и аддон каждого пункта). Иначе новый модуль
    // пришлось бы вспомнить здесь, а забытый выглядел бы как «инструмент не
    // отвечает».
    const { MODULE_REGISTRY } = await import("@/lib/modules")
    const { navItems } = await import("@/lib/nav-items")
    const ids = new Set<string>(Object.keys(MODULE_REGISTRY))
    for (const item of navItems) {
      if (item.module) ids.add(item.module)
      if (item.feature) ids.add(item.feature)
      if (item.addon) ids.add(item.addon)
    }
    return {
      plan: "enterprise",
      addons: [] as string[],
      modules: Object.fromEntries(
        [...ids].map((id) => [id, !modulesOff.has(id)]),
      ) as Record<string, boolean>,
    }
  }),
}))

// Пилотный allowlist голоса живёт в env и проверяется в lib-ai-voice-gate:
// здесь он не предмет проверки, иначе каждый тест пришлось бы начинать с
// расстановки переменных окружения.
vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true })),
  checkVoiceWriteAccess: vi.fn(async () => ({ ok: true })),
}))

// Лимит на черновики — 20 в минуту на пользователя; один прогон этого набора
// делает их больше, а предмет проверки не он.
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: vi.fn(() => true),
}))

// Наружу ничего не уходит: что команда ХОТЕЛА отправить, проверяют её
// собственные тесты.
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => {}) }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * Схема в том виде, в каком `db push` соберёт её на любом Postgres. Две
 * таблицы базы знаний несут колонку pgvector, а служба БД в деплое — обычный
 * `postgres:16` без этого расширения. Здесь эти колонки не читаются.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "ai-voice-assistant-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  })
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" })
}

type Receipt = {
  id: string
  revision: number
  payloadHash: string
  state: string
  supersededIntentId?: string
  unchangedFields?: string[]
  warnings?: unknown
  preview: { fields?: { key: string; after: unknown }[] }
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("the voice assistant without a microphone, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let draftRoute!: typeof import("@/app/api/v1/ai/voice/actions/draft/route")
  let proposeRoute!: typeof import("@/app/api/v1/ai/voice/actions/propose/route")
  let activeRoute!: typeof import("@/app/api/v1/ai/voice/actions/active/route")
  let confirmRoute!: typeof import("@/app/api/v1/ai/voice/actions/[id]/confirmation/route")
  let commitRoute!: typeof import("@/app/api/v1/ai/voice/actions/[id]/commit/route")
  let cancelRoute!: typeof import("@/app/api/v1/ai/voice/actions/[id]/cancel/route")
  let editRoute!: typeof import("@/app/api/v1/ai/voice/actions/[id]/route")
  let endRoute!: typeof import("@/app/api/v1/ai/voice/session/end/route")
  let reaperRoute!: typeof import("@/app/api/cron/voice-session-reaper/route")
  let claimExecution!: typeof import("@/lib/ai/voice/action-execution-claim").claimAiVoiceActionExecution
  let readRoute!: typeof import("@/app/api/v1/ai/voice/read/route")
  let gateModule!: typeof import("@/lib/ai/voice/voice-confirmation")

  let session = ""
  let keySeq = 0

  function key(label: string): string {
    keySeq += 1
    return `draft.${label}.${keySeq}`
  }

  /** Одна фраза пользователя, превращённая моделью в черновик. */
  async function speak(
    actionType: string,
    payload: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ): Promise<{ status: number; body: { data?: Receipt; code?: string } }> {
    const response = await draftRoute.POST(post("/api/v1/ai/voice/actions/draft", {
      voiceSessionId: session,
      actionType,
      payload,
      idempotencyKey: key(actionType),
      ...over,
    }))
    return { status: response.status, body: await response.json() }
  }

  /**
   * Одна фраза пользователя так, как она на самом деле доезжает до сервера:
   * модель называет ИМЕНА, идентификаторы сервер находит сам.
   */
  async function propose(
    tool: string,
    args: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ): Promise<{
    status: number
    body: {
      data?: Receipt
      needsClarification?: boolean
      code?: string
      field?: string
      candidates?: string[]
    }
  }> {
    const response = await proposeRoute.POST(post("/api/v1/ai/voice/actions/propose", {
      voiceSessionId: session,
      tool,
      args,
      ...over,
    }))
    return { status: response.status, body: await response.json() }
  }

  /** Вопрос вслух: инструмент чтения, как его зовёт вкладка пользователя. */
  async function ask(
    tool: string,
    filter: Record<string, unknown> = {},
  ): Promise<{ status: number; body: unknown }> {
    const response = await readRoute.POST(post("/api/v1/ai/voice/read", {
      voiceSessionId: session,
      tool,
      filter,
    }))
    return { status: response.status, body: await response.json() }
  }

  async function activeReceipt(): Promise<Receipt | null> {
    const response = await activeRoute.GET(
      get(`/api/v1/ai/voice/actions/active?voiceSessionId=${session}`),
    )
    const body = await response.json() as { data: Receipt | null }
    return body.data
  }

  /**
   * Нажатие «Создать» на квитанции: сначала одноразовое доказательство, затем
   * запись. Возвращается ещё и ШАГ, на котором всё закончилось: отказать
   * может любой из двух, и для разговора это разные истории.
   */
  async function pressCreate(receipt: Receipt): Promise<{
    step: "proof" | "commit"
    status: number
    body: Record<string, unknown>
  }> {
    const proofResponse = await confirmRoute.POST(
      post(`/api/v1/ai/voice/actions/${receipt.id}/confirmation`, {
        expectedRevision: receipt.revision,
        payloadHash: receipt.payloadHash,
        confirmed: true,
      }),
      { params: Promise.resolve({ id: receipt.id }) },
    )
    const proof = (await proofResponse.json()) as {
      data: { confirmationEventId: string; confirmationToken: string }
    } & Record<string, unknown>
    if (proofResponse.status !== 201) {
      return { step: "proof", status: proofResponse.status, body: proof }
    }

    const response = await commitRoute.POST(
      post(`/api/v1/ai/voice/actions/${receipt.id}/commit`, {
        confirmationEventId: proof.data.confirmationEventId,
        confirmationToken: proof.data.confirmationToken,
        expectedRevision: receipt.revision,
        payloadHash: receipt.payloadHash,
      }),
      { params: Promise.resolve({ id: receipt.id }) },
    )
    return { step: "commit", status: response.status, body: await response.json() }
  }

  /**
   * Правка поля руками в квитанции: «Изменить» → поле → «Сохранить».
   * Эндпоинт не сливает, а ЗАМЕНЯЕТ, поэтому форма присылает всю полезную
   * нагрузку целиком — как и настоящая форма (buildEditedReceiptPayload).
   */
  async function typeIntoReceipt(
    receipt: Receipt,
    fields: Record<string, unknown>,
  ): Promise<{ status: number; body: { data?: Receipt; code?: string } }> {
    const whole: Record<string, unknown> = {}
    for (const field of receipt.preview.fields ?? []) {
      if (field.key === "expectedUpdatedAt") continue
      if (field.after !== null && field.after !== undefined) whole[field.key] = field.after
    }
    const response = await editRoute.PATCH(
      new NextRequest(`http://localhost:3000/api/v1/ai/voice/actions/${receipt.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          expectedRevision: receipt.revision,
          payload: { ...whole, ...fields },
        }),
      }),
      { params: Promise.resolve({ id: receipt.id }) },
    )
    return { status: response.status, body: await response.json() }
  }

  /** Нажатие ✕ на квитанции. */
  async function pressClose(receipt: Receipt): Promise<{ status: number; body: { code?: string; data?: Receipt } }> {
    const response = await cancelRoute.POST(
      post(`/api/v1/ai/voice/actions/${receipt.id}/cancel`, {
        expectedRevision: receipt.revision,
      }),
      { params: Promise.resolve({ id: receipt.id }) },
    )
    return { status: response.status, body: await response.json() }
  }

  function previewField(receipt: Receipt, field: string): unknown {
    return receipt.preview.fields?.find((candidate) => candidate.key === field)?.after
  }

  async function storedIntent(id: string) {
    return bypass(() => prisma.aiActionIntent.findFirstOrThrow({ where: { id } }))
  }

  async function lifecycleEvents(id: string): Promise<{ eventType: string; eventData: unknown }[]> {
    return bypass(() => prisma.aiActionIntentEvent.findMany({
      where: { intentId: id },
      orderBy: { createdAt: "asc" },
      select: { eventType: true, eventData: true },
    }))
  }

  /** Новый разговор: ровно то, что делает вкладка, нажимая «микрофон». */
  async function startConversation(over: Record<string, unknown> = {}): Promise<string> {
    const created = await bypass(() => prisma.voiceSession.create({
      data: {
        organizationId: ORG,
        userId: USER,
        status: "active",
        reservedSeconds: 600,
        expiresAt: new Date(Date.now() + 600_000),
        elevenlabsConversationId: "gemini:connected:test",
        ...over,
      },
    }))
    return created.id
  }

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )

    prisma = (await import("@/lib/prisma")).prisma
    const rls = await import("@/lib/rls-context")
    bypass = rls.runWithRlsBypass
    tenant = rls.runWithTenant
    draftRoute = await import("@/app/api/v1/ai/voice/actions/draft/route")
    proposeRoute = await import("@/app/api/v1/ai/voice/actions/propose/route")
    activeRoute = await import("@/app/api/v1/ai/voice/actions/active/route")
    confirmRoute = await import("@/app/api/v1/ai/voice/actions/[id]/confirmation/route")
    commitRoute = await import("@/app/api/v1/ai/voice/actions/[id]/commit/route")
    cancelRoute = await import("@/app/api/v1/ai/voice/actions/[id]/cancel/route")
    editRoute = await import("@/app/api/v1/ai/voice/actions/[id]/route")
    endRoute = await import("@/app/api/v1/ai/voice/session/end/route")
    reaperRoute = await import("@/app/api/cron/voice-session-reaper/route")
    claimExecution = (await import("@/lib/ai/voice/action-execution-claim")).claimAiVoiceActionExecution
    readRoute = await import("@/app/api/v1/ai/voice/read/route")
    gateModule = await import("@/lib/ai/voice/voice-confirmation")

    await bypass(async () => {
      await prisma.organization.create({
        data: { id: ORG, name: "Azmart", slug: "voice-lifecycle", plan: "enterprise" },
      })
      await prisma.user.create({
        data: {
          id: USER,
          organizationId: ORG,
          email: "owner@example.com",
          name: "Owner",
          role: "admin",
          isActive: true,
          // Вход подменён моком: пароль здесь — только обязательная колонка.
          passwordHash: "not-a-login-path",
        },
      })
      await prisma.user.create({
        data: {
          id: "user-colleague",
          organizationId: ORG,
          email: "leyla@example.com",
          name: "Leyla Mämmädova",
          role: "manager",
          isActive: true,
          passwordHash: "not-a-login-path",
        },
      })
      await prisma.user.create({
        data: {
          id: "user-seller",
          organizationId: ORG,
          email: "rashad.seller@example.com",
          name: "Rəşad Quliyev",
          role: "sales",
          isActive: true,
          passwordHash: "not-a-login-path",
        },
      })
      await prisma.company.create({
        data: { id: "company-1", organizationId: ORG, name: "Azmart MMC" },
      })
      // Настоящая воронка организации: названия стадий свои, `isWon`/`isLost`
      // берутся из строки, а не угадываются по слову.
      await prisma.pipeline.create({
        data: { id: "pipeline-1", organizationId: ORG, name: "Основная", isDefault: true, isActive: true },
      })
      await prisma.pipelineStage.createMany({
        data: [
          { organizationId: ORG, pipelineId: "pipeline-1", name: "LEAD", displayName: "Новый", sortOrder: 1, probability: 10 },
          { organizationId: ORG, pipelineId: "pipeline-1", name: "NEGOTIATION", displayName: "Переговоры", sortOrder: 2, probability: 50 },
          { organizationId: ORG, pipelineId: "pipeline-1", name: "WON", displayName: "Qazanıldı", sortOrder: 3, probability: 100, isWon: true },
          { organizationId: ORG, pipelineId: "pipeline-1", name: "LOST", displayName: "Uduzdu", sortOrder: 4, probability: 0, isLost: true },
        ],
      })
    })
  }, 600_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    session = await startConversation()
  })

  /**
   * Та самая поломка 2026-11-05. «Создай сделку Azmart» — «добавь цену 5000».
   * Вторая фраза приходит одним полем, а создание сделки требует названия:
   * раньше она падала на проверке полезной нагрузки, и человек слышал, что
   * сделку создать не удалось.
   */
  it("«создай сделку» → «добавь цену»: та же квитанция, оба поля, одна запись в CRM", async () => {
    const first = await speak("create_deal", { name: "Azmart", companyId: "company-1" })
    expect(first.status).toBe(201)
    const draft = first.body.data!

    const amended = await speak("create_deal", { valueAmount: 5000, currency: "AZN" })
    expect(amended.status).toBe(201)
    const corrected = amended.body.data!

    // Та же квитанция: тот же идентификатор, выросла ревизия.
    expect(corrected.id).toBe(draft.id)
    expect(corrected.revision).toBe(2)
    // Названное раньше не потеряно, новое добавлено.
    expect(previewField(corrected, "name")).toBe("Azmart")
    expect(previewField(corrected, "valueAmount")).toBe(5000)
    // И на экране по-прежнему одна квитанция — она же.
    const onScreen = await activeReceipt()
    expect(onScreen?.id).toBe(draft.id)
    expect(onScreen?.revision).toBe(2)

    const committed = await pressCreate(corrected)
    expect(committed.status).toBe(200)

    const deals = await bypass(() => prisma.deal.findMany({ where: { organizationId: ORG } }))
    expect(deals).toHaveLength(1)
    expect(deals[0].name).toBe("Azmart")
    expect(Number(deals[0].valueAmount)).toBe(5000)
    expect(deals[0].currency).toBe("AZN")
    // Квитанция закрыта, экран чист.
    expect((await storedIntent(draft.id)).state).toBe("succeeded")
    expect(await activeReceipt()).toBeNull()
    expect((await lifecycleEvents(draft.id)).map((event) => event.eventType))
      .toEqual([
        "drafted",
        "draft_updated",
        "confirmation_proof_issued",
        "confirmation_consumed",
        "execution_claimed",
        "succeeded",
      ])
  })

  /** Поправка к той же задаче — дополнение; другая задача — замена. */
  it("«а теперь создай лида» заменяет открытую квитанцию, а не упирается в неё", async () => {
    const deal = (await speak("create_deal", { name: "Azmart", companyId: "company-1" })).body.data!

    const lead = await speak("create_lead", { contactName: "Əli", phone: "+994501234567" })
    expect(lead.status).toBe(201)
    expect(lead.body.data!.id).not.toBe(deal.id)
    expect(lead.body.data!.supersededIntentId).toBe(deal.id)

    // Прежняя задача закончилась отменой, и в журнале видно, чем заменена.
    expect((await storedIntent(deal.id)).state).toBe("cancelled")
    expect(await lifecycleEvents(deal.id)).toEqual([
      { eventType: "drafted", eventData: expect.objectContaining({ actionType: "create_deal" }) },
      { eventType: "cancelled", eventData: expect.objectContaining({ reason: "superseded_by_draft" }) },
    ])
    expect((await activeReceipt())?.id).toBe(lead.body.data!.id)
  })

  /** «Не всякая задача должна выполняться» (владелец, 2026-11-05). */
  it("крестик закрывает черновик в базе, и следующая просьба проходит", async () => {
    const draft = (await speak("create_task", { title: "Позвонить Əli" })).body.data!

    const closed = await pressClose(draft)
    expect(closed.status).toBe(200)
    expect((await storedIntent(draft.id)).state).toBe("cancelled")
    expect(await activeReceipt()).toBeNull()
    expect(await bypass(() => prisma.task.count({ where: { organizationId: ORG } }))).toBe(0)

    const next = await speak("create_lead", { contactName: "Nəriman" })
    expect(next.status).toBe(201)
  })

  it("конец разговора закрывает незавершённую квитанцию", async () => {
    const draft = (await speak("create_task", { title: "Забытая задача" })).body.data!

    const ended = await endRoute.POST(post("/api/v1/ai/voice/session/end", {
      voiceSessionId: session,
      elapsedSeconds: 12,
    }))
    expect(ended.status).toBe(200)

    expect((await storedIntent(draft.id)).state).toBe("cancelled")
    expect(await lifecycleEvents(draft.id)).toEqual([
      { eventType: "drafted", eventData: expect.anything() },
      { eventType: "cancelled", eventData: expect.objectContaining({ reason: "session_ended" }) },
    ])
    expect(await bypass(() => prisma.task.count({ where: { organizationId: ORG } }))).toBe(0)
  })

  it("брошенный разговор: уборщик закрывает и сессию, и её черновик", async () => {
    const draft = (await speak("create_task", { title: "Закрыли вкладку" })).body.data!
    // Вкладку закрыли: биения сердца прекратились.
    await bypass(() => prisma.voiceSession.update({
      where: { id: session },
      data: { lastHeartbeatAt: new Date(Date.now() - 3_600_000) },
    }))

    process.env.CRON_SECRET = "voice-lifecycle-cron-secret"
    const response = await reaperRoute.POST(new NextRequest(
      "http://localhost:3000/api/cron/voice-session-reaper",
      { method: "POST", headers: { "x-cron-secret": "voice-lifecycle-cron-secret" } },
    ))
    expect(response.status).toBe(200)

    expect((await storedIntent(draft.id)).state).toBe("cancelled")
    expect(await lifecycleEvents(draft.id)).toEqual([
      { eventType: "drafted", eventData: expect.anything() },
      { eventType: "cancelled", eventData: expect.objectContaining({ reason: "session_abandoned" }) },
    ])
  })

  /**
   * Последнее место того же класса: исполнение, начатое и брошенное.
   *
   * Так выглядит падение процесса (деплой, обрыв сети, закрытая вкладка) между
   * заявкой на исполнение и записью в CRM. Запись при этом не появляется —
   * мутация и результат лежат в одной транзакции, — а строка остаётся
   * `executing`. До правки её не закрывал никто: ни срок жизни черновика, ни
   * крестик, ни конец разговора, ни крон. Через минуту, когда истекала лиза,
   * каждая следующая просьба получала «предыдущее действие выполняется прямо
   * сейчас» — и это было уже неправдой до конца разговора.
   */
  async function abandonAnExecution(): Promise<Receipt> {
    const receipt = (await speak("create_deal", { name: "Брошенная сделка" })).body.data!
    const proofResponse = await confirmRoute.POST(
      post(`/api/v1/ai/voice/actions/${receipt.id}/confirmation`, {
        expectedRevision: receipt.revision,
        payloadHash: receipt.payloadHash,
        confirmed: true,
      }),
      { params: Promise.resolve({ id: receipt.id }) },
    )
    const proof = (await proofResponse.json()) as {
      data: { confirmationEventId: string; confirmationToken: string }
    }
    // Заявка на исполнение состоялась — и на этом процесс умер: записи в CRM
    // не будет, строка останется `executing`.
    await tenant(ORG, () => claimExecution(auth, {
      intentId: receipt.id,
      expectedRevision: receipt.revision,
      payloadHash: receipt.payloadHash,
      confirmationEventId: proof.data.confirmationEventId,
      confirmationToken: proof.data.confirmationToken,
    }))
    expect((await storedIntent(receipt.id)).state).toBe("executing")
    return receipt
  }

  /** Сколько сделок оставило после себя брошенное исполнение. Должно быть 0. */
  async function abandonedDeals(): Promise<number> {
    return bypass(() => prisma.deal.count({
      where: { organizationId: ORG, name: "Брошенная сделка" },
    }))
  }

  it("брошенное исполнение не запирает разговор: оно закрывается, и в CRM от него ничего нет", async () => {
    const abandoned = await abandonAnExecution()
    // Прошла минута — срок лизы истёк, исполнять некому.
    await bypass(() => prisma.aiActionIntent.update({
      where: { id: abandoned.id },
      data: { executionLeaseExpiresAt: new Date(Date.now() - 1_000) },
    }))

    const next = await speak("create_lead", { contactName: "Следующая просьба" })
    expect(next.status).toBe(201)

    const settled = await storedIntent(abandoned.id)
    expect(settled.state).toBe("failed")
    expect(settled.errorCode).toBe("EXECUTION_ABANDONED")
    // Главное: сделки нет. Не «неизвестно, создалась ли» — нет.
    expect(await abandonedDeals()).toBe(0)
    expect((await lifecycleEvents(abandoned.id)).at(-1)).toEqual({
      eventType: "failed",
      eventData: expect.objectContaining({ reason: "execution_lease_expired" }),
    })
    // На экране его тоже нет — висит новая квитанция, а не старая.
    expect((await activeReceipt())?.id).toBe(next.body.data!.id)
  })

  it("крестик закрывает брошенное исполнение, и конец разговора тоже", async () => {
    const abandoned = await abandonAnExecution()
    await bypass(() => prisma.aiActionIntent.update({
      where: { id: abandoned.id },
      data: { executionLeaseExpiresAt: new Date(Date.now() - 1_000) },
    }))

    const closed = await pressClose(abandoned)
    expect(closed.status).toBe(200)
    expect((await storedIntent(abandoned.id)).state).toBe("failed")

    // И то же самое — концом разговора, в другом разговоре.
    session = await startConversation()
    const second = await abandonAnExecution()
    await bypass(() => prisma.aiActionIntent.update({
      where: { id: second.id },
      data: { executionLeaseExpiresAt: new Date(Date.now() - 1_000) },
    }))
    const ended = await endRoute.POST(post("/api/v1/ai/voice/session/end", {
      voiceSessionId: session,
      elapsedSeconds: 30,
    }))
    expect(ended.status).toBe(200)
    expect((await storedIntent(second.id)).state).toBe("failed")
    expect(await abandonedDeals()).toBe(0)
  })

  /**
   * Обратная сторона: пока исполнение действительно идёт, его не трогает
   * ничто. Вторая запись в CRM — это не поправка, а дубль.
   */
  it("живое исполнение неприкосновенно: ни поправкой, ни крестиком, ни концом разговора", async () => {
    const live = await abandonAnExecution()

    const refused = await speak("create_lead", { contactName: "Пока рано" })
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe("ACTIVE_EXECUTION_IN_PROGRESS")

    const close = await pressClose(live)
    expect(close.status).toBe(409)
    expect(close.body.code).toBe("INTENT_NOT_CANCELLABLE")

    await endRoute.POST(post("/api/v1/ai/voice/session/end", {
      voiceSessionId: session,
      elapsedSeconds: 5,
    }))
    expect((await storedIntent(live.id)).state).toBe("executing")
  })

  /**
   * Разговор целиком, а не один запрос: сделка рождается из слов, правится,
   * дважды меняет стадию и упирается в стадию, которой у организации нет.
   *
   * Три подтверждения подряд по одной записи — проверка того, чего не видно в
   * одном шаге: оптимистичная блокировка должна перепривязываться к НОВОЙ
   * версии записи на каждом новом черновике, иначе второе движение по стадиям
   * упало бы как «запись изменилась».
   */
  describe("сценарий: сделка от первого звонка до победы", () => {
    const DEAL = "Поставка Azmart"

    async function thatDeal() {
      return bypass(() => prisma.deal.findFirstOrThrow({
        where: { organizationId: ORG, name: DEAL },
      }))
    }

    it("имя компании словами, поправка цены, две стадии и отказ от выдуманной", async () => {
      // «Создай сделку „Поставка Azmart" для Azmart MMC».
      const opened = await propose("propose_create_deal", {
        name: DEAL,
        companyName: "Azmart MMC",
      })
      expect(opened.status).toBe(201)
      // Идентификатор компании нашёл сервер: модель называла только имя.
      expect(previewField(opened.body.data!, "companyId")).toBe("company-1")

      // «И цена двенадцать тысяч манат» — про компанию во второй фразе ни слова.
      const priced = await propose("propose_create_deal", {
        name: DEAL,
        valueAmount: 12000,
        currency: "AZN",
      })
      expect(priced.body.data!.id).toBe(opened.body.data!.id)
      expect(priced.body.data!.revision).toBe(2)
      // Компания не потерялась — поправка дополняет, а не начинает заново.
      expect(previewField(priced.body.data!, "companyId")).toBe("company-1")

      expect((await pressCreate(priced.body.data!)).status).toBe(200)
      expect(await thatDeal()).toMatchObject({
        companyId: "company-1",
        currency: "AZN",
        pipelineId: "pipeline-1",
        // Входная стадия воронки ОРГАНИЗАЦИИ, а не слово "LEAD" из кода.
        stage: "LEAD",
      })
      expect(Number((await thatDeal()).valueAmount)).toBe(12000)

      // «Переведи в переговоры» — сказано по-русски, в базе стадия своя.
      const toNegotiation = await propose("propose_move_deal_stage", {
        dealName: DEAL,
        stage: "переговоры",
      })
      expect(toNegotiation.status).toBe(201)
      expect(previewField(toNegotiation.body.data!, "stage")).toBe("NEGOTIATION")
      expect((await pressCreate(toNegotiation.body.data!)).status).toBe(200)
      expect((await thatDeal()).stage).toBe("NEGOTIATION")

      // «Qazanıldı» — то же действие, другим языком, и это победа.
      const toWon = await propose("propose_move_deal_stage", {
        dealName: DEAL,
        stage: "qazanıldı",
      })
      expect((await pressCreate(toWon.body.data!)).status).toBe(200)
      expect((await thatDeal()).stage).toBe("WON")

      // «Переведи в доставку» — такой стадии в воронке нет. Ответ — вопрос со
      // списком настоящих стадий, а не выдуманная стадия.
      const nowhere = await propose("propose_move_deal_stage", {
        dealName: DEAL,
        stage: "доставка",
      })
      expect(nowhere.status).toBe(200)
      expect(nowhere.body.needsClarification).toBe(true)
      expect(nowhere.body.code).toBe("DEAL_STAGE_NOT_FOUND")
      expect(nowhere.body.candidates?.length).toBeGreaterThan(0)
      // Запись не тронута, второй сделки не появилось, квитанции на экране нет.
      expect((await thatDeal()).stage).toBe("WON")
      expect(await bypass(() => prisma.deal.count({ where: { organizationId: ORG, name: DEAL } }))).toBe(1)
      expect(await activeReceipt()).toBeNull()
    })
  })

  /**
   * Лид проходит свой путь целиком, и путь этот односторонний: превратить его
   * в сделку можно один раз.
   */
  describe("сценарий: лид до сделки", () => {
    it("создать с исполнителем по имени, квалифицировать, превратить — и второй раз нельзя", async () => {
      // «…и назначь Лейлу» — Лейла менеджер, владельцем ЛИДА она быть не
      // может (единственная команда с таким правилом). Разговор обязан
      // упереться в это ЗДЕСЬ, вопросом со списком продавцов, а не квитанцией,
      // которая умрёт на кнопке.
      const wrongOwner = await propose("propose_create_lead", {
        contactName: "Nəriman Əliyev",
        assigneeName: "Leyla",
      })
      expect(wrongOwner.status).toBe(200)
      expect(wrongOwner.body).toMatchObject({
        needsClarification: true,
        code: "ASSIGNEE_NOT_FOUND",
        field: "assigneeName",
      })
      expect(await activeReceipt()).toBeNull()

      const created = await propose("propose_create_lead", {
        contactName: "Nəriman Əliyev",
        companyName: "Nar Ticarət",
        phone: "+994551112233",
        // Продавца тоже называют по имени.
        assigneeName: "Rəşad",
      })
      expect(created.status).toBe(201)
      expect(previewField(created.body.data!, "assignedTo")).toBe("user-seller")
      expect((await pressCreate(created.body.data!)).status).toBe(200)

      const stored = await bypass(() => prisma.lead.findFirstOrThrow({
        where: { organizationId: ORG, contactName: "Nəriman Əliyev" },
      }))
      expect(stored.assignedTo).toBe("user-seller")
      expect(stored.status).toBe("new")

      // «Он квалифицирован, оценка восемь тысяч» — лид найден по имени.
      const qualified = await propose("propose_update_lead", {
        leadName: "Nəriman",
        status: "qualified",
        estimatedValue: 8000,
      })
      expect(qualified.status).toBe(201)
      expect((await pressCreate(qualified.body.data!)).status).toBe(200)
      expect((await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: stored.id } }))).status)
        .toBe("qualified")

      // «Сделай из него сделку».
      const converted = await propose("propose_convert_lead_to_deal", {
        leadName: "Nəriman",
        dealValue: 8000,
        createCompany: true,
      })
      expect(converted.status).toBe(201)
      expect((await pressCreate(converted.body.data!)).status).toBe(200)

      const afterConversion = await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: stored.id } }))
      expect(afterConversion.status).toBe("converted")
      const contact = await bypass(() => prisma.contact.findFirstOrThrow({
        where: { organizationId: ORG, fullName: "Nəriman Əliyev" },
      }))
      const deals = await bypass(() => prisma.deal.findMany({
        where: { organizationId: ORG, contactId: contact.id },
      }))
      expect(deals).toHaveLength(1)
      expect(Number(deals[0].valueAmount)).toBe(8000)

      // «Сделай из него сделку» ещё раз — уже нельзя, и второй сделки нет.
      const again = await propose("propose_convert_lead_to_deal", { leadName: "Nəriman" })
      expect(again.status).toBe(409)
      expect(again.body.code).toBe("TARGET_ALREADY_CONVERTED")
      expect(await bypass(() => prisma.deal.count({ where: { organizationId: ORG, contactId: contact.id } })))
        .toBe(1)
    })
  })

  /**
   * Пока квитанция висела на экране, запись изменил другой человек.
   *
   * Это главная причина, по которой у черновика есть версия записи: голос не
   * должен затирать чужую правку тем, что человек видел минуту назад. Отказ
   * здесь — правильный исход, а правильное продолжение — повторить фразу.
   */
  describe("сценарий: пока думали, запись изменили", () => {
    it("подтверждение отклонено, чужая правка цела, повтор проходит", async () => {
      const deal = await bypass(() => prisma.deal.create({
        data: {
          organizationId: ORG,
          name: "Склад Nar",
          stage: "LEAD",
          pipelineId: "pipeline-1",
          valueAmount: 100,
          currency: "AZN",
        },
      }))

      const receipt = (await propose("propose_update_deal", {
        dealName: "Склад Nar",
        valueAmount: 777,
      })).body.data!

      // Другой человек меняет ту же сделку из обычного интерфейса.
      await bypass(() => prisma.deal.update({
        where: { id: deal.id },
        data: { valueAmount: 999 },
      }))

      const refused = await pressCreate(receipt)
      // Отказ приходит РАНЬШЕ записи: одноразовое доказательство на устаревшую
      // квитанцию даже не выдаётся.
      expect(refused.step).toBe("proof")
      expect(refused.status).toBe(409)
      // Чужая цифра на месте: голос её не перетёр.
      expect(Number((await bypass(() => prisma.deal.findFirstOrThrow({ where: { id: deal.id } }))).valueAmount))
        .toBe(999)

      // Человек повторяет фразу — новый черновик видит новую версию записи.
      // Человек просто повторяет фразу. Новый черновик считается от ЖИВОЙ
      // версии записи — отказывать в повторе было бы тупиком с единственным
      // выходом через крестик.
      const retryResponse = await propose("propose_update_deal", {
        dealName: "Склад Nar",
        valueAmount: 777,
      })
      expect(retryResponse.status).toBe(201)
      const retry = retryResponse.body.data!
      // Квитанция другая — старую дополнять было нечем, она считалась от
      // версии, которой больше нет, и честно закрылась заменой.
      expect(retry.id).not.toBe(receipt.id)
      expect(retry.supersededIntentId).toBe(receipt.id)
      expect((await storedIntent(receipt.id)).state).toBe("cancelled")
      expect((await pressCreate(retry)).status).toBe(200)
      expect(Number((await bypass(() => prisma.deal.findFirstOrThrow({ where: { id: deal.id } }))).valueAmount))
        .toBe(777)
    })
  })

  /**
   * Утро менеджера: послушал сводку, нашёл запись, поправил её голосом,
   * услышал результат, начал задачу и передумал.
   *
   * Здесь важна именно смесь: чтения и записи в одном разговоре, экран как
   * контекст («привяжи к этой записи»), поправка, отказ от начатого и конец
   * разговора. По отдельности каждый шаг покрыт, вместе — нет.
   */
  describe("сценарий: рабочее утро менеджера", () => {
    it("сводка, поиск, правка, чтение результата, брошенная задача, конец", async () => {
      const lead = await bypass(() => prisma.lead.create({
        data: {
          organizationId: ORG,
          contactName: "Aysel Həsənova",
          companyName: "Aysel Tekstil",
          phone: "+994505550001",
          status: "new",
          source: "instagram",
        },
      }))

      // «Что у меня сегодня?»
      const briefing = await ask("get_daily_briefing")
      expect(briefing.status).toBe(200)

      // «Найди Айсель».
      const found = await ask("find_record", { type: "lead", query: "Aysel" })
      expect(found.status).toBe(200)
      expect(JSON.stringify(found.body)).toContain("Aysel Həsənova")

      // «Она квалифицирована» — и сразу поправка: «нет, оценка десять тысяч».
      const first = await propose("propose_update_lead", { leadName: "Aysel", status: "qualified" })
      expect(first.status).toBe(201)
      const amended = await propose("propose_update_lead", {
        leadName: "Aysel",
        estimatedValue: 10000,
      })
      expect(amended.body.data!.id).toBe(first.body.data!.id)
      expect(amended.body.data!.revision).toBe(2)
      expect((await pressCreate(amended.body.data!)).status).toBe(200)

      const updated = await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: lead.id } }))
      // Оба поля: сказанное первым не потерялось.
      expect(updated.status).toBe("qualified")
      expect(Number(updated.estimatedValue)).toBe(10000)

      // «Прочитай, что получилось» — тем же инструментом, которым читает агент.
      const readBack = await ask("read_record", { type: "lead", id: lead.id })
      expect(readBack.status).toBe(200)
      expect(JSON.stringify(readBack.body)).toContain("qualified")

      // «Поставь задачу позвонить ей» — привязка к записи, открытой на экране.
      const task = await propose("propose_create_task", {
        title: "Позвонить Айсель",
        relateToCurrentRecord: true,
      }, { screen: { recordType: "lead", recordId: lead.id } })
      expect(task.status).toBe(201)
      expect(previewField(task.body.data!, "relatedId")).toBe(lead.id)

      // «Нет, не надо» — задача не создаётся.
      expect((await pressClose(task.body.data!)).status).toBe(200)
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Позвонить Айсель" },
      }))).toBe(0)

      const ended = await endRoute.POST(post("/api/v1/ai/voice/session/end", {
        voiceSessionId: session,
        elapsedSeconds: 95,
      }))
      expect(ended.status).toBe(200)
      // Разговор закрыт, и из него ничего не висит.
      expect((await bypass(() => prisma.voiceSession.findFirstOrThrow({ where: { id: session } }))).status)
        .toBe("ended")
      expect(await bypass(() => prisma.aiActionIntent.count({
        where: { voiceSessionId: session, state: { in: ["collecting", "awaiting_confirmation"] } },
      }))).toBe(0)
    })
  })

  /**
   * Два человека с одним именем. Помощник обязан СПРОСИТЬ, а не выбрать —
   * выбранный наугад лид это чужая запись, изменённая чужими словами.
   */
  describe("сценарий: двое с одним именем", () => {
    it("спрашивает, какой из двух, и правит только названного", async () => {
      const first = await bypass(() => prisma.lead.create({
        data: { organizationId: ORG, contactName: "Elçin Qasımov", companyName: "Bakı Tikinti", status: "new" },
      }))
      const second = await bypass(() => prisma.lead.create({
        data: { organizationId: ORG, contactName: "Elçin Qasımov", companyName: "Gəncə Logistika", status: "new" },
      }))

      // «Отметь Эльчина связавшимся».
      const ambiguous = await propose("propose_update_lead", {
        leadName: "Elçin",
        status: "contacted",
      })
      expect(ambiguous.status).toBe(200)
      expect(ambiguous.body.needsClarification).toBe(true)
      expect(ambiguous.body.code).toBe("LEAD_AMBIGUOUS")
      expect(ambiguous.body.field).toBe("leadName")
      // В вопросе — названия обеих записей, иначе человеку нечего ответить.
      expect(ambiguous.body.candidates?.join(" ")).toContain("Bakı Tikinti")
      expect(ambiguous.body.candidates?.join(" ")).toContain("Gəncə Logistika")
      // И ничего не начато: квитанции на экране нет.
      expect(await activeReceipt()).toBeNull()

      // «Тот, что из Gəncə Logistika» — теперь однозначно.
      const resolved = await propose("propose_update_lead", {
        leadName: "Gəncə Logistika",
        status: "contacted",
      })
      expect(resolved.status).toBe(201)
      expect((await pressCreate(resolved.body.data!)).status).toBe(200)

      expect((await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: second.id } }))).status)
        .toBe("contacted")
      // Чужая запись не тронута.
      expect((await bypass(() => prisma.lead.findFirstOrThrow({ where: { id: first.id } }))).status)
        .toBe("new")
    })
  })

  /**
   * Две вкладки одного человека — два разговора. Квитанция принадлежит своему
   * разговору: закрытая в одной вкладке не закрывает чужую, и конец одного
   * разговора не трогает другой.
   */
  describe("сценарий: две вкладки одновременно", () => {
    it("у каждого разговора своя квитанция, и они не мешают друг другу", async () => {
      const firstTab = session
      const firstReceipt = (await speak("create_task", { title: "Задача из первой вкладки" })).body.data!

      const secondTab = await startConversation()
      session = secondTab
      const secondReceipt = (await speak("create_task", { title: "Задача из второй вкладки" })).body.data!
      expect(secondReceipt.id).not.toBe(firstReceipt.id)
      // Во второй вкладке своя квитанция, не подменённая первой.
      expect((await activeReceipt())?.id).toBe(secondReceipt.id)

      // Первая вкладка всё ещё держит свою.
      session = firstTab
      expect((await activeReceipt())?.id).toBe(firstReceipt.id)

      // Закрыли первую вкладку целиком — вторая живёт.
      await endRoute.POST(post("/api/v1/ai/voice/session/end", {
        voiceSessionId: firstTab,
        elapsedSeconds: 10,
      }))
      expect((await storedIntent(firstReceipt.id)).state).toBe("cancelled")
      expect((await storedIntent(secondReceipt.id)).state).toBe("awaiting_confirmation")

      // И во второй вкладке подтверждение проходит обычным порядком.
      session = secondTab
      expect((await pressCreate(secondReceipt)).status).toBe(200)
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Задача из второй вкладки" },
      }))).toBe(1)
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Задача из первой вкладки" },
      }))).toBe(0)
    })
  })

  /**
   * Помощник читает вслух и не пишет. Это не настройка, а граница: модель,
   * чьи аргументы можно увести прочитанным текстом, не должна быть в одном
   * шаге от записи.
   */
  describe("сценарий: читает всё, не пишет ничего", () => {
    it("проходит все инструменты чтения и не меняет в CRM ни строки", async () => {
      const { VOICE_TOOL_NAMES } = await import("@/lib/ai/voice/read-tools")
      // Своя цель для двух инструментов, которым нужна запись: тест не должен
      // зависеть от строк, созданных другими тестами этого файла (с ключом
      // `-t` они не запускаются, и цикл падал не по своей вине).
      const target = await bypass(() => prisma.deal.create({
        data: {
          organizationId: ORG,
          pipelineId: "pipeline-1",
          name: "Oxu hədəfi",
          stage: "NEGOTIATION",
          valueAmount: 10,
          currency: "AZN",
        },
      }))
      const before = await bypass(async () => ({
        deals: await prisma.deal.count({ where: { organizationId: ORG } }),
        leads: await prisma.lead.count({ where: { organizationId: ORG } }),
        tasks: await prisma.task.count({ where: { organizationId: ORG } }),
        contacts: await prisma.contact.count({ where: { organizationId: ORG } }),
        intents: await prisma.aiActionIntent.count({ where: { organizationId: ORG } }),
      }))

      const answered: string[] = []
      const refused: Record<string, string> = {}
      for (const tool of VOICE_TOOL_NAMES) {
        // Двум инструментам нужна цель; остальные отвечают про всё.
        const filter = tool === "read_record"
          ? { type: "deal", id: target.id }
          : tool === "find_record"
            ? { type: "deal", query: "Oxu hədəfi" }
            : tool === "describe_section" || tool === "explain_section"
              ? { section: "deals" }
              : {}
        const result = await ask(tool, filter)
        // Отказ приезжает ДАННЫМИ при статусе 200 — намеренно, чтобы помощник
        // объяснил и продолжил, а не услышал мёртвую CRM. Поэтому «ответил»
        // здесь — это 200 БЕЗ `data.error`: проверка только по статусу
        // зеленела на невыкупленном модуле и на отвергнутых аргументах.
        const error = (result.body as { data?: { error?: string } } | null)?.data?.error
        if (result.status !== 200) refused[tool] = `HTTP ${result.status}`
        else if (error) refused[tool] = error
        else answered.push(tool)
      }

      // Каждый инструмент из реестра доходит до своего читателя — реестр и
      // реализация не расходятся. Раньше это ловилось только там, где кто-то
      // вручную перечислил инструменты.
      expect(refused).toEqual({})
      expect(answered).toHaveLength(VOICE_TOOL_NAMES.length)

      // И после всех чтений в CRM ничего не изменилось.
      const after = await bypass(async () => ({
        deals: await prisma.deal.count({ where: { organizationId: ORG } }),
        leads: await prisma.lead.count({ where: { organizationId: ORG } }),
        tasks: await prisma.task.count({ where: { organizationId: ORG } }),
        contacts: await prisma.contact.count({ where: { organizationId: ORG } }),
        intents: await prisma.aiActionIntent.count({ where: { organizationId: ORG } }),
      }))
      expect(after).toEqual(before)

      // Каждый вопрос посчитан: потолок вызовов — единственная защита от
      // модели, которая зацикливается, и выглядит она как обычный трафик.
      const counted = await bypass(() => prisma.voiceSession.findFirstOrThrow({ where: { id: session } }))
      expect(counted.toolCallCount).toBe(VOICE_TOOL_NAMES.length)
    })

    it("упирается в потолок вызовов и больше не отвечает", async () => {
      const { MAX_TOOL_CALLS } = await import("@/lib/ai/voice/config")
      await bypass(() => prisma.voiceSession.update({
        where: { id: session },
        data: { toolCallCount: MAX_TOOL_CALLS },
      }))
      const refused = await ask("list_deals")
      expect(refused.status).toBe(409)
    })
  })

  /**
   * «Да» вслух вместо кнопки — и то, что это НЕ значит.
   *
   * Решает приложение, а не модель: оно сверяет свою же расшифровку с четырьмя
   * условиями. Здесь проверяется вся цепочка до записи в CRM и три случая,
   * когда «да» не считается, — потому что ложное «да» это запись, которую
   * никто не просил.
   */
  describe("сценарий: подтверждение голосом", () => {
    it("«да» после вопроса записывает, а «да» не к месту — нет", async () => {
      const receipt = (await speak("create_task", { title: "Подтверждено голосом" })).body.data!
      const gate = gateModule.createConfirmationGate()
      let t = 1_000

      // Квитанция появилась на экране, помощник произнёс вопрос.
      gate.setPendingReceipt(receipt.id, t)
      gate.setAssistantSpeaking(true, t)
      t += 2_000
      gate.setAssistantSpeaking(false, t)
      const asked = gate.assistantFinishedTurn(t)
      expect(asked.action).toBe("ignore")

      // Пауза дольше эха — и человек говорит «да».
      t += 2_000
      gate.userSpeech("да", t)
      t += 500
      const decision = gate.assistantFinishedTurn(t)
      expect(decision).toEqual({ action: "confirm", receiptId: receipt.id })

      // Только теперь — запись.
      expect((await pressCreate(receipt)).status).toBe(200)
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Подтверждено голосом" },
      }))).toBe(1)

      // Повторное «да» по той же квитанции второй записи не делает.
      t += 1_000
      gate.userSpeech("да", t)
      t += 200
      expect(gate.assistantFinishedTurn(t)).toEqual({ action: "ignore", reason: "already_answered" })
    })

    it.each([
      [
        "сказал «да» раньше, чем увидел квитанцию",
        "receipt_not_shown",
        (gate: ReturnType<typeof gateModule.createConfirmationGate>, at: number, id: string) => {
          gate.setAssistantSpeaking(true, at)
          gate.setAssistantSpeaking(false, at + 1_000)
          gate.assistantFinishedTurn(at + 1_000)
          gate.userSpeech("да", at + 2_000)
          // Квитанция появилась ПОСЛЕ слов — «да» было о другом.
          gate.setPendingReceipt(id, at + 2_500)
          return gate.assistantFinishedTurn(at + 3_000)
        },
      ],
      [
        "сказал «да» через минуту после вопроса",
        "too_late",
        (gate: ReturnType<typeof gateModule.createConfirmationGate>, at: number, id: string) => {
          gate.setPendingReceipt(id, at)
          gate.setAssistantSpeaking(true, at)
          gate.setAssistantSpeaking(false, at + 1_000)
          gate.assistantFinishedTurn(at + 1_000)
          gate.userSpeech("да", at + 1_000 + 31_000)
          return gate.assistantFinishedTurn(at + 1_000 + 31_500)
        },
      ],
      [
        "«да» прозвучало поверх голоса помощника",
        "assistant_speaking",
        (gate: ReturnType<typeof gateModule.createConfirmationGate>, at: number, id: string) => {
          gate.setPendingReceipt(id, at)
          gate.setAssistantSpeaking(true, at)
          gate.setAssistantSpeaking(false, at + 1_000)
          gate.assistantFinishedTurn(at + 1_000)
          gate.setAssistantSpeaking(true, at + 2_000)
          gate.userSpeech("да", at + 2_500)
          return gate.assistantFinishedTurn(at + 3_000)
        },
      ],
      [
        "сказал не «да» и не «нет»",
        "not_an_answer",
        (gate: ReturnType<typeof gateModule.createConfirmationGate>, at: number, id: string) => {
          gate.setPendingReceipt(id, at)
          gate.setAssistantSpeaking(true, at)
          gate.setAssistantSpeaking(false, at + 1_000)
          gate.assistantFinishedTurn(at + 1_000)
          gate.userSpeech("а сколько у нас сделок", at + 3_000)
          return gate.assistantFinishedTurn(at + 3_500)
        },
      ],
    ])("%s — не подтверждение (%s), и в CRM ничего", async (_name, reason, script) => {
      const receipt = (await speak("create_task", { title: `Не должно записаться: ${reason}` })).body.data!
      const gate = gateModule.createConfirmationGate()

      expect(script(gate, 1_000, receipt.id)).toEqual({ action: "ignore", reason })
      // Черновик так и остался черновиком, задачи нет.
      expect((await storedIntent(receipt.id)).state).toBe("awaiting_confirmation")
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: `Не должно записаться: ${reason}` },
      }))).toBe(0)
    })
  })

  /**
   * Квитанция принадлежит человеку, а не организации. Коллега за тем же
   * сервером не видит её, не подтвердит и не закроет — иначе голосом можно
   * было бы доделать чужое решение.
   */
  describe("сценарий: чужая квитанция", () => {
    it("коллега не видит, не подтверждает и не закрывает начатое другим", async () => {
      const mine = (await speak("create_deal", { name: "Моя сделка" })).body.data!

      await bypass(() => prisma.user.create({
        data: {
          id: "user-other",
          organizationId: ORG,
          email: "other@example.com",
          name: "Başqa İşçi",
          role: "manager",
          isActive: true,
          passwordHash: "not-a-login-path",
        },
      }))
      const otherSession = await bypass(() => prisma.voiceSession.create({
        data: {
          organizationId: ORG,
          userId: "user-other",
          status: "active",
          reservedSeconds: 600,
          expiresAt: new Date(Date.now() + 600_000),
        },
      }))

      auth.userId = "user-other"
      try {
        // Его собственный разговор пуст, хотя в организации квитанция есть.
        const previous = session
        session = otherSession.id
        expect(await activeReceipt()).toBeNull()
        session = previous

        // Закрыть чужую нельзя — её для него просто нет.
        expect((await pressClose(mine)).status).toBe(404)
        // И подтвердить нельзя: доказательство на чужую квитанцию не выдаётся.
        const attempt = await pressCreate(mine)
        expect(attempt.step).toBe("proof")
        expect(attempt.status).toBe(404)
      } finally {
        auth.userId = USER
      }

      // У хозяина квитанция цела и подтверждается как обычно.
      expect((await activeReceipt())?.id).toBe(mine.id)
      expect((await pressCreate(mine)).status).toBe(200)
      expect(await bypass(() => prisma.deal.count({
        where: { organizationId: ORG, name: "Моя сделка" },
      }))).toBe(1)
    })
  })

  /**
   * Квитанция живёт ограниченное время. Это не придирка: подтверждать то, что
   * обсуждали десять минут назад, человек будет уже по памяти, а не по
   * экрану — а запись уйдёт настоящая.
   */
  describe("сценарий: квитанция просрочена", () => {
    it("просроченную не подтвердить, она уходит с экрана, и следующая фраза проходит", async () => {
      const receipt = (await speak("create_task", { title: "Просроченная задача" })).body.data!

      // Прошло больше её срока.
      await bypass(() => prisma.aiActionIntent.update({
        where: { id: receipt.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      }))

      const refused = await pressCreate(receipt)
      expect(refused.step).toBe("proof")
      expect(refused.status).toBe(409)
      expect((await storedIntent(receipt.id)).state).toBe("expired")
      expect(await activeReceipt()).toBeNull()
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Просроченная задача" },
      }))).toBe(0)

      // И разговор не заперт: следующая просьба начинается с чистого листа.
      const next = await speak("create_task", { title: "Задача после просрочки" })
      expect(next.status).toBe(201)
      expect((await pressCreate(next.body.data!)).status).toBe(200)
    })
  })

  /**
   * Провайдер повторяет тот же вызов инструмента — это ретрай, а не вторая
   * просьба. Иначе одно «создай задачу» при дрогнувшей сети превращалось бы в
   * две задачи.
   */
  describe("сценарий: повтор одного и того же вызова", () => {
    it("повтор вызова даёт ту же квитанцию, а повтор подтверждения — ту же запись", async () => {
      const callId = "provider-call-retry-1"
      const first = await propose("propose_create_task", { title: "Единственная задача" }, {
        providerToolCallId: callId,
      })
      expect(first.status).toBe(201)

      // Тот же вызов пришёл снова.
      const retried = await propose("propose_create_task", { title: "Единственная задача" }, {
        providerToolCallId: callId,
      })
      expect(retried.status).toBe(200)
      expect(retried.body.data!.id).toBe(first.body.data!.id)
      expect(retried.body.data!.revision).toBe(1)

      // Черновик по-прежнему один.
      expect(await bypass(() => prisma.aiActionIntent.count({
        where: { voiceSessionId: session, parentIntentId: null },
      }))).toBe(1)

      const receipt = retried.body.data!
      expect((await pressCreate(receipt)).status).toBe(200)
      // Повторное нажатие по уже исполненной квитанции: второго
      // доказательства на неё не выдают вовсе — значит второй записи не будет
      // даже при двойном нажатии.
      const again = await pressCreate(receipt)
      expect(again.step).toBe("proof")
      expect(again.status).toBe(409)
      expect((await storedIntent(receipt.id)).state).toBe("succeeded")
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Единственная задача" },
      }))).toBe(1)
    })
  })

  /**
   * Разговор закончился — закончились и права говорить от его имени. Это не
   * формальность: закрытая сессия уже вернула неиспользованные минуты, и
   * запись «из неё» была бы записью вне учёта.
   */
  describe("сценарий: после конца разговора", () => {
    it("ни черновика, ни чтения из закрытой сессии", async () => {
      await endRoute.POST(post("/api/v1/ai/voice/session/end", {
        voiceSessionId: session,
        elapsedSeconds: 7,
      }))

      const late = await speak("create_task", { title: "Поздняя задача" })
      expect(late.status).toBe(409)
      expect(late.body.code).toBe("VOICE_SESSION_INACTIVE")
      const lateRead = await ask("list_deals")
      expect(lateRead.status).toBe(409)
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Поздняя задача" },
      }))).toBe(0)
    })
  })

  /**
   * Минуты: остановить разговор со стороны сервера нельзя, поэтому резерв
   * берётся вперёд. Закрыл сам — вернулось неиспользованное; бросил вкладку —
   * списывается резерв целиком, иначе закрытая вкладка была бы бесплатной.
   */
  describe("сценарий: минуты за разговор", () => {
    async function usage(userId: string): Promise<{ reservedSeconds: number; settledSeconds: number }> {
      const row = await bypass(() => prisma.voiceMonthlyUsage.findFirst({
        where: { organizationId: ORG, userId },
        select: { reservedSeconds: true, settledSeconds: true },
      }))
      return row ?? { reservedSeconds: 0, settledSeconds: 0 }
    }

    it("свой конец возвращает неиспользованное, брошенная вкладка списывает резерв целиком", async () => {
      const month = new Date().toISOString().slice(0, 7)
      await bypass(() => prisma.voiceMonthlyUsage.create({
        data: {
          organizationId: ORG,
          userId: "user-minutes",
          yearMonth: month,
          reservedSeconds: 1_200,
          settledSeconds: 0,
        },
      }))
      await bypass(() => prisma.user.create({
        data: {
          id: "user-minutes",
          organizationId: ORG,
          email: "minutes@example.com",
          name: "Dəqiqə",
          role: "manager",
          isActive: true,
          passwordHash: "not-a-login-path",
        },
      }))

      auth.userId = "user-minutes"
      try {
        // Два разговора по 600 зарезервированных секунд.
        const closed = await bypass(() => prisma.voiceSession.create({
          data: {
            organizationId: ORG,
            userId: "user-minutes",
            status: "active",
            reservedSeconds: 600,
            expiresAt: new Date(Date.now() + 600_000),
            elevenlabsConversationId: "gemini:connected:minutes-1",
          },
        }))
        const abandoned = await bypass(() => prisma.voiceSession.create({
          data: {
            organizationId: ORG,
            userId: "user-minutes",
            status: "active",
            reservedSeconds: 600,
            expiresAt: new Date(Date.now() + 600_000),
            elevenlabsConversationId: "gemini:connected:minutes-2",
            lastHeartbeatAt: new Date(Date.now() - 3_600_000),
          },
        }))

        // Первый человек закрыл сам, проговорив полторы минуты.
        await endRoute.POST(post("/api/v1/ai/voice/session/end", {
          voiceSessionId: closed.id,
          elapsedSeconds: 90,
        }))
        const afterOwnEnd = await usage("user-minutes")
        // Списано сказанное, остальное вернулось в месячный остаток.
        expect(afterOwnEnd.settledSeconds).toBe(90)
        expect(afterOwnEnd.reservedSeconds).toBe(1_200 - (600 - 90))

        // Вторую вкладку просто закрыли — её добивает крон.
        process.env.CRON_SECRET = "voice-lifecycle-cron-secret"
        await reaperRoute.POST(new NextRequest(
          "http://localhost:3000/api/cron/voice-session-reaper",
          { method: "POST", headers: { "x-cron-secret": "voice-lifecycle-cron-secret" } },
        ))
        expect((await bypass(() => prisma.voiceSession.findFirstOrThrow({ where: { id: abandoned.id } }))).status)
          .toBe("abandoned")
        const afterReaper = await usage("user-minutes")
        // Резерв брошенного разговора списан целиком, а не обнулён.
        expect(afterReaper.settledSeconds).toBe(90 + 600)
      } finally {
        auth.userId = USER
      }
    })
  })

  /**
   * Правка существующей задачи — восьмое действие записи, и единственное, по
   * которому не было ни одного разговора: нашлось пересчётом реестра против
   * теста, а не падением. Здесь задача ведётся словами от создания до
   * закрытия, и ни один идентификатор не произносится вслух.
   */
  describe("сценарий: задача, которую ведут словами", () => {
    const TASK = "Azmart-a zəng etmək"

    async function thatTask() {
      return bypass(() => prisma.task.findFirstOrThrow({
        where: { organizationId: ORG, title: TASK },
      }))
    }

    it("создать, перенести, передать, закрыть — каждое слово через свою квитанцию", async () => {
      const created = await propose("propose_create_task", { title: TASK, dueDate: "2026-11-10" })
      expect(created.status).toBe(201)
      expect((await pressCreate(created.body.data!)).status).toBe(200)
      // Список, а не доска: у этой задачи свой словарь состояний.
      expect((await thatTask()).status).toBe("pending")

      // «Перенеси на пятницу»: задача названа словами, цель нашёл сервер.
      const moved = await propose("propose_update_task", { taskTitle: TASK, dueDate: "2026-11-14" })
      expect(moved.status).toBe(201)
      // Другое действие — своя квитанция, а не поправка прежней.
      expect(moved.body.data!.id).not.toBe(created.body.data!.id)
      expect((await pressCreate(moved.body.data!)).status).toBe(200)
      expect((await thatTask()).dueDate?.toISOString().slice(0, 10)).toBe("2026-11-14")

      // «Передай Лейле»: исполнитель тоже по имени.
      const handed = await propose("propose_update_task", { taskTitle: TASK, assigneeName: "Leyla" })
      expect(handed.status).toBe(201)
      expect((await pressCreate(handed.body.data!)).status).toBe(200)
      expect((await thatTask()).assignedTo).toBe("user-colleague")

      // «Закрой задачу»: слово превращается в состояние ЭТОЙ задачи.
      const closed = await propose("propose_update_task", { taskTitle: TASK, status: "done" })
      expect(closed.status).toBe(201)
      expect((await pressCreate(closed.body.data!)).status).toBe(200)
      expect((await thatTask()).status).toBe("completed")

      // Четыре фразы — четыре квитанции и одна задача. Экран чист.
      expect(await bypass(() => prisma.task.count({ where: { organizationId: ORG, title: TASK } }))).toBe(1)
      expect(await activeReceipt()).toBeNull()
    })

    it("та же фраза про задачу на доске пишет другое слово", async () => {
      await bypass(async () => {
        await prisma.division.create({
          data: { id: "division-board", organizationId: ORG, key: "WH", name: "Anbar" },
        })
        await prisma.task.create({
          data: {
            id: "task-on-board",
            organizationId: ORG,
            title: "Rəfləri saymaq",
            divisionId: "division-board",
          },
        })
      })

      const closed = await propose("propose_update_task", { taskTitle: "Rəfləri saymaq", status: "done" })
      expect(closed.status).toBe(201)
      expect((await pressCreate(closed.body.data!)).status).toBe(200)
      // Доска, а не список: «done», а не «completed». Одно и то же слово
      // человека, разные значения в базе — поэтому состояние не приходит от
      // модели готовым значением.
      expect((await bypass(() => prisma.task.findFirstOrThrow({ where: { id: "task-on-board" } }))).status)
        .toBe("done")
    })

    it("не угадывает, какую задачу править: спрашивает и ничего не меняет", async () => {
      const mine = await bypass(() => prisma.task.create({
        data: { organizationId: ORG, title: "Sənədləri yoxlamaq" },
      }))
      const before = await bypass(() => prisma.task.count({ where: { organizationId: ORG } }))

      // Задачи с таким названием нет.
      const missing = await propose("propose_update_task", { taskTitle: "Kaktusu sulamaq", status: "done" })
      expect(missing.status).toBe(200)
      expect(missing.body.needsClarification).toBe(true)
      expect(missing.body.code).toBe("TASK_NOT_FOUND")

      // «Закрой эту» без открытой на экране записи — тоже вопрос, а не выбор
      // наугад: закрытая чужая задача не отменяется словами.
      const noTarget = await propose("propose_update_task", { status: "done" })
      expect(noTarget.status).toBe(200)
      expect(noTarget.body.code).toBe("TASK_TARGET_REQUIRED")

      // Правка, в которой не названо ни одного поля, — отказ, а не пустая
      // квитанция, которую человеку предложат подтвердить.
      const empty = await propose("propose_update_task", { taskTitle: "Sənədləri yoxlamaq" })
      expect(empty.status).toBe(400)

      // Три фразы — ни одной квитанции и ни одной новой или изменённой задачи.
      expect(await activeReceipt()).toBeNull()
      expect(await bypass(() => prisma.task.count({ where: { organizationId: ORG } }))).toBe(before)
      expect((await bypass(() => prisma.task.findFirstOrThrow({ where: { id: mine.id } }))).status)
        .toBe("pending")
    })

    it("«поставь срочным» берёт цель с экрана, а не из названия", async () => {
      const open = await bypass(() => prisma.task.create({
        data: { organizationId: ORG, title: "Müqaviləni aparmaq" },
      }))
      // Так это и приходит с экрана: браузер говорит, что открыто, модель —
      // только что изменить.
      const receipt = await propose(
        "propose_update_task",
        { priority: "high" },
        { screen: { recordType: "task", recordId: open.id } },
      )
      expect(receipt.status).toBe(201)
      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      expect((await bypass(() => prisma.task.findFirstOrThrow({ where: { id: open.id } }))).priority)
        .toBe("high")
    })
  })

  /**
   * Карточка и поиск — по КАЖДОМУ типу записи, а не по сделке и лиду.
   *
   * У девяти карточек девять своих читателей (`READERS` в record-read.ts), у
   * поиска — пятнадцать своих запросов. Это ровно та форма кода, которая
   * ломается по одному типу и молчит: до этого набора проверялась одна сделка
   * из пятнадцати возможных.
   */
  describe("сценарий: карточка и поиск по каждому типу записи", () => {
    /** Название, по которому запись и находят, и узнают в прочитанной карточке. */
    const NEEDLE: Record<string, string> = {
      deal: "Printer partiyası",
      contact: "Könül Əliyeva",
      company: "Bakı Ofis MMC",
      lead: "Tural Həsənov",
      ticket: "Printer işləmir",
      invoice: "Printer hesabı",
      project: "Anbar köçürülməsi",
      contract: "Təchizat müqaviləsi",
      product: "Printer HP 1020",
      board: "Satış şöbəsi",
      quote: "QTE-9001",
      campaign: "Payız kampaniyası",
      complaint: "Çatdırılma gecikdi",
      event: "Açıq qapı günü",
      task: "Sifarişi yoxlamaq",
    }
    /**
     * Чем человек ищет эту запись. По умолчанию — тем же названием, которое
     * помощник произносит из карточки; у счёта иначе: искать его реестр даёт
     * по НОМЕРУ (`searchFields` в record-types), а вслух карточка называет
     * заголовок. Две разные строки для одной записи — и обе должны работать.
     */
    const QUERY: Record<string, string> = { invoice: "INV-9001" }

    const ID: Record<string, string> = {}

    beforeEach(async () => {
      if (ID.deal) return
      await bypass(async () => {
        ID.deal = (await prisma.deal.create({
          data: {
            organizationId: ORG,
            pipelineId: "pipeline-1",
            name: NEEDLE.deal,
            stage: "NEGOTIATION",
            valueAmount: 1500,
            currency: "AZN",
          },
        })).id
        ID.contact = (await prisma.contact.create({
          data: { organizationId: ORG, fullName: NEEDLE.contact },
        })).id
        ID.company = (await prisma.company.create({
          data: { organizationId: ORG, name: NEEDLE.company },
        })).id
        ID.lead = (await prisma.lead.create({
          data: { organizationId: ORG, contactName: NEEDLE.lead, status: "new" },
        })).id
        ID.ticket = (await prisma.ticket.create({
          data: { organizationId: ORG, ticketNumber: "TCK-9001", subject: NEEDLE.ticket },
        })).id
        ID.invoice = (await prisma.invoice.create({
          data: {
            organizationId: ORG,
            invoiceNumber: "INV-9001",
            title: NEEDLE.invoice,
            currency: "AZN",
          },
        })).id
        ID.project = (await prisma.project.create({
          data: { organizationId: ORG, name: NEEDLE.project },
        })).id
        ID.contract = (await prisma.contract.create({
          data: { organizationId: ORG, contractNumber: "CTR-9001", title: NEEDLE.contract },
        })).id
        ID.product = (await prisma.product.create({
          data: { organizationId: ORG, name: NEEDLE.product, sku: "PRN-1020" },
        })).id
        ID.board = (await prisma.division.create({
          data: { organizationId: ORG, key: "SALES9", name: NEEDLE.board },
        })).id
        ID.quote = (await prisma.quote.create({
          data: { organizationId: ORG, quoteNumber: NEEDLE.quote, currency: "AZN" },
        })).id
        ID.campaign = (await prisma.campaign.create({
          data: { organizationId: ORG, name: NEEDLE.campaign },
        })).id
        // Жалоба — не своя таблица: это тикет, у которого есть строка
        // ComplaintMeta. Поиск жалоб смотрит именно на неё, поэтому обычный
        // тикет сюда не годится.
        const complaint = await prisma.ticket.create({
          data: { organizationId: ORG, ticketNumber: "TCK-9002", subject: NEEDLE.complaint },
        })
        await prisma.complaintMeta.create({
          data: { organizationId: ORG, ticketId: complaint.id, riskLevel: "high" },
        })
        ID.complaint = complaint.id
        ID.event = (await prisma.event.create({
          data: { organizationId: ORG, name: NEEDLE.event, startDate: new Date() },
        })).id
        ID.task = (await prisma.task.create({
          data: { organizationId: ORG, title: NEEDLE.task },
        })).id
      })
    })

    it("каждую карточку помощник читает, и в ней та запись, о которой спросили", async () => {
      const { VOICE_READABLE_TYPES } = await import("@/lib/ai/voice/record-read")
      const broken: Record<string, string> = {}
      for (const type of VOICE_READABLE_TYPES) {
        const answer = await ask("read_record", { type, id: ID[type] })
        const card = (answer.body as { data?: Record<string, unknown> }).data
        if (answer.status !== 200) broken[type] = `HTTP ${answer.status}`
        else if (!card || card.error) broken[type] = String(card?.error ?? "no data")
        // Карточка без имени записи — это карточка не той записи или пустая:
        // помощник зачитает её вслух, и человек не поймёт, о чём он.
        else if (!JSON.stringify(card).includes(NEEDLE[type])) broken[type] = "карточка без названия записи"
      }
      expect(broken).toEqual({})
      expect(VOICE_READABLE_TYPES.length).toBe(9)
    })

    it("каждый тип записи находится по словам человека", async () => {
      const { RECORD_TYPES } = await import("@/lib/ai/voice/record-types")
      const types = Object.keys(RECORD_TYPES)
      const broken: Record<string, string> = {}
      for (const type of types) {
        // Потолок вызовов на разговор — 40, типов пятнадцать плюс карточки:
        // счётчик обнуляется, иначе цикл упёрся бы в защиту от зациклившейся
        // модели, а не проверил поиск.
        await bypass(() => prisma.voiceSession.update({
          where: { id: session },
          data: { toolCallCount: 0 },
        }))
        const answer = await ask("find_record", { type, query: QUERY[type] ?? NEEDLE[type] })
        const found = (answer.body as { data?: { error?: string; matches?: { id: string }[] } }).data
        if (answer.status !== 200) broken[type] = `HTTP ${answer.status}`
        else if (!found || found.error) broken[type] = String(found?.error ?? "no data")
        else if (!found.matches?.some((match) => match.id === ID[type])) broken[type] = "не нашёл"
      }
      expect(broken).toEqual({})
      expect(types.length).toBe(15)
    })

    it("расслышанный слог не превращается в список всех записей", async () => {
      // Одна буква — отказ схемы, и он тоже приезжает ДАННЫМИ: модель
      // переспросит и позовёт снова, а не услышит мёртвую CRM. Пустой ответ
      // здесь был бы хуже отказа только тем, что неотличим от «ничего не
      // найдено».
      const answer = await ask("find_record", { type: "deal", query: "a" })
      expect(answer.status).toBe(200)
      expect((answer.body as { data: { error?: string } }).data.error).toBe("BAD_ARGUMENTS")
    })
  })

  /**
   * Разделы: и цифры, и разбор словами.
   *
   * Урок здесь уже оплачен — первый список разделов был написан руками и
   * приехал без «лидов», а аудит нашёл 142 недостижимых пункта меню из 152.
   * Поэтому цикл идёт по РЕЕСТРУ, а не по тому, что кто-то вспомнил.
   */
  describe("сценарий: каждый раздел отвечает о себе", () => {
    it("каждый раздел с цифрами называет своё число", async () => {
      const { SECTION_DESCRIPTORS } = await import("@/lib/ai/voice/section-registry")
      const sections = Object.keys(SECTION_DESCRIPTORS)
      const broken: Record<string, string> = {}
      for (const section of sections) {
        await bypass(() => prisma.voiceSession.update({
          where: { id: session },
          data: { toolCallCount: 0 },
        }))
        const answer = await ask("describe_section", { section })
        const data = (answer.body as { data?: { error?: string; total?: unknown } }).data
        if (answer.status !== 200) broken[section] = `HTTP ${answer.status}`
        else if (data?.error) broken[section] = String(data.error)
        else if (typeof data?.total !== "number") broken[section] = `total=${typeof data?.total}`
      }
      expect(broken).toEqual({})
      // Реестр не должен молча усохнуть: пустой цикл зеленел бы всегда.
      expect(sections.length).toBeGreaterThanOrEqual(22)
    })

    it("написанный разбор доходит целиком, а снятого с продукта помощник не зачитывает", async () => {
      const { SECTION_GUIDE } = await import("@/lib/ai/voice/section-guide")
      const { VOICE_SECTIONS } = await import("@/lib/ai/voice/sections")
      const { isWithdrawnCrmPath } = await import("@/lib/crm-product-availability")
      const sections = Object.keys(SECTION_GUIDE)
      const broken: Record<string, string> = {}
      const served: string[] = []
      for (const section of sections) {
        // Девять разборов из десяти написаны про Workforce, снятый с продукта
        // решением в коде («Re-enabling it requires a reviewed release»).
        // Помощник обязан отказать по ним, а не рассказывать про то, чего
        // тенанту не отдают: иначе текст живёт дольше функции.
        const withdrawn = isWithdrawnCrmPath(VOICE_SECTIONS[section] ?? "")
        await bypass(() => prisma.voiceSession.update({
          where: { id: session },
          data: { toolCallCount: 0 },
        }))
        const answer = await ask("explain_section", { section })
        const data = (answer.body as {
          data?: { error?: string; whatItIs?: string; howItWorks?: string; keyFeatures?: string[] }
        }).data
        if (answer.status !== 200) broken[section] = `HTTP ${answer.status}`
        else if (withdrawn) {
          if (data?.error !== "SECTION_NOT_AVAILABLE") broken[section] = `снятое отдано: ${data?.error ?? "разбор"}`
        }
        else if (data?.error) broken[section] = String(data.error)
        else if (!data?.whatItIs || !data.howItWorks || !data.keyFeatures?.length) {
          broken[section] = "разбор без одной из трёх частей"
        }
        else served.push(section)
      }
      expect(broken).toEqual({})
      // Хотя бы один разбор помощник всё-таки отдаёт: иначе цикл зеленел бы,
      // проверяя одни отказы.
      expect(served.length).toBeGreaterThanOrEqual(1)
      expect(sections.length).toBeGreaterThanOrEqual(10)
    })

    it("раздел без цифр не молчит, а называет те, о которых цифры есть", async () => {
      const answer = await ask("describe_section", { section: "dashboard" })
      const data = (answer.body as { data: { error: string; known: string[] } }).data
      // Отказ приезжает данными и со списком: помощнику есть что сказать
      // дальше, а не «не могу».
      expect(data.error).toBe("UNKNOWN_SECTION")
      expect(data.known).toContain("deals")
    })

    it("инструмент невыкупленного модуля отвечает словами, а не ошибкой", async () => {
      modulesOff.add("finance")
      try {
        const answer = await ask("list_invoices")
        // 200 и данными — намеренно: браузер считает два ответа не-2xx мёртвой
        // CRM и заканчивает разговор, так что два вопроса про чужой модуль
        // кладут трубку.
        expect(answer.status).toBe(200)
        expect(answer.body).toEqual({ data: { error: "MODULE_NOT_ENABLED", module: "finance" } })
      } finally {
        modulesOff.delete("finance")
      }
    })
  })

  /**
   * Цифры, которые помощник произносит вслух.
   *
   * Неверное число звучит так же уверенно, как верное, и проверить его на слух
   * нельзя. Поэтому здесь не «ответил 200», а «изменилось в CRM ровно на
   * столько»: сначала читается цифра, потом меняется CRM, потом цифра
   * читается снова. Так тест не зависит от того, что накопили соседние
   * сценарии, и доказывает поведение, а не форму ответа.
   */
  describe("сценарий: цифры отвечают на то, что изменилось в CRM", () => {
    type Pipeline = {
      openDeals: number
      openAmount: number
      stages: { stage: string; deals: number; amount: number }[]
    }
    type Managers = {
      managers: { name: string; openDeals: number; openAmount: number; wonDeals: number; wonAmount: number }[]
      unassignedOpen: number
    }
    type Period = { wonCount: number; money: { amount: number } | null }
    type Overdue = {
      overdueTasks: number
      overdueInvoices: number
      overdueInvoiceAmount: number
      dealsPastExpectedClose: number
    }

    async function pipeline(): Promise<Pipeline> {
      return ((await ask("get_pipeline_by_stage")).body as { data: Pipeline }).data
    }
    async function managers(): Promise<Managers> {
      return ((await ask("get_sales_by_manager")).body as { data: Managers }).data
    }
    async function period(): Promise<Period> {
      return ((await ask("get_sales_in_period", { period: "this_month" })).body as { data: Period }).data
    }
    async function overdue(): Promise<Overdue> {
      return ((await ask("get_overdue")).body as { data: Overdue }).data
    }
    function seller(rows: Managers) {
      return rows.managers.find((row) => row.name.includes("Rəşad Quliyev"))
    }

    it("сделка, созданная и выигранная голосом, двигает воронку, менеджера и итог месяца", async () => {
      const wasPipeline = await pipeline()
      const wasManagers = await managers()
      const wasPeriod = await period()
      const DEAL = "Printer partiyası üçün müqavilə"

      const created = await propose("propose_create_deal", {
        name: DEAL,
        companyName: "Azmart MMC",
        valueAmount: 4000,
        currency: "AZN",
        assigneeName: "Rəşad Quliyev",
      })
      expect(created.status).toBe(201)
      expect((await pressCreate(created.body.data!)).status).toBe(200)

      const afterCreate = await pipeline()
      expect(afterCreate.openDeals).toBe(wasPipeline.openDeals + 1)
      expect(afterCreate.openAmount).toBe(wasPipeline.openAmount + 4000)
      const sellerAfterCreate = seller(await managers())!
      expect(sellerAfterCreate.openDeals).toBe((seller(wasManagers)?.openDeals ?? 0) + 1)
      expect(sellerAfterCreate.openAmount).toBe((seller(wasManagers)?.openAmount ?? 0) + 4000)

      // «Qazanıldı» — слово воронки этой организации.
      const won = await propose("propose_move_deal_stage", { dealName: DEAL, stage: "qazanıldı" })
      expect(won.status).toBe(201)
      expect((await pressCreate(won.body.data!)).status).toBe(200)

      const afterWin = await pipeline()
      // Выигранная ушла из открытых: «у вас в воронке столько» не должно
      // включать закрытое.
      expect(afterWin.openDeals).toBe(wasPipeline.openDeals)
      expect(afterWin.openAmount).toBe(wasPipeline.openAmount)
      const wonStage = afterWin.stages.find((row) => row.stage === "WON")!
      expect(wonStage.deals).toBe((wasPipeline.stages.find((row) => row.stage === "WON")?.deals ?? 0) + 1)
      // У менеджера она переехала из открытых в выигранные.
      const sellerAfterWin = seller(await managers())!
      expect(sellerAfterWin.wonDeals).toBe((seller(wasManagers)?.wonDeals ?? 0) + 1)
      expect(sellerAfterWin.wonAmount).toBe((seller(wasManagers)?.wonAmount ?? 0) + 4000)
      // Итог месяца считается по ЗАПИСАННОМУ переходу, а не по текущей
      // стадии, — значит голосовая победа его и записала.
      const nowPeriod = await period()
      expect(nowPeriod.wonCount).toBe(wasPeriod.wonCount + 1)
      expect(nowPeriod.money?.amount).toBe((wasPeriod.money?.amount ?? 0) + 4000)
    })

    it("просрочка растёт только на просроченное", async () => {
      const was = await overdue()
      const past = new Date(Date.now() - 48 * 3_600_000)
      await bypass(async () => {
        await prisma.task.create({
          data: { organizationId: ORG, title: "Gecikmiş zəng", dueDate: past },
        })
        // Закрытая задача со вчерашним сроком не просрочена.
        await prisma.task.create({
          data: { organizationId: ORG, title: "Gecikmiş, amma bitmiş", dueDate: past, status: "completed" },
        })
        await prisma.invoice.create({
          data: {
            organizationId: ORG,
            invoiceNumber: "INV-OVERDUE",
            title: "Gecikmiş hesab",
            dueDate: past,
            totalAmount: 250,
            balanceDue: 250,
            currency: "AZN",
          },
        })
        // Оплаченный счёт не просрочен, даже если на нём остался ярлык.
        await prisma.invoice.create({
          data: {
            organizationId: ORG,
            invoiceNumber: "INV-PAID",
            title: "Ödənilmiş hesab",
            status: "overdue",
            dueDate: past,
            totalAmount: 900,
            paidAmount: 900,
            balanceDue: 0,
            currency: "AZN",
          },
        })
        await prisma.deal.create({
          data: {
            organizationId: ORG,
            pipelineId: "pipeline-1",
            name: "Tarixi keçmiş sövdələşmə",
            stage: "NEGOTIATION",
            expectedClose: past,
            valueAmount: 100,
            currency: "AZN",
          },
        })
        // Уже выигранная сделка с прошедшей датой — не «съехавшая».
        await prisma.deal.create({
          data: {
            organizationId: ORG,
            pipelineId: "pipeline-1",
            name: "Qazanılmış, tarixi keçmiş",
            stage: "WON",
            expectedClose: past,
            valueAmount: 100,
            currency: "AZN",
          },
        })
      })

      const now = await overdue()
      expect(now.overdueTasks).toBe(was.overdueTasks + 1)
      expect(now.overdueInvoices).toBe(was.overdueInvoices + 1)
      expect(now.overdueInvoiceAmount).toBe(was.overdueInvoiceAmount + 250)
      expect(now.dealsPastExpectedClose).toBe(was.dealsPastExpectedClose + 1)
    })

    it("сводка дня читается из снимка, а без снимка честно говорит, что его нет", async () => {
      const empty = ((await ask("get_daily_briefing")).body as {
        data: { available: boolean; totalSignals: number }
      }).data
      // Снимка ещё нет: ответ — «нечего сказать», а не нули как факт.
      expect(empty).toMatchObject({ available: false, totalSignals: 0 })

      await bypass(() => prisma.advisorSignalSnapshot.create({
        data: {
          organizationId: ORG,
          snapshotKey: "voice-assistant-test",
          snapshotAt: new Date(Date.now() - 2 * 3_600_000),
          totalSignals: 7,
          criticalCount: 2,
          highCount: 3,
          moneyAtRisk: 12_345.6,
        },
      }))

      const briefing = ((await ask("get_daily_briefing")).body as {
        data: {
          available: boolean
          totalSignals: number
          criticalCount: number
          highCount: number
          moneyAtRisk: number
          staleHours: number
        }
      }).data
      expect(briefing).toMatchObject({
        available: true,
        totalSignals: 7,
        criticalCount: 2,
        highCount: 3,
        // Копейки вслух — шум, и сама величина оценочная.
        moneyAtRisk: 12_346,
      })
      // Возраст снимка возвращается, чтобы помощник сказал, КОГДА это мерили.
      expect(briefing.staleHours).toBe(2)
    })

    it("непокрытый лид виден как непокрытый", async () => {
      type Coverage = { openLeads: number; unassigned: number }
      const coverage = async () =>
        ((await ask("get_lead_coverage")).body as { data: Coverage }).data

      const was = await coverage()
      await bypass(() => prisma.lead.create({
        data: {
          organizationId: ORG,
          contactName: "Örtülməmiş müştəri",
          status: "new",
          createdAt: new Date(Date.now() - 72 * 3_600_000),
        },
      }))
      const now = await coverage()
      expect(now.openLeads).toBe(was.openLeads + 1)
      expect(now.unassigned).toBe(was.unassigned + 1)
    })

    it("списки называют то, что только что появилось", async () => {
      const NEEDLE = "Siyahı yoxlaması"
      await bypass(async () => {
        await prisma.deal.create({
          data: {
            organizationId: ORG,
            pipelineId: "pipeline-1",
            name: NEEDLE,
            stage: "NEGOTIATION",
            valueAmount: 10,
            currency: "AZN",
          },
        })
        await prisma.task.create({ data: { organizationId: ORG, title: NEEDLE } })
        await prisma.contact.create({ data: { organizationId: ORG, fullName: NEEDLE } })
        await prisma.invoice.create({
          data: {
            organizationId: ORG,
            invoiceNumber: "INV-LIST",
            title: NEEDLE,
            currency: "AZN",
          },
        })
        await prisma.ticket.create({
          data: { organizationId: ORG, ticketNumber: "TCK-LIST", subject: NEEDLE },
        })
      })

      // Чем список называет строку, решает он сам: счета люди знают по
      // номеру, остальное — по названию. Поэтому ждём ровно то, что в этом
      // списке и есть смысл услышать.
      const named: Record<string, string> = {
        list_deals: NEEDLE,
        list_tasks: NEEDLE,
        list_contacts: NEEDLE,
        list_invoices: "INV-LIST",
        list_tickets: NEEDLE,
      }
      for (const [tool, needle] of Object.entries(named)) {
        const answer = await ask(tool)
        expect(JSON.stringify(answer.body), tool).toContain(needle)
      }
    })
  })

  /**
   * Помощник записал не то имя — и повтор голосом этого не лечит.
   *
   * Разговор владельца 2026-11-06 (орг Zeytun Pharma, 06:51 UTC): «создай
   * клиента, компания fanumsec» — модель услышала «PhantomSec». На «нет, измени
   * на fanumsec» ревизия выросла до второй, а название осталось тем же: для
   * распознавателя «фанум-сек» и «фантом-сек» одно слово. Человек бросил
   * квитанцию крестиком, и в CRM не появилось ничего.
   *
   * Отсюда два пути, и оба проверяются здесь: сервер говорит, что поправка
   * ничего не изменила (сам он единственный, кто это видит), а правка руками в
   * квитанции пишет имя буква в букву.
   */
  describe("сценарий: записал не то имя", () => {
    const HEARD = "PhantomSec"
    const SAID = "fanumsec"

    it("повтор того же слова помечается, настоящая поправка — нет", async () => {
      const first = await propose("propose_create_lead", {
        contactName: "Rəşad Rəhimov",
        companyName: HEARD,
      })
      expect(first.status).toBe(201)
      // Пометки на первом черновике быть не может: сравнивать не с чем.
      expect(first.body.data!.unchangedFields).toBeUndefined()

      // «Нет, компания fanumsec» — и услышано снова то же самое. Поправку
      // модель присылает полным набором: имя контакта она не забыла.
      const circle = await propose("propose_create_lead", {
        contactName: "Rəşad Rəhimov",
        companyName: HEARD,
      })
      expect(circle.status).toBe(201)
      expect(circle.body.data!.id).toBe(first.body.data!.id)
      expect(circle.body.data!.revision).toBe(2)
      // Вот это и есть то, чего модель о своём вызове знать не может.
      expect(circle.body.data!.unchangedFields).toEqual(["contactName", "companyName"])

      // Поправка, которая меняет хоть одно поле, не помечается: неизменившиеся
      // поля есть почти в каждой поправке, и пометка на них ничего не стоила бы.
      const real = await propose("propose_create_lead", {
        contactName: "Rəşad Rəhimov",
        companyName: SAID,
      })
      expect(real.status).toBe(201)
      expect(real.body.data!.unchangedFields).toBeUndefined()
      expect(previewField(real.body.data!, "companyName")).toBe(SAID)

      // А названное раньше не потерялось по дороге.
      expect(previewField(real.body.data!, "contactName")).toBe("Rəşad Rəhimov")
    })

    it("правка руками в квитанции пишет имя буква в букву", async () => {
      const heard = await propose("propose_create_lead", {
        contactName: "Könül Məmmədova",
        companyName: HEARD,
      })
      expect(heard.status).toBe(201)

      // «Изменить» → стёр «PhantomSec», написал «Fanumsec» → «Сохранить».
      const typed = await typeIntoReceipt(heard.body.data!, { companyName: "Fanumsec" })
      expect(typed.status).toBe(200)
      const corrected = typed.body.data!
      expect(corrected.revision).toBe(2)
      expect(previewField(corrected, "companyName")).toBe("Fanumsec")
      // Имя контакта правка не уронила: форма присылает нагрузку целиком.
      expect(previewField(corrected, "contactName")).toBe("Könül Məmmədova")

      expect((await pressCreate(corrected)).status).toBe(200)
      const lead = await bypass(() => prisma.lead.findFirstOrThrow({
        where: { organizationId: ORG, contactName: "Könül Məmmədova" },
      }))
      // Буква в букву: выдуманное название никто не «улучшает» по дороге.
      expect(lead.companyName).toBe("Fanumsec")
    })

    it("подтверждение, выданное до правки, после неё не проходит", async () => {
      const heard = await propose("propose_create_lead", {
        contactName: "Elçin Nəsirov",
        companyName: HEARD,
      })
      const draft = heard.body.data!

      // Доказательство на старую ревизию выдано…
      const proofResponse = await confirmRoute.POST(
        post(`/api/v1/ai/voice/actions/${draft.id}/confirmation`, {
          expectedRevision: draft.revision,
          payloadHash: draft.payloadHash,
          confirmed: true,
        }),
        { params: Promise.resolve({ id: draft.id }) },
      )
      expect(proofResponse.status).toBe(201)
      const proof = (await proofResponse.json()) as {
        data: { confirmationEventId: string; confirmationToken: string }
      }

      // …а потом человек поправил название на экране.
      const typed = await typeIntoReceipt(draft, { companyName: "Fanumsec" })
      expect(typed.status).toBe(200)

      // Старое доказательство не записывает: подтверждали другое имя.
      const commit = await commitRoute.POST(
        post(`/api/v1/ai/voice/actions/${draft.id}/commit`, {
          confirmationEventId: proof.data.confirmationEventId,
          confirmationToken: proof.data.confirmationToken,
          expectedRevision: draft.revision,
          payloadHash: draft.payloadHash,
        }),
        { params: Promise.resolve({ id: draft.id }) },
      )
      expect(commit.status).toBe(409)
      expect(await bypass(() => prisma.lead.count({
        where: { organizationId: ORG, contactName: "Elçin Nəsirov" },
      }))).toBe(0)

      // Новое — записывает, и с поправленным именем.
      expect((await pressCreate(typed.body.data!)).status).toBe(200)
      expect((await bypass(() => prisma.lead.findFirstOrThrow({
        where: { organizationId: ORG, contactName: "Elçin Nəsirov" },
      }))).companyName).toBe("Fanumsec")
    })

    it("выдуманный идентификатор в правке в CRM не попадает", async () => {
      // Исполнителя сервер находит по имени сам, и в квитанции он — ссылка;
      // форма её не предлагает перепечатывать (REFERENCE_FIELD_KEYS), но
      // эндпоинт правки — это дверь, и держать её должен он сам.
      const draft = (await propose("propose_create_task", {
        title: "Fanumsec-ə zəng",
        assigneeName: "Leyla",
      })).body.data!
      expect(previewField(draft, "assignedTo")).toBe("user-colleague")

      // Сейчас эндпоинт правки такую строку ПРИНИМАЕТ, а отказывает кнопка:
      // исполнителя проверяет сама команда. Записать это нельзя — и именно
      // «нельзя записать» здесь и закреплено. Что отказ приходит на кнопке, а
      // не на сохранении правки, — известный зазор того же рода, что и
      // квитанция, обещавшая исполнителя, которого команда отвергает.
      const typed = await typeIntoReceipt(draft, { assignedTo: "user-from-nowhere" })
      expect(typed.status).toBe(200)

      const pressed = await pressCreate(typed.body.data!)
      expect(pressed.step).toBe("commit")
      expect(pressed.status).toBe(400)
      expect(pressed.body.code).toBe("VALIDATION_FAILED")
      // В CRM не появилось ничего, а квитанция закрыта как неудавшаяся.
      expect(await bypass(() => prisma.task.count({
        where: { organizationId: ORG, title: "Fanumsec-ə zəng" },
      }))).toBe(0)
      expect((await storedIntent(typed.body.data!.id)).state).toBe("failed")
    })
  })

  /**
   * «Клиент» — это компания, а не лид.
   *
   * Владелец 2026-11-06: «создай клиента, название компании fanumsec».
   * Действия для этого не было вовсе, и фраза превращалась в ЛИД — ещё не
   * квалифицированный интерес, который потом превращают в сделку. Теперь есть
   * девятое действие записи, и проверяется оно тем же путём, что остальные:
   * имена вслух, квитанция, кнопка.
   */
  describe("сценарий: клиент — это компания", () => {
    it("создать компанию голосом, увидеть похожую и записать одну", async () => {
      // Лидов до фразы: имя «Fanumsec» в этом файле уже звучало — в сценарии
      // про неверно услышанное название, — поэтому «лида не появилось»
      // проверяется разницей, а не нулём.
      const leadsBefore = await bypass(() => prisma.lead.count({ where: { organizationId: ORG } }))
      const created = await propose("propose_create_company", {
        name: "Fanumsec",
        city: "Bakı",
        phone: "+994501234567",
        industry: "Təhlükəsizlik",
      })
      expect(created.status).toBe(201)
      const receipt = created.body.data!
      // Выдуманное название в квитанции стоит буква в букву.
      expect(previewField(receipt, "name")).toBe("Fanumsec")
      expect(previewField(receipt, "city")).toBe("Bakı")
      expect((await pressCreate(receipt)).status).toBe(200)

      const company = await bypass(() => prisma.company.findFirstOrThrow({
        where: { organizationId: ORG, name: "Fanumsec" },
      }))
      expect(company.city).toBe("Bakı")
      expect(company.industry).toBe("Təhlükəsizlik")
      // И это компания, а не лид: ровно та разница, из-за которой действие и
      // появилось.
      expect(await bypass(() => prisma.lead.count({ where: { organizationId: ORG } })))
        .toBe(leadsBefore)

      // Вторая компания с похожим названием — предупреждение с первой
      // карточкой ДО подтверждения, а не второй дубль в базе потом.
      const similar = await propose("propose_create_company", { name: "Fanumsec MMC" })
      expect(similar.status).toBe(201)
      const warned = JSON.stringify(similar.body.data!.warnings ?? [])
      expect(warned).toContain("POSSIBLE_DUPLICATE")
      expect(warned).toContain(company.id)

      // Предупреждение не запрет: человек видит его и решает сам.
      expect((await pressCreate(similar.body.data!)).status).toBe(200)
      expect(await bypass(() => prisma.company.count({
        where: { organizationId: ORG, name: { startsWith: "Fanumsec" } },
      }))).toBe(2)
    })

    it("закрытые словари и налоговые поля голосом не задаются", async () => {
      // Статус и категория компании в базе имеют свои значения, а
      // произнесённое «клиент» — это не хранимое `category`.
      for (const args of [
        { name: "Söz lüğəti", status: "prospect" },
        { name: "Vergi nömrəsi", voen: "1234567890" },
        { name: "Kredit limiti", creditLimit: 1000 },
        { name: "Menecer", managerId: "user-colleague" },
      ]) {
        const refused = await propose("propose_create_company", args)
        expect(refused.status, JSON.stringify(args)).toBe(400)
      }
      // И ни одной компании от этих четырёх фраз.
      expect(await bypass(() => prisma.company.count({
        where: {
          organizationId: ORG,
          name: { in: ["Söz lüğəti", "Vergi nömrəsi", "Kredit limiti", "Menecer"] },
        },
      }))).toBe(0)
    })

    it("компания без названия — отказ, а не пустая карточка", async () => {
      const refused = await propose("propose_create_company", { city: "Gəncə" })
      expect(refused.status).toBe(400)
      expect(await activeReceipt()).toBeNull()
    })
  })

  /**
   * Работа ВНУТРИ задачи голосом (владелец 2026-11-08: «всё, что работник и
   * начальник делают руками в CRM — через голосового помощника»).
   *
   * В Zeytun за 60 дней руками написано больше тысячи сообщений в задачах и
   * сотни подзадач — самая частая ручная работа в CRM. Сценарии ведут одну
   * задачу так, как её ведут люди: сообщение коллеге, подзадача на человека,
   * отметка подзадачи словами, записанное время — и то, чего голос делать не
   * должен: чужая доска, выдуманная подзадача, «устаревшая» квитанция там, где
   * она устареть не может.
   */
  describe("сценарий: работа внутри задачи", () => {
    const TASK = "Anbar hesabatı"
    let taskId = ""

    beforeAll(async () => {
      const task = await bypass(() => prisma.task.create({
        data: { organizationId: ORG, title: TASK, assignedTo: "user-colleague", createdBy: USER },
      }))
      taskId = task.id
      // Лейла следит за задачей — ей и должно прийти сообщение.
      await bypass(() => prisma.taskFollower.create({
        data: { organizationId: ORG, taskId, userId: "user-colleague" },
      }))
    })

    it("сообщение в открытой задаче: автор начинает следить, подписчику уходит уведомление", async () => {
      const receipt = await propose(
        "propose_add_task_comment",
        { content: "Hesabatı cümə günü göndər" },
        { screen: { recordType: "task", recordId: taskId } },
      )
      expect(receipt.status).toBe(201)
      // Квитанция говорит, В КАКОЙ задаче, и что именно уйдёт.
      expect(receipt.body.data!.preview).toMatchObject({ target: { id: taskId, label: TASK } })
      expect(previewField(receipt.body.data!, "content")).toBe("Hesabatı cümə günü göndər")
      // До подтверждения в задаче ничего нет.
      expect(await bypass(() => prisma.taskComment.count({ where: { taskId } }))).toBe(0)

      const committed = await pressCreate(receipt.body.data!)
      expect(committed.status).toBe(200)

      const comments = await bypass(() => prisma.taskComment.findMany({ where: { taskId } }))
      expect(comments.map((comment) => [comment.userId, comment.content]))
        .toEqual([[USER, "Hesabatı cümə günü göndər"]])
      expect(await bypass(() => prisma.taskFollower.count({ where: { taskId, userId: USER } }))).toBe(1)

      // Уведомление уходит после коммита и в фоне — ждём его, а не угадываем.
      let notified = 0
      for (let attempt = 0; attempt < 40 && notified === 0; attempt += 1) {
        notified = await bypass(() => prisma.notification.count({
          where: { organizationId: ORG, userId: "user-colleague", entityType: "task", entityId: taskId },
        }))
        if (notified === 0) await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(notified).toBe(1)
      // Автору о собственном сообщении не сообщают.
      expect(await bypass(() => prisma.notification.count({
        where: { organizationId: ORG, userId: USER, entityType: "task", entityId: taskId },
      }))).toBe(0)
    })

    it("подзадача на человека по имени, со сроком; отметка словами — одна строка в ленте", async () => {
      const added = await propose("propose_add_task_checklist_item", {
        taskTitle: TASK,
        title: "Rəfləri saymaq",
        assigneeName: "Leyla",
        dueDate: "2026-11-12",
      })
      expect(added.status).toBe(201)
      expect((await pressCreate(added.body.data!)).status).toBe(200)
      const item = await bypass(() => prisma.taskChecklist.findFirstOrThrow({ where: { taskId } }))
      expect([item.title, item.assignedTo, item.completed, item.dueDate?.toISOString().slice(0, 10)])
        .toEqual(["Rəfləri saymaq", "user-colleague", false, "2026-11-12"])

      // «Отметь, что рэфляри посчитали»: подзадачу сервер находит по словам.
      const ticked = await propose("propose_set_task_checklist_item_done", { taskTitle: TASK, itemTitle: "rəfləri" })
      expect(ticked.status).toBe(201)
      // В квитанции — название подзадачи, а не её идентификатор.
      const field = ticked.body.data!.preview.fields!.find((candidate) => candidate.key === "checklistItemId") as
        { after: unknown; afterLabel?: string }
      expect([field.after, field.afterLabel]).toEqual([item.id, "Rəfləri saymaq"])
      expect(previewField(ticked.body.data!, "completed")).toBe(true)
      expect((await pressCreate(ticked.body.data!)).status).toBe(200)

      const done = await bypass(() => prisma.taskChecklist.findFirstOrThrow({ where: { id: item.id } }))
      expect(done.completed).toBe(true)
      expect(done.completedAt).not.toBeNull()
      const lines = async () => bypass(() => prisma.taskActivity.count({
        where: { taskId, action: "subtask_completed" },
      }))
      expect(await lines()).toBe(1)

      // Повторная отметка того, что уже отмечено, ленту не засоряет.
      const again = await propose("propose_set_task_checklist_item_done", { taskTitle: TASK, itemTitle: "rəfləri" })
      expect((await pressCreate(again.body.data!)).status).toBe(200)
      expect(await lines()).toBe(1)

      // Сама задача не закрыта: подзадача — не задача.
      expect((await bypass(() => prisma.task.findFirstOrThrow({ where: { id: taskId } }))).status).not.toBe("completed")
    })

    it("подзадачу, которой нет, не угадывает: спрашивает со списком тех, что есть", async () => {
      const missing = await propose("propose_set_task_checklist_item_done", { taskTitle: TASK, itemTitle: "Kassanı bağlamaq" })
      expect(missing.status).toBe(200)
      expect(missing.body.needsClarification).toBe(true)
      expect(missing.body.code).toBe("CHECKLIST_ITEM_NOT_FOUND")
      expect(missing.body.candidates).toContain("Rəfləri saymaq")
      expect(await activeReceipt()).toBeNull()
    })

    it("время: «полтора часа» записывается как 90 минут от имени говорящего", async () => {
      const receipt = await propose("propose_log_task_time", { taskTitle: TASK, minutes: 90, note: "inventar" })
      expect(receipt.status).toBe(201)
      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      const entries = await bypass(() => prisma.taskTimeEntry.findMany({ where: { taskId } }))
      expect(entries.map((entry) => [entry.userId, entry.minutes, entry.source, entry.note]))
        .toEqual([[USER, 90, "manual", "inventar"]])
    })

    it("чужая правка задачи не делает сообщение «устаревшим» — а правку самой задачи делает", async () => {
      const message = await propose("propose_add_task_comment", { taskTitle: TASK, content: "Yoxladım" })
      const change = await propose("propose_update_task", { taskTitle: TASK, priority: "high" })
      expect(change.status).toBe(201)
      // Пока квитанции висели, коллега перенёс срок.
      await bypass(() => prisma.task.update({ where: { id: taskId }, data: { dueDate: new Date("2026-11-20") } }))

      // Правка полей задачи — устарела: голос не затирает чужую правку.
      expect((await pressCreate(change.body.data!)).status).toBe(409)

      // Сообщение в ней — нет: срок задачи не делает сообщение неверным.
      const again = await propose("propose_add_task_comment", { taskTitle: TASK, content: "Yoxladım" })
      expect(again.body.data!.id).not.toBe(message.body.data!.id)
      expect((await pressCreate(again.body.data!)).status).toBe(200)
      expect(await bypass(() => prisma.taskComment.count({ where: { taskId, content: "Yoxladım" } }))).toBe(1)
    })

    it("задачи чужой доски для голоса нет — как и для экрана", async () => {
      await bypass(async () => {
        await prisma.division.create({ data: { id: "division-closed", organizationId: ORG, key: "FN", name: "Maliyyə" } })
        await prisma.task.create({
          data: { id: "task-closed", organizationId: ORG, title: "Büdcə planı", divisionId: "division-closed" },
        })
      })
      // Менеджер: правила видимости записей показывают ему все задачи
      // организации, и отсечь эту может только правило доски (openTaskFor).
      auth.userId = "user-colleague"
      ;(auth as { role: string }).role = "manager"
      try {
        const managerSession = await bypass(() => prisma.voiceSession.create({
          data: {
            organizationId: ORG,
            userId: "user-colleague",
            status: "active",
            reservedSeconds: 600,
            expiresAt: new Date(Date.now() + 600_000),
          },
        }))
        const refused = await propose(
          "propose_add_task_comment",
          { content: "Baxdım" },
          { voiceSessionId: managerSession.id, screen: { recordType: "task", recordId: "task-closed" } },
        )
        expect(refused.status).toBe(404)
        expect(await bypass(() => prisma.taskComment.count({ where: { taskId: "task-closed" } }))).toBe(0)
        expect(await bypass(() => prisma.aiActionIntent.count({ where: { voiceSessionId: managerSession.id } }))).toBe(0)
      } finally {
        auth.userId = USER
        ;(auth as { role: string }).role = "admin"
      }
    })

    it("всё, что сказано про задачу, видно на её экране — те же записи, что от кнопок", async () => {
      // Экран читает сообщения, подзадачи и время своими маршрутами; голосовые
      // записи обязаны быть среди них, а не в каком-то своём месте.
      const comments = await import("@/app/api/v1/tasks/[id]/comments/route")
      const checklist = await import("@/app/api/v1/tasks/[id]/checklist/route")
      const time = await import("@/app/api/v1/tasks/[id]/time/route")
      const params = { params: Promise.resolve({ id: taskId }) }
      const messages = await (await comments.GET(get(`/api/v1/tasks/${taskId}/comments`), params)).json() as
        { data: { content: string }[] }
      const items = await (await checklist.GET(get(`/api/v1/tasks/${taskId}/checklist`), params)).json() as
        { data: { title: string; completed: boolean }[] }
      const spent = await (await time.GET(get(`/api/v1/tasks/${taskId}/time`), params)).json() as
        { data: { totalMinutes: number } }
      expect(messages.data.map((message) => message.content)).toEqual(expect.arrayContaining(["Hesabatı cümə günü göndər", "Yoxladım"]))
      expect(items.data.map((item) => [item.title, item.completed])).toEqual([["Rəfləri saymaq", true]])
      expect(spent.data.totalMinutes).toBe(90)
    })
  })

  /**
   * Начальник в «Маршрутах и поле» голосом (этап 2, владелец 2026-11-08):
   * полевая задача агенту, сообщение агенту, решение по заявке сотрудника.
   *
   * Здесь всё настоящее, кроме микрофона: возможности тенанта читаются из
   * строки организации, решение по заявке идёт через ту же функцию, что кнопки
   * экрана «Решения» (блокировки, журнал, колокольчик сотрудника).
   */
  describe("сценарий: начальник в поле", () => {
    const ELVIRA = "field-elvira"
    const LEAVE = "11111111-1111-4111-8111-111111111111"
    const LATE = "22222222-2222-4222-8222-222222222222"

    function leaveDetails(kind: string) {
      return {
        version: 1,
        kind,
        unit: "DAYS",
        startTime: null,
        endTime: null,
        timezone: "Asia/Baku",
        dayKind: {
          key: "ANNUAL_LEAVE", code: "M", color: "#22c55e", group: "PAID_LEAVE", paid: true,
          unit: "DAYS", countsAsWorked: false, archived: false,
          names: { az: "Məzuniyyət", ru: "Отпуск", en: "Annual leave" },
        },
        attachmentIds: [],
        submissionHash: "a".repeat(64),
      }
    }

    beforeAll(async () => {
      await bypass(async () => {
        // «Маршруты и поле» и «Персонал» включаются возможностями тенанта —
        // их читает настоящая проверка, а не мок модулей.
        await prisma.organization.update({
          where: { id: ORG },
          data: { features: ["route-field", "personnel"], modules: { mtm: true } },
        })
        await prisma.mtmSetting.create({ data: { organizationId: ORG, key: "attendanceEnabled", value: true } })
        await prisma.mtmAgent.createMany({
          data: [
            { id: ELVIRA, organizationId: ORG, name: "Elvira Hasanova", role: "AGENT", status: "ACTIVE" },
            { id: "field-aytan-1", organizationId: ORG, name: "Aytan Mushkurova", role: "AGENT", status: "ACTIVE" },
            { id: "field-aytan-2", organizationId: ORG, name: "Aytan Quliyeva", role: "AGENT", status: "ACTIVE" },
          ],
        })
        await prisma.mtmHrmRequest.create({
          data: {
            id: LEAVE, organizationId: ORG, agentId: ELVIRA, clientRequestId: "33333333-3333-4333-8333-333333333333",
            type: "LEAVE", startDate: new Date("2026-11-20"), endDate: new Date("2026-11-21"),
            reason: "Ailə işi", attendanceDetails: leaveDetails("ANNUAL_LEAVE"), submittedAt: new Date(),
          },
        })
        await prisma.mtmHrmRequest.create({
          data: {
            id: LATE, organizationId: ORG, agentId: "field-aytan-1", clientRequestId: "44444444-4444-4444-8444-444444444444",
            type: "LEAVE", startDate: new Date("2026-11-25"), endDate: new Date("2026-11-25"),
            reason: "Həkim", attendanceDetails: leaveDetails("TIME_OFF"), submittedAt: new Date(),
          },
        })
      })
    })

    async function waitFor(count: () => Promise<number>): Promise<number> {
      let seen = 0
      for (let attempt = 0; attempt < 40 && seen === 0; attempt += 1) {
        seen = await count()
        if (seen === 0) await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return seen
    }

    it("«дай Эльвире задачу на завтра»: задача агенту со сроком 18:00, и агент узнаёт о ней", async () => {
      const receipt = await propose("propose_give_field_task", {
        agentName: "Elvira", title: "Aptek 92-yə baş çək", due: "tomorrow",
      })
      expect(receipt.status).toBe(201)
      // Агент — именем, а не идентификатором.
      const agentField = receipt.body.data!.preview.fields!.find((field) => field.key === "agentId") as
        { after: unknown; afterLabel?: string }
      expect([agentField.after, agentField.afterLabel]).toEqual([ELVIRA, "Elvira Hasanova"])
      // «Завтра» — это 18:00 завтрашнего дня по часам компании (task-quick-due.ts).
      const due = new Date(String(previewField(receipt.body.data!, "dueDate")))
      expect(due.toLocaleTimeString("en-GB", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit" })).toBe("18:00")
      expect(await bypass(() => prisma.mtmTask.count({ where: { organizationId: ORG } }))).toBe(0)

      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      const task = await bypass(() => prisma.mtmTask.findFirstOrThrow({
        where: { organizationId: ORG }, include: { events: true },
      }))
      expect([task.agentId, task.title, task.status, task.dueDate?.toISOString()])
        .toEqual([ELVIRA, "Aptek 92-yə baş çək", "PENDING", due.toISOString()])
      expect(task.events.map((event) => [event.type, (event.evidence as { channel?: string }).channel]))
        .toEqual([["CREATED", "voice"]])
      expect(await bypass(() => prisma.mtmAuditLog.count({
        where: { organizationId: ORG, action: "TASK_CREATE", entityId: task.id, actorUserId: USER },
      }))).toBe(1)
      // Колокольчик агента — после коммита, в фоне.
      expect(await waitFor(() => bypass(() => prisma.mtmNotification.count({
        where: { organizationId: ORG, agentId: ELVIRA },
      })))).toBeGreaterThan(0)
    })

    it("две Айтан — вопрос с обеими, а не первая попавшаяся", async () => {
      const asked = await propose("propose_give_field_task", { agentName: "Aytan", title: "Hesabat", due: "today" })
      expect(asked.status).toBe(200)
      expect(asked.body.code).toBe("FIELD_AGENT_AMBIGUOUS")
      expect([...(asked.body.candidates ?? [])].sort()).toEqual(["Aytan Mushkurova", "Aytan Quliyeva"])
      expect(await activeReceipt()).toBeNull()
    })

    it("сообщение агенту уходит в его личную переписку от имени начальника", async () => {
      const receipt = await propose("propose_send_field_message", { agentName: "Elvira", message: "Sabah 9-da ofisdə ol" })
      expect(receipt.status).toBe(201)
      expect(previewField(receipt.body.data!, "body")).toBe("Sabah 9-da ofisdə ol")
      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      const messages = await bypass(() => prisma.mtmMessage.findMany({
        where: { organizationId: ORG }, include: { thread: true },
      }))
      expect(messages.map((message) => [message.body, message.senderUserId, message.senderName, message.thread.type]))
        .toEqual([["Sabah 9-da ofisdə ol", USER, "Owner", "DIRECT"]])
      expect(await bypass(() => prisma.mtmAuditLog.count({
        where: { organizationId: ORG, action: "MESSAGE_DIRECT_SEND" },
      }))).toBe(1)
    })

    it("отказ без причины не готовится; одобрение идёт через «Решения» — с колокольчиком сотрудника", async () => {
      const noReason = await propose("propose_decide_attendance_request", { agentName: "Elvira", decision: "reject" })
      expect(noReason.status).toBe(400)
      expect(await activeReceipt()).toBeNull()

      const receipt = await propose("propose_decide_attendance_request", { agentName: "Elvira", decision: "approve" })
      expect(receipt.status).toBe(201)
      const requestField = receipt.body.data!.preview.fields!.find((field) => field.key === "attendanceRequestId") as
        { after: unknown; afterLabel?: string }
      expect([requestField.after, requestField.afterLabel])
        .toEqual([LEAVE, "Elvira Hasanova · ANNUAL_LEAVE · 2026-11-20 – 2026-11-21"])
      expect(previewField(receipt.body.data!, "decision")).toBe("APPROVED")

      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      const decided = await bypass(() => prisma.mtmHrmRequest.findUniqueOrThrow({ where: { id: LEAVE } }))
      expect([decided.status, decided.decidedByUserId]).toEqual(["APPROVED", USER])
      expect(await bypass(() => prisma.mtmAuditLog.count({
        where: { organizationId: ORG, action: "MTM_ATTENDANCE_REQUEST_DECIDED", entityId: LEAVE },
      }))).toBe(1)
      expect(await bypass(() => prisma.mtmNotification.count({
        where: { organizationId: ORG, agentId: ELVIRA, metadata: { path: ["attendanceRequestId"], equals: LEAVE } },
      }))).toBe(1)
    })

    it("заявку изменили, пока висела квитанция, — решение не уходит вслепую", async () => {
      const receipt = await propose("propose_decide_attendance_request", {
        agentName: "Mushkurova", decision: "reject", reason: "Həmin gün audit var",
      })
      expect(receipt.status).toBe(201)
      await bypass(() => prisma.mtmHrmRequest.update({ where: { id: LATE }, data: { reason: "Həkim, arayış var" } }))

      expect((await pressCreate(receipt.body.data!)).status).toBe(409)
      expect((await bypass(() => prisma.mtmHrmRequest.findUniqueOrThrow({ where: { id: LATE } }))).status).toBe("PENDING")
    })

    it("пользователь CRM без карточки начальника в поле — отказ словами, и ничего не создано", async () => {
      auth.userId = "user-colleague"
      ;(auth as { role: string }).role = "manager"
      try {
        const colleagueSession = await bypass(() => prisma.voiceSession.create({
          data: {
            organizationId: ORG, userId: "user-colleague", status: "active",
            reservedSeconds: 600, expiresAt: new Date(Date.now() + 600_000),
          },
        }))
        const refused = await propose(
          "propose_give_field_task",
          { agentName: "Elvira", title: "Başqa iş", due: "today" },
          { voiceSessionId: colleagueSession.id },
        )
        expect(refused.status).toBe(400)
        expect(await bypass(() => prisma.mtmTask.count({ where: { organizationId: ORG, title: "Başqa iş" } }))).toBe(0)
      } finally {
        auth.userId = USER
        ;(auth as { role: string }).role = "admin"
      }
    })
  })

  /**
   * Этап 2б (владелец 2026-11-08: «Сначала 2б»): опубликовать маршрут дня и
   * привязать клиента поля к сотруднику — голосом, через те же функции, что
   * кнопки экрана (route-publish.ts, contact-bulk-assignment-execute.ts).
   * Сотрудники и возможности тенанта — из сценария «начальник в поле» выше.
   */
  describe("сценарий: маршрут и клиенты поля", () => {
    const ELVIRA = "field-elvira"
    const ROUTE = "field-route-1"
    const DOCTOR = "field-contact-aliyev"
    const PHARMACIST = "field-contact-mammadova"

    function bakuDay(offsetDays: number): string {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baku" })
      return new Date(Date.parse(`${today}T12:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10)
    }

    beforeAll(async () => {
      await bypass(async () => {
        await prisma.mtmCustomer.create({ data: { id: "field-customer-1", organizationId: ORG, name: "Aptek 92" } })
        await prisma.mtmRoute.create({
          data: {
            id: ROUTE, organizationId: ORG, agentId: ELVIRA, date: new Date(`${bakuDay(1)}T00:00:00.000Z`),
            name: "Yasamal", status: "DRAFT", version: 1,
          },
        })
        await prisma.mtmRoutePoint.create({
          data: { organizationId: ORG, routeId: ROUTE, customerId: "field-customer-1", orderIndex: 0 },
        })
        await prisma.mtmContact.createMany({
          data: [
            { id: DOCTOR, organizationId: ORG, firstName: "Rashad", lastName: "Aliyev", displayName: "Aliyev Rashad" },
            { id: PHARMACIST, organizationId: ORG, firstName: "Leyla", lastName: "Mammadova", displayName: "Mammadova Leyla" },
          ],
        })
      })
    })

    it("«опубликуй маршрут Эльвиры на завтра»: PLANNED, уведомление агенту, журнал", async () => {
      const receipt = await propose("propose_publish_field_route", { agentName: "Elvira", day: "tomorrow" })
      expect(receipt.status).toBe(201)
      const routeField = receipt.body.data!.preview.fields!.find((field) => field.key === "routeId") as
        { after: unknown; afterLabel?: string }
      expect([routeField.after, routeField.afterLabel]).toEqual([ROUTE, `Elvira Hasanova · Yasamal · ${bakuDay(1)}`])
      // Версия — служебная: в квитанции её нет.
      expect(receipt.body.data!.preview.fields!.map((field) => field.key)).not.toContain("expectedVersion")

      expect((await pressCreate(receipt.body.data!)).status).toBe(200)
      const route = await bypass(() => prisma.mtmRoute.findUniqueOrThrow({ where: { id: ROUTE } }))
      expect([route.status, route.version, route.publishedVersion, route.publishedBy]).toEqual(["PLANNED", 2, 2, USER])
      expect(await bypass(() => prisma.mtmRouteNotificationOutbox.count({
        where: { organizationId: ORG, agentId: ELVIRA },
      }))).toBe(1)
      expect(await bypass(() => prisma.mtmAuditLog.count({
        where: { organizationId: ORG, action: "ROUTE_PUBLISH", entityId: ROUTE, actorUserId: USER },
      }))).toBe(1)

      // Опубликованный второй раз не публикуется: помощник слышит, что он уже такой.
      const again = await propose("propose_publish_field_route", { agentName: "Elvira", day: "tomorrow" })
      expect(again.body.code).toBe("FIELD_ROUTE_NOT_FOUND")
      expect(again.body.candidates).toEqual(["Yasamal (PLANNED)"])
    })

    it("привязать клиента: первый — главный, следующий — дополнительный, повтор — отказ словами", async () => {
      const first = await propose("propose_assign_field_contact", { clientName: "doktor Aliyev", agentName: "Elvira" })
      expect(first.status).toBe(201)
      const contactField = first.body.data!.preview.fields!.find((field) => field.key === "fieldContactId") as
        { after: unknown; afterLabel?: string }
      expect([contactField.after, contactField.afterLabel]).toEqual([DOCTOR, "Aliyev Rashad"])
      expect(first.body.data!.preview.fields!.map((field) => field.key)).not.toContain("previewToken")
      expect((await pressCreate(first.body.data!)).status).toBe(200)

      const second = await propose("propose_assign_field_contact", { clientName: "Aliyev", agentName: "Quliyeva" })
      expect(second.status).toBe(201)
      expect((await pressCreate(second.body.data!)).status).toBe(200)

      const assignments = await bypass(() => prisma.mtmContactAgentAssignment.findMany({
        where: { organizationId: ORG, contactId: DOCTOR }, orderBy: { createdAt: "asc" },
      }))
      expect(assignments.map((row) => [row.agentId, row.role, row.source, row.assignedBy]))
        .toEqual([[ELVIRA, "PRIMARY", "BULK_ASSIGNMENT", USER], ["field-aytan-2", "SECONDARY", "BULK_ASSIGNMENT", USER]])
      expect(await bypass(() => prisma.mtmAuditLog.count({
        where: { organizationId: ORG, action: "CONTACT_BULK_ASSIGN" },
      }))).toBe(2)

      // К начальнику клиента не привязывают: его просто нет среди кандидатов.
      await bypass(() => prisma.mtmAgent.create({
        data: { id: "field-manager-kamran", organizationId: ORG, name: "Kamran Rzayev", role: "MANAGER", status: "ACTIVE" },
      }))
      const toManager = await propose("propose_assign_field_contact", { clientName: "Aliyev", agentName: "Kamran" })
      expect(toManager.status).toBe(200)
      expect(toManager.body.code).toBe("FIELD_AGENT_NOT_FOUND")
      // А задачу ему дать можно — там роль не сужается.
      expect((await propose("propose_give_field_task", { agentName: "Kamran", title: "Yoxla", due: "none" })).status).toBe(201)
      await pressClose((await activeReceipt())!)

      // Эльвира у этого клиента уже есть — отказ до квитанции, с причиной.
      const repeat = await propose("propose_assign_field_contact", { clientName: "Aliyev", agentName: "Elvira" })
      expect(repeat.status).toBe(400)
      expect(JSON.stringify(repeat.body)).toContain("TARGET_ALREADY_ASSIGNED")
    })

    it("у клиента всё изменилось после квитанции — привязка не проходит вслепую", async () => {
      const receipt = await propose("propose_assign_field_contact", { clientName: "Mammadova", agentName: "Mushkurova" })
      expect(receipt.status).toBe(201)
      // Пока квитанция висела, клиента отдали Эльвире главной: Мушкурова стала
      // бы уже не главной, а дополнительной — не то, что человек видел.
      await bypass(() => prisma.mtmContactAgentAssignment.create({
        data: {
          organizationId: ORG, contactId: PHARMACIST, agentId: ELVIRA, role: "PRIMARY",
          effectiveFrom: new Date(`${bakuDay(0)}T00:00:00.000Z`), source: "MANUAL",
        },
      }))
      expect((await pressCreate(receipt.body.data!)).status).toBe(409)
      expect(await bypass(() => prisma.mtmContactAgentAssignment.count({
        where: { organizationId: ORG, contactId: PHARMACIST, agentId: "field-aytan-1" },
      }))).toBe(0)
    })
  })
})
