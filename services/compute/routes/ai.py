"""AI routes — all AI calls go through AIService."""
from fastapi import APIRouter

router = APIRouter(prefix="/compute/ai", tags=["ai"])


@router.post("/score-lead")
async def score_lead():
    """Score a lead using AI."""
    return {"error": "Not implemented yet — Task 4.5"}


@router.post("/suggest-reply")
async def suggest_reply():
    """AI copilot: suggest ticket reply."""
    return {"error": "Not implemented yet — Task 4.6"}


@router.post("/analyze")
async def analyze():
    """AI profitability analysis."""
    return {"error": "Not implemented yet — Task 2.11"}


@router.post("/chat")
async def chat():
    """Portal chat with AI agent."""
    return {"error": "Not implemented yet — Task 4.4"}
