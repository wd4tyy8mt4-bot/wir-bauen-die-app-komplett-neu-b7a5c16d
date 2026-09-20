import pytest

from app.services.ai_contracts import AIContext, AIExtraction, AIProvenance, AIRequest
from app.services.ai_orchestrator import AIOrchestrator
from app.services.ai_provider import AIProviderResult
from app.services.ai_validation import AIValidationError
from app.services.local_ai_provider import LocalDevelopmentAIProvider


class FakeAIProvider:
    key = "fake"
    version = "test.1"

    def __init__(self) -> None:
        self.received_request: AIRequest | None = None

    def interpret(self, request: AIRequest) -> AIProviderResult:
        self.received_request = request
        return AIProviderResult(
            extraction=AIExtraction(
                items=[],
                language=request.context.language,
                summary="Fake result",
            ),
            proposals=(),
            provenance=AIProvenance(
                source_kind="user_input",
                source_reference=request.context.source_reference,
                evidence_text=request.text,
                evidence_start=0,
                evidence_end=len(request.text),
                provider_key=self.key,
                provider_version=self.version,
                generated_at="2025-01-01T00:00:00+00:00",
            ),
        )


def test_orchestrator_uses_provider_and_preserves_request_id() -> None:
    provider = FakeAIProvider()
    orchestrator = AIOrchestrator(provider)
    request = AIRequest(
        text="Eine Testnotiz",
        context=AIContext(
            language="de",
            request_id="request-from-client",
            source_reference="note-42",
        ),
    )

    response = orchestrator.interpret(request)

    assert provider.received_request is request
    assert response.request_id == "request-from-client"
    assert response.provider_provenance.provider_key == "fake"
    assert response.validation_warnings == [
        "No structured information could be extracted."
    ]


def test_orchestrator_generates_stable_request_id() -> None:
    orchestrator = AIOrchestrator(FakeAIProvider())
    request = AIRequest(text="Dieselbe Eingabe", context=AIContext(language="de"))

    first = orchestrator.interpret(request)
    second = orchestrator.interpret(request)

    assert first.request_id == second.request_id
    assert first.request_id.startswith("ai_request_")


class InvalidOutputProvider:
    key = "invalid"
    version = "test.1"

    def interpret(self, request: AIRequest) -> AIProviderResult:
        valid = LocalDevelopmentAIProvider().interpret(request)
        first_item = valid.extraction.items[0]
        invalid_item = first_item.model_copy(
            update={
                "provenance": first_item.provenance.model_copy(
                    update={"evidence_text": "does not match input"}
                )
            }
        )
        return AIProviderResult(
            extraction=valid.extraction.model_copy(
                update={"items": [invalid_item, *valid.extraction.items[1:]]}
            ),
            proposals=valid.proposals,
            provenance=valid.provenance,
        )


def test_orchestrator_rejects_invalid_provider_output() -> None:
    orchestrator = AIOrchestrator(InvalidOutputProvider())

    with pytest.raises(AIValidationError, match="evidence text mismatch"):
        orchestrator.interpret(AIRequest(text="Eine einfache Notiz"))
