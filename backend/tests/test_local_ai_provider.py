from app.services.ai_contracts import AIExtractionItem, AIRequest
from app.services.ai_validation import validate_ai_output
from app.services.local_ai_provider import LocalDevelopmentAIProvider


def _find_item(
    items: list[AIExtractionItem], kind: str, type_key: str
) -> AIExtractionItem:
    return next(item for item in items if item.kind == kind and item.type_key == type_key)


def _assert_valid_unconfirmed_result(request: AIRequest) -> None:
    result = LocalDevelopmentAIProvider().interpret(request)

    assert validate_ai_output(request, result.extraction, result.proposals) == []
    assert all(proposal.requires_user_confirmation for proposal in result.proposals)
    assert len(result.proposals) == len(result.extraction.items)
    for item in result.extraction.items:
        evidence = item.provenance
        assert request.text[evidence.evidence_start : evidence.evidence_end] == (
            evidence.evidence_text
        )
        assert evidence.provider_key == "local_deterministic"
        assert evidence.provider_version == LocalDevelopmentAIProvider.version


def test_local_provider_extracts_purchase_document_time_and_relationships() -> None:
    provider = LocalDevelopmentAIProvider()
    request = AIRequest(
        text=(
            "Das ist unser neuer Kühlschrank. Wir haben ihn gestern bei MediaMarkt "
            "gekauft. Die Rechnung habe ich aufgehoben."
        )
    )

    first = provider.interpret(request)
    second = provider.interpret(request)
    items = first.extraction.items

    assert [item.local_id for item in first.extraction.items] == [
        item.local_id for item in second.extraction.items
    ]
    assert len(items) > 2

    refrigerator = next(item for item in items if item.title == "Kühlschrank")
    seller = next(item for item in items if item.title == "MediaMarkt")
    invoice = next(item for item in items if item.title == "Rechnung")
    purchase = _find_item(items, "event", "purchase")
    purchase_relation = _find_item(items, "relationship", "purchased_from")
    document_relation = _find_item(
        items, "relationship", "connected_with_document"
    )
    time_information = _find_item(
        items, "attribute", "purchase_time_expression"
    )

    assert (refrigerator.kind, refrigerator.type_key) == (
        "entity",
        "unknown.entity",
    )
    assert refrigerator.metadata["refinement_state"] == "open"
    assert (seller.kind, seller.type_key) == ("entity", "organization")
    assert (invoice.kind, invoice.type_key) == ("entity", "document")
    assert purchase.source_local_id == refrigerator.local_id
    assert purchase.value == {
        "time_expression": "gestern",
        "time_is_relative": True,
    }
    assert purchase_relation.source_local_id == refrigerator.local_id
    assert purchase_relation.target_local_id == seller.local_id
    assert document_relation.source_local_id == refrigerator.local_id
    assert document_relation.target_local_id == invoice.local_id
    assert time_information.source_local_id == refrigerator.local_id
    assert time_information.value == {
        "expression": "gestern",
        "is_relative": True,
        "resolved_date": None,
    }
    assert time_information.provenance.evidence_text == "gestern"
    _assert_valid_unconfirmed_result(request)


def test_local_provider_preserves_uncertainty_for_approximate_price() -> None:
    request = AIRequest(text="Ich glaube, die Rechnung war ungefähr 899 Euro.")
    result = LocalDevelopmentAIProvider().interpret(request)
    price = _find_item(result.extraction.items, "attribute", "price")
    invoice = next(item for item in result.extraction.items if item.title == "Rechnung")

    assert price.source_local_id == invoice.local_id
    assert price.value == {
        "amount": "899",
        "currency": "EUR",
        "approximate": True,
    }
    assert price.metadata["certainty"] == "uncertain"
    assert set(price.metadata["uncertainty_cues"]) == {"ich glaube", "ungefähr"}
    assert price.confidence.score < 0.7
    assert "Unsicherheit" in (price.confidence.rationale or "")
    assert price.provenance.evidence_text == "ungefähr 899 Euro"
    _assert_valid_unconfirmed_result(request)


