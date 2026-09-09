"""
LeadDrive CRM v2 — Cost Model Engine
Ported from v1 api.py _compute_cost_model() (lines 5599-5900)

Computes Section F (Core Maya) and Section G (Full Service Maya).
Target numbers from v1:
  Grand Total G: 645,204.83
  Section F:     462,678.81
  Admin OH:      197,654.94
  Tech Infra:     98,661.62
"""


INCOME_TAX_RATE = 0.14

SERVICE_DEPT_MAP = {
    "permanent_it": ["IT"],
    "infosec": ["InfoSec"],
    "erp": ["ERP"],
    "grc": ["GRC"],
    "projects": ["PM"],
    "helpdesk": ["HelpDesk"],
    "cloud": [],
}

TECH_DEPT_FALLBACK = {
    "cloud_servers": "cloud", "cloud": "cloud",
    "ms_license": "permanent_it", "service_desk": "permanent_it",
    "cortex": "infosec", "firewall_amort": "infosec", "fw_amort": "infosec",
    "palo_alto": "infosec", "fw_license": "infosec", "pam": "infosec",
}


def compute_cost_model(
    params: dict,
    overhead_items: list[dict],
    employees: list[dict],
    client_companies: list[dict] | None = None,
    client_services: list[dict] | None = None,
) -> dict:
    """
    Pure computation — no DB access. Takes data as arguments.

    Args:
        params: pricing_parameters row
        overhead_items: list of overhead_costs rows
        employees: list of cost_employees rows
        client_companies: list of companies with user_count
        client_services: list of client_services rows (monthly_revenue per service)

    Returns:
        Full cost model dict with Section F, Section G, service costs, client margins
    """
    if not params:
        return {}

    vat = params.get("vat_rate", 0.18)
    emp_tax = params.get("employer_tax_rate", 0.175)
    risk_rate = params.get("risk_rate", 0.05)
    misc_rate = params.get("misc_expense_rate", 0.01)
    fixed_ratio = params.get("fixed_overhead_ratio", 0.25)
    variable_ratio = 1.0 - fixed_ratio
    total_employees_param = params.get("total_employees", 137)

    # Portfolio users from client companies
    total_users = sum(c.get("user_count", 0) for c in (client_companies or []) if c.get("user_count", 0) > 0)
    if total_users == 0:
        total_users = params.get("total_users", 0)

    # ═══ Stage 1: Parse Overhead Costs ═══
    admin_overhead = 0.0
    tech_infra_total = 0.0
    overhead_breakdown = []

    for item in overhead_items:
        amt = item.get("amount", 0)

        if item.get("is_annual", False):
            amt = amt / 12

        if item.get("has_vat", False):
            amt = amt * (1 + vat)

        category = item.get("category", "")
        if category in ("insurance", "mobile"):
            amt = amt * total_employees_param

        monthly_amount = round(amt, 2)
        item_copy = {**item, "monthly_amount": monthly_amount}

        is_admin = item.get("is_admin", True)
        if is_admin:
            admin_overhead += monthly_amount
        else:
            tech_infra_total += monthly_amount

        overhead_breakdown.append(item_copy)

    # ═══ Stage 2: Employee Costs by Department ═══
    dept_costs = {}
    back_office_cost = 0.0
    grc_direct_cost = 0.0
    processed_employees = []

    for emp in employees:
        net = emp.get("net_salary", 0)
        count = emp.get("count", 1)
        gross = net / (1 - INCOME_TAX_RATE) if INCOME_TAX_RATE < 1 else net
        super_gross = gross * (1 + emp_tax)
        total_dept = count * super_gross

        emp_data = {
            **emp,
            "gross_salary": round(gross, 2),
            "super_gross": round(super_gross, 2),
            "total_labor_cost": round(total_dept, 2),
        }
        processed_employees.append(emp_data)

        dept = emp.get("department", "")
        if dept == "BackOffice":
            back_office_cost += total_dept
        elif emp.get("in_overhead", False):
            grc_direct_cost += total_dept
        else:
            dept_costs[dept] = dept_costs.get(dept, 0.0) + total_dept

    # ═══ Stage 3: Section F (Core Maya) ═══
    admin_for_f = admin_overhead + back_office_cost
    admin_for_g = admin_overhead + back_office_cost + grc_direct_cost
    total_overhead = admin_for_g + tech_infra_total

    core_labor = dept_costs.get("IT", 0) + dept_costs.get("InfoSec", 0)
    section_f_subtotal = admin_for_f + tech_infra_total + core_labor
    misc = section_f_subtotal * misc_rate
    risk_cost = (section_f_subtotal + misc) * risk_rate
    grand_total_f = round(section_f_subtotal + misc + risk_cost, 2)

    # ═══ Stage 4: Section G (Full Service Distribution) ═══
    all_dept_employees = [e for e in processed_employees if e.get("department") != "BackOffice"]
    total_headcount = sum(e.get("count", 0) for e in all_dept_employees)

    # Build per-service tech costs from overhead
    svc_tech_costs = {}
    for oh in overhead_breakdown:
        target_svc = (oh.get("target_service") or "").strip() or TECH_DEPT_FALLBACK.get(oh.get("category", ""))
        if target_svc:
            svc_tech_costs[target_svc] = svc_tech_costs.get(target_svc, 0.0) + oh["monthly_amount"]

    # Subtract tech items from admin allocation to avoid double-counting
    tech_in_admin = 0.0
    for oh in overhead_breakdown:
        target_svc = (oh.get("target_service") or "").strip() or TECH_DEPT_FALLBACK.get(oh.get("category", ""))
        if oh.get("is_admin", True) and target_svc:
            tech_in_admin += oh["monthly_amount"]
    admin_for_g_adjusted = admin_for_g - tech_in_admin

    service_costs = {}
    service_details = {}
    for svc, depts in SERVICE_DEPT_MAP.items():
        direct_labor = sum(dept_costs.get(d, 0.0) for d in depts)
        dept_headcount = sum(e.get("count", 0) for e in all_dept_employees if e.get("department") in depts)
        ratio = dept_headcount / total_headcount if total_headcount > 0 else 0
        admin_share = admin_for_g_adjusted * ratio
        tech_direct = svc_tech_costs.get(svc, 0.0)
        total = round(direct_labor + admin_share + tech_direct, 2)
        service_costs[svc] = total
        service_details[svc] = {
            "direct_labor": round(direct_labor, 2),
            "admin_share": round(admin_share, 2),
            "tech_direct": round(tech_direct, 2),
            "total": total,
            "headcount": dept_headcount,
            "ratio": round(ratio, 4),
        }

    grand_total_g = round(sum(service_costs.values()), 2)

    # ═══ Stage 5: Client Margins ═══
    total_active_clients = max(1, len([c for c in (client_companies or []) if c.get("user_count", 0) > 0]))
    clients = []

    for company in (client_companies or []):
        users = company.get("user_count", 0)
        company_id = company.get("id", "")

        # Cost allocation
        fixed_cost = grand_total_g * fixed_ratio / total_active_clients if total_active_clients > 0 else 0
        variable_cost = grand_total_g * variable_ratio * users / total_users if total_users > 0 else 0
        total_cost = round(fixed_cost + variable_cost, 2)

        # Revenue from client_services
        company_services = [s for s in (client_services or []) if s.get("company_id") == company_id and s.get("is_active", True)]
        total_revenue = round(sum(s.get("monthly_revenue", 0) for s in company_services), 2)

        margin = round(total_revenue - total_cost, 2)
        margin_pct = round(margin / total_revenue * 100, 2) if total_revenue > 0 else 0

        if margin_pct >= 15:
            status = "good"
        elif margin_pct >= 0:
            status = "low"
        elif total_revenue > 0:
            status = "loss"
        else:
            status = "no_revenue"

        clients.append({
            "id": company_id,
            "name": company.get("name", ""),
            "cost_code": company.get("cost_code", ""),
            "user_count": users,
            "fixed_cost": round(fixed_cost, 2),
            "variable_cost": round(variable_cost, 2),
            "total_cost": total_cost,
            "total_revenue": total_revenue,
            "margin": margin,
            "margin_pct": margin_pct,
            "status": status,
            "services": {s.get("service_type", ""): s.get("monthly_revenue", 0) for s in company_services},
        })

    # Sort by margin ascending (worst first)
    clients.sort(key=lambda c: c["margin"])

    profitable = len([c for c in clients if c["status"] == "good"])
    loss = len([c for c in clients if c["status"] == "loss"])

    # Revenue from all client services
    total_revenue = round(sum(c["total_revenue"] for c in clients), 2)
    total_margin = round(total_revenue - grand_total_g, 2)
    margin_pct = round(total_margin / total_revenue * 100, 2) if total_revenue > 0 else 0

    return {
        "grand_total_f": grand_total_f,
        "grand_total_g": grand_total_g,
        "admin_overhead": round(admin_for_g, 2),
        "tech_infra_total": round(tech_infra_total, 2),
        "total_overhead": round(total_overhead, 2),
        "back_office_cost": round(back_office_cost, 2),
        "grc_direct_cost": round(grc_direct_cost, 2),
        "core_labor": round(core_labor, 2),
        "section_f_subtotal": round(section_f_subtotal, 2),
        "misc": round(misc, 2),
        "risk_cost": round(risk_cost, 2),
        "service_costs": service_costs,
        "service_details": service_details,
        "dept_costs": {k: round(v, 2) for k, v in dept_costs.items()},
        "overhead_breakdown": overhead_breakdown,
        "employees": processed_employees,
        "clients": clients,
        "total_users": total_users,
        "total_headcount": total_headcount,
        "summary": {
            "total_revenue": total_revenue,
            "total_margin": total_margin,
            "margin_pct": margin_pct,
            "profitable_clients": profitable,
            "loss_clients": loss,
            "total_clients": len(clients),
        },
        "params": params,
    }
