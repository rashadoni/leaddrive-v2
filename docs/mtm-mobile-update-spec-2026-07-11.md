# Спека обновления мобильного приложения MTM (маршруты) — 2026-07-11

**Для кого:** локальный агент (Codex/Claude) на Mac владельца, репозиторий
`/Users/rashadrahimov/Documents/mtm/MTMobileApp` (bare React Native 0.84.1,
Android). Эмулятор и сборка APK — локальные.

**Почему:** 2026-07-11 в прод LeadDrive задеплоена серия PR #288–#294 —
из MTM удалены не относящиеся к маршрутам домены, а настройки MTM стали
реально принудительными. Контракт
`/api/v1/mtm/*` изменился; установленная сборка APK v1.1.2 частично сломана.

**Решения владельца (2026-07-11):**
1. Экран «Заказы» (OrdersScreen) из приложения **убираем** — он вне scope MTM.
2. Правки исполняются локально по этой спеке; репо в GitHub пока не пушим.

---

## 1. Что сломано в v1.1.2 прямо сейчас

| Вызов из APK | Было | Стало |
|---|---|---|
| `GET/POST /api/v1/mtm/orders` | 200 | **404** (роут удалён) |
| `GET/PUT /api/v1/mtm/orders/{id}` | 200 | **404** |
| `GET /api/v1/mtm/orders/{id}/invoice` | 200 | **404** |

Остальные вызовы v1.1.2 не удалены и отвечают как раньше:
`mobile/auth`, `mobile/ping`, `mobile/location`, `mobile/profile`,
`mobile/notifications`, `routes`, `tasks`, `customers`, `agents/push-token`.
Оговорка: у `visits` (checkout) и `photos` появились **новые условные 422**
при включённых настройках организации — см. §2.2; при дефолтных настройках
поведение прежнее.

## 2. Обязательные изменения в приложении

### 2.1. Удалить OrdersScreen (P0)
- Удалить экран `OrdersScreen` из навигации (NativeStack) и все вызовы
  `/api/v1/mtm/orders*` (создание заказа «свободным JSON» больше не
  поддерживается сервером).
- Убрать связанные пункты меню/кнопки из VisitScreen, если заказ создавался
  из визита.
- Если в сторе (Zustand) есть срез заказов — удалить вместе с типами.
- Grep-чек по репо приложения: `orders`, `Order`, `invoice` — не должно
  остаться живых вызовов.

### 2.2. Обработать новые 422 (P1)
Сервер (#294) начал принудительно применять настройки организации:

**a) Checkout без фото** — `PUT /api/v1/mtm/visits/{id}` со `status:"CHECKED_OUT"`:
```json
HTTP 422
{ "error": "Photo required before checkout", "code": "PHOTO_REQUIRED" }
```
Возвращается, если org включила `photoRequired` и у визита 0 фото.
UI: показать понятное сообщение («Сначала прикрепите фото визита») и
предложить перейти к камере. По умолчанию настройка выключена, но клиент
обязан не падать на 422.

**b) Лимит фото на визит** — `POST /api/v1/mtm/photos` (multipart, с `visitId`):
```json
HTTP 422
{ "error": "Photo limit reached (N per visit)", "code": "MAX_PHOTOS_REACHED" }
```
Только для фото, привязанных к визиту; ad-hoc фото без `visitId` не лимитируются.
UI: сообщение «Достигнут лимит фото для визита».

Обработчик ответов: ветка `status === 422` → парсить `code`, маппить на
локализованные строки (en + strings.xml по конвенции приложения).

### 2.3. Онбординг (P2, косметика)
Шаг `first_order` переименован на сервере в `first_task`.
`PUT /api/v1/mtm/onboarding` содержит алиас (старое имя молча маппится),
поэтому старые сборки не ломаются — но в новой сборке отправлять `first_task`
и убрать упоминания заказов из текстов онбординга, если есть.

### 2.4. Контракт ошибок чек-ина (с 2026-09-05, задача A6 полевого аудита)

Один словарь для обоих способов открыть визит. Истина в коде:
`src/lib/mtm/check-in-errors.ts`; обе серверные точки используют только его.

- Интерактивно, `POST /api/v1/mtm/visits`: HTTP-статус из таблицы и тело
  `{ "error": "<англ. текст для разработчика>", "code": "<код>", ...детали }`.
- Офлайн, `visits.create` в `POST /api/v1/mtm/mobile/sync/push`: HTTP 200,
  per-op `{ "status": "conflict", "error": "<тот же текст>", "serverData": { "code": "<код>", ...детали } }`.
