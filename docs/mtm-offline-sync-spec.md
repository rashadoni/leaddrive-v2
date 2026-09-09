# MTM Offline-First Sync — Спецификация

> **Версия:** 1.0 draft, 2026-05-21
> **Цель:** дать торговому агенту возможность полноценно работать в магазинах без интернета и автоматически синхронизироваться при появлении сети.

> ⚠️ **Актуализация 2026-07-11 (после PR #288):** sync поддерживает только
> `routes, customers, visits, tasks`. Актуальный контракт и чек-лист обновления
> приложения: [`mtm-mobile-update-spec-2026-07-11.md`](./mtm-mobile-update-spec-2026-07-11.md),
> истина в коде: `src/app/api/v1/mtm/mobile/sync/{pull,push}/route.ts`.
> Примеры ниже приведены к пост-#288 контракту.

---

## 1. Контекст и почему это критично

Регионы Азербайджана за пределами Баку (Гянджа, Сумгайыт, Сабирабад, Лянкяран) — нестабильный 4G. Магазины часто в подвалах/складских помещениях без сигнала. Если торговый агент не может работать без сети — продукт нельзя ставить в эксплуатацию.

**effie это делает.** Без этого мы не можем выйти даже на pre-pitch.

Сейчас (v1.1.2) приложение все вызовы делает напрямую через `fetch` — при потере сети теряется работа агента.

---

## 2. Что должно работать оффлайн

| Сценарий | Должно работать оффлайн |
|---|---|
| Просмотр маршрута на день | ✅ |
| Просмотр карточки клиента | ✅ |
| GPS check-in (с локальной валидацией geofence) | ✅ |
| Просмотр каталога SKU + поиск | ✅ |
| Создание заказа | ✅ |
| Фото-фиксация (со всем watermark) | ✅ |
| Заполнение чек-листов/задач | ✅ |
| GPS check-out | ✅ |
| Просмотр истории своих визитов сегодня | ✅ |
| Live карта команды | ❌ (online only) |
| Аналитика/leaderboard | ❌ (online only) |
| Изменение настроек организации | ❌ (online only) |

---

## 3. Технический стек

### Локальная БД на устройстве: **WatermelonDB**

**Почему WatermelonDB, а не RxDB или Realm:**
- Заточен под React Native + большие датасеты (10k+ записей)
- Lazy loading из SQLite — не грузит всё в JS heap
- Reactive подписка для UI (как React Query, но локально)
- Хорошая интеграция с TypeScript
- Open source, без лицензионных подвохов

Альтернатива: Realm (хорош, но Realm Atlas теперь требует Atlas-облако и более тяжёлый интеграционно).

### Структура данных

WatermelonDB schema в `MTMobileApp/src/db/schema.ts` — зеркалит Prisma модели, но с упрощениями:
- Только то, что нужно агенту (НЕ грузим `MtmAuditLog`, `MtmNotification`)
- Денормализация для скорости (например, `Visit.customerName` хранится denormalized чтобы не делать JOIN)

### Sync protocol: **Custom delta sync с idempotency**

Не используем `@nozbe/watermelondb/sync` напрямую — нужна кастомная логика под наши API. Зато их паттерн `pull→push→ack` берём за основу.

---

## 4. Sync flow

### High-level

```
┌──────────────────┐
│  Mobile App      │
│  WatermelonDB    │
│  + Outbox        │
└────────┬─────────┘
         │
         │  every 60s OR onForeground OR onNetReconnect
         │
         ▼
┌──────────────────┐
│  Sync Manager    │
│  1. PULL changes │
│  2. PUSH outbox  │
│  3. ACK & cleanup│
└────────┬─────────┘
         │ HTTPS
         ▼
┌──────────────────┐
│  Backend API     │
│  /sync/pull      │
│  /sync/push      │
└──────────────────┘
```

### PULL (server → client)
**Endpoint:** `GET /api/v1/mtm/mobile/sync/pull?since=<lastSyncTimestamp>&entities=routes,customers,visits,tasks`

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-05-21T10:30:00Z",
  "changes": {
    "customers": {
      "updated": [...],
      "deleted": ["cust_id_1"]
    },
    "routes": { ... },
    "visits": { ... },
    "tasks": { ... }
  }
}
```

Неизвестные значения в `entities` (в т.ч. вырезанные `skus`, `orders`)
молча игнорируются — секции для них в `changes` просто отсутствуют.

**Backend logic** (`src/app/api/v1/mtm/mobile/sync/pull/route.ts`):
1. Auth check, extract `agentId` + `organizationId`
2. Параллельно для каждой entity:
   - `WHERE updatedAt > since AND organizationId = orgId AND <scope-filter>`
   - Например для visits: `AND agentId = currentAgentId`
   - Soft-deleted записи возвращаются в `deleted[]`
3. Возвращаем changes с серверным timestamp

### PUSH (client → server)
**Endpoint:** `POST /api/v1/mtm/mobile/sync/push`

**Request:**
```json
{
  "clientId": "device-uuid",
  "operations": [
    {
      "op": "create",
      "entity": "visits",
      "data": {
        "id": "client_cuid_xyz",
        "customerId": "cust_abc",
        "checkInAt": "2026-05-21T09:15:00Z",
        "checkInLat": 40.4093,
        "checkInLng": 49.8671
      },
      "clientTimestamp": "2026-05-21T09:15:00Z",
      "operationId": "op_unique_id_for_idempotency"
    },
    {
      "op": "update",
      "entity": "tasks",
      "data": { "id": "task_abc", "status": "COMPLETED" },
      "operationId": "..."
    }
  ]
}
```

Поддерживаемые операции: `visits` — `create`/`update`, `tasks` — `update`.

**Backend logic** (`src/app/api/v1/mtm/mobile/sync/push/route.ts`):
1. Auth check
2. Для каждой operation:
   - Проверить `operationId` в `MtmSyncOperation` таблице — если уже обработано, вернуть прошлый результат (идемпотентность)
   - Применить операцию в транзакции
   - Записать `operationId` + результат
3. Вернуть `[{operationId, status: 'ok' | 'conflict' | 'error', serverId, serverData}]`

### Client-generated IDs

**Все ID — cuid, генерируются на клиенте.** Сервер принимает их как PK. Это устраняет необходимость маппинга после sync.

В Prisma уже используется `cuid` — менять не нужно.

---

## 5. Outbox pattern

```typescript
// MTMobileApp/src/db/models/Outbox.ts
class OutboxOperation extends Model {
  static table = 'outbox_operations';

