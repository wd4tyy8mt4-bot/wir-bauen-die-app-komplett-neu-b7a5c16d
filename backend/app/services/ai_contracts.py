from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas import BaseSchema


AIProposalKind = Literal[
    "entity",
    "attribute",
    "relationship",
    "event",
    "memory",
    "alias",
]
AIActionType = Literal["create", "refine", "link"]


class AIConfidence(BaseSchema):
    score: float = Field(ge=0.0, le=1.0)
    rationale: str | None = Field(default=None, max_length=1000)


class AIProvenance(BaseSchema):
    source_kind: str = Field(min_length=1, max_length=100)
    source_reference: str | None = Field(default=None, max_length=500)
    evidence_text: str = Field(min_length=1, max_length=100_000)
    evidence_start: int = Field(ge=0)
    evidence_end: int = Field(gt=0)
    provider_key: str = Field(min_length=1, max_length=100)
    provider_version: str = Field(min_length=1, max_length=100)
    generated_at: str

    @model_validator(mode="after")
    def validate_evidence_range(self) -> AIProvenance:
        if self.evidence_end <= self.evidence_start:
            raise ValueError("evidence_end must be greater than evidence_start")
        return self


class AIContext(BaseSchema):
    language: str = Field(default="de", min_length=2, max_length=20)
    context_entity_ids: list[str] = Field(default_factory=list, max_length=100)
    request_id: str | None = Field(default=None, max_length=200)
    source_reference: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AIRequest(BaseSchema):
    text: str = Field(min_length=1, max_length=100_000)
    context: AIContext = Field(default_factory=AIContext)

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value


class AIExtractionItem(BaseSchema):
    local_id: str = Field(min_length=1, max_length=200)
    kind: AIProposalKind
    type_key: str = Field(min_length=1, max_length=200)
    title: str | None = Field(default=None, max_length=1000)
    content: str | None = Field(default=None, max_length=100_000)
    value: Any = None
    source_local_id: str | None = Field(default=None, max_length=200)
    target_local_id: str | None = Field(default=None, max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)
    confidence: AIConfidence
    provenance: AIProvenance


class AIExtraction(BaseSchema):
    items: list[AIExtractionItem] = Field(default_factory=list, max_length=500)
    language: str = Field(default="de", min_length=2, max_length=20)
    summary: str | None = Field(default=None, max_length=2000)


class AIActionProposal(BaseSchema):
    proposal_id: str = Field(min_length=1, max_length=200)
    action: AIActionType
    target_kind: AIProposalKind
    type_key: str = Field(min_length=1, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list, max_length=100)
    confidence: AIConfidence
    provenance: AIProvenance
    requires_user_confirmation: bool = True


class AIResponse(BaseSchema):
    request_id: str
    extraction: AIExtraction
    proposals: list[AIActionProposal] = Field(default_factory=list, max_length=500)
    provider_provenance: AIProvenance
    validation_warnings: list[str] = Field(default_factory=list)