- Веб-PWA офлайн, `visit.check_in` в `POST /api/v1/mtm/sync/push` (сессионная
  авторизация): прежние слова `result.status` (`out_of_zone`,
  `customer_not_found`, `already_checked_in`, `route_point_unavailable`,
  `route_point_in_use`, `contact_not_found`, новое `customer_no_coordinates`)
  дополнены тем же `result.code`.

Приложение ветвится **только по `code`** и показывает локализованный текст
(задача B1); поле `error` не для интерфейса. Названия кодов совпадают с теми,
что центр синхронизации приложения уже маппит, поэтому старые сборки продолжают
понимать конфликты. Короткие имена из плана аудита даны для сверки.

| Код (`code`) | Имя в плане | HTTP (`POST /visits`) | Детали | Смысл |
|---|---|---|---|---|
| `MTM_VISIT_CUSTOMER_NOT_FOUND` | CUSTOMER_MISSING | 404 | — | клиент не виден агенту (нет назначения или удалён) |
| `MTM_VISIT_CUSTOMER_NO_COORDINATES` | NO_COORDINATES | 422 | `customerId` | у точки нет координат; чек-ин отклоняется всегда, `force` не помогает (решение владельца 2). Приложение: «у точки нет координат» + «Сообщить руководителю» |
| `MTM_VISIT_ALREADY_ACTIVE` | ACTIVE_VISIT | 409 | `activeVisitId` (офлайн: `activeVisit`) | у агента уже открыт визит |
| `MTM_VISIT_OUT_OF_ZONE` | TOO_FAR | 400 | `distanceMeters`, `geofenceRadius` | агент вне геозоны; `force` доступен только SUPERVISOR/MANAGER/ADMIN |
| `MTM_ROUTE_POINT_NOT_AVAILABLE` | ROUTE_MISMATCH | 409 | — | точка маршрута не в статусе PENDING на активном маршруте агента |
| `MTM_ROUTE_POINT_ALREADY_ACTIVE` | ROUTE_MISMATCH | 409 | `activeVisit` (офлайн) | у точки маршрута уже есть открытый визит |
| `MTM_ROUTE_TARGET_MISMATCH` | ROUTE_MISMATCH | 409 | — | клиент/контакт визита не совпадает с точкой маршрута |
| `MTM_ROUTE_TARGET_INVALID` | ROUTE_MISMATCH | 400 | — | пара клиент/контакт не является допустимой целью на дату чек-ина |
| `MTM_VISIT_CONTACT_NOT_FOUND` | — | 404 | — | контакт не активен у этого клиента |
| `MTM_VISIT_FORCE_FORBIDDEN` | — | 403 | `actorRole` (офлайн) | `force` запросила роль без права |

Порядок проверок интерактивного роута: открытый визит → клиент → координаты →
контакт → право на `force` → геозона → точка маршрута. Отсутствие GPS у самого
агента чек-ин **не** блокирует (геозона тогда не проверяется), блокирует только
отсутствие координат у клиента.

## 3. Offline-sync v1.2 (код уже в мобильном репо: WatermelonDB, outbox/SyncManager)

Каноничная спека offline-sync — [`mtm-offline-sync-spec.md`](./mtm-offline-sync-spec.md)
(архитектура клиента, WatermelonDB, outbox); ниже — только дельта контракта
после #288 и текущее поведение сервера. Истина — в коде:
`src/app/api/v1/mtm/mobile/sync/{pull,push}/route.ts`.

Если в этой итерации доезжает sync (рекомендуется — ради него затевалась v1.2):

### 3.1. `GET /api/v1/mtm/mobile/sync/pull?since=<ISO>&entities=<csv>`
- Поддерживаемые entities: **`routes, customers, visits, tasks`**
  (были ещё `skuCategories, skus, orders` — удалены).
- Неизвестные entities **молча игнорируются** (не 400): секции для них
  просто отсутствуют в `changes`. Клиент не должен ожидать ключи
  `skus`/`skuCategories`/`orders` в ответе.
- Формат: `{ success, timestamp, changes: { <entity>: { updated: [...], deleted: [id...] } } }`.
  `timestamp` использовать как курсор следующего pull.
- Visits дополнительно ограничены окном 14 дней по `checkInAt`.
- `deleted[]` заполняется только при переданном `since`.

### 3.2. `POST /api/v1/mtm/mobile/sync/push`
- Тело: `{ clientId, operations: [{ operationId, op, entity, data, clientTimestamp }] }`
  — поле называется **`op`** (не `opType`), максимум **100 операций** за пуш.
