"""
Migration script for Cost Model (Рентабельность) Module
=======================================================
Запусти этот файл в корне нового проекта:
    python cost_model_migration_data/migrate_cost_model.py

Что делает:
1. Создаёт таблицы cost model в БД (если не существуют)
2. Импортирует параметры из pricing_parameters.json
3. Импортирует накладные из overhead_costs.json (18 строк)
4. Импортирует сотрудников из cost_employees.json (9 строк, 124 чел.)
5. Импортирует client_services из client_services.json (146 строк)
6. Обновляет user_count/cost_code/group_name у client companies
7. Проверяет корректность данных

ВАЖНО: Запусти ПОСЛЕ основной миграции (migrate.py из migration_data/),
       т.к. нужна таблица companies с клиентами.
"""

import json, os, sqlite3
from pathlib import Path

MIGRATION_DIR = Path(__file__).parent
DB_PATH = Path("crm.db")

def step(msg): print(f"\n▶ {msg}")
def ok(msg):   print(f"  ✓ {msg}")
def warn(msg): print(f"  ⚠ {msg}")


# ── 1. Создаём таблицы ──────────────────────────────────────────────
step("Создание таблиц cost model")
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.executescript("""
CREATE TABLE IF NOT EXISTS pricing_parameters (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    total_users           INTEGER DEFAULT 4500,
    total_users_manual    INTEGER DEFAULT 0,
    total_employees       INTEGER DEFAULT 137,
    technical_staff       INTEGER DEFAULT 107,
    back_office_staff     INTEGER DEFAULT 30,
    monthly_work_hours    INTEGER DEFAULT 160,
    vat_rate              REAL DEFAULT 0.18,
    employer_tax_rate     REAL DEFAULT 0.175,
    risk_rate             REAL DEFAULT 0.05,
    misc_expense_rate     REAL DEFAULT 0.01,
    fixed_overhead_ratio  REAL DEFAULT 0.25,
    updated_at            TEXT DEFAULT (datetime('now')),
    updated_by            INTEGER
);

CREATE TABLE IF NOT EXISTS overhead_costs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category       TEXT NOT NULL,
    label          TEXT NOT NULL,
    amount         REAL DEFAULT 0,
    is_annual      INTEGER DEFAULT 0,
    has_vat        INTEGER DEFAULT 0,
    is_admin       INTEGER DEFAULT 1,
    target_service TEXT DEFAULT '',
    sort_order     INTEGER DEFAULT 0,
    notes          TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cost_employees (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    department   TEXT NOT NULL,
    position     TEXT NOT NULL,
    count        INTEGER DEFAULT 1,
    net_salary   REAL DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    super_gross  REAL DEFAULT 0,
    in_overhead  INTEGER DEFAULT 0,
    notes        TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS client_services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    company_code    TEXT NOT NULL,
    service_type    TEXT NOT NULL,
    monthly_revenue REAL DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    notes           TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cost_model_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT,
    record_id  INTEGER,
    action     TEXT,
    old_value  TEXT,
    new_value  TEXT,
    changed_by INTEGER,
    changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_model_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_month      TEXT NOT NULL,
    total_cost          REAL DEFAULT 0,
    total_revenue       REAL DEFAULT 0,
    margin              REAL DEFAULT 0,
    margin_pct          REAL DEFAULT 0,
    overhead_total      REAL DEFAULT 0,
    employee_cost       REAL DEFAULT 0,
    profitable_clients  INTEGER DEFAULT 0,
    loss_clients        INTEGER DEFAULT 0,
    data_json           TEXT DEFAULT '{}',
    created_at          TEXT DEFAULT (datetime('now')),
    UNIQUE(snapshot_month)
);
""")
conn.commit()
ok("Таблицы созданы")

