# Миграция модуля «Рентабельность» (Cost Model)

## Что здесь находится

| Файл | Описание |
|------|----------|
| `pricing_parameters.json` | Параметры расчёта (ставки налогов, коэффициенты) |
| `overhead_costs.json` | 18 накладных расходов (admin + tech infra) |
| `cost_employees.json` | 9 записей сотрудников (124 человека по 7 департаментам) |
| `client_services.json` | 146 строк — доход по типам сервиса для 39 компаний |
| `client_companies.json` | 60 клиентов с user_count, cost_code, group_name |
| `migrate_cost_model.py` | Скрипт миграции — запусти один раз |

## Порядок миграции

### Шаг 0 — Сначала мигрируй основные данные!
```bash
python migration_data/migrate.py
```
Это создаст таблицу `companies` (240 компаний) и скопирует `pricing_data.json` в `static/`.

### Шаг 1 — Запусти миграцию cost model
```bash
python cost_model_migration_data/migrate_cost_model.py
```
Скрипт создаст 6 таблиц и импортирует все данные.

### Шаг 2 — Проверь
```bash
curl http://localhost:PORT/api/cost-model/analytics | python3 -c "
import json, sys
d = json.load(sys.stdin)['data']
print(f'Grand Total G: {d[\"grand_total_g\"]:,.2f} ₼')
print(f'Total Revenue: {d[\"summary\"][\"total_revenue\"]:,.2f} ₼')
print(f'Margin: {d[\"summary\"][\"total_margin\"]:,.2f} ₼ ({d[\"summary\"][\"margin_pct\"]:.1f}%)')
print(f'Clients: {d[\"summary\"][\"total_clients\"]} (profitable: {d[\"summary\"][\"profitable_clients\"]})')
"
```

## Ожидаемые значения

| Метрика | Значение |
|---------|----------|
| Grand Total (Sec G) | ~645,206 ₼ |
| Grand Total (Sec F) | ~462,679 ₼ |
| Total Revenue | ~617,020 ₼ |
| Total Margin | ~-28,186 ₼ (-4.6%) |
| Total Users | 3,566 |
| Cost/User (G) | ~180.96 ₼ |
| Profitable Clients | 16 |
| Loss Clients | 38 |

## Инструкция для Claude Code

Вставь это в промпт Claude Code:

---

> **Модуль «Рентабельность» (Cost Model)**
>
> Используй спецификацию `CostModel_Spec.md` для реализации.
>
> **Данные для миграции готовы** в `cost_model_migration_data/`:
> 1. Запусти `python cost_model_migration_data/migrate_cost_model.py` (ПОСЛЕ основной миграции)
> 2. Реализуй функцию `_compute_cost_model(conn)` строго по спецификации
> 3. Реализуй 22 API endpoints (GET/PUT parameters, CRUD overhead, CRUD employees, client-services, sync, snapshots, ai-analysis, log)
> 4. Фронтенд: 6 вкладок (Аналитика, Услуги, Клиенты, Накладные, Сотрудники, Параметры)
> 5. AI-аналитика: POST /api/cost-model/ai-analysis — 5 вкладочных промптов через Claude API (см. секцию 8 спеки)
> 6. Проверь: `GET /api/cost-model/analytics` — grand_total_f < grand_total_g, SUM(service_costs) == grand_total_g
>
> **Критически важно:**
> - Section F = core (IT+InfoSec) + overhead + misc 1% + risk 5%
> - Section G = все 7 сервисов с admin overhead по headcount
> - Admin overhead = is_admin=1 items + BackOffice + GRC wages
> - Tech infra = is_admin=0 items, назначаются на сервисы через target_service
> - Маржа: fixed_cost = G × 0.25 / active_clients; variable = G × 0.75 × users / total_users
> - Доход: pricing_data.json (primary) → client_services (fallback)
> - Зарплата: Gross = Net / 0.86; SuperGross = Gross × 1.175
> - AI: @anthropic-ai/sdk, extended thinking (budget 10000), кеш по tab_lang, инвалидация при любом изменении данных
> - AI: 4-секционный ответ (📊 Оценка, ⚠️ Риски, 💡 Рекомендации, 🔍 Наблюдения), модель из env MANAGER_MODEL
