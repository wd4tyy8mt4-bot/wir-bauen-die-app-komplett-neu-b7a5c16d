from __future__ import annotations

import json
import math
import re
from typing import Any

from app.services.ai_contracts import AIActionProposal, AIExtraction, AIRequest


TYPE_KEY_PATTERN = re.compile(r"^[^\x00-\x1f\x7f]{1,200}$")


class AIValidationError(ValueError):
    pass


def _assert_json_compatible(value: Any, path: str) -> None:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise AIValidationError(f"{path} must be JSON-compatible") from exc


def validate_ai_output(
    request: AIRequest,
    extraction: AIExtraction,
    proposals: tuple[AIActionProposal, ...],
) -> list[str]:
    warnings: list[str] = []
    items_by_id = {}

    for item in extraction.items:
        if item.local_id in items_by_id:
            raise AIValidationError(f"duplicate extraction id: {item.local_id}")
        if not TYPE_KEY_PATTERN.fullmatch(item.type_key):
            raise AIValidationError(f"invalid type_key for {item.local_id}")
        if not math.isfinite(item.confidence.score):
            raise AIValidationError(f"non-finite confidence for {item.local_id}")
        provenance = item.provenance
        if provenance.evidence_end > len(request.text):
            raise AIValidationError(f"evidence range exceeds input for {item.local_id}")
        if request.text[provenance.evidence_start:provenance.evidence_end] != provenance.evidence_text:
            raise AIValidationError(f"evidence text mismatch for {item.local_id}")
        _assert_json_compatible(item.value, f"item {item.local_id} value")
        _assert_json_compatible(item.metadata, f"item {item.local_id} metadata")
        items_by_id[item.local_id] = item

    proposal_ids: set[str] = set()
    for proposal in proposals:
        if proposal.proposal_id in proposal_ids:
            raise AIValidationError(f"duplicate proposal id: {proposal.proposal_id}")
        proposal_ids.add(proposal.proposal_id)
        if not TYPE_KEY_PATTERN.fullmatch(proposal.type_key):
            raise AIValidationError(f"invalid proposal type_key: {proposal.proposal_id}")
        _assert_json_compatible(proposal.payload, f"proposal {proposal.proposal_id} payload")
        for dependency in proposal.depends_on:
            if dependency not in items_by_id and dependency not in proposal_ids:
                warnings.append(
                    f"Proposal {proposal.proposal_id} references unresolved dependency {dependency}."
                )
        if not proposal.requires_user_confirmation:
            raise AIValidationError("AI proposals must require user confirmation")

    for item in extraction.items:
        for reference_name, reference in (
            ("source_local_id", item.source_local_id),
            ("target_local_id", item.target_local_id),
        ):
            if reference is None:
                continue
            referenced = items_by_id.get(reference)
            if referenced is None:
                raise AIValidationError(
                    f"{item.local_id} has unknown {reference_name}: {reference}"
                )
            if referenced.kind != "entity":
                raise AIValidationError(
                    f"{item.local_id} {reference_name} must reference an entity"
                )

        if item.kind == "relationship" and (
            item.source_local_id is None or item.target_local_id is None
        ):
            raise AIValidationError(
                f"relationship {item.local_id} requires source and target entities"
            )
        if item.kind in {"attribute", "alias"} and item.source_local_id is None:
            raise AIValidationError(
                f"{item.kind} {item.local_id} requires a source entity"
            )

    if not extraction.items:
        warnings.append("No structured information could be extracted.")

    return warnings
