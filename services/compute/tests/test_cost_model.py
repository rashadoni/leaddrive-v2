"""
Unit tests for Cost Model — numbers MUST match v1 exactly.

v1 reference values (from production):
  Grand Total G: 645,204.83
  Section F:     462,678.81
  Admin OH:      197,654.94
  Tech Infra:     98,661.62
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cost_model import compute_cost_model


# ═══ Fixture data from v1 production ═══

PARAMS = {
    "total_users": 4500,
    "total_employees": 137,
    "technical_staff": 107,
    "back_office_staff": 30,
    "monthly_work_hours": 160,
    "vat_rate": 0.18,
    "employer_tax_rate": 0.175,
    "risk_rate": 0.05,
    "misc_expense_rate": 0.01,
    "fixed_overhead_ratio": 0.25,
}

OVERHEAD_ITEMS = [
    # EXACT production data from v1 API (2026-03-18)
    {"category": "cloud_servers", "amount": 20000, "is_annual": False, "has_vat": True, "is_admin": False, "target_service": "cloud"},
    {"category": "office_rent", "amount": 30000, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "insurance", "amount": 40, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "mobile", "amount": 30, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "cortex", "amount": 500000, "is_annual": True, "has_vat": True, "is_admin": False, "target_service": "infosec"},
    {"category": "ms_license", "amount": 6800, "is_annual": False, "has_vat": True, "is_admin": False, "target_service": "permanent_it"},
    {"category": "service_desk", "amount": 50000, "is_annual": True, "has_vat": True, "is_admin": False, "target_service": "permanent_it"},
    {"category": "palo_alto", "amount": 76000, "is_annual": True, "has_vat": True, "is_admin": False, "target_service": "infosec"},
    {"category": "pam", "amount": 40000, "is_annual": True, "has_vat": True, "is_admin": False, "target_service": "infosec"},
    {"category": "lms", "amount": 49999.97, "is_annual": True, "has_vat": True, "is_admin": True, "target_service": ""},
    {"category": "trainings", "amount": 250000, "is_annual": True, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "ai_licenses", "amount": 3800, "is_annual": True, "has_vat": True, "is_admin": True, "target_service": ""},
    {"category": "car_amort", "amount": 2500, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "car_expenses", "amount": 1200, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "firewall_amort", "amount": 1547.62, "is_annual": False, "has_vat": False, "is_admin": False, "target_service": "infosec"},
    {"category": "laptops", "amount": 8500, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "internet", "amount": 439, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""},
    {"category": "team_building", "amount": 120000, "is_annual": True, "has_vat": False, "is_admin": True, "target_service": ""},
]

EMPLOYEES = [
    # EXACT production data from v1 API (2026-03-18)
    {"department": "BackOffice", "position": "BackOffice (17 people)", "count": 17, "net_salary": 4705.88, "in_overhead": True},
    {"department": "ERP", "position": "ERP Specialist", "count": 6, "net_salary": 3177.18, "in_overhead": False},
    {"department": "GRC", "position": "GRC Specialist", "count": 8, "net_salary": 2451.76, "in_overhead": False},
    {"department": "HelpDesk", "position": "HelpDesk Operator", "count": 56, "net_salary": 1737.28, "in_overhead": False},
    {"department": "InfoSec", "position": "InfoSec Engineer", "count": 12, "net_salary": 3603.9, "in_overhead": False},
    {"department": "IT", "position": "SysAdmin", "count": 8, "net_salary": 2992.22, "in_overhead": False},
    {"department": "IT", "position": "NetAdmin", "count": 8, "net_salary": 3538.82, "in_overhead": False},
    {"department": "IT", "position": "Zəng Mərkəzi", "count": 4, "net_salary": 1737.28, "in_overhead": False},
    {"department": "PM", "position": "Project Manager", "count": 5, "net_salary": 3389.6, "in_overhead": False},
]


def test_grand_total_g():
    """Grand Total G must match v1: 645,204.83"""
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    assert abs(result["grand_total_g"] - 645204.83) < 1.0, f"Grand Total G: {result['grand_total_g']} != 645204.83"


def test_grand_total_f():
    """Section F must match v1: 462,678.81"""
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    assert abs(result["grand_total_f"] - 462678.81) < 1.0, f"Section F: {result['grand_total_f']} != 462678.81"


def test_admin_overhead():
    """Admin overhead must match v1: 197,654.94"""
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    assert abs(result["admin_overhead"] - 197654.94) < 1.0, f"Admin OH: {result['admin_overhead']} != 197654.94"


def test_tech_infra():
    """Tech infra must match v1: 98,661.62"""
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    assert abs(result["tech_infra_total"] - 98661.62) < 1.0, f"Tech Infra: {result['tech_infra_total']} != 98661.62"


def test_service_costs_sum():
    """Sum of all service costs must equal Grand Total G."""
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    svc_sum = sum(result["service_costs"].values())
    assert abs(svc_sum - result["grand_total_g"]) < 0.01, f"Service sum {svc_sum} != Grand Total G {result['grand_total_g']}"


def test_add_overhead_increases_total():
    """Adding 5000 to admin overhead should increase Grand Total G by ~5000."""
    base = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    extra_item = {"category": "test", "label": "Test", "amount": 5000, "is_annual": False, "has_vat": False, "is_admin": True, "target_service": ""}
    result = compute_cost_model(PARAMS, OVERHEAD_ITEMS + [extra_item], EMPLOYEES)
    diff = result["grand_total_g"] - base["grand_total_g"]
    assert abs(diff - 5000) < 100, f"Adding 5000 changed total by {diff}, expected ~5000"


def test_move_to_service():
    """Moving Cortex from infosec to admin should change admin_overhead."""
    items_modified = []
    for item in OVERHEAD_ITEMS:
        if item["category"] == "cortex":
            items_modified.append({**item, "is_admin": True, "target_service": ""})
        else:
            items_modified.append(item)

    base = compute_cost_model(PARAMS, OVERHEAD_ITEMS, EMPLOYEES)
    moved = compute_cost_model(PARAMS, items_modified, EMPLOYEES)

    # Cortex monthly = 500000/12 * 1.18 = ~49,166.67
    cortex_monthly = 500000 / 12 * 1.18
    admin_diff = moved["admin_overhead"] - base["admin_overhead"]
    assert abs(admin_diff - cortex_monthly) < 10, f"Admin diff {admin_diff} != Cortex monthly {cortex_monthly}"


if __name__ == "__main__":
    tests = [test_grand_total_g, test_grand_total_f, test_admin_overhead, test_tech_infra,
             test_service_costs_sum, test_add_overhead_increases_total, test_move_to_service]
    for t in tests:
        try:
            t()
            print(f"  ✅ {t.__name__}")
        except AssertionError as e:
            print(f"  ❌ {t.__name__}: {e}")
        except Exception as e:
            print(f"  ❌ {t.__name__}: {e}")
