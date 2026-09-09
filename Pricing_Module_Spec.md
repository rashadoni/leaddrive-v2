# Модуль Ценообразования — Техническая Спецификация

> Этот документ описывает полную логику модуля ценообразования. Используй его как основу для реализации аналогичного модуля в другом проекте.

---

## 1. Общая концепция

Модуль позволяет:
- Хранить тарифы каждого клиента (услуги → категории → итог по компании)
- Визуально корректировать цены ползунками (глобально / по группе / по категории / по компании)
- Задавать дату начала действия новой цены на каждом уровне
- Экспортировать прогноз продаж в Excel (с разбивкой по месяцам)
- Сохранять запросы на изменение цены с историей и статусами

---

## 2. Структура данных

### 2.1 pricing_data.json — главный файл цен

```json
{
  "COMPANY_CODE": {
    "group": "GroupName",
    "categories": {
      "Название категории": {
        "total": 5000,
        "services": [
          {
            "name": "Название услуги",
            "qty": 10,
            "price": 500,
            "total": 5000,
            "unit": "Per Device"
          }
        ]
      }
    },
    "monthly": 12500,
    "annual": 150000
  }
}
```

**Важно:** `monthly` = сумма всех `category.total`. `annual` = `monthly × 12`.

### 2.2 company_legal_names.json

```json
{
  "COMPANY_CODE": "ООО Полное Юридическое Название"
}
```

### 2.3 pricing_crm_mapping.json

```json
{
  "COMPANY_CODE": "Название компании в CRM"
}
```

### 2.4 Группы клиентов (GROUP_ORDER)

Фиксированный порядок групп для отображения и отчётности:
```
['Tabia', 'AFI', 'Azmade', 'PMD', 'Novex', 'Azersheker', 'Separated']
```

### 2.5 Категории → Агрегация

11 внутренних категорий сворачиваются в 7 для отчётов:

| Внутреннее название | Отчётная категория |
|---|---|
| İT İnfrastruktur | Daimi İT xidməti |
| Məlumat Bazası | Daimi İT xidməti |
| Video, Monitorinq | Daimi İT xidməti |
| İnformasiya Təhlükəsizlik | İnfosec |
| Təlim və Maarifləndirmə | İnfosec |
| HelpDesk və Texniki Dəstək | Əlavə IT xidməti |
| Bulud Xidmətləri | SAAS xidməti |
| Avtomatlaşdırılmış Sistemlər | ERP |
| SaaS Biznes Process | ERP |
| Audit və Uyğunluq | GRC |
| Konsaltinq və Layihə | Layihə |

---

## 3. API Endpoints

Все endpoints требуют авторизации (Bearer token).
Пометка `[ADMIN]` = только для роли admin.

| Метод | URL | Описание | Тело запроса | Ответ |
|---|---|---|---|---|
| GET | `/api/pricing/data` | Получить все цены | — | Полный pricing_data.json |
| PUT | `/api/pricing/data` | Сохранить все цены | `{...pricing_data}` | `{saved: true}` |
| PUT | `/api/pricing/company/{code}` | Обновить одну компанию | `{categories, group}` | Объект компании |
| DELETE | `/api/pricing/delete/{code}` | Удалить компанию | — | `{message, remaining}` |
| GET | `/api/pricing/groups` | Список групп | — | `[group_names]` |
| GET | `/api/pricing/crm-mapping` | Маппинг код→CRM | — | `{mapping, crm_clients}` |
| POST | `/api/pricing/crm-mapping` | Обновить маппинг | `{updates: {code: crm_name}}` | `{mapping, updated}` |
| POST | `/api/pricing/export` | Экспорт в Excel | `{template, adjustments, effective_date}` | Файл XLSX |
| POST | `/api/pricing/import` | Импорт из Excel | FormData: `{file, company_name, group_name}` | `{success, message}` |
| GET | `/api/price-changes` | История изменений | `?status=pending&company_code=X` | Список записей |
| POST | `/api/price-changes` | Создать запрос | `{company_code, new_prices, effective_date, notes}` | Созданная запись |
| PUT | `/api/price-changes/{id}` | Одобрить/отклонить | `{status: "approved"}` | Обновлённая запись |
| POST | `/api/price-changes/batch` | Пакетное изменение | `{companies, adjustments, effective_date, notes}` | `{created: count}` |