def test_local_provider_extracts_meeting_place_obligation_and_relationships() -> None:
    request = AIRequest(
        text=(
            "Morgen treffe ich Thomas auf der Baustelle. "
            "Ich soll ihm die Unterlagen mitbringen."
        )
    )
    result = LocalDevelopmentAIProvider().interpret(request)
    items = result.extraction.items

    person = next(item for item in items if item.title == "Thomas")
    place = next(item for item in items if item.title == "Baustelle")
    documents = next(item for item in items if item.title == "Unterlagen")
    meeting = _find_item(items, "event", "planned_meeting")
    meeting_place = _find_item(items, "relationship", "meeting_context_at")
    obligation = _find_item(items, "memory", "obligation")
    bring_relation = _find_item(items, "relationship", "to_bring_to")

    assert (person.kind, person.type_key) == ("entity", "person")
    assert (place.kind, place.type_key) == ("entity", "place")
    assert (documents.kind, documents.type_key) == ("entity", "document")
    assert meeting.source_local_id == person.local_id
    assert meeting.value == {
        "time_expression": "Morgen",
        "time_is_relative": True,
        "resolved_date": None,
        "place_local_id": place.local_id,
    }
    assert meeting_place.source_local_id == person.local_id
    assert meeting_place.target_local_id == place.local_id
    assert obligation.metadata["modal"] == "soll"
    assert obligation.metadata["recipient_is_contextual"] is True
    assert set(obligation.metadata["entity_local_ids"]) == {
        documents.local_id,
        person.local_id,
    }
    assert bring_relation.source_local_id == documents.local_id
    assert bring_relation.target_local_id == person.local_id
    _assert_valid_unconfirmed_result(request)


def test_local_provider_keeps_unknown_when_input_cannot_be_classified() -> None:
    request = AIRequest(
        text="Ich weiß nicht, was das genau ist, aber merk dir das bitte."
    )
    result = LocalDevelopmentAIProvider().interpret(request)
    structured_items = [
        item
        for item in result.extraction.items
        if item.type_key != "natural_language_capture"
    ]

    assert len(structured_items) == 1
    unknown = structured_items[0]
    assert (unknown.kind, unknown.type_key) == ("entity", "unknown.entity")
    assert unknown.metadata["refinement_state"] == "unclassified"
    assert unknown.confidence.score < 0.5
    _assert_valid_unconfirmed_result(request)


def test_local_provider_uses_open_unknown_type_for_unfamiliar_object() -> None:
    request = AIRequest(text="Das ist unser neuer Fluxkompensator.")
    result = LocalDevelopmentAIProvider().interpret(request)
    unknown = next(item for item in result.extraction.items if item.kind == "entity")

    assert unknown.title == "Fluxkompensator"
    assert unknown.type_key == "unknown.entity"
    assert unknown.metadata["refinement_state"] == "open"
    assert "household" not in unknown.type_key
    assert "vehicle" not in unknown.type_key
    _assert_valid_unconfirmed_result(request)


def test_local_provider_marks_conflicting_prices_without_resolving_them() -> None:
    request = AIRequest(
        text="Die Rechnung war 899 Euro. Die Rechnung war 949 Euro."
    )
    result = LocalDevelopmentAIProvider().interpret(request)
    prices = [
        item
        for item in result.extraction.items
        if item.kind == "attribute" and item.type_key == "price"
    ]

    assert {price.value["amount"] for price in prices} == {"899", "949"}
    assert len({price.metadata["conflict_group"] for price in prices}) == 1
    assert all(price.metadata["conflict_status"] == "unresolved" for price in prices)
    assert all(price.confidence.score < 0.5 for price in prices)
    assert all("unaufgelöst" in (price.confidence.rationale or "") for price in prices)
    _assert_valid_unconfirmed_result(request)


def _price_items(request: AIRequest) -> list[AIExtractionItem]:
    return [
        item
        for item in LocalDevelopmentAIProvider().interpret(request).extraction.items
        if item.kind == "attribute" and item.type_key == "price"
    ]


def test_local_provider_recognizes_doch_price_correction() -> None:
    request = AIRequest(text="Die Rechnung war doch 879 Euro, nicht 899 Euro.")
    result = LocalDevelopmentAIProvider().interpret(request)
    prices = {
        item.value["amount"]: item
        for item in result.extraction.items
        if item.kind == "attribute" and item.type_key == "price"
    }

    current = prices["879"]
    previous = prices["899"]
    assert current.metadata["revision_status"] == "current_claim"
    assert current.metadata["relation_type"] == "REVISES"
    assert current.metadata["revises_local_id"] == previous.local_id
    assert current.metadata["user_confirmed"] is False
    assert current.value["approximate"] is False
    assert current.confidence.score < 0.9
    assert previous.metadata["revision_status"] == "superseded_claim"
    assert previous.metadata["superseded_by_local_id"] == current.local_id
    assert "conflict_status" not in current.metadata
    proposal = next(
        proposal
        for proposal in result.proposals
        if proposal.proposal_id == f"proposal_{current.local_id}"
    )
    assert proposal.action == "refine"
    assert proposal.requires_user_confirmation is True
    _assert_valid_unconfirmed_result(request)


