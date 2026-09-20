from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.services.ai_contracts import (
    AIActionProposal,
    AIExtraction,
    AIProvenance,
    AIRequest,
)


@dataclass(frozen=True)
class AIProviderResult:
    extraction: AIExtraction
    proposals: tuple[AIActionProposal, ...]
    provenance: AIProvenance


class AIProvider(Protocol):
    @property
    def key(self) -> str:
        ...

    @property
    def version(self) -> str:
        ...

    def interpret(self, request: AIRequest) -> AIProviderResult:
        ...
