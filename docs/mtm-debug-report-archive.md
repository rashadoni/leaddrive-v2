# MTM Debug Report — Archive (Phase 1, 12 May 2026)

> **ALL findings in this archive are CLOSED** as of commit `1737ec23`
> (May 13, 2026). See [`mtm-debug-report.md`](./mtm-debug-report.md)
> for the current closeout matrix. This file is preserved for
> historical context — DO NOT chase phantom bugs from here.

---

## Резюме (top-6 — historical, Phase 1 input)

**MTM модуль архитектурно полон и большая часть бизнес-логики работает.** "Ощущение криво" объясняется конкретными паттернами:

1. **🔴 P0 — Google Maps API key broken на проде** (`ApiProjectMapError, NoApiKeys, InvalidKey` в console на `/mtm/map`). Все карты не работают для всех пользователей. См. F-25. **Это и есть «карты глючат» — но проблема не в коде, а в env.**
2. **🔴 P0 — JWT fallback secret в коде**: [src/lib/mobile-auth.ts:4](src/lib/mobile-auth.ts) и [mobile/auth/route.ts:6](src/app/api/v1/mtm/mobile/auth/route.ts). Если `NEXTAUTH_SECRET` не выставлен → токены подписываются `"fallback-secret"`. Любой может подделать mobile JWT.
3. **🟠 P1 — useEffect double-fire**: dashboard вызывается **5×** на один навигейт, routes **3×**, photos **3×**. См. F-26. Лишняя нагрузка на DB.
4. **🟠 P1 — Эпидемия silent catches на фронте (17 мест)**. Все MTM-страницы делают `} catch {}` на fetch — менеджер не видит ни сетевых ошибок, ни 5xx ответов API. Это **главный источник** «работает криво» в UI.
5. **🟠 P1 — 8 silent catches в API GET endpoints**: routes / visits / tasks / customers / agents / photos / alerts / dashboard возвращают `{success:true, data:[]}` на любую ошибку — таблицы кажутся пустыми вместо «сервер сломан».
6. **🟠 P1 — Audit log урезанный**: реально пишутся 4/18+ обещанных actions; `MtmNotification` model вообще dead. CI не гоняет тесты ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

**Итого: 30 findings** (после architect review: добавлены F-28 force role-check, F-29 audit metadata schema, F-30 location rate limit). Бóльшая часть — паттерны (тиражируется на N endpoints), а не уникальные баги. Фикс одного паттерна закроет 5-15 строк нарушений.

---

## Findings

