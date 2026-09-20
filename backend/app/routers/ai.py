from fastapi import APIRouter, HTTPException, status

from app.services.ai_contracts import AIRequest, AIResponse
from app.services.ai_orchestrator import create_default_ai_orchestrator
from app.services.ai_validation import AIValidationError


router = APIRouter(prefix="/api/ai", tags=["ai"])
orchestrator = create_default_ai_orchestrator()


@router.post("/interpret", response_model=AIResponse, status_code=status.HTTP_200_OK)
def interpret_natural_language(request: AIRequest) -> AIResponse:
    try:
        return orchestrator.interpret(request)
    except AIValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The AI provider returned an invalid proposal.",
        ) from exc
