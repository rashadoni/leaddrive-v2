"""Cost Model routes — called by Next.js via callCompute().

Data flow: Next.js API route → callCompute('/compute/cost-model/analytics') → this router → cost_model.compute_cost_model()
DB access will be through Prisma (Next.js side) passing data as JSON, OR through direct psycopg2 here.
For now, accepts data as request body (Next.js fetches from DB and forwards).
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from cost_model import compute_cost_model

router = APIRouter(prefix="/compute/cost-model", tags=["cost-model"])


class AnalyticsRequest(BaseModel):
    """Next.js sends all required data; compute service just calculates."""
    params: dict
    overhead_items: list[dict]
    employees: list[dict]
    client_companies: list[dict] | None = None
    client_services: list[dict] | None = None


@router.post("/analytics")
async def post_analytics(req: AnalyticsRequest):
    """Compute full cost model from provided data."""
    result = compute_cost_model(
        params=req.params,
        overhead_items=req.overhead_items,
        employees=req.employees,
        client_companies=req.client_companies,
        client_services=req.client_services,
    )
    if not result:
        return {"error": "Cost model computation failed — missing parameters"}
    return {"data": result}


@router.get("/health")
async def cost_model_health():
    """Quick check that cost model engine works."""
    test_params = {"vat_rate": 0.18, "employer_tax_rate": 0.175, "risk_rate": 0.05,
                   "misc_expense_rate": 0.01, "fixed_overhead_ratio": 0.25, "total_employees": 10}
    test_overhead = [{"category": "test", "amount": 1000, "is_annual": False, "has_vat": False, "is_admin": True}]
    test_employees = [{"department": "IT", "position": "Dev", "count": 1, "net_salary": 1000, "in_overhead": False}]
    result = compute_cost_model(test_params, test_overhead, test_employees)
    return {"status": "ok" if result and result.get("grand_total_g", 0) > 0 else "error"}