# ── 2. Импорт pricing_parameters ────────────────────────────────────
step("Импорт pricing_parameters")
params_file = MIGRATION_DIR / "pricing_parameters.json"
if params_file.exists():
    with open(params_file, encoding="utf-8") as f:
        params = json.load(f)

    existing = cur.execute("SELECT id FROM pricing_parameters WHERE id=1").fetchone()
    if existing:
        warn("pricing_parameters уже существует — обновляю")
        fields = ["total_users", "total_users_manual", "total_employees", "technical_staff",
                  "back_office_staff", "monthly_work_hours", "vat_rate", "employer_tax_rate",
                  "risk_rate", "misc_expense_rate", "fixed_overhead_ratio"]
        for f_name in fields:
            if f_name in params:
                cur.execute(f"UPDATE pricing_parameters SET {f_name}=? WHERE id=1", [params[f_name]])
    else:
        cur.execute("""INSERT INTO pricing_parameters
            (id, total_users, total_users_manual, total_employees, technical_staff,
             back_office_staff, monthly_work_hours, vat_rate, employer_tax_rate,
             risk_rate, misc_expense_rate, fixed_overhead_ratio)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [params.get("total_users", 4500), params.get("total_users_manual", 0),
             params.get("total_employees", 137), params.get("technical_staff", 107),
             params.get("back_office_staff", 30), params.get("monthly_work_hours", 160),
             params.get("vat_rate", 0.18), params.get("employer_tax_rate", 0.175),
             params.get("risk_rate", 0.05), params.get("misc_expense_rate", 0.01),
             params.get("fixed_overhead_ratio", 0.25)])
    conn.commit()
    ok(f"pricing_parameters импортированы (total_users={params.get('total_users')})")
else:
    warn("pricing_parameters.json не найден")

# ── 3. Импорт overhead_costs ────────────────────────────────────────
step("Импорт overhead_costs")
oh_file = MIGRATION_DIR / "overhead_costs.json"
if oh_file.exists():
    with open(oh_file, encoding="utf-8") as f:
        overhead = json.load(f)

    existing_count = cur.execute("SELECT COUNT(*) FROM overhead_costs").fetchone()[0]
    if existing_count > 0:
        warn(f"overhead_costs уже содержит {existing_count} строк — очищаю и импортирую заново")
        cur.execute("DELETE FROM overhead_costs")

    for oh in overhead:
        cur.execute("""INSERT INTO overhead_costs
            (category, label, amount, is_annual, has_vat, is_admin, target_service, sort_order, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [oh["category"], oh["label"], oh["amount"], oh["is_annual"], oh["has_vat"],
             oh.get("is_admin", 1), oh.get("target_service", ""), oh["sort_order"], oh.get("notes", "")])

    # Set target_service for tech items
    tech_map = {
        "cloud": "cloud", "cortex": "infosec", "ms_license": "permanent_it",
        "service_desk": "permanent_it", "fw_license": "infosec", "pam": "infosec",
        "lms": "infosec", "fw_amort": "infosec",
    }
    for cat, svc in tech_map.items():
        cur.execute("UPDATE overhead_costs SET target_service=? WHERE category=? AND (target_service IS NULL OR target_service='')",
                    [svc, cat])

    conn.commit()
    ok(f"Импортировано {len(overhead)} накладных")
else:
    warn("overhead_costs.json не найден")

# ── 4. Импорт cost_employees ────────────────────────────────────────
step("Импорт cost_employees")
emp_file = MIGRATION_DIR / "cost_employees.json"
if emp_file.exists():
    with open(emp_file, encoding="utf-8") as f:
        employees = json.load(f)

    existing_count = cur.execute("SELECT COUNT(*) FROM cost_employees").fetchone()[0]
    if existing_count > 0:
        warn(f"cost_employees уже содержит {existing_count} строк — очищаю и импортирую заново")
        cur.execute("DELETE FROM cost_employees")

    total_headcount = 0
    for emp in employees:
        cur.execute("""INSERT INTO cost_employees
            (department, position, count, net_salary, gross_salary, super_gross, in_overhead, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [emp["department"], emp["position"], emp["count"],
             emp["net_salary"], emp["gross_salary"], emp["super_gross"],
             emp.get("in_overhead", 0), emp.get("notes", "")])
        total_headcount += emp["count"]

    conn.commit()
    ok(f"Импортировано {len(employees)} записей ({total_headcount} сотрудников)")
else:
    warn("cost_employees.json не найден")

# ── 5. Импорт client_services ───────────────────────────────────────
step("Импорт client_services")
cs_file = MIGRATION_DIR / "client_services.json"
if cs_file.exists():
    with open(cs_file, encoding="utf-8") as f:
        services = json.load(f)

    existing_count = cur.execute("SELECT COUNT(*) FROM client_services").fetchone()[0]
    if existing_count > 0:
        warn(f"client_services уже содержит {existing_count} строк — очищаю и импортирую заново")
        cur.execute("DELETE FROM client_services")

    for svc in services:
        cur.execute("""INSERT INTO client_services
            (company_id, company_code, service_type, monthly_revenue, is_active, notes)
            VALUES (?, ?, ?, ?, ?, ?)""",
            [svc["company_id"], svc["company_code"], svc["service_type"],
             svc["monthly_revenue"], svc.get("is_active", 1), svc.get("notes", "")])

    conn.commit()
    ok(f"Импортировано {len(services)} сервисов")
else:
    warn("client_services.json не найден")

# ── 6. Обновление companies ─────────────────────────────────────────
step("Обновление user_count и cost_code у клиентов")
clients_file = MIGRATION_DIR / "client_companies.json"
if clients_file.exists():
    with open(clients_file, encoding="utf-8") as f:
        clients = json.load(f)

    updated = 0
    not_found = []
    for cl in clients:
        # Ищем по имени (case-insensitive)
        comp = cur.execute(
            "SELECT id FROM companies WHERE LOWER(name)=? LIMIT 1",
            [cl["name"].lower()]
        ).fetchone()
        if comp:
            cur.execute(
                "UPDATE companies SET user_count=?, cost_code=?, group_name=? WHERE id=?",
                [cl.get("user_count", 0), cl.get("cost_code", ""), cl.get("group_name", ""), comp[0]]
            )
            updated += 1
        else:
            not_found.append(cl["name"])

    conn.commit()
    ok(f"Обновлено {updated} клиентов")
    if not_found:
        warn(f"Не найдены: {', '.join(not_found[:5])}{'...' if len(not_found) > 5 else ''}")
else:
    warn("client_companies.json не найден")

# ── 7. Проверка ─────────────────────────────────────────────────────
step("Проверка данных")
params_row = cur.execute("SELECT * FROM pricing_parameters WHERE id=1").fetchone()
if params_row:
    ok(f"pricing_parameters: total_users={params_row[1]}, vat={params_row[8]}, emp_tax={params_row[9]}")

oh_count = cur.execute("SELECT COUNT(*) FROM overhead_costs").fetchone()[0]
admin_count = cur.execute("SELECT COUNT(*) FROM overhead_costs WHERE is_admin=1").fetchone()[0]
tech_count = oh_count - admin_count
ok(f"overhead_costs: {oh_count} строк (admin={admin_count}, tech={tech_count})")

emp_count = cur.execute("SELECT COUNT(*) FROM cost_employees").fetchone()[0]
total_hc = cur.execute("SELECT SUM(count) FROM cost_employees").fetchone()[0]
ok(f"cost_employees: {emp_count} записей, {total_hc} человек")

cs_count = cur.execute("SELECT COUNT(*) FROM client_services").fetchone()[0]
cs_companies = cur.execute("SELECT COUNT(DISTINCT company_id) FROM client_services").fetchone()[0]
ok(f"client_services: {cs_count} строк, {cs_companies} компаний")

client_count = cur.execute("SELECT COUNT(*) FROM companies WHERE category='client'").fetchone()[0]
users_total = cur.execute("SELECT SUM(user_count) FROM companies WHERE category='client' AND user_count > 0").fetchone()[0]
ok(f"Клиентов: {client_count}, total_users (portfolio): {users_total or 0}")

conn.close()
print("\n✅ Миграция cost model завершена!")
print("   Следующий шаг: запусти сервер и проверь /api/cost-model/analytics")
print("   Ожидаемые значения:")
print("     grand_total_g ≈ 645,206 ₼")
print("     total_revenue ≈ 617,020 ₼")
print("     total_margin  ≈ -28,186 ₼")