---

## 4. Логика корректировок (ползунки)

### 4.1 Четыре уровня иерархии

```
Глобальный (%)
  └── Группа (%)          ← переопределяет глобальный
        └── Категория (%)  ← переопределяет группу
              └── Компания (%) ← наивысший приоритет
```

### 4.2 Формула расчёта итогового значения

```
adjusted = base × (1 + global/100) × (1 + group/100) × (1 + category/100) × (1 + company/100)
```

**Пример:**
- База: 1000 ₼
- Global +10%, Group +5%, Category -2%, Company +3%
- Итог: `1000 × 1.10 × 1.05 × 0.98 × 1.03 = 1171.89 ₼`

### 4.3 Состояние на фронтенде (JavaScript)

```javascript
let _pricingAdjustments = {
  global: 0,                      // число -50..100
  groups: {                       // { "GroupName": 15, ... }
    "Tabia": 15,
    "AFI": 0
  },
  categories: {                   // { "CategoryName": 10, ... }
    "IT Infrastructure": 10
  },
  companies: {                    // { "COMPANY_CODE": -5, ... }
    "EXCELSIOR": 20
  },
  group_dates: {                  // { "GroupName": "YYYY-MM-DD" }
    "Tabia": "2026-07-01"
  },
  category_dates: {               // { "CategoryName": "YYYY-MM-DD" }
  },
  company_dates: {                // { "COMPANY_CODE": "YYYY-MM-DD" }
  }
};
```

### 4.4 Функции обновления

```javascript
updatePricingGlobal(value)            // Глобальный ползунок
updatePricingGroup(group, value)      // Ползунок группы
updatePricingGroupDate(group, date)   // Дата для группы
updatePricingCategory(cat, value)     // Ползунок категории
updatePricingCategoryDate(cat, date)  // Дата для категории
updatePricingCompany(code, value)     // Ползунок компании
updatePricingCompanyDate(code, date)  // Дата для компании
updatePricingDisplay()                // Пересчитать и обновить UI
resetPricingAdjustments()             // Сбросить всё в 0
```

### 4.5 KPI карточки (обновляются в реальном времени)

| Карточка | Формула |
|---|---|
| Базовая выручка | Сумма `monthly` всех компаний × 12 |
| Прогноз выручки | Базовая × скорректированный множитель |
| Эффект | Прогноз − База |
| Средн. изменение % | Среднее по всем скорр. множителям |

---

## 5. Логика даты начала действия

### 5.1 Иерархия приоритетов (от высшего к низшему)

```
company_dates[code]      ← наивысший (дата конкретной компании)
  └── category_dates[cat] ← дата категории услуг
        └── group_dates[group] ← дата группы
              └── global_eff_date ← общая дата вверху страницы
                    └── январь (0) ← дефолт если ничего не выбрано
```

### 5.2 Функция поиска эффективного месяца (Python, backend)

```python
def _get_company_eff_month(company_name, group_name, adjustments, global_eff_date, category_name=None):
    """Returns 0-based month index (0=Jan, 11=Dec). Default=0."""
    if adjustments:
        # 1. Проверяем дату компании
        cd = (adjustments.get('company_dates') or {}).get(company_name)
        if cd:
            return _parse_effective_month(cd)
        # 2. Проверяем дату категории
        if category_name:
            cat_d = (adjustments.get('category_dates') or {}).get(category_name)
            if cat_d:
                return _parse_effective_month(cat_d)
        # 3. Проверяем дату группы
        gd = (adjustments.get('group_dates') or {}).get(group_name)
        if gd:
            return _parse_effective_month(gd)
    # 4. Глобальная дата
    m = _parse_effective_month(global_eff_date)
    if m is not None:
        return m
    return 0  # дефолт: январь

def _parse_effective_month(date_str):
    """'2026-07-01' → 6 (0-based). None если не задана."""
    if not date_str:
        return None
    try:
        return int(date_str.split('-')[1]) - 1
    except:
        return None
```

### 5.3 Применение в Excel (по месяцам)

```python
for month_index in range(12):  # 0=Jan .. 11=Dec
    use_adjusted = (eff_month is None) or (month_index >= eff_month)
    if use_adjusted:
        value = adjusted_monthly
        cell_color = GREEN  # "#e8f5e9"
    else:
        value = base_monthly
        cell_color = WHITE
```

