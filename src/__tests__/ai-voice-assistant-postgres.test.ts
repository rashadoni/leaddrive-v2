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

const ORG = "org-voice-lifecycle"
const USER = "user-voice-lifecycle"

const auth = vi.hoisted(() => ({
  orgId: "org-voice-lifecycle",
  userId: "user-voice-lifecycle",
  role: "admin",
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
  getOrgModuleContext: vi.fn(async () => ({
    plan: "enterprise",
    addons: [] as string[],
    modules: { ai: true, crm: true, sales: true, deals: true, leads: true } as Record<string, boolean>,
  })),
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
      const before = await bypass(async () => ({
        deals: await prisma.deal.count({ where: { organizationId: ORG } }),
        leads: await prisma.lead.count({ where: { organizationId: ORG } }),
        tasks: await prisma.task.count({ where: { organizationId: ORG } }),
        contacts: await prisma.contact.count({ where: { organizationId: ORG } }),
        intents: await prisma.aiActionIntent.count({ where: { organizationId: ORG } }),
      }))

      const answered: string[] = []
      const refused: Record<string, number> = {}
      for (const tool of VOICE_TOOL_NAMES) {
        // Двум инструментам нужна цель; остальные отвечают про всё.
        const filter = tool === "read_record"
          ? { type: "deal", id: (await bypass(() => prisma.deal.findFirstOrThrow({
              where: { organizationId: ORG },
              select: { id: true },
            }))).id }
          : tool === "find_record"
            ? { type: "deal", query: "Azmart" }
            : tool === "describe_section" || tool === "explain_section"
              ? { section: "deals" }
              : {}
        const result = await ask(tool, filter)
        if (result.status === 200) answered.push(tool)
        else refused[tool] = result.status
      }

      // Каждый инструмент из реестра отвечает — реестр и реализация не
      // расходятся. Раньше это ловилось только там, где кто-то вручную
      // перечислил инструменты.
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
})