- Поддерживается: `visits` (`create`, `update`), `tasks` (`update`).
  **`orders` удалён**: операция вернёт HTTP 200, но per-op
  `{ status: "error", error: "Unsupported entity \"orders\"" }` — остальные
  операции пакета обработаются нормально. В outbox не должно генерироваться
  orders-операций вовсе (см. 2.1).
- Идемпотентность: по `operationId` (UUIDv4). Пинуются только результаты
  `ok` и `conflict` — их повторный пуш возвращает сохранённый результат.
  Результаты `status:"error"` НЕ пинуются: ошибка может быть транзиентной,
  поэтому повторный пуш той же операции обрабатывается заново.
- Конфликты: `status:"conflict"` — чужой/удалённый визит, чужая задача,
  попытка отката терминального `CHECKED_OUT` (сервер побеждает) или создание
  записи с уже существующим клиентским `id` («Record with this id already
  exists»). `serverData` с серверным состоянием приходит ТОЛЬКО в кейсе
  отката терминального статуса; в остальных — только `error`.
- Запись сущности и идемпотентная запись коммитятся одной транзакцией:
  конкурентный повтор operationId не может применить операцию дважды —
  проигравший получает replay результата победителя.
- ВАЖНО: офлайн-checkout через sync/push сознательно НЕ блокируется
  `PHOTO_REQUIRED` (фото могут досинхронизироваться позже) — это только
  для интерактивного `PUT /visits/{id}`.

## 3.3. Координаты клиентов (с 2026-09-05, задача A1 полевого аудита)

- Сервер отдаёт `latitude`/`longitude` клиента **только парой**: либо оба числа,
  либо оба `null`. Значение `0` для «неизвестно» больше не существует: пара
  (0, 0) и половинная пара запрещены на уровне БД
  (`mtm_customers_coordinates_check`) и нормализуются в `null` при записи
  (`src/lib/mtm/geo-coordinates.ts`). Это касается `mobile/sync/pull`
  (`customers.updated[]`), `mobile/routes/targets` (`items[].customer`),
  `routes/{id}` (`points[].customer`) и `mtm/customers`.
- Приложение при `null` **не считает расстояние** и не строит маркер: в списках
  пишет «координаты не заданы», такие точки идут в конец списка (задача B2).
- Запись координат из приложения (`customer-create-requests`): оба поля
  обязаны приходить вместе, иначе `400 Latitude and longitude must be provided
  together`. Пара (0, 0) принимается и сохраняется как `null`/`null`.
- Backfill миграции `20260905160000_mtm_customer_coordinates_null_island`
  обновляет `updatedAt` исправленных строк, поэтому дельта-синк подтянет
  исправление без переустановки приложения.

## 4. Что НЕ трогать
- `mobile/auth` (JWT 7 дней), `mobile/ping` (anonymous discovery,
  response only `{ success: true, data: {} }`; клиент использует введённый host как
  display fallback), `mobile/location` (GPS-heartbeat), `mobile/profile`, `mobile/notifications`,
  `agents/push-token` (Expo) — остальные контракты не менялись.

## 5. Сборка, проверка, раскатка

1. Ветка в мобильном репо, версия: bump `versionName`/`versionCode`
   (текущая в поле — v1.1.2; в репо уже есть bump до v1.2.0).
2. Тесты: `npx jest` (базлайн — 100 passing).
3. Сборка: `cd android && ./gradlew assembleRelease`.
4. Smoke на эмуляторе против прода `https://app.leaddrivecrm.org`:
   - Login (email+пароль агента, при мульти-тенанте — organizationSlug);
   - Route: список маршрутов дня;
   - Visit: check-in → фото → check-out (проверить обработку 422 при
     включённом `photoRequired` в настройках тестовой org — включить в
     `/mtm/settings`, повторить checkout без фото, увидеть сообщение);
   - Tasks: список, смена статуса;
   - Profile, push-токен (индикатор «приложение установлено» на
     `/mtm/agents` в вебе загорается от `expoPushToken`);
   - Убедиться, что нигде не осталось входов в «Заказы».
5. Раскатка APK — как раньше (email; стора нет).

## 6. Справка: серверные файлы контракта (репо leaddrive-v2)
- `src/app/api/v1/mtm/mobile/sync/pull/route.ts`, `.../sync/push/route.ts`
- `src/app/api/v1/mtm/visits/[id]/route.ts` (PHOTO_REQUIRED)
- `src/app/api/v1/mtm/photos/route.ts` (MAX_PHOTOS_REACHED)
- `src/app/api/v1/mtm/mobile/auth/route.ts`, `src/lib/mobile-auth.ts`
- `src/lib/mtm-settings.ts` (дефолты настроек)
- История изменений: PR #288 (вырезание доменов), #294 (принудительные настройки)