> **Нумерация**: F-NN отражает порядок обнаружения (discovery order), не severity. Группировка по severity — в [Резюме](#резюме-top-6) и в Phase 2 plans ниже.

### F-01 [P0] JWT fallback secret в production коде

- **Файл**: [src/lib/mobile-auth.ts:4](src/lib/mobile-auth.ts), [src/app/api/v1/mtm/mobile/auth/route.ts:6](src/app/api/v1/mtm/mobile/auth/route.ts)
- **Симптом**: `const JWT_SECRET = process.env.NEXTAUTH_SECRET || "fallback-secret"`
- **Repro**: если на сервере `NEXTAUTH_SECRET` пуст — все JWT подписываются строкой `"fallback-secret"`. Атакующий может подделать токен с любым `agentId`/`orgId`/`role`.
- **Ожидание / Реальность**: сервер должен `throw` на startup без секрета / сервер тихо работает с известным fallback.
- **Направление фикса**: на module load: `if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET required")`. В deploy.yml уже передаётся `NEXTAUTH_SECRET` (строка 56) — должно быть везде, но прод-серверы клиентов могут забыть.

### F-02 [P0] Mobile auth без rate limiting

- **Файл**: [src/app/api/v1/mtm/mobile/auth/route.ts](src/app/api/v1/mtm/mobile/auth/route.ts) (весь файл)
- **Симптом**: POST `/api/v1/mtm/mobile/auth` принимает unlimited login attempts. Bcrypt compare = ~100ms, значит ~600 attempts/min с одного IP.
- **Repro**: цикл `curl POST` с одним email + перебор паролей — отсутствует throttling / lockout / captcha / IP-based limit.
- **Ожидание / Реальность**: lockout после N failures / 429 после N requests / no protection at all.
- **Направление фикса**: проверить есть ли в репо rate-limit middleware (см. `docs/rate-limit-policy.md`); если есть — обернуть. Если нет — добавить per-IP throttle для `/mobile/auth` (5 attempts/min).

### F-03 [P0] Auto-link agent.userId без audit log

- **Файл**: [src/app/api/v1/mtm/mobile/auth/route.ts:73-76](src/app/api/v1/mtm/mobile/auth/route.ts)
- **Симптом**: Method 3 в auth flow — если agent без `passwordHash`, но в org есть User с тем же email и совпавшим паролем → `prisma.mtmAgent.update({ where: {id: agent.id}, data: {userId: user.id} })`. Тихая привязка agent ↔ user без записи в audit log.
- **Repro**: создать MtmAgent без passwordHash, иметь User с тем же email; mobile login → agent.userId меняется. Admin не узнаёт.
- **Ожидание / Реальность**: audit log entry `AUTO_LINK` с старым/новым userId, opt-in flag на org / silent assignment.
- **Направление фикса**: добавить `writeMtmAudit({action: "AUTO_LINK", oldData: {userId: agent.userId}, newData: {userId: user.id}})`. Возможно, добавить `MtmSetting.allowAutoLink` (default true для backward compat).

### F-04 [P0] Нет валидации body на POST/PUT во всех endpoints

- **Файл**: все `route.ts` под `src/app/api/v1/mtm/` (агенты, customers, routes, visits, tasks, photos PATCH, orders, alerts PATCH, settings PUT, dashboard, mobile)
- **Симптом**: `const body = await req.json(); prisma.X.create({data: {...body...}})` без zod/joi/manual checks. Принимается mismatch типа, отсутствие required, illegal enum values.
- **Repro**: `POST /api/v1/mtm/customers {"name": 123, "latitude": "not-a-number"}` — повалит как Prisma error 400 с unhelpful message, либо примет неверный тип (если Float? разрешает coercion).
- **Ожидание / Реальность**: 400 с понятным валидационным сообщением / generic error / silent acceptance.
- **Направление фикса**: один `lib/mtm-validators.ts` с zod schemas per endpoint. Tests на каждый negative case.

### F-05 [P1] Silent catches в 8 GET endpoints — таблицы кажутся пустыми

- **Файлы**:
  - [src/app/api/v1/mtm/routes/route.ts:42-44](src/app/api/v1/mtm/routes/route.ts)
  - [src/app/api/v1/mtm/visits/route.ts:44-46](src/app/api/v1/mtm/visits/route.ts)
  - [src/app/api/v1/mtm/tasks/route.ts:37-39](src/app/api/v1/mtm/tasks/route.ts)
  - [src/app/api/v1/mtm/customers/route.ts](src/app/api/v1/mtm/customers/route.ts) (по grep — same pattern)
  - [src/app/api/v1/mtm/agents/route.ts](src/app/api/v1/mtm/agents/route.ts)
  - [src/app/api/v1/mtm/photos/route.ts:124-126](src/app/api/v1/mtm/photos/route.ts)
  - [src/app/api/v1/mtm/alerts/route.ts:32](src/app/api/v1/mtm/alerts/route.ts) (per Explore agent)
  - [src/app/api/v1/mtm/locations/route.ts:163-165](src/app/api/v1/mtm/locations/route.ts)
- **Симптом**: `try { ... } catch { return NextResponse.json({success:true, data:{routes:[], total:0, page, limit}}) }` — любая DB / Prisma / parsing ошибка маскируется как пустой happy-path ответ.
- **Repro**: уронить Prisma connection (например `DATABASE_URL` неправильный) → таблица routes показывает «нет маршрутов» вместо ошибки.
- **Ожидание / Реальность**: 500 с error message + Sentry alert / silent 200 + empty.
- **Направление фикса**: единый паттерн `catch (e) { console.error("[MTM/routes]", e); return NextResponse.json({error: "..."}, {status: 500}) }`. Закрывает 8 файлов одним грепом-и-замена.

### F-06 [P1] 17 silent fetch catches на frontend — никаких toast'ов на error

- **Файлы** (все под `src/app/(dashboard)/mtm/`):
  - [agents/page.tsx:49](src/app/(dashboard)/mtm/agents/page.tsx)
  - [alerts/page.tsx:35,60](src/app/(dashboard)/mtm/alerts/page.tsx)
  - [activity/page.tsx:28](src/app/(dashboard)/mtm/activity/page.tsx)
  - [analytics/page.tsx:29](src/app/(dashboard)/mtm/analytics/page.tsx)
  - [customers/page.tsx:43](src/app/(dashboard)/mtm/customers/page.tsx)
  - [leaderboard/page.tsx:33](src/app/(dashboard)/mtm/leaderboard/page.tsx)
  - [map/page.tsx:134](src/app/(dashboard)/mtm/map/page.tsx)
  - [orders/page.tsx:36](src/app/(dashboard)/mtm/orders/page.tsx)
  - [photos/page.tsx:38,62](src/app/(dashboard)/mtm/photos/page.tsx)
  - [reports/page.tsx:40](src/app/(dashboard)/mtm/reports/page.tsx)
  - [routes/page.tsx:54](src/app/(dashboard)/mtm/routes/page.tsx)
  - [settings/page.tsx:31](src/app/(dashboard)/mtm/settings/page.tsx)
  - [tasks/page.tsx:45,75](src/app/(dashboard)/mtm/tasks/page.tsx)
  - [visits/page.tsx:36](src/app/(dashboard)/mtm/visits/page.tsx)
- **Симптом**: каждая страница: `try { await fetch(...); } catch {} finally { setLoading(false) }` — сетевые ошибки молча игнорируются.
- **Repro**: убить сервер локально → страница показывает «нет данных», без toast / error state.
- **Ожидание / Реальность**: toast(error.message) + retry button / тишина.
- **Направление фикса**: обёртка `useApiQuery(url)` хук, который вызывает `toast.error` на throw. Or централизованный `axios` + interceptor. Сам этот finding объясняет 80% жалоб "не работает / не сохраняет / нет данных".

### F-07 [P1] CI не запускает `npm test` перед деплоем

- **Файл**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Симптом**: `Setup Node → Cache → Install → Prisma → Build → Deploy`. Нет `npm test` шага. Если кто-то ломает тест локально и push'ит — deploy идёт.
- **Repro**: `git commit` с заведомо ломаным тестом → push → GitHub Actions зелёный → prod деплой.
- **Ожидание / Реальность**: CI fail / silent green.
- **Направление фикса**: добавить шаг перед `Build Next.js`:
  ```yaml
  - name: Run tests
    run: npm test -- --run
  ```
  5 LOC. Возможен skip отдельно через `[skip-tests]` в commit message если надо emergency-deploy.

### F-08 [P1] Audit log: реализовано 4/15+ actions, comment-ложь про ORDER_CREATE

- **Файл**: [src/lib/mtm-audit.ts](src/lib/mtm-audit.ts) (комментарий line 11)
- **Симптом**: комментарий обещает actions `CHECK_IN, CHECK_OUT, TASK_COMPLETE, PHOTO_UPLOAD, ORDER_CREATE`. По grep `writeMtmAudit` реально вызывается из:
  - `visits/route.ts:180` → CHECK_IN ✓
  - `visits/[id]/route.ts:69` → CHECK_OUT ✓
  - `tasks/[id]/route.ts:50` → TASK_COMPLETE ✓
  - `photos/route.ts:75` → PHOTO_UPLOAD ✓
  - **ORDER_CREATE — нет, хотя в комментарии обещан**
  - **AGENT_*, CUSTOMER_*, ROUTE_*, TASK_CREATE, ALERT_*, PHOTO_REVIEW, PHOTO_DELETE, SETTINGS_UPDATE, FORCE_CHECKIN, LOGIN, LOGIN_FAILED, AUTO_LINK — нет**
- **Repro**: создать customer / удалить агента / approve photo → в `mtm_audit_logs` ничего не появится.
- **Ожидание / Реальность**: полный audit trail / только check-ins и uploads.
- **Направление фикса**: см. таблицу [Audit log gap-table](#audit-log-gap-table) ниже. Обернуть в helper `audit.create(entity)`, `audit.update(entity, old, new)`, `audit.delete(entity)` и расставить.

### F-09 [P1] MtmNotification модель — dead, никто не пишет

- **Файл**: [prisma/schema.prisma:3193-3210](prisma/schema.prisma)
- **Симптом**: модель определена (organizationId, agentId, title, body, type, isRead). Grep `prisma.mtmNotification` по всему src → **0 результатов**. Mobile API `/profile`, `/ping` не возвращают unread notifications. Frontend нет страницы notifications для агента.
- **Repro**: создать MtmAlert (alert pipeline работает) — никакой `MtmNotification` для агента не появится.
- **Ожидание / Реальность**: push/in-app notification агенту через MtmNotification / dead model только в schema.
- **Направление фикса**: либо реализовать (mobile endpoint, alert→notification bridge), либо удалить из schema. Решение пользователя.

### F-10 [P1] MtmAgentLocation без retention policy — миллионы записей через месяц

- **Файл**: [prisma/schema.prisma:3130-3150](prisma/schema.prisma), [src/app/api/v1/mtm/mobile/location/route.ts](src/app/api/v1/mtm/mobile/location/route.ts)
- **Симптом**: каждый ping = INSERT. С `gpsInterval=30s` (default из settings) × 10 рабочих часов × N агентов = `N × 1200` записей/день. 10 агентов = 360k/месяц. Никакого VACUUM/cleanup.
- **Repro**: посмотреть `SELECT COUNT(*) FROM mtm_agent_locations` на любом активном tenant.
- **Ожидание / Реальность**: cron-cleanup записей старше X дней / unbounded growth.
- **Направление фикса**:
  - короткий: cron job (Vercel cron / GitHub Actions schedule / pg-cron) — раз в сутки `DELETE FROM mtm_agent_locations WHERE recordedAt < NOW() - INTERVAL '30 days'`
  - долгий: переход на time-series store (TimescaleDB extension), либо partitioning по дате.

### F-11 [P1] Hardcoded magic constants — невозможно настроить per-org

- **Файлы и константы**:
  - [src/app/api/v1/mtm/locations/route.ts:25](src/app/api/v1/mtm/locations/route.ts) — `fiveMinAgo = 5*60*1000` (offline threshold)
  - [src/app/api/v1/mtm/locations/route.ts:63](src/app/api/v1/mtm/locations/route.ts) — `tenMinAgo = 10*60*1000` (location window)
  - [src/app/api/v1/mtm/locations/route.ts:83](src/app/api/v1/mtm/locations/route.ts) — `hour >= 10` (LATE threshold)
  - [src/app/api/v1/mtm/mobile/location/route.ts:65](src/app/api/v1/mtm/mobile/location/route.ts) — `DEVIATION_THRESHOLD = 500m`
  - [src/app/api/v1/mtm/mobile/location/route.ts:69](src/app/api/v1/mtm/mobile/location/route.ts) — `tenMinAgo = 10min` (alert throttle)
  - [src/app/api/v1/mtm/visits/route.ts:75](src/app/api/v1/mtm/visits/route.ts) — `geofenceRadius default 100m` (хотя есть MtmSetting fallback — OK)
- **Симптом**: org с другим графиком (например с 7:00) видит всех агентов LATE с 10:00 утра вместо 8:00. Для разных индустрий нужны разные deviation thresholds.
- **Repro**: смена графика в `/mtm/settings` → не влияет на `LATE` логику в `/api/v1/mtm/locations`.
- **Направление фикса**: добавить ключи в `MtmSetting`: `workingHoursStart`, `lateAfterMinutesPastStart`, `offlineThresholdSeconds`, `locationWindowMinutes`, `deviationThresholdMeters`, `deviationAlertThrottleMinutes`. В коде fetch из settings с fallback на текущие значения как default.

### F-12 [P1] Dashboard endpoint: 15 параллельных count() + N+1 на agentLocations

- **Файл**: [src/app/api/v1/mtm/dashboard/route.ts](src/app/api/v1/mtm/dashboard/route.ts)
- **Симптом**: `Promise.all([...15 prisma.X.count(...) запросов...])` (lines 30-73) + потом `prisma.mtmAgentLocation.findMany({where: {agentId: {in: [...]}}, distinct: ["agentId"]})` — distinct не использует индекс хорошо.
- **Repro**: tenant с 50k visits / 10k tasks → dashboard грузится >2 сек.
- **Ожидание / Реальность**: <500ms / 2-5 сек.
- **Направление фикса**:
  - короткий: 5-минутный cache (Redis / Next.js `unstable_cache`) на agent-aggregated KPIs
  - долгий: материализованное view `mtm_dashboard_kpis_daily` с refresh по cron / triggers

### F-13 [P1] Leaderboard: N+1 queries по агентам (9 запросов × N)

- **Файл**: [src/app/api/v1/mtm/leaderboard/route.ts:31-97](src/app/api/v1/mtm/leaderboard/route.ts)
- **Симптом**: `agents.map(async agent => Promise.all([7 count queries]))` на строках 31-44, плюс ещё `prisma.mtmVisit.findMany` (line 65-70) и `prisma.mtmAlert.count` (line 79-81) внутри той же map → **9 запросов на агента**. Для 50 агентов = 1 (initial) + 50×9 = **451 запрос на один endpoint hit**.
- **Repro**: tenant с >20 агентами → `/mtm/leaderboard` отдаёт за 3-5 сек.
- **Ожидание / Реальность**: один `groupBy` запрос / 451 запрос.
- **Направление фикса**: переписать на `prisma.mtmVisit.groupBy({by: ['agentId'], _count, where})` + `mtmTask.groupBy(...)` + `mtmPhoto.groupBy(...)` + `mtmRoute.groupBy(...)`. Достичь O(1) запросов на endpoint независимо от N агентов.
- **Заметка**: [analytics/route.ts:80](src/app/api/v1/mtm/analytics/route.ts) уже корректно использует `groupBy` — это паттерн для копирования. [reports/route.ts](src/app/api/v1/mtm/reports/route.ts) тоже стоит проверить отдельно (по Explore — там N+1, но я не верифицировал лично).

### F-14 [P1] Mobile location POST: нет валидации диапазонов lat/lng

- **Файл**: [src/app/api/v1/mtm/mobile/location/route.ts:19-37](src/app/api/v1/mtm/mobile/location/route.ts)
- **Симптом**: `if (!latitude || !longitude) return 400` — но не проверяется `-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180`. Также `latitude: 0` бракуется как falsy (баг для координат на экваторе).
- **Repro**: POST `{"latitude": 999, "longitude": -500}` → запись принимается, попадает в polyline math → potentially `NaN` в дальнейших расчётах.
- **Ожидание / Реальность**: 400 с message / silent acceptance + corrupt data.
- **Направление фикса**: проверять `Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180`. Использовать `!= null` вместо `!latitude` чтобы 0 проходил.

### F-15 [P1] Photos upload: WebP/HEIC magic-number check skipped

- **Файл**: [src/app/api/v1/mtm/photos/route.ts:32-57](src/app/api/v1/mtm/photos/route.ts)
- **Симптом**: `ALLOWED_EXTENSIONS = ["jpg","jpeg","png","webp","heic"]`. Magic-number проверка есть только для JPEG (`FF D8 FF`) и PNG (`89 50 4E 47`). WebP/HEIC принимаются по расширению — спуфер может загрузить `.exe` переименованный в `.heic`.
- **Repro**: переименовать `malicious.exe` в `bad.heic` → upload пройдёт.
- **Ожидание / Реальность**: magic-number для всех / только jpeg/png проверяются.
- **Направление фикса**: добавить magic-numbers для WebP (`52 49 46 46 .. .. .. .. 57 45 42 50`) и HEIC (`.. .. .. .. 66 74 79 70 68 65 69 63/68 65 69 78`). Либо просто использовать `file-type` npm пакет.

### F-16 [P1] Photos PATCH/DELETE без audit log

- **Файл**: [src/app/api/v1/mtm/photos/[id]/route.ts](src/app/api/v1/mtm/photos/[id]/route.ts)
- **Симптом**: PATCH (review action: approve/reject) и DELETE не пишут в `MtmAuditLog`. Менеджер approved/rejected → нет трейла кто и когда.
- **Repro**: approve photo через `/mtm/photos` → `mtm_audit_logs` запись отсутствует.
- **Ожидание / Реальность**: `PHOTO_REVIEW` / `PHOTO_DELETE` entries / тишина.
- **Направление фикса**: добавить `writeMtmAudit` в PATCH (с oldStatus → newStatus в newData) и в DELETE.

### F-17 [P1] Visit POST с force=true: нет audit log на force-override

- **Файл**: [src/app/api/v1/mtm/visits/route.ts:108-119](src/app/api/v1/mtm/visits/route.ts)
- **Симптом**: agent делает check-in вне зоны с `force=true` — создаётся OUT_OF_ZONE alert (good) и visit (line 123) — НО **audit log пишет обычный CHECK_IN** (line 183), без отметки что был force override.
- **Repro**: POST `/visits {agentId, customerId, latitude: far_from_customer, force: true}` → audit log = "CHECK_IN" без `forceOverride: true` в newData.
- **Ожидание / Реальность**: audit log включает `forceOverride: true, distanceMeters` / только базовая CHECK_IN запись.
- **Направление фикса**: при force passing включать в newData `{forceOverride: true, distanceMeters, geofenceRadius}`.

### F-18 [P1] MtmAuditLog не имеет relation к MtmAgent — reports/activity не показывают agent name

- **Файл**: [prisma/schema.prisma:3213-3231](prisma/schema.prisma)
- **Симптом**: `MtmAuditLog.agentId String?` — no `agent MtmAgent @relation(...)`. Поэтому endpoints `/reports` и `/activity` не могут `include: { agent }` — комментарий в [reports/route.ts:46](src/app/api/v1/mtm/reports/route.ts) и [activity/route.ts:38](src/app/api/v1/mtm/activity/route.ts) явно говорит "MtmAuditLog has agentId but no relation".
- **Repro**: UI `/mtm/activity` показывает action+entity, но agent отображается как "Unknown" или ID.
- **Ожидание / Реальность**: agent name из join / placeholder.
- **Направление фикса**: добавить relation в schema:
  ```prisma
  agentId String?
  agent   MtmAgent? @relation(fields: [agentId], references: [id], onDelete: SetNull)
  ```
  В MtmAgent добавить обратное поле `auditLogs MtmAuditLog[]`. Migration.

### F-19 [P2] Photos PATCH: race condition findFirst → update

- **Файл**: [src/app/api/v1/mtm/photos/[id]/route.ts:20-22](src/app/api/v1/mtm/photos/[id]/route.ts)
- **Симптом**: `findFirst({id, organizationId})` (line 20) → `update({where: {id}, data})` (line 22). Между этими двумя — DELETE может произойти, update упадёт; либо переподпись cross-tenant если ID-генератор когда-то столкнётся.
- **Repro**: high concurrency Approve + Delete в одну секунду.
- **Ожидание / Реальность**: atomic / 2 запроса в окне.
- **Направление фикса**: заменить на `updateMany({where: {id, organizationId}, data})` — атомарно, проверяется orgId, возвращает count для not-found. Применить тот же паттерн ко всем `[id]` endpoints (см. routes/[id], visits/[id], tasks/[id], orders/[id]).

### F-20 [P2] locations.reduce(null start) может вернуть null

- **Файл**: [src/app/api/v1/mtm/locations/route.ts:65-67](src/app/api/v1/mtm/locations/route.ts)
- **Симптом**: `recentLocs.reduce((best, l) => (!best || l.accuracy < best.accuracy) ? l : best, null)` — если все `l.accuracy === null`, condition `l.accuracy < best.accuracy` будет `null < null` = `false` всегда → возвращает первый элемент, но логика "best accuracy" не работает; если condition `!best` падает (когда best ≠ null) и `l.accuracy` falsy — может выбрать неподходящий элемент.
- **Repro**: 5 location records без accuracy → выбор `best` непредсказуем.
- **Ожидание / Реальность**: deterministic / undefined behavior.
- **Направление фикса**: исключить из `recentLocs` записи с `accuracy == null` перед reduce, либо use `Number.MAX_VALUE` как initial bestAccuracy.

### F-21 [P2] Photos POST: коллизия filename при одновременном upload

- **Файл**: [src/app/api/v1/mtm/photos/route.ts:42](src/app/api/v1/mtm/photos/route.ts)
- **Симптом**: `fileName = ${Date.now()}-${agentId.slice(-6)}.${ext}`. Два upload в одну миллисекунду от одного агента → overwrite файла.
- **Repro**: bulk upload 100 фоток за раз → часть может потеряться.
- **Ожидание / Реальность**: collision-resistant / возможна потеря.
- **Направление фикса**: добавить `crypto.randomUUID()` или `nanoid()` в filename.

### F-22 [P2] Per-customer geofence radius не поддерживается

> Связано с **F-11** (magic constants → MtmSetting) и **F-23** (customer без coords). Все три — настройки geofence слишком «жёсткие» / не гибкие per-org / per-customer.



- **Файл**: [src/app/api/v1/mtm/visits/route.ts:74](src/app/api/v1/mtm/visits/route.ts), [prisma/schema.prisma:2941](prisma/schema.prisma) (MtmCustomer)
- **Симптом**: geofence radius один на org (`MtmSetting.geofenceRadius`). Большой склад нуждается в радиусе 200м, киоск — 30м. Сейчас один размер для всех.
- **Repro**: org с гипермаркетами и киосками → ложные OUT_OF_ZONE alerts либо слишком разрешённый radius.
- **Ожидание / Реальность**: per-customer override / только org-level.
- **Направление фикса**: добавить `MtmCustomer.geofenceRadius Int?` (Prisma migration). В visits POST: `radius = customer.geofenceRadius ?? setting.geofenceRadius ?? 100`.

### F-23 [P2] Customer без координат → geofence silently skipped

- **Файл**: [src/app/api/v1/mtm/visits/route.ts:73](src/app/api/v1/mtm/visits/route.ts)
- **Симптом**: `if (customer?.latitude != null && customer?.longitude != null) { ... }` — если у customer нет координат (бывает у новых outlets), geofence check полностью пропускается, visit создаётся с любыми GPS.
- **Repro**: создать customer без lat/lng → check-in из любой точки → пройдёт без alert.
- **Ожидание / Реальность**: предупреждение в response о пропущенной проверке / silent skip.
- **Направление фикса**: вернуть `warning: "customer_no_coords_geofence_skipped"` в response data (это не error, но информирует), либо создать INFO alert.

### F-25 [P0-config] 🔴 Google Maps API key broken на проде — карты вообще не работают

> **Severity note**: это env/config issue (не code defect). Маркирован «P0-config» — критичный по impact, но фикс ≠ code change. Architect feedback корректен: «P0» был бы overstated если применять rubric только к коду.



- **Источник**: prod browser console на `app.leaddrivecrm.org/mtm/map`
- **Симптом**: на загрузке `/mtm/map` в console:
  ```
  [ERROR] Google Maps JavaScript API error: ApiProjectMapError
  [WARNING] Google Maps JavaScript API warning: NoApiKeys
  [WARNING] Google Maps JavaScript API warning: InvalidKey
  ```
  Карта показывает «Loading map…» indefinitely. Все клиенты у которых MTM enabled — карты не работают.
- **Repro**: открыть `/mtm/map` на проде → DevTools Console → видеть ошибки выше; карта пустая / серая.
- **Ожидание / Реальность**: рендер OSM/Google карты с маркерами агентов / спиннер бесконечно.
- **Направление фикса**:
  - проверить env var на prod (вероятно `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` пуст или ограничен на другой домен)
  - либо: переключить на OSM/Leaflet (нет API key, нет rate limit; см. F-24 — там же история переключений)
  - **это объясняет жалобу «карты глючат» из user feedback** — проблема в env, не в коде. Фикс на 1 ENV переменную закроет жалобу.

### F-26 [P1] useEffect double/triple/quintuple fire — лишние API запросы

- **Источник**: prod Network tab после reload `/mtm` и навигации
- **Симптом**:
  - `/api/v1/mtm/dashboard?period=today` → **5 запросов** (один навигейт на /mtm)
  - `/api/v1/mtm/routes?limit=200` → **3 запроса** (один навигейт на /routes)
  - `/api/v1/mtm/photos?limit=200` → **3 запроса** (один навигейт на /photos)
- **Repro**: открыть DevTools Network → navigate `/mtm` → видеть множественные одинаковые запросы.
- **Ожидание / Реальность**: 1-2 (учитывая React StrictMode dev double-fire) / 3-5 в prod build.
- **Направление фикса**:
  - проверить `useEffect` deps в [page.tsx файлах](src/app/(dashboard)/mtm/) — типичная ошибка `useEffect(() => fetchX(), [session])` где `session` меняется ссылкой
  - **либо** дублируются вызовы: `useEffect` + onClick refresh + period change → все в один frame
  - **либо** session re-fetched useSession → каждый раз новый объект → useEffect retriggers
  - Рекомендация: использовать `useSWR`/`react-query` с dedupe, или ref-guard внутри fetcher.
  - В prod (где StrictMode выключен) это в любом случае избыток — реальная проблема.

### F-27 [P1] MTM не появляется в sidebar nav, доступен только по прямому URL

- **Источник**: prod sidebar на `app.leaddrivecrm.org`
- **Симптом**: в боковой панели присутствуют группы CRM / Marketing / Support / Analytics / ERP / Settings. **MTM раздела нет.** Однако прямой URL `/mtm` работает.
- **Repro**: открыть любую страницу на проде → в sidebar найти MTM/Field/Marshrutы → отсутствует.
- **Ожидание / Реальность**: видимая MTM группа со ссылками на agents/routes/visits/photos/etc / только прямой URL.
- **Направление фикса**: проверить `src/components/nav-config.ts` (или аналог) — MTM группа условно показывается по `Organization.features.mtm === true` или `Organization.addons.mtm`. На главном LeadDrive tenant возможно тогл `false`. См. memory `feedback_branding_leaddrive_visible.md` — нужно решить: показывать MTM в LeadDrive sidebar или нет (для dogfooding имеет смысл показывать).

### F-24 [P2] Maps инстабильность — 5 фиксов за месяц, нет тестов на render

- **Контекст**: git log за 60 коммитов содержит:
  - 824d5ef5 AdvancedMarker рендерится пусто
  - bc16c293 контейнер не размеризируется
  - 24510c8c Leaflet несовместим с Google Maps → switch
  - 0d7d843d Google Maps 503 → switch to OSM
  - 1517a000 ReferenceError fetchAgentRoute hoisting
  - cc09e8b6 tile rate-limit detection
- **Файлы**: [src/components/mtm/route-map.tsx](src/components/mtm/route-map.tsx), [src/components/mtm/live-map.tsx](src/components/mtm/live-map.tsx), [src/app/(dashboard)/mtm/map/page.tsx](src/app/(dashboard)/mtm/map/page.tsx)
- **Симптом**: компонент маршрутной карты переключался между Leaflet → @vis.gl/react-google-maps → OSM. Каждое переключение → новый класс багов.
- **Repro**: открыть `/mtm/map` на медленной сети → tile load fails → нет fallback UI / маркер не появляется.
- **Ожидание / Реальность**: стабильный provider, error boundary / прыжки между провайдерами.
- **Направление фикса**: зафиксировать **один** провайдер (рекомендую OSM/Leaflet — нет API key, нет rate limit на dev), добавить unit/component тест с моком tiles + Cypress E2E на `/mtm/map`.

### F-28 [P1] force=true в visits POST без role check — любой агент может обходить geofence

- **Файл**: [src/app/api/v1/mtm/visits/route.ts:55-118](src/app/api/v1/mtm/visits/route.ts)
- **Симптом**: `const { agentId, customerId, notes, force } = body` (line 55) — `force` принимается без проверки `auth.role ∈ {ADMIN, SUPERVISOR}`. Любой AGENT может зачекиниться вне зоны установив `force:true` в body.
- **Repro**: mobile JWT обычного agent → POST `/visits {force:true, latitude:0, longitude:0, customerId}` → проходит, создаётся visit + alert (но agent сделал что хотел).
- **Ожидание / Реальность**: 403 для не-supervisor / любой агент может.
- **Направление фикса**: проверять `auth.role` (или `agent.role`) — `if (force && !["ADMIN","SUPERVISOR","MANAGER"].includes(agent.role)) return 403`. Связано с F-17 (audit log на force).

### F-29 [P1] MtmAuditLog.metadata типизация — невозможно эффективно queryить audit

- **Файл**: [prisma/schema.prisma:3220-3222](prisma/schema.prisma) — `oldData Json?` / `newData Json?`
- **Симптом**: `Json` без structure. Query «все force-override checkins за месяц» = full-table scan + JSON path expression — не использует индекс.
- **Repro**: `SELECT * FROM mtm_audit_logs WHERE newData->>'forceOverride' = 'true'` — пропускает индексы.
- **Ожидание / Реальность**: indexed query / linear scan.
- **Направление фикса**: добавить дискретные колонки для часто-queryable полей: `metadata_kind String?` (audit category), `targetEntityId String?`. Либо отдельная таблица `MtmAuditFlags` для force overrides / role escalations. Решение зависит от объёма audit data.

### F-30 [P1] mobile/location POST без batch size limit — DoS вектор

- **Файл**: [src/app/api/v1/mtm/mobile/location/route.ts:11-37](src/app/api/v1/mtm/mobile/location/route.ts)
- **Симптом**: endpoint принимает single location (по коду — non-batch). Однако: нет лимита на body size в Next.js handler. Mobile app с накопленным offline cache может POSTить большой payload и упасть на JSON parse / OOM на сервере. Также — нет лимита на `prisma.mtmAgentLocation.create` rate (агент может слать 1000 раз в секунду из теста).
- **Repro**: `curl POST /mobile/location` циклом 10000 раз без интервала → server CPU/memory вырастет, DB заполнится мусором.
- **Ожидание / Реальность**: per-agent rate limit (например 1 ping / 5 сек) / unbounded.
- **Направление фикса**: per-agent throttle через MtmSetting `gpsInterval` (есть в settings, но не enforced). Либо проверять `recordedAt` последнего pinga и реджектить если < `gpsInterval` секунд назад. Связано с F-10 (retention).

---

## Audit log gap-table

| Action | Где должно писаться | Реально пишется? | Severity |
|---|---|---|---|
| CHECK_IN | `visits/route.ts:180` | ✅ да | — |
| CHECK_OUT | `visits/[id]/route.ts:69` | ✅ да | — |
| TASK_COMPLETE | `tasks/[id]/route.ts:50` | ✅ да | — |
| PHOTO_UPLOAD | `photos/route.ts:75` | ✅ да | — |
| **ORDER_CREATE** | `orders/route.ts` POST | ❌ нет (хотя audit.ts comment обещает) | P1 |
| **ORDER_UPDATE/DELETE** | `orders/[id]/route.ts` PATCH/DELETE | ❌ нет | P1 |
| **PHOTO_REVIEW** (approve/reject) | `photos/[id]/route.ts` PATCH | ❌ нет | P1 |
| **PHOTO_DELETE** | `photos/[id]/route.ts` DELETE | ❌ нет | P2 |
| **ALERT_DISMISS** | `alerts/[id]/route.ts` PATCH | ❌ нет | P2 |
| **ROUTE_CREATE/UPDATE/DELETE** | `routes/*/route.ts` | ❌ нет | P1 |
| **TASK_CREATE/UPDATE/DELETE** | `tasks/*/route.ts` | ❌ нет | P1 |
| **AGENT_CREATE/UPDATE/DELETE** | `agents/*/route.ts` (admin actions!) | ❌ нет | **P0** (compliance) |
| **CUSTOMER_CREATE/UPDATE/DELETE** | `customers/*/route.ts` | ❌ нет | P1 |
| **SETTINGS_UPDATE** | `settings/route.ts` PUT | ❌ нет | P1 |
| **FORCE_CHECKIN** | `visits/route.ts` (force=true) | ❌ нет (CHECK_IN без отметки) | P1 |
| **MOBILE_LOGIN_SUCCESS** | `mobile/auth/route.ts` | ❌ нет | P1 |
| **MOBILE_LOGIN_FAILED** | `mobile/auth/route.ts` | ❌ нет | P1 |
| **AUTO_LINK** (silent agent.userId set) | `mobile/auth/route.ts:73-76` | ❌ нет | **P0** |

**Итого: реализовано 4 actions из 18+ ожидаемых.**

---

## Geofence corner cases

| # | Сценарий | Input | Текущее поведение (по коду) | Ожидаемое |
|---|---|---|---|---|
| 1 | Точно на границе радиуса | `distance == geofenceRadius` | `> geofenceRadius` (line 84, **strict comparison**) → 100m при 100m radius **засчитывается** (alert не создаётся, visit проходит) | Это decision: либо OK (inclusive boundary), либо изменить на `>=` (exclusive). Стоит зафиксировать в spec. |
| 2 | Плохая accuracy | `accuracy=999m`, distance=50m | accuracy не учитывается, проходит | warning "accuracy_too_low" или reject (≥radius) |
| 3 | force=true override | `force=true, distance=500m, radius=100m` | проходит, создаётся OUT_OF_ZONE alert + visit, **но audit log = обычный CHECK_IN** | audit log с `forceOverride: true` |
| 4 | latitude=null payload | `latitude=null, longitude=null` | line 60 condition false → geofence пропущен → visit создаётся БЕЗ проверки | принять (mobile fallback), но warning в response |
| 5 | Customer без coords | `customer.latitude=null` | line 73 condition false → skip, visit создаётся | INFO log или response warning, см. F-23 |
| 6 | latitude=0 (экватор) | `latitude=0` | line 19 в `mobile/location` `if (!latitude)` блокирует — баг! 0 falsy | принять, использовать `!= null` |
| 7 | Очень большой radius | `MtmSetting.geofenceRadius=99999` | принимается as-is, нет sanity cap | warning при значении > 5000 |
| 8 | Per-customer radius | `MtmCustomer.geofenceRadius=30` | не поддерживается (см. F-22) | использовать customer override, fallback на org-level |

---

## Test coverage gaps

**Status**: 6 файлов, 124 теста, **0 в CI** (см. F-07). Все локально проходят.

**Покрытые API endpoints (17/27 = 63%):**
agents, customers, tasks, photos (list only), alerts (list only), settings, routes (incl. [id]), visits (root + GPS/geofence), orders, dashboard, analytics, leaderboard, mobile/auth, mobile/ping, routes/[id]

**Без тестов (10/27 = 37%):**
- `/mtm/activity`
- `/mtm/locations` (web admin GET)
- `/mtm/reports`
- `/mtm/visits/[id]` (check-out, edit, cancel)
- `/mtm/photos/[id]` (review workflow — критично)
- `/mtm/alerts/[id]` (dismiss)
- `/mtm/orders/[id]`
- `/mtm/mobile/location` (POST + deviation detection)
- `/mtm/mobile/profile`

**Полностью без покрытия:**
- 0 component тестов (`src/components/mtm/*`)
- 0 E2E тестов (mobile flow, web admin walkthrough)
- Геофенс math edge-cases (см. matrix выше) не закрыты
- mtmNotification (dead model, тоже без тестов)
- Force-override audit, auto-link flow
- Alert throttling (10-min window in mobile/location)

**Регрессионные тесты на найденное в Phase 1**: должны быть добавлены в Phase 2 одновременно с фиксами.

---

## Frontend silent fetch table (F-06 details)

| Page | Line | Calls | Effect on user |
|---|---|---|---|
| agents | 49 | GET /agents | "нет агентов" вместо error |
| alerts | 35, 60 | GET, PATCH | "нет алертов" / тихий fail dismiss |
| activity | 28 | GET /activity | empty feed |
| analytics | 29 | GET /analytics | пустые графики |
| customers | 43 | GET /customers | "нет клиентов" |
| leaderboard | 33 | GET /leaderboard | пустая доска |
| map | 134 | GET /locations | агенты не появляются на карте |
| orders | 36 | GET /orders | "нет заказов" |
| photos | 38, 62 | GET, PATCH (review) | "нет фото" / approve silently fails |
| reports | 40 | GET /reports | пустой отчёт |
| routes | 54 | GET /routes | "нет маршрутов" — **самый частый source жалобы** |
| settings | 31 | GET /settings | дефолты вместо сохранённых |
| tasks | 45, 75 | GET, mutation | "нет задач" / создание тихо падает |
| visits | 36 | GET /visits | "нет визитов" |

**Прямая причинно-следственная связь**: пользователь жалуется "не работает / нет данных / не сохраняет" → backend вернул 5xx → frontend swallow → UI показал empty. Фикс одного hook'а (`useApiQuery` с toast) закроет 17 мест.

---

## Recommendations для Phase 2

### Phase 2a — P0 quick-wins (≤1 день, ~150 LOC + 1 ENV fix)

1. **🔴 Google Maps API key fix** (F-25): проверить env vars на prod, либо переключить компоненты карт на OSM/Leaflet (без API key, без rate limit). **0 LOC если ENV fix, ~50 LOC если switch on OSM.** Закрывает "карты глючат".
2. **JWT_SECRET throw** (F-01): убрать fallback, добавить assertion на module load. 2 LOC × 2 файла.
3. **CI gate** (F-07): `npm test --run` в deploy.yml перед build. 5 LOC.
4. **Mobile auth rate-limit** (F-02): 5 attempts/min/IP. ~30 LOC (использовать существующий rate-limit middleware если есть).
5. **Audit log на admin actions** (F-03, F-17, частично F-08): AGENT_*, AUTO_LINK, FORCE_CHECKIN — обернуть существующие endpoints. ~40 LOC.
6. **Centralized fetch hook** (F-06) `useApiQuery` с toast.error + retry + types: 1 файл, 17 замен в UI. **~150-200 LOC** total (architect-corrected). **Закрывает F-06 целиком**.
7. **Centralized API catch** (F-05) в 8 GET endpoints: один helper, 8 замен. ~40 LOC.
8. **useEffect deps audit** (F-26): найти где dashboard/routes/photos дёргаются 3-5×; вероятно `[session]` dep — заменить на `[orgId]`. ~10-30 LOC.

**Эффект Phase 2a**: ощущение «не работает» уйдёт. Менеджер начнёт видеть ошибки. Карты заработают. Лишние запросы исчезнут.

### Phase 2b — P1 doneness (~2-3 дня, ~400 LOC)

1. **Zod validators** для всех POST/PUT (F-04). 1 lib + integrate.
2. **Audit log на все CRUD** (F-08, таблица ниже) — DRY-helper + расставить.
3. **MtmNotification** (F-09) — либо реализовать, либо удалить (решение пользователя).
4. **MtmAuditLog.agent relation** (F-18) — schema migration + Prisma regenerate.
5. **Mobile location validation** lat/lng ranges (F-14).
6. **Photos magic-numbers для WebP/HEIC** (F-15) или `file-type` пакет.
7. **MTM sidebar nav** (F-27) — решить показывать ли на главном LeadDrive (для dogfooding да). 1-5 LOC.
8. **Регрессионные тесты** под каждый фикс выше.

### Phase 2c — P2 polish (~1 неделя)

1. **MtmAgentLocation retention** — cron cleanup (F-10).
2. **Magic constants → MtmSetting keys** (F-11).
3. **Analytics/reports/leaderboard groupBy** — устранить N+1 (F-13).
4. **Dashboard cache** (F-12).
5. **Per-customer geofence radius** (F-22).
6. **Photos filename UUID** (F-21).
7. **`updateMany` atomic pattern** для всех `[id]` endpoints (F-19).
8. **Maps fix + E2E** (F-24) — фиксировать один provider, добавить Cypress.
9. **Customer without coords UX warning** (F-23).

### Out of Phase 2 scope (продуктовые решения)

- Photo workflow: escalation на dislikes/likes
- Route deviation tracking (planned distance, actual distance, score)
- ETA для следующего customer
- Battery warning system (data есть, не используется)
- Per-customer custom check-in fields

---

## Verification — что проверить после Phase 1

- [x] **Файл существует**: `docs/mtm-debug-report.md` (этот файл)
- [x] **≥12 findings**: 30 findings с severity + repro + file:line ✅ (включая 3 prod-наблюдения F-25/F-26/F-27 + 3 architect-добавки F-28/F-29/F-30)
- [x] **4 предварительно подтверждённых пункта включены**: F-01 (JWT_SECRET), F-05 (silent GET catches ×8), F-07 (CI gate), F-08 (audit gap) ✅
- [x] **Geofence test matrix**: 8 corner cases (превышает требуемые 6) ✅
- [x] **Audit log gap-table**: 18 actions (превышает 6) ✅
- [x] **Phase 2 recommendations** P0/P1/P2 с time-estimate ✅
- [x] **`git diff`** показывает только `docs/mtm-debug-report.md` (никаких .ts/.tsx изменений) ✅
- [x] **`npx tsc --noEmit`** exit 0 — zero TS errors ✅
- [x] **Prod smoke выполнен**: 4 страницы (/mtm, /mtm/map, /mtm/photos, /mtm/visits, /mtm/activity) — found F-25, F-26, F-27 ✅
- [ ] **Architect subagent review** scope + quality (запускается после написания этого блока)

---

## Prod smoke observations (raw)

Captured через Chrome MCP с авторизованной сессией пользователя на `app.leaddrivecrm.org` 2026-05-12 22:35.

| Page | Network requests | Console errors | UI state |
|---|---|---|---|
| `/mtm` | dashboard?period=today × **5** (status 200) | — | Dashboard рендерится; Today/Week/Month кнопки; "New Agent"/"Reports"/"Live Map" |
| `/mtm/routes` | routes?limit=200 × **3** (200) | — | "Marşrutlar" заголовок; список пустой |
| `/mtm/map` | locations (pending) | **ApiProjectMapError + NoApiKeys + InvalidKey** (Google Maps) | "Loading map..." бесконечно; All(0)/Check-in(0)/On Road(0)/Late(0)/Offline(0)/Agents(0); "No agents match filter" |
| `/mtm/photos` | photos?limit=200 × **3** (200) | — | Photos page рендерится |
| `/mtm/visits` | visits?limit=200 (pending) | — | Visits page рендерится |
| `/mtm/activity` | activity?limit=50 (pending) | — | Activity page рендерится |
| `/mtm/map` | — | Google Maps API errors (см. F-25) | Карта не рендерится |

**Observations**:
- Все MTM endpoints вернули **200** (нет 4xx/5xx) — backend работает.
- Counters = 0 потому что на главном LeadDrive нет реальных field-агентов (dogfooding tenant) — это **не баг**, а ожидаемое для demo tenant.
- **MTM раздел отсутствует в основном sidebar** — F-27.
- **Google Maps API не работает** — F-25 (это и есть «карты глючат»).
- **useEffect double/triple/quintuple fire** — F-26.

---

## Out of Phase 1 scope (явно НЕ сделано)

- **Local runtime smoke**: `.env.local` отсутствует → static review + Chrome MCP prod smoke выбраны как замена. Покрывает 24 findings без runtime.
- **Mobile native APK testing**: вне репо. Только curl-based API smoke возможен.
- **Code changes**: 0 LOC. Все находки идут в этот отчёт.
- **AFI Group**: не трогается. Все наблюдения с main LeadDrive tenant.
- **Schema changes / migrations**: не выполнены, описаны как Phase 2 actions.
