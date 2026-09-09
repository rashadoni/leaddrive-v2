# MTM Equipment Inventory — Спецификация

> **Версия:** 1.0 draft, 2026-05-21
> **Цель:** учёт холодильников Pepsi, стендов, POSM в торговых точках. Это критично для Pepsi-боттлера — у Mars Overseas могут быть тысячи холодильников в полях.

---

## 1. Контекст

effie показывает в слайде 8 этот модуль с фичами:
- Equipment relocation (перемещение между точками)
- Replacement / Write-off
- Equipment search
- Condition control (фото осмотра)
- Repair requests + tracking
- Engineer checklist
- Spare parts write-off control

Для Pepsi-боттлера типичные ситуации:
- Холодильник установлен в магазине X, через 6 мес магазин закрывается → перенести в магазин Y
- Холодильник сломан → создать заявку на ремонт → инженер выезжает → закрытие после ремонта
- Поставщик украл / магазин не вернул при закрытии → списать
- Регулярный осмотр: фото-фиксация состояния каждый квартал

---

## 2. Prisma schema

```prisma
model MtmEquipmentType {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String   // "Холодильник 200L", "Стенд POSM", "Морозильник"
  code           String?
  iconUrl        String?
  isActive       Boolean  @default(true)

  equipment      MtmEquipment[]

  @@unique([organizationId, code])
  @@index([organizationId])
  @@map("mtm_equipment_types")
}

model MtmEquipment {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  typeId         String
  type           MtmEquipmentType @relation(fields: [typeId], references: [id], onDelete: Restrict)

  serialNumber   String   // уникальный s/n
  internalCode   String?  // наш внутренний инвентарный номер
  model          String?
  manufacturer   String?  // "Pepsi-Cola", "Coca-Cola"
  manufacturingYear Int?

  // Текущее место
  currentCustomerId String?
  currentCustomer MtmCustomer? @relation("EquipmentLocation", fields: [currentCustomerId], references: [id], onDelete: SetNull)
  installedAt    DateTime?

  status         MtmEquipmentStatus @default(ACTIVE)
  condition      MtmEquipmentCondition @default(WORKING)

  // Финансы
  purchasePrice  Decimal? @db.Decimal(12, 2)
  purchaseDate   DateTime?
  currency       String   @default("AZN")

  // Метаданные
  notes          String?
  photoUrl       String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  history        MtmEquipmentHistory[]
  inspections    MtmEquipmentInspection[]
  repairRequests MtmRepairRequest[]

  @@unique([organizationId, serialNumber])
  @@index([organizationId])
  @@index([currentCustomerId])
  @@index([status])
  @@map("mtm_equipment")
}

enum MtmEquipmentStatus {
  ACTIVE
  IN_TRANSIT
  IN_REPAIR
  WAREHOUSE
  WRITTEN_OFF
  LOST
}

enum MtmEquipmentCondition {
  WORKING
  NEEDS_REPAIR
  BROKEN
}

// История перемещений и изменений статуса
model MtmEquipmentHistory {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  equipmentId    String
  equipment      MtmEquipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)

  eventType      MtmEquipmentEvent
  fromCustomerId String?
  toCustomerId   String?
  notes          String?
  performedBy    String?  // agent ID
  performedAt    DateTime @default(now())

  @@index([organizationId])
  @@index([equipmentId])
  @@index([performedAt])
  @@map("mtm_equipment_history")
}

enum MtmEquipmentEvent {
  INSTALLED
  RELOCATED
  INSPECTED
  REPAIR_REQUESTED
  REPAIRED
  REPLACED
  WRITTEN_OFF
  STATUS_CHANGED
  CONDITION_CHANGED
}

// Регулярные осмотры
model MtmEquipmentInspection {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  equipmentId    String
  equipment      MtmEquipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)
  agentId        String
  visitId        String?

  conditionBefore MtmEquipmentCondition
  conditionAfter  MtmEquipmentCondition

  checklist      Json     // [{item: "Чистота", ok: true/false, note: "..."}]
  notes          String?
  photoUrls      Json     @default("[]")  // array of photo URLs

  performedAt    DateTime @default(now())

  @@index([organizationId])
  @@index([equipmentId])
  @@map("mtm_equipment_inspections")
}

// Заявки на ремонт
model MtmRepairRequest {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  equipmentId    String
  equipment      MtmEquipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)

  requestedBy    String   // agent ID
  reportedAt     DateTime @default(now())
  description    String
  priority       MtmRepairPriority @default(NORMAL)

  status         MtmRepairStatus @default(OPEN)

  assignedTo     String?  // engineer ID
  assignedAt     DateTime?
  scheduledFor   DateTime?
  startedAt      DateTime?
  completedAt    DateTime?

  // SLA tracking
  expectedDays   Int      @default(3)
  isOverdue      Boolean  @default(false)

  resolutionNotes String?
  partsUsed      Json?    // [{name, quantity, cost}]
  totalCost      Decimal? @db.Decimal(10, 2)

  photoUrlsBefore Json    @default("[]")
  photoUrlsAfter  Json    @default("[]")

  @@index([organizationId])
  @@index([equipmentId])
  @@index([status])
  @@index([assignedTo])
  @@map("mtm_repair_requests")
}

enum MtmRepairPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}

enum MtmRepairStatus {
  OPEN
  ASSIGNED
  IN_PROGRESS
  WAITING_PARTS
  COMPLETED
  CANCELLED
}
```

### Изменения в MtmCustomer
```prisma
model MtmCustomer {
  // ... существующие поля ...
  equipment MtmEquipment[] @relation("EquipmentLocation")
}
```

---

## 3. API endpoints

