from __future__ import annotations

import hashlib

from app.services.ai_contracts import AIRequest, AIResponse
from app.services.ai_provider import AIProvider
from app.services.ai_validation import validate_ai_output
from app.services.local_ai_provider import LocalDevelopmentAIProvider


class AIOrchestrator:
    def __init__(self, provider: AIProvider | None = None) -> None:
        self._provider = provider or LocalDevelopmentAIProvider()

    def interpret(self, request: AIRequest) -> AIResponse:
        provider_result = self._provider.interpret(request)
        warnings = validate_ai_output(
            request,
            provider_result.extraction,
            provider_result.proposals,
        )
        request_id = request.context.request_id or self._request_id(request)
        return AIResponse(
            request_id=request_id,
            extraction=provider_result.extraction,
            proposals=list(provider_result.proposals),
            provider_provenance=provider_result.provenance,
            validation_warnings=warnings,
        )

    @staticmethod
    def _request_id(request: AIRequest) -> str:
        digest = hashlib.sha256(
            f"{request.context.language}|{request.text}".encode("utf-8")
        ).hexdigest()[:20]
        return f"ai_request_{digest}"


def create_default_ai_orchestrator() -> AIOrchestrator:
    return AIOrchestrator(LocalDevelopmentAIProvider())
