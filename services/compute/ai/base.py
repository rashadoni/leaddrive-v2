"""AIService — single entry point for ALL AI calls in LeadDrive CRM."""
import anthropic
import config


class AIService:
    """Centralized AI service. All AI modules use this.call() method."""

    def __init__(self):
        self.client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY) if config.ANTHROPIC_API_KEY else None

    async def call(self, prompt: str, model: str = "claude-haiku-4-5-20251001",
                   max_tokens: int = 1024, temperature: float = 1.0,
                   system: str = "", org_id: str = "") -> str:
        """Single method for ALL Claude API calls."""
        if not self.client:
            return '{"error": "AI not configured"}'

        response = self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system or "You are a helpful CRM assistant.",
            messages=[{"role": "user", "content": prompt}],
        )

        return response.content[0].text


# Singleton
ai_service = AIService()