```
GET    /api/v1/mtm/equipment                         # list with filters
GET    /api/v1/mtm/equipment/:id                     # detail with history
POST   /api/v1/mtm/equipment                         # create
PATCH  /api/v1/mtm/equipment/:id                     # update
DELETE /api/v1/mtm/equipment/:id                     # soft delete (write off)

POST   /api/v1/mtm/equipment/:id/relocate            # body: {toCustomerId, notes}
POST   /api/v1/mtm/equipment/:id/inspect             # body: {checklist, photos[], notes}
POST   /api/v1/mtm/equipment/:id/write-off           # body: {reason, notes}

GET    /api/v1/mtm/equipment/types                   # CRUD types
POST   /api/v1/mtm/equipment/types
PATCH  /api/v1/mtm/equipment/types/:id

GET    /api/v1/mtm/repair-requests                   # list with filters: status, agent, equipment
GET    /api/v1/mtm/repair-requests/:id
POST   /api/v1/mtm/repair-requests                   # create new
PATCH  /api/v1/mtm/repair-requests/:id               # assign/update/complete

GET    /api/v1/mtm/equipment/search?q=<serial>       # quick search by serial
```

### Mobile sync
```
GET    /api/v1/mtm/mobile/sync/equipment?since=<timestamp>
```

В sync — только equipment, привязанное к customers агента + warehouse equipment организации.

---

## 4. Web admin UI

### Страницы
- `/mtm/equipment` — таблица с поиском, фильтрами (type, status, condition, customer)
- `/mtm/equipment/[id]` — карточка: основные поля, история, осмотры, заявки на ремонт
- `/mtm/equipment/new` — создание (вручную или из CSV)
- `/mtm/equipment/types` — справочник типов
- `/mtm/repair-requests` — kanban: Open / Assigned / In Progress / Waiting Parts / Completed
- `/mtm/repair-requests/[id]` — детали заявки

### Импорт CSV
- Структура: serialNumber, internalCode, type, model, manufacturer, currentCustomerCode, status, condition, purchasePrice, purchaseDate
- Match customer по `code` — если найден, привязать; если нет — пометить как orphan
- Show import summary: imported N, updated M, errors K (с list)

### Map view
В `(dashboard)/mtm/map/` — добавить toggle «Show equipment»: маркеры с цветом по condition (зелёный=working, жёлтый=needs_repair, красный=broken).

---

## 5. Mobile UI

### Новые экраны (`MTMobileApp/src/screens/equipment/`)
| Файл | Что |
|---|---|
| `EquipmentListScreen.tsx` | Список оборудования по текущему клиенту (в карточке визита) или у себя на агента |
| `EquipmentScanScreen.tsx` | Скан штрих-кода / s/n через VisionCamera для быстрой идентификации |
| `EquipmentDetailScreen.tsx` | Детали + кнопки «Осмотреть», «Создать заявку на ремонт», «Переместить» |
| `InspectionFormScreen.tsx` | Чек-лист осмотра + фото-фиксация |
| `RepairRequestFormScreen.tsx` | Создание заявки на ремонт |

### Сценарий «Осмотр оборудования во время визита»
1. Агент check-in в магазин
2. На экране визита — кнопка «Оборудование (3)»
3. Список холодильников этой точки
4. Тап → "Осмотреть"
5. Чек-лист (Чистота / Лампы работают / Дверь закрывается / Брендинг на месте / Температура)
6. По каждому пункту — toggle ok/not ok + опциональное фото
7. Сохранить → запись в `MtmEquipmentInspection`
8. Если condition изменилась с WORKING на NEEDS_REPAIR → автоматически предложить создать заявку на ремонт

---

## 6. Notifications / Alerts

### Авто-создание `MtmAlert`
- Equipment в `IN_REPAIR` дольше expectedDays → alert супервайзеру
- Equipment не осматривался > 90 дней → alert «Equipment overdue inspection»
- Equipment в status LOST → alert финансовому отделу

---

## 7. Reports

В `/mtm/reports/` добавить:
- Equipment by region (county breakdown)
- Equipment by status (донат-чарт)
- Repair requests SLA: average days to resolve, % overdue
- Cost analysis: cost of repairs / parts по месяцам
- Equipment at risk: список оборудования без осмотра > 90 дней

---

## 8. Permissions

В `src/lib/permissions.ts` добавить новые permission keys:
- `mtm.equipment.read`
- `mtm.equipment.write`
- `mtm.equipment.delete`
- `mtm.equipment.relocate`
- `mtm.equipment.write_off`
- `mtm.repair.read`
- `mtm.repair.assign`
- `mtm.repair.complete`

По умолчанию:
- AGENT — read + inspect + create repair request
- SUPERVISOR — assign / approve repair requests
- MANAGER — relocate + write-off
- ADMIN — full

---

## 9. Acceptance criteria

### Phase 1 v1 (1 неделя)
- [ ] Prisma миграция применилась без ошибок
- [ ] Админ импортирует CSV из 1000 серийных номеров холодильников за 1 минуту
- [ ] Агент при визите видит список оборудования этого клиента
- [ ] Чек-лист осмотра можно заполнить и приложить 3+ фото за < 2 минут
- [ ] При condition = NEEDS_REPAIR создаётся заявка на ремонт
- [ ] Заявки на ремонт видны на web kanban для супервайзера

### Phase 1+ (full)
- [ ] Перемещение между customers работает с историей в `MtmEquipmentHistory`
- [ ] SLA-tracking для repair requests
- [ ] Reports по equipment работают
- [ ] Сканирование штрих-кода через VisionCamera распознаёт s/n

---

## 10. Out of scope (этой спеки)

- Spare parts inventory (отдельный модуль, отложен)
- Engineer mobile app (на старте инженеры пользуются web)
- Контракты с поставщиками оборудования
- Финансовая амортизация в P&L

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-05-21 | Создан v1 |