**Пример:** `group_dates["Tabia"] = "2026-07-01"` (eff_month=6)
- Янв-Июн (0-5): базовая цена, белый фон
- Июл-Дек (6-11): скорр. цена, зелёный фон

---

## 6. Экспорт в Excel

### 6.1 Вызов с фронтенда

```javascript
async function exportPricingExcel(template) {
  const resp = await fetch('/api/pricing/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' },
    body: JSON.stringify({
      template: template,          // "1" или "2"
      adjustments: _pricingAdjustments,
      effective_date: null         // null = per-group/company даты из adjustments
    })
  });
  // blob → download
}
```

### 6.2 Серверная обработка (Python / openpyxl)

```python
def generate_template1(pricing_data, legal_names, effective_date=None, adjustments=None):
    base_data = copy.deepcopy(pricing_data)   # ← сохранить базу ДО корректировок
    adjusted_data = apply_adjustments(pricing_data, adjustments)
    wb = Workbook()

    # Лист 1: Сводная таблица (компании × 7 категорий)
    _build_summary_sheet(wb, adjusted_data, legal_names)

    # Лист 2: Ежемесячные продажи по компаниям
    add_monthly_sales_sheet(wb, base_data, adjusted_data, legal_names,
                            effective_date, view='company', adjustments=adjustments)

    # Лист 3: Ежемесячные продажи по услугам
    add_monthly_sales_sheet(wb, base_data, adjusted_data, legal_names,
                            effective_date, view='service', adjustments=adjustments)

    return wb
```

### 6.3 Функция apply_adjustments

```python
def apply_adjustments(data, adjustments):
    if not adjustments:
        return data
    g = adjustments.get('global', 0) / 100
    for code, company in data.items():
        group = company.get('group', '')
        gr = adjustments.get('groups', {}).get(group, 0) / 100

        new_monthly = 0
        for cat_name, cat_val in company.get('categories', {}).items():
            ca = adjustments.get('categories', {}).get(cat_name, 0) / 100
            co = adjustments.get('companies', {}).get(code, 0) / 100

            base_total = _cat_total(cat_val)
            mult = (1+g) * (1+gr) * (1+ca) * (1+co)
            new_total = base_total * mult

            # Масштабируем услуги пропорционально
            if isinstance(cat_val, dict) and 'services' in cat_val:
                for svc in cat_val['services']:
                    svc['total'] = svc.get('total', 0) * mult
                    svc['price'] = svc.get('price', 0) * mult
                cat_val['total'] = new_total
            else:
                company['categories'][cat_name] = new_total

            new_monthly += new_total

        company['monthly'] = new_monthly
        company['annual'] = new_monthly * 12

    return data
```

### 6.4 Лист "Ажлық Сатış по компаниям" (view='company')

Структура:
```
| Компания | Янв | Фев | Мар | Апр | Май | Июн | Июл | Авг | Сен | Окт | Ноя | Дек | Год |
|----------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| TABIA    | 100 | 100 | 100 | 100 | 100 | 100 | 115 | 115 | 115 | 115 | 115 | 115 | ... |  ← с июля +15%
| ...      |
| ИТОГО    | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |
```

- Строки группируются по GROUP_ORDER
- Подытоги по каждой группе
- Скорректированные ячейки = зелёный текст + светло-зелёный фон
- Диаграмма: столбчатая по месяцам

### 6.5 Лист "Ежемесячные продажи по услугам" (view='service')

Агрегирует месячные значения по услугам через все компании:

```python
def _build_service_monthly(base_data, adj_data, adjustments, effective_date):
    services = {}  # { "service_name": [0]*12 }

    for code, company in base_data.items():
        group = company.get('group', '')
        for cat_name, cat_val in company.get('categories', {}).items():
            eff_month = _get_company_eff_month(code, group, adjustments,
                                               effective_date, cat_name)
            base_monthly = _cat_total(cat_val) / 12  # примерно
            adj_monthly  = _cat_total(adj_data[code]['categories'][cat_name]) / 12

            for svc in _get_services(cat_val):
                key = svc['name']
                if key not in services:
                    services[key] = [0.0] * 12

                for m in range(12):
                    use_adj = (eff_month is None) or (m >= eff_month)
                    services[key][m] += adj_svc_val[m] if use_adj else base_svc_val[m]

    return services
```

