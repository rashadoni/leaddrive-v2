"""LeadDrive CRM v2 — Compute Service (AI + Cost Model)"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.cost_model import router as cost_model_router
from routes.ai import router as ai_router

app = FastAPI(title="LeadDrive Compute", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cost_model_router)
app.include_router(ai_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "compute"}