  @field('operation_id') operationId!: string;
  @field('op_type') opType!: 'create' | 'update' | 'delete';
  @field('entity') entity!: string;
  @json('data', sanitize) data!: any;
  @field('client_timestamp') clientTimestamp!: number;
  @field('status') status!: 'pending' | 'syncing' | 'synced' | 'failed';
  @field('retry_count') retryCount!: number;
  @field('last_error') lastError?: string;
  @field('synced_at') syncedAt?: number;
}
```

**Workflow:**
1. User создаёт визит → запись в `visits` table в WDB + запись в `outbox_operations` со status='pending'
2. Sync Manager при следующем запуске берёт все `status='pending'` ops, отправляет в `/sync/push`
3. После успеха → status='synced', через 7 дней — DELETE
4. При conflict — status='failed', notify user, ручное разрешение

### Conflict resolution стратегия
- **Default:** Last-Write-Wins по `updatedAt`
- **Visit status:** Special — нельзя «отменить» check-in после check-out, server wins для terminal statuses
- **Order items:** Если на сервере уже есть order с теми же positions — merge не делаем, возвращаем conflict, UI показывает «Заказ уже есть, открыть?»

---

## 6. UI индикаторы

### Status bar в приложении
- ☁️ синяя облачко — всё синхронизировано
- ⏳ оранжевая — есть pending operations, ждём сети или sync
- ⚠️ красная — есть failed operations, требуется внимание
- Цифра на иконке — количество pending

### Sync screen (в Profile)
- Список pending operations с возможностью retry
- Кнопка «Force sync now»
- Статистика: «Последняя синхронизация: 2 мин назад. Отправлено: 15 записей. Получено: 23 записи»

---

## 7. Размеры данных

Расчёт для типичного агента в день (Mars Overseas):

| Сущность | Объём | Размер |
|---|---|---|
| SKU catalog | 200 SKU | ~1 MB (с фото-превью) |
| Customers (свои + соседние агенты для covering) | 100 | ~50 KB |
| Routes (текущий день + след 2 дня) | 3 | ~5 KB |
| RoutePoints | 30 | ~10 KB |
| Visits сегодня | 15 | ~20 KB |
| Photos сегодня (только метаданные, файлы остаются в file storage) | 30 | ~10 KB |
| Tasks active | 20 | ~10 KB |
| Promotions active | 10 | ~5 KB |
| **Итого активных данных в памяти** | | **~1.1 MB** |

WatermelonDB справляется с гораздо большим — на 10k SKU тоже не тормозит, потому что lazy loading.

### Фото-файлы
- НЕ хранятся в WDB
- Хранятся в `RNFS` (react-native-fs) в директории приложения
- При sync — upload через multipart, после ack — можно удалить локально (опц. оставить превью)
- Backoff strategy для photo upload — отдельная очередь от data ops

---

## 8. Reliability

### Network detection
- `@react-native-community/netinfo` для определения состояния сети
- Sync запускается:
  - При смене состояния `disconnected → connected`
  - Каждые 60 сек когда сеть есть
  - При foreground приложения
  - Вручную (pull-to-refresh)

### Retry logic
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap)
- После 5 failed retries для одной operation → mark as failed, требует ручного решения

### Power management
- Не запускать sync при battery < 15% если sync не критичен
- Batched sync: один HTTP запрос для до 100 ops

---

## 9. Tests

Это самый рискованный модуль. Покрытие тестами обязательно.

### Unit tests
- `sync-manager.test.ts` — pull/push логика
- `outbox.test.ts` — добавление, ретраи, очистка
- `conflict-resolver.test.ts` — все стратегии

### Integration tests
- Mock-сервер: симуляция HTTP, отдача changes, приём push, симуляция conflicts
- Chaos tests: random failures на 30% запросов

### Manual QA scenarios
1. Aviation mode весь день — собрать 5 заказов, 20 фото → включить сеть → проверить что всё попало
2. Сеть мигает: connect 10 сек / disconnect 30 сек на протяжении часа
3. Два устройства одновременно изменяют один заказ → проверить conflict
4. Watermark photo на устройстве 1 → upload → метаданные в БД на сервере → видны на устройстве 2

---

## 10. Backend изменения

### Новые таблицы

```prisma
model MtmSyncOperation {
  id             String   @id @default(cuid())
  organizationId String
  agentId        String
  operationId    String   @unique
  opType         String
  entity         String
  appliedAt      DateTime @default(now())
  resultData     Json?
  status         String   // 'ok' | 'conflict' | 'error'

  @@index([organizationId])
  @@index([agentId])
  @@index([operationId])
  @@map("mtm_sync_operations")
}