def test_local_provider_recognizes_nicht_sondern_price_correction() -> None:
    request = AIRequest(text="Nicht 899 Euro, sondern 879 Euro.")
    prices = {item.value["amount"]: item for item in _price_items(request)}

    assert prices["879"].metadata["revises_local_id"] == prices["899"].local_id
    assert prices["899"].metadata["superseded_by_local_id"] == prices["879"].local_id
    assert prices["879"].metadata["correction_cue"] == "nicht_sondern"
    _assert_valid_unconfirmed_result(request)


def test_local_provider_uses_unambiguous_context_for_ich_meinte() -> None:
    request = AIRequest(
        text="Ich meinte 879 Euro.",
        context={
            "metadata": {
                "recent_attributes": [
                    {
                        "record_id": "attribute-price-899",
                        "type_key": "price",
                        "value": {
                            "amount": "899",
                            "currency": "EUR",
                            "approximate": True,
                        },
                        "source_reference": "input-before-correction",
                        "entity_record_id": "invoice-record",
                        "entity_type": "document",
                        "entity_title": "Rechnung",
                    }
                ]
            }
        },
    )
    price = _find_item(
        LocalDevelopmentAIProvider().interpret(request).extraction.items,
        "attribute",
        "price",
    )

    invoice = next(
        item
        for item in LocalDevelopmentAIProvider().interpret(request).extraction.items
        if item.kind == "entity" and item.title == "Rechnung"
    )
    assert price.source_local_id == invoice.local_id
    assert invoice.metadata["context_record_id"] == "invoice-record"
    assert price.metadata["revision_status"] == "current_claim"
    assert price.metadata["relation_type"] == "REVISES"
    assert price.metadata["revises_record_id"] == "attribute-price-899"
    assert price.metadata["revises_value"]["amount"] == "899"
    assert price.metadata["user_confirmed"] is False
    _assert_valid_unconfirmed_result(request)


def test_local_provider_keeps_rejected_value_unresolved_without_replacement() -> None:
    request = AIRequest(text="899 Euro stimmt nicht.")
    price = _price_items(request)[0]

    assert price.metadata["revision_status"] == "disputed_claim"
    assert price.metadata["conflict_status"] == "unresolved"
    assert price.metadata["user_confirmed"] is False
    assert price.confidence.score < 0.5
    _assert_valid_unconfirmed_result(request)


def test_local_provider_does_not_treat_second_invoice_as_correction() -> None:
    request = AIRequest(text="Ich habe noch eine zweite Rechnung über 879 Euro.")
    prices = _price_items(request)

    assert len(prices) == 1
    assert prices[0].value["amount"] == "879"
    assert "revision_status" not in prices[0].metadata
    assert "revises_local_id" not in prices[0].metadata
    _assert_valid_unconfirmed_result(request)


def test_local_provider_keeps_prices_for_distinct_subjects_separate() -> None:
    request = AIRequest(
        text="Die Rechnung kostet 879 Euro und die Garantie kostet 899 Euro."
    )
    result = LocalDevelopmentAIProvider().interpret(request)
    prices = [
        item
        for item in result.extraction.items
        if item.kind == "attribute" and item.type_key == "price"
    ]
    source_titles = {
        item.local_id: item.title
        for item in result.extraction.items
        if item.kind == "entity"
    }

    assert len(prices) == 2
    assert {source_titles[price.source_local_id] for price in prices} == {
        "Rechnung",
        "Garantie",
    }
    assert all("revision_status" not in price.metadata for price in prices)
    assert all("conflict_status" not in price.metadata for price in prices)
    _assert_valid_unconfirmed_result(request)


def test_local_provider_keeps_legacy_planned_meeting_semantics() -> None:
    request = AIRequest(text="Thomas am Freitag treffen")
    result = LocalDevelopmentAIProvider().interpret(request)
    person = next(item for item in result.extraction.items if item.kind == "entity")
    meeting = _find_item(result.extraction.items, "event", "planned_meeting")

    assert (person.type_key, person.title) == ("person", "Thomas")
    assert meeting.source_local_id == person.local_id
    assert meeting.value == {
        "time_expression": "am Freitag",
        "time_is_relative": True,
        "resolved_date": None,
    }
    _assert_valid_unconfirmed_result(request)
