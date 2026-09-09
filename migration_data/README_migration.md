# Миграция модуля ценообразования

## Что здесь находится

| Файл | Размер | Описание |
|---|---|---|
| `pricing_data.json` | ~1 МБ | **Главный файл** — все цены по компаниям (59 компаний, категории, услуги) |
| `company_legal_names.json` | 2 KB | Юридические названия компаний |
| `pricing_crm_mapping.json` | 1 KB | Маппинг код компании → название в CRM |
| `company_details.json` | 31 KB | Детали компаний (реквизиты, параметры) |
| `companies_db.json` | 44 KB | Все 240 компаний из БД (группы, категории, кол-во пользователей) |
| `migrate.py` | — | Скрипт миграции — запусти один раз |

## Как использовать в новом проекте

### Шаг 1 — Скопируй папку migration_data/ в новый проект

```
new_project/
├── api.py
├── export_excel.py
├── migration_data/          ← эта папка
│   ├── pricing_data.json
│   ├── company_legal_names.json
│   ├── pricing_crm_mapping.json
│   ├── company_details.json
│   ├── companies_db.json
│   └── migrate.py
└── static/
```

### Шаг 2 — Запусти скрипт миграции

```bash
cd new_project
python migration_data/migrate.py
```

Скрипт автоматически:
- Скопирует JSON файлы в `static/`
- Создаст таблицы в `crm.db`
- Импортирует 240 компаний
- Проверит корректность данных

### Шаг 3 — Убедись что всё работает

```bash
curl http://localhost:PORT/api/pricing/data | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'OK: {len(d)} компаний')"
```

---

## Структура pricing_data.json (для понимания)

```json
{
  "COMPANY_CODE": {
    "group": "Tabia",
    "categories": {
      "İT İnfrastruktur": {
        "total": 5000,
        "services": [
          { "name": "Firewall Support", "qty": 2, "price": 500, "total": 1000, "unit": "Per Device" },
          { "name": "Server Monitoring", "qty": 10, "price": 400, "total": 4000, "unit": "Per User" }
        ]
      },
      "HelpDesk və Texniki Dəstək": {
        "total": 2000,
        "services": [...]
      }
    },
    "monthly": 7000,
    "annual": 84000
  }
}
```

## Инструкция для Claude Code

Вставь это в промпт Claude Code вместе со спецификацией (`Pricing_Module_Spec.md`):

---

> **Данные для миграции уже готовы** в папке `migration_data/`.
>
> Не нужно создавать тестовые данные — используй реальные:
>
> 1. Скопируй файлы из `migration_data/` в `static/` нового проекта:
>    - `pricing_data.json` — 59 компаний с реальными ценами
>    - `company_legal_names.json` — юридические названия
>    - `pricing_crm_mapping.json` — маппинг
>    - `company_details.json` — детали
>
> 2. Запусти `python migration_data/migrate.py` — создаст таблицы в БД и импортирует 240 компаний
>
> 3. API endpoint `GET /api/pricing/data` должен вернуть 59 компаний с их категориями и услугами
