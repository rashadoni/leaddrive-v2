"""
Migration script for Pricing Module
====================================
Запусти этот файл в корне нового проекта:
    python migrate.py

Что делает:
1. Копирует JSON файлы данных в static/
2. Создаёт таблицы в БД (если не существуют)
3. Импортирует компании из companies_db.json
4. Создаёт таблицу price_changes
5. Проверяет успешность миграции
"""

import json, os, shutil, sqlite3
from pathlib import Path

# ── Настройки ────────────────────────────────────────────────────────────────
MIGRATION_DIR = Path(__file__).parent          # папка с этим скриптом
DB_PATH       = Path("crm.db")                 # путь к БД нового проекта
STATIC_DIR    = Path("static")                 # папка static нового проекта

JSON_FILES = [
    "pricing_data.json",
    "company_legal_names.json",
    "pricing_crm_mapping.json",
    "company_details.json",
]

def step(msg): print(f"\n▶ {msg}")
def ok(msg):   print(f"  ✓ {msg}")
def warn(msg): print(f"  ⚠ {msg}")

# ── 1. Копируем JSON файлы ────────────────────────────────────────────────────
step("Копирование JSON файлов в static/")
STATIC_DIR.mkdir(exist_ok=True)

for fname in JSON_FILES:
    src = MIGRATION_DIR / fname
    dst = STATIC_DIR / fname
    if src.exists():
        if dst.exists():
            warn(f"{fname} уже существует — перезаписываю")
        shutil.copy2(src, dst)
        size_kb = src.stat().st_size // 1024
        ok(f"{fname} скопирован ({size_kb} KB)")
    else:
        warn(f"{fname} НЕ НАЙДЕН в {MIGRATION_DIR}")

# ── 2. Создаём таблицы в БД ───────────────────────────────────────────────────
step("Создание таблиц в БД")
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.executescript("""
CREATE TABLE IF NOT EXISTS companies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    domain          TEXT,
    industry        TEXT,
    website         TEXT,
    notes           TEXT,
    contacts_count  INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    last_activity   TEXT,
    category        TEXT DEFAULT 'prospect',
    user_count      INTEGER DEFAULT 0,
    cost_code       TEXT,
    group_name      TEXT
);

CREATE TABLE IF NOT EXISTS price_changes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER,
    company_code    TEXT,
    old_prices      TEXT,
    new_prices      TEXT,
    status          TEXT DEFAULT 'pending',
    notes           TEXT,
    effective_date  TEXT,
    created_by      INTEGER,
    approved_by     INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pricing_parameters (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    total_users           INTEGER DEFAULT 4500,
    total_users_manual    INTEGER DEFAULT 0,
    total_employees       INTEGER DEFAULT 120,
    technical_staff       INTEGER DEFAULT 80,
    back_office_staff     INTEGER DEFAULT 40,
    monthly_work_hours    REAL DEFAULT 168,
    vat_rate              REAL DEFAULT 0.18,
    employer_tax_rate     REAL DEFAULT 0.175,
    risk_rate             REAL DEFAULT 0.05,
    misc_expense_rate     REAL DEFAULT 0.01,
    fixed_overhead_ratio  REAL DEFAULT 0.25,
    updated_at            TEXT,
    updated_by            INTEGER
);

INSERT OR IGNORE INTO pricing_parameters (id) VALUES (1);
""")
conn.commit()
ok("Таблицы созданы")

# ── 3. Импортируем компании ───────────────────────────────────────────────────
step("Импорт компаний")
companies_file = MIGRATION_DIR / "companies_db.json"
if companies_file.exists():
    with open(companies_file, encoding='utf-8') as f:
        companies = json.load(f)

    existing = cur.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    if existing > 0:
        warn(f"В БД уже {existing} компаний — пропускаю импорт (чтобы не дублировать)")
    else:
        inserted = 0
        for c in companies:
            cur.execute("""
                INSERT OR IGNORE INTO companies
                    (name, domain, industry, category, user_count, cost_code, group_name)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                c.get('name'), c.get('domain'), c.get('industry'),
                c.get('category', 'prospect'), c.get('user_count', 0),
                c.get('cost_code'), c.get('group_name')
            ))
            inserted += 1
        conn.commit()
        ok(f"Импортировано {inserted} компаний")
else:
    warn("companies_db.json не найден — компании не импортированы")

# ── 4. Проверка pricing_data.json ────────────────────────────────────────────
step("Проверка данных ценообразования")
pd_file = STATIC_DIR / "pricing_data.json"
if pd_file.exists():
    with open(pd_file, encoding='utf-8') as f:
        pd = json.load(f)
    ok(f"pricing_data.json: {len(pd)} компаний")

    # Проверяем структуру первой компании
    sample_code = next(iter(pd))
    sample = pd[sample_code]
    has_categories = 'categories' in sample
    has_monthly    = 'monthly' in sample
    has_group      = 'group' in sample
    ok(f"Структура OK: group={has_group}, categories={has_categories}, monthly={has_monthly}")
else:
    warn("pricing_data.json НЕ НАЙДЕН — ценообразование не будет работать!")

# ── 5. Итоговая сводка ────────────────────────────────────────────────────────
step("Итоговая сводка")
comp_count = cur.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
client_count = cur.execute("SELECT COUNT(*) FROM companies WHERE category='client'").fetchone()[0]
ok(f"Компаний в БД: {comp_count} (клиентов: {client_count})")

for fname in JSON_FILES:
    fpath = STATIC_DIR / fname
    status = f"{fpath.stat().st_size//1024} KB" if fpath.exists() else "ОТСУТСТВУЕТ ⛔"
    ok(f"static/{fname}: {status}")

conn.close()
print("\n✅ Миграция завершена успешно!")
print("   Следующий шаг: запусти сервер и проверь /api/pricing/data")