// Soft delete для всех MTM моделей — добавить:
// deletedAt DateTime?
// @@index([deletedAt])
```

### Soft delete
Все sync-able модели должны поддерживать soft delete (поле `deletedAt`), потому что hard delete не передаётся в delta sync. Запросы должны фильтровать `WHERE deletedAt IS NULL`.

Это **большое изменение** — затронет все MTM endpoints. План:
1. Добавить `deletedAt` ко всем MTM моделям в одной миграции
2. Заменить в API все `delete` на `update {deletedAt: now()}`
3. Добавить middleware Prisma для авто-фильтрации (есть пакет prisma-soft-delete-middleware)

### Rate limiting
Sync endpoints — частые запросы. Установить лимит: 60 sync операций / минуту на агента (то есть раз в секунду максимум).

---

## 11. Acceptance criteria

- [ ] Создан outbox + Sync Manager на mobile
- [ ] Endpoints `/sync/pull` и `/sync/push` работают с идемпотентностью
- [ ] При aviation mode весь день агент полноценно работает, все операции сохраняются и при появлении сети попадают на сервер
- [ ] При conflict UI показывает понятное сообщение и предлагает действия
- [ ] Все MTM модели поддерживают soft delete
- [ ] Sync статус виден агенту в реальном времени
- [ ] Тесты покрывают основные сценарии (≥80% line coverage на sync модуле)
- [ ] Manual QA сценарии 1–4 проходят без потери данных

---

## 12. Риски

| # | Риск | Mitigation |
|---|---|---|
| 1 | WatermelonDB не справится с native module conflicts на RN 0.84 | На первой неделе сделать proof-of-concept; план B — Realm |
| 2 | Photo upload очередь не справляется при 100+ фото у одного агента | Параллельный upload (3–5 одновременно), приоритезация по recency, ручная пауза в Settings |
| 3 | Sync conflicts не решатся автоматически и UI станет помойкой | Жёсткая дисциплина: для каждого entity заранее прописан resolution strategy |
| 4 | БД растёт бесконечно — agent с историей за год тормозит | Cleanup job на устройстве: операции старше 90 дней удаляются (но НЕ photo/visits, только аналитика) |

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-05-21 | Создан v1 |