---

## 7. База данных (таблица price_changes)

```sql
CREATE TABLE price_changes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER,
    company_code TEXT,
    old_prices  TEXT,        -- JSON: предыдущие цены
    new_prices  TEXT,        -- JSON: новые цены
    status      TEXT DEFAULT 'pending',  -- pending | approved | rejected
    notes       TEXT,
    effective_date TEXT,     -- YYYY-MM-DD
    created_by  INTEGER,
    approved_by INTEGER,
    created_at  TEXT,
    updated_at  TEXT
);
```

---

## 8. Пример полного сценария использования

```
1. Загрузка страницы
   → GET /api/pricing/data
   → Отрисовка таблицы компаний, графиков, слайдеров

2. Пользователь двигает ползунок "Tabia +15%"
   → updatePricingGroup('Tabia', 15)
   → updatePricingDisplay()
   → KPI карточки пересчитаны в реальном времени

3. Пользователь ставит дату "01.07.2026" для Tabia
   → updatePricingGroupDate('Tabia', '2026-07-01')

4. Нажимает "Экспорт → Template 1"
   → POST /api/pricing/export
     { template: "1", adjustments: {global:0, groups:{Tabia:15}, ...}, effective_date: null }
   → Backend: base_data сохранён, adjusted_data = apply_adjustments(...)
   → Строится Excel: Янв-Июн = база, Июл-Дек = +15% (зелёный)
   → Файл скачан

5. Нажимает "Применить"
   → POST /api/price-changes/batch
     { companies: ["TABIA", "EXCELSIOR", ...], adjustments: {...}, effective_date: "2026-07-01" }
   → Создаются записи в price_changes со статусом pending
   → Можно одобрить через PUT /api/price-changes/{id} { status: "approved" }
```

---

## 9. Ключевые технические детали

### Стек
- **Backend:** Python 3.10 + FastAPI + SQLite (через `get_db()` context manager)
- **Excel:** openpyxl
- **Frontend:** Vanilla JS + Tailwind CSS + Chart.js
- **Авторизация:** JWT Bearer токен

### Важные нюансы

1. **Файл pricing_data.json** — источник истины для цен, НЕ база данных
2. **Категории могут быть двух форматов:**
   - Плоский: `"Категория": 5000`
   - Вложенный: `"Категория": {"total": 5000, "services": [...]}`
   - Функция `_cat_total(val)` обрабатывает оба формата
3. **При корректировке цен** services масштабируются пропорционально тому же множителю что и категория
4. **effective_date=null** в запросе экспорта означает: брать даты из `adjustments.group_dates`, `category_dates`, `company_dates`
5. **Дефолт при отсутствии любой даты** = январь (eff_month=0), т.е. все 12 месяцев по скорректированной цене
6. **Инвалидация кэша:** При любом изменении цен вызывается `_invalidate_ai_cache()`

---

## 10. Что нужно для реализации в новом проекте

### Минимальный набор файлов

```
project/
├── api.py                         # FastAPI
├── export_excel.py                # Логика Excel
└── static/
    ├── index.html                 # Frontend (renderPricing функция)
    ├── pricing_data.json          # Данные цен
    ├── company_legal_names.json   # Юр. названия
    └── pricing_crm_mapping.json  # Маппинг
```

### Минимальный набор endpoints для старта

1. `GET /api/pricing/data` — получить данные
2. `PUT /api/pricing/data` — сохранить
3. `POST /api/pricing/export` — экспорт Excel с корректировками

### Минимальный набор JS-переменных

```javascript
let _pricingData = null;
let _pricingAdjustments = {
  global: 0, groups: {}, categories: {}, companies: {},
  group_dates: {}, category_dates: {}, company_dates: {}
};
```

### Минимальный набор UI компонентов

- [ ] Таблица компаний (компания | категории | итог месяц | итог год)
- [ ] Глобальный слайдер (-50% .. +100%)
- [ ] Слайдеры по группам + дата-пикер
- [ ] Слайдеры по категориям + дата-пикер
- [ ] Слайдеры по компаниям + дата-пикер
- [ ] KPI карточки (база / прогноз / эффект / % изменение)
- [ ] Кнопки: Применить, Сбросить, Экспорт
