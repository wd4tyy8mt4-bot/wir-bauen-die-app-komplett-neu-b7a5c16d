from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from app.services.ai_contracts import (
    AIActionProposal,
    AIConfidence,
    AIExtraction,
    AIExtractionItem,
    AIProvenance,
    AIRequest,
)
from app.services.ai_provider import AIProviderResult


class LocalDevelopmentAIProvider:
    """Deterministic, credential-free semantic provider for development and tests."""

    key = "local_deterministic"
    version = "bau03.2.semantic.patch.1"

    _RELATIVE_TIME_PATTERN = re.compile(
        r"\b(?:gestern|heute|morgen|übermorgen|vorgestern|letzte(?:n|r|s)?\s+Woche|"
        r"nächste(?:n|r|s)?\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)|"
        r"am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))\b",
        re.IGNORECASE,
    )
    _DOCUMENT_WORDS = {
        "beleg",
        "dokument",
        "dokumente",
        "quittung",
        "rechnung",
        "unterlage",
        "unterlagen",
        "vertrag",
    }
    _UNCERTAINTY_CUES = (
        "ich glaube",
        "glaube ich",
        "ungefähr",
        "vermutlich",
        "wahrscheinlich",
        "vielleicht",
        "circa",
        "ca.",
    )

    def interpret(self, request: AIRequest) -> AIProviderResult:
        text = request.text
        generated_at = datetime.now(timezone.utc).isoformat()
        items: list[AIExtractionItem] = []
        entity_ids_by_key: dict[tuple[str, str], str] = {}

        def stable_id(kind: str, type_key: str, marker: str) -> str:
            digest = hashlib.sha256(
                f"{self.version}|{text}|{kind}|{type_key}|{marker}".encode("utf-8")
            ).hexdigest()[:16]
            return f"{kind}_{digest}"

        def provenance(start: int = 0, end: int | None = None) -> AIProvenance:
            final_end = len(text) if end is None else end
            return AIProvenance(
                source_kind="user_input",
                source_reference=request.context.source_reference,
                evidence_text=text[start:final_end],
                evidence_start=start,
                evidence_end=final_end,
                provider_key=self.key,
                provider_version=self.version,
                generated_at=generated_at,
            )

        def add_item(
            kind: str,
            type_key: str,
            marker: str,
            *,
            title: str | None = None,
            content: str | None = None,
            value: Any = None,
            source_local_id: str | None = None,
            target_local_id: str | None = None,
            metadata: dict[str, Any] | None = None,
            confidence: float = 0.72,
            rationale: str = "Deterministische lokale semantische Mustererkennung.",
            start: int = 0,
            end: int | None = None,
        ) -> str:
            local_id = stable_id(kind, type_key, marker)
            items.append(
                AIExtractionItem(
                    local_id=local_id,
                    kind=kind,
                    type_key=type_key,
                    title=title,
                    content=content,
                    value=value,
                    source_local_id=source_local_id,
                    target_local_id=target_local_id,
                    metadata=metadata or {},
                    confidence=AIConfidence(score=confidence, rationale=rationale),
                    provenance=provenance(start, end),
                )
            )
            return local_id

        def ensure_entity(
            title: str,
            type_key: str,
            start: int,
            end: int,
            *,
            confidence: float,
            metadata: dict[str, Any] | None = None,
            rationale: str = "Explizite Gegenstands- oder Namensnennung im Text.",
        ) -> str:
            clean_title = self._clean_mention(title)
            key = (type_key, clean_title.casefold())
            existing_id = entity_ids_by_key.get(key)
            if existing_id is not None:
                return existing_id
            entity_id = add_item(
                "entity",
                type_key,
                f"{clean_title.casefold()}:{start}",
                title=self._display_title(clean_title),
                metadata={"mention": clean_title, **(metadata or {})},
                confidence=confidence,
                rationale=rationale,
                start=start,
                end=end,
            )
            entity_ids_by_key[key] = entity_id
            return entity_id

        primary_object_id: str | None = None
        last_person_id: str | None = None

        # Generic introductions such as "Das ist unser neuer Kühlschrank". The
        # noun is retained without assigning a closed domain category.
        introduction_patterns = (
            re.compile(
                r"\b(?:das|dies)\s+ist\s+(?:unser|mein|ein|eine)\s+"
                r"(?:(?:neuer|neue|neues)\s+)?(?P<name>[A-ZÄÖÜ][\wÄÖÜäöüß-]+)",
                re.IGNORECASE,
            ),
            re.compile(
                r"\b(?:ich|wir)\s+ha(?:be|ben)\s+(?:einen|eine|ein)\s+"
                r"(?:(?:neuen|neue|neues)\s+)?(?P<name>[A-ZÄÖÜ][\wÄÖÜäöüß-]+)",
                re.IGNORECASE,
            ),
        )
        for pattern in introduction_patterns:
            match = pattern.search(text)
            if match:
                name = match.group("name")
                primary_object_id = ensure_entity(
                    name,
                    "unknown.entity",
                    match.start("name"),
                    match.end("name"),
                    confidence=0.82,
                    metadata={"refinement_state": "open"},
                    rationale="Das benannte Ding ist explizit; sein genauer Typ bleibt offen.",
                )
                break

        # Explicit document mentions are linguistic roles, not life-area categories.
        document_matches = list(
            re.finditer(
                r"\b(?:die|der|das|den|dem|eine|einer|einen)?\s*"
                r"(?P<document>Rechnung|Quittung|Beleg|Vertrag|Dokumente?|Unterlagen?)\b",
                text,
                re.IGNORECASE,
            )
        )
        document_ids: list[str] = []
        for match in document_matches:
            document_ids.append(
                ensure_entity(
                    match.group("document"),
                    "document",
                    match.start("document"),
                    match.end("document"),
                    confidence=0.93,
                    rationale="Der Text bezeichnet den Gegenstand ausdrücklich als Dokument.",
                )
            )

        purchase_match = re.search(r"\bgekauft\b", text, re.IGNORECASE)
        purchase_event_id: str | None = None
        seller_id: str | None = None
        if purchase_match:
            purchase_start, purchase_end = self._sentence_span(text, purchase_match.start())
            seller_match = re.search(
                r"\bbei\s+(?P<seller>[A-ZÄÖÜ][\wÄÖÜäöüß&.-]*)\s+gekauft\b",
                text[purchase_start:purchase_end],
            )
            if seller_match:
                seller_start = purchase_start + seller_match.start("seller")
                seller_end = purchase_start + seller_match.end("seller")
                seller_id = ensure_entity(
                    seller_match.group("seller"),
                    "organization",
                    seller_start,
                    seller_end,
                    confidence=0.88,
                    rationale="Die benannte Stelle steht ausdrücklich nach 'bei' im Kaufkontext.",
                )

            event_entities = [
                entity_id
                for entity_id in (primary_object_id, seller_id)
                if entity_id is not None
            ]
            event_value: dict[str, Any] = {}
            time_match = self._RELATIVE_TIME_PATTERN.search(
                text[purchase_start:purchase_end]
            )
            if time_match:
                event_value["time_expression"] = time_match.group(0)
                event_value["time_is_relative"] = True
            purchase_event_id = add_item(
                "event",
                "purchase",
                f"purchase:{purchase_match.start()}",
                title="Kauf",
                content=text[purchase_start:purchase_end],
                source_local_id=primary_object_id,
                value=event_value or None,
                metadata={"entity_local_ids": event_entities},
                confidence=0.91 if primary_object_id else 0.76,
                start=purchase_start,
                end=purchase_end,
            )

            if primary_object_id and seller_id:
                add_item(
                    "relationship",
                    "purchased_from",
                    f"{primary_object_id}:{seller_id}:{purchase_match.start()}",
                    title="Gekauft bei",
                    source_local_id=primary_object_id,
                    target_local_id=seller_id,
                    confidence=0.9,
                    start=purchase_start,
                    end=purchase_end,
                )

            if primary_object_id and time_match:
                absolute_start = purchase_start + time_match.start()
                absolute_end = purchase_start + time_match.end()
                add_item(
                    "attribute",
                    "purchase_time_expression",
                    f"{primary_object_id}:{absolute_start}",
                    source_local_id=primary_object_id,
                    value={
                        "expression": time_match.group(0),
                        "is_relative": True,
                        "resolved_date": None,
                    },
                    metadata={"event_local_id": purchase_event_id},
                    confidence=0.96,
                    rationale="Relative Zeitangabe wird unverändert bewahrt und nicht in ein Datum umgerechnet.",
                    start=absolute_start,
                    end=absolute_end,
                )

        # A document mentioned immediately after a purchase can be linked to that
        # purchase context, while keeping the inference visibly below certainty.
        if primary_object_id and document_ids and purchase_event_id:
            document_match = document_matches[0]
            document_start, document_end = self._sentence_span(
                text, document_match.start("document")
            )
            add_item(
                "relationship",
                "connected_with_document",
                f"{primary_object_id}:{document_ids[0]}:{document_match.start()}",
                title="Verbunden mit Dokument",
                source_local_id=primary_object_id,
                target_local_id=document_ids[0],
                metadata={"event_local_id": purchase_event_id},
                confidence=0.72,
                rationale="Das Dokument folgt im selben Eingabekontext direkt auf den beschriebenen Kauf.",
                start=document_start,
                end=document_end,
            )

        # Price statements retain hedging and distinguish explicit corrections
        # from unresolved contradictions. Revision metadata deliberately uses the
        # existing BAU-02 relation names instead of introducing a second conflict
        # model.
        amount_matches = list(
            re.finditer(
                r"(?:(?P<approx>ungefähr|circa|ca\.)\s+)?"
                r"(?P<amount>\d+(?:[.,]\d{1,2})?)\s*(?P<currency>Euro|EUR|€)\b",
                text,
                re.IGNORECASE,
            )
        )
        contextual_price_candidate = self._contextual_price_candidate(request)
        default_price_source_id = document_ids[0] if document_ids else primary_object_id
        if (
            amount_matches
            and default_price_source_id is None
            and contextual_price_candidate is not None
            and contextual_price_candidate.get("entity_title")
        ):
            default_price_source_id = ensure_entity(
                str(contextual_price_candidate["entity_title"]),
                str(contextual_price_candidate.get("entity_type") or "unknown.entity"),
                0,
                len(text),
                confidence=0.74,
                metadata={
                    "context_record_id": contextual_price_candidate.get(
                        "entity_record_id"
                    ),
                    "refinement_state": "contextual",
                },
                rationale="Der eindeutig relevante frühere Fakt liefert den Bezugsgegenstand der Korrektur.",
            )
        if amount_matches and default_price_source_id is None:
            amount_context_start, amount_context_end = self._sentence_span(
                text, amount_matches[0].start()
            )
            default_price_source_id = ensure_entity(
                self._title_from_text(text[amount_context_start:amount_context_end]),
                "unknown.entity",
                amount_context_start,
                amount_context_end,
                confidence=0.42,
                metadata={"refinement_state": "unclassified"},
                rationale="Ein Wert ist genannt, sein Bezugsgegenstand bleibt jedoch unbekannt.",
            )

        price_source_ids: list[str | None] = []
        for amount_match in amount_matches:
            subject = self._price_subject_before(text, amount_match.start())
            if subject is None:
                price_source_ids.append(default_price_source_id)
                continue
            subject_name, subject_start, subject_end = subject
            subject_type = (
                "document"
                if subject_name.casefold() in self._DOCUMENT_WORDS
                else "unknown.entity"
            )
            price_source_ids.append(
                ensure_entity(
                    subject_name,
                    subject_type,
                    subject_start,
                    subject_end,
                    confidence=0.9 if subject_type == "document" else 0.7,
                    metadata={"refinement_state": "open"}
                    if subject_type == "unknown.entity"
                    else None,
                    rationale="Der Preis wird dem unmittelbar genannten semantischen Träger zugeordnet.",
                )
            )

        correction = self._detect_price_correction(text, amount_matches)
        disputed_amount_indices = self._disputed_price_indices(text, amount_matches)
        if correction is not None:
            old_source_id = price_source_ids[correction["old_index"]]
            new_source_id = price_source_ids[correction["new_index"]]
            if old_source_id != new_source_id:
                correction = None
        contextual_revision = self._contextual_price_revision(request, amount_matches)
        correction_group = (
            f"price-revision:{price_source_ids[correction['new_index']]}:"
            f"{correction['old_index']}:{correction['new_index']}"
            if correction is not None
            else None
        )
        price_local_ids = [
            stable_id(
                "attribute",
                "price",
                f"{price_source_ids[index]}:{amount_match.start()}",
            )
            for index, amount_match in enumerate(amount_matches)
        ]

        for amount_index, amount_match in enumerate(amount_matches):
            sentence_start, sentence_end = self._sentence_span(text, amount_match.start())
            sentence = text[sentence_start:sentence_end]
            uncertainty_cues = [
                cue for cue in self._UNCERTAINTY_CUES if cue in sentence.casefold()
            ]
            is_uncertain = bool(uncertainty_cues or amount_match.group("approx"))
            is_old_correction_value = bool(
                correction and amount_index == correction["old_index"]
            )
            is_new_correction_value = bool(
                correction and amount_index == correction["new_index"]
            )
            is_contextual_revision = bool(
                contextual_revision and amount_index == contextual_revision["new_index"]
            )
            same_source_amounts = {
                candidate.group("amount")
                for candidate_index, candidate in enumerate(amount_matches)
                if price_source_ids[candidate_index] == price_source_ids[amount_index]
            }
            is_conflicting = (
                len(same_source_amounts) > 1
                and not is_old_correction_value
                and not is_new_correction_value
                and correction is None
            )
            metadata: dict[str, Any] = {
                "certainty": "uncertain" if is_uncertain else "stated",
                "uncertainty_cues": uncertainty_cues,
            }
            confidence = 0.58 if is_uncertain else 0.9
            rationale = (
                "Sprachliche Unsicherheit wird beibehalten."
                if is_uncertain
                else "Preis und Währung sind ausdrücklich genannt."
            )

            if is_old_correction_value and correction and correction_group:
                metadata.update(
                    {
                        "revision_status": "superseded_claim",
                        "relation_type": "REVISES",
                        "revision_group": correction_group,
                        "superseded_by_local_id": price_local_ids[
                            correction["new_index"]
                        ],
                        "correction_cue": correction["cue"],
                    }
                )
                confidence = min(confidence, 0.4)
                rationale = "Die Aussage wird als frühere, durch dieselbe Quelle revidierte Preisangabe bewahrt."
            elif is_new_correction_value and correction and correction_group:
                metadata.update(
                    {
                        "revision_status": "current_claim",
                        "relation_type": "REVISES",
                        "revision_group": correction_group,
                        "revises_local_id": price_local_ids[correction["old_index"]],
                        "revises_value": {
                            "amount": amount_matches[
                                correction["old_index"]
                            ].group("amount").replace(",", "."),
                            "currency": "EUR",
                        },
                        "correction_cue": correction["cue"],
                        "user_confirmed": False,
                    }
                )
                confidence = min(confidence, 0.78)
                rationale = "Explizite Korrektur erkannt; die neue Angabe bleibt bis zur Benutzerbestätigung unbestätigt."
            elif is_contextual_revision and contextual_revision:
                metadata.update(
                    {
                        "revision_status": "current_claim",
                        "relation_type": "REVISES",
                        "revises_record_id": contextual_revision["record_id"],
                        "revises_value": contextual_revision["value"],
                        "prior_source_reference": contextual_revision.get(
                            "source_reference"
                        ),
                        "correction_cue": contextual_revision["cue"],
                        "user_confirmed": False,
                    }
                )
                confidence = min(confidence, 0.68)
                rationale = "Kontextbezogene Korrektur erkannt; die Zuordnung bleibt bis zur Benutzerbestätigung unbestätigt."
            elif amount_index in disputed_amount_indices:
                metadata.update(
                    {
                        "revision_status": "disputed_claim",
                        "conflict_status": "unresolved",
                        "conflict_group": f"price:{price_source_ids[amount_index]}",
                        "user_confirmed": False,
                    }
                )
                confidence = 0.32
                rationale = "Die genannte frühere Preisangabe wird bestritten; ohne eindeutigen Ersatzwert bleibt sie unaufgelöst."
            elif is_conflicting:
                metadata.update(
                    {
                        "conflict_status": "unresolved",
                        "conflict_group": f"price:{price_source_ids[amount_index]}",
                    }
                )
                confidence = 0.48
                rationale = "Widersprüchliche Preisangaben bleiben unaufgelöst."

            add_item(
                "attribute",
                "price",
                f"{price_source_ids[amount_index]}:{amount_match.start()}",
                source_local_id=price_source_ids[amount_index],
                value={
                    "amount": amount_match.group("amount").replace(",", "."),
                    "currency": "EUR",
                    "approximate": is_uncertain,
                },
                metadata=metadata,
                confidence=confidence,
                rationale=rationale,
                start=amount_match.start(),
                end=amount_match.end(),
            )

        # Meetings in both common German word orders.
        meeting_match = re.search(
            r"\b(?P<when>gestern|heute|morgen|übermorgen|am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))\s+"
            r"treffe\s+ich\s+(?P<person>[A-ZÄÖÜ][a-zäöüß-]+)"
            r"(?:\s+(?P<prep>auf|an|in|bei)\s+(?:(?:der|dem|einer|einem)\s+)?(?P<place>[^.!?]+))?",
            text,
            re.IGNORECASE,
        )
        if meeting_match is None:
            meeting_match = re.search(
                r"\b(?P<person>[A-ZÄÖÜ][a-zäöüß-]+)\s+"
                r"(?P<when>am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))\s+treffen\b",
                text,
                re.IGNORECASE,
            )
        if meeting_match:
            person_name = meeting_match.group("person")
            last_person_id = ensure_entity(
                person_name,
                "person",
                meeting_match.start("person"),
                meeting_match.end("person"),
                confidence=0.95,
                rationale="Die Person wird ausdrücklich als Treffpartner genannt.",
            )
            place_id: str | None = None
            place_name = meeting_match.groupdict().get("place")
            if place_name:
                clean_place = self._clean_mention(place_name)
                place_start = meeting_match.start("place")
                place_end = place_start + len(clean_place)
                place_id = ensure_entity(
                    clean_place,
                    "place",
                    place_start,
                    place_end,
                    confidence=0.88,
                    rationale="Der Ort wird durch eine räumliche Präposition im Treffkontext genannt.",
                )
            meeting_start, meeting_end = self._sentence_span(text, meeting_match.start())
            event_entities = [last_person_id]
            if place_id:
                event_entities.append(place_id)
            add_item(
                "event",
                "planned_meeting",
                f"{last_person_id}:{meeting_match.start()}",
                title=f"Treffen mit {self._display_title(person_name)}",
                content=text[meeting_start:meeting_end],
                source_local_id=last_person_id,
                value={
                    "time_expression": meeting_match.group("when"),
                    "time_is_relative": True,
                    "resolved_date": None,
                    **({"place_local_id": place_id} if place_id else {}),
                },
                metadata={"entity_local_ids": event_entities},
                confidence=0.92,
                start=meeting_start,
                end=meeting_end,
            )
            if place_id:
                add_item(
                    "relationship",
                    "meeting_context_at",
                    f"{last_person_id}:{place_id}:{meeting_match.start()}",
                    title="Treffkontext am Ort",
                    source_local_id=last_person_id,
                    target_local_id=place_id,
                    confidence=0.78,
                    rationale="Person und Ort sind gemeinsam im ausdrücklich geplanten Treffen genannt.",
                    start=meeting_start,
                    end=meeting_end,
                )

        # Obligations and tasks remain memories with explicit participants and can
        # add a relationship when both the item and recipient are present.
        obligation_pattern = re.compile(
            r"\bich\s+(?P<modal>soll|muss)\s+(?:(?P<recipient>ihm|ihr|ihnen)\s+)?"
            r"(?:(?:die|den|das|eine|einen)\s+)?(?P<object>[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]*)\s+"
            r"(?P<action>mitbringen|bringen|abgeben|erledigen)\b",
            re.IGNORECASE,
        )
        for obligation_match in obligation_pattern.finditer(text):
            object_name = obligation_match.group("object")
            object_type = (
                "document"
                if object_name.casefold() in self._DOCUMENT_WORDS
                else "unknown.entity"
            )
            object_id = ensure_entity(
                object_name,
                object_type,
                obligation_match.start("object"),
                obligation_match.end("object"),
                confidence=0.9 if object_type == "document" else 0.66,
                metadata={"refinement_state": "open"}
                if object_type == "unknown.entity"
                else None,
            )
            obligation_start, obligation_end = self._sentence_span(
                text, obligation_match.start()
            )
            linked_ids = [object_id]
            if last_person_id:
                linked_ids.append(last_person_id)
            add_item(
                "memory",
                "obligation",
                f"obligation:{obligation_match.start()}",
                title="Verpflichtung",
                content=text[obligation_start:obligation_end],
                source_local_id=object_id,
                metadata={
                    "entity_local_ids": linked_ids,
                    "modal": obligation_match.group("modal").casefold(),
                    "action": obligation_match.group("action").casefold(),
                    "recipient_is_contextual": bool(
                        obligation_match.group("recipient") and last_person_id
                    ),
                },
                confidence=0.88 if last_person_id else 0.72,
                start=obligation_start,
                end=obligation_end,
            )
            if last_person_id and obligation_match.group("recipient"):
                add_item(
                    "relationship",
                    "to_bring_to",
                    f"{object_id}:{last_person_id}:{obligation_match.start()}",
                    title="Mitbringen für",
                    source_local_id=object_id,
                    target_local_id=last_person_id,
                    confidence=0.82,
                    rationale="Das Pronomen verweist im direkt vorherigen Treffkontext auf die genannte Person.",
                    start=obligation_start,
                    end=obligation_end,
                )

        semantic_memory_patterns = (
            ("commitment", r"\b(?:ich\s+verspreche|ich\s+sage\s+zu|wir\s+sagen\s+zu)\b", "Zusage"),
            ("decision", r"\b(?:ich|wir)\s+ha(?:be|ben)\s+entschieden\b", "Entscheidung"),
            ("problem", r"\b(?:problem|funktioniert\s+nicht|kaputt|defekt)\b", "Problem"),
        )
        for type_key, pattern, title in semantic_memory_patterns:
            for semantic_match in re.finditer(pattern, text, re.IGNORECASE):
                start, end = self._sentence_span(text, semantic_match.start())
                add_item(
                    "memory",
                    type_key,
                    f"{type_key}:{semantic_match.start()}",
                    title=title,
                    content=text[start:end],
                    source_local_id=primary_object_id,
                    confidence=0.84,
                    start=start,
                    end=end,
                )

        if not any(item.kind == "entity" for item in items):
            primary_object_id = add_item(
                "entity",
                "unknown.entity",
                "fallback",
                title=self._title_from_text(text),
                metadata={"refinement_state": "unclassified"},
                confidence=0.35,
                rationale="Der Text enthält etwas Merkenswertes, aber keine sicher klassifizierbare Entität.",
            )

        entity_ids = [item.local_id for item in items if item.kind == "entity"]
        add_item(
            "memory",
            "natural_language_capture",
            "memory",
            content=text,
            source_local_id=entity_ids[0] if entity_ids else None,
            metadata={"entity_local_ids": entity_ids},
            confidence=0.7 if len(items) > 1 else 0.45,
            rationale="Verlustfreie Bewahrung der unveränderten Benutzereingabe.",
        )

        proposals = tuple(self._to_action(item) for item in items)
        return AIProviderResult(
            extraction=AIExtraction(
                items=items,
                language=request.context.language,
                summary="Lokale, deterministische semantische Interpretation ohne externen KI-Dienst.",
            ),
            proposals=proposals,
            provenance=provenance(),
        )

    @staticmethod
    def _price_subject_before(
        text: str, amount_position: int
    ) -> tuple[str, int, int] | None:
        sentence_start, _ = LocalDevelopmentAIProvider._sentence_span(
            text, amount_position
        )
        prefix = text[sentence_start:amount_position]
        subject_pattern = re.compile(
            r"\b(?:die|der|das|eine|ein)\s+"
            r"(?P<subject>[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]*)\s+"
            r"(?:kostet|war|beträgt|lag(?:\s+bei)?)(?:\s+doch)?\b",
            re.IGNORECASE,
        )
        matches = list(subject_pattern.finditer(prefix))
        if not matches:
            return None
        match = matches[-1]
        return (
            match.group("subject"),
            sentence_start + match.start("subject"),
            sentence_start + match.end("subject"),
        )

    @classmethod
    def _detect_price_correction(
        cls, text: str, amount_matches: list[re.Match[str]]
    ) -> dict[str, Any] | None:
        if len(amount_matches) < 2:
            return None

        amount_token = r"\d+(?:[.,]\d{1,2})?\s*(?:Euro|EUR|€)"
        patterns = (
            (
                "nicht_sondern",
                re.compile(
                    rf"\bnicht\s+(?P<old>{amount_token})\s*,?\s*"
                    rf"sondern(?:\s+jetzt)?\s+(?P<new>{amount_token})\b",
                    re.IGNORECASE,
                ),
            ),
            (
                "doch_nicht",
                re.compile(
                    rf"\bdoch\s+(?P<new>{amount_token})\s*,?\s*"
                    rf"nicht\s+(?P<old>{amount_token})\b",
                    re.IGNORECASE,
                ),
            ),
            (
                "korrigiere_auf",
                re.compile(
                    rf"\bkorrigiere\s+(?P<old>{amount_token})\s+auf\s+"
                    rf"(?P<new>{amount_token})\b",
                    re.IGNORECASE,
                ),
            ),
            (
                "statt",
                re.compile(
                    rf"\bstatt\s+(?P<old>{amount_token})\s+(?:jetzt\s+)?"
                    rf"(?P<new>{amount_token})\b",
                    re.IGNORECASE,
                ),
            ),
        )
        for cue, pattern in patterns:
            correction_match = pattern.search(text)
            if correction_match is None:
                continue
            old_index = cls._amount_index_at(
                amount_matches, correction_match.start("old")
            )
            new_index = cls._amount_index_at(
                amount_matches, correction_match.start("new")
            )
            if old_index is not None and new_index is not None and old_index != new_index:
                return {
                    "old_index": old_index,
                    "new_index": new_index,
                    "cue": cue,
                }
        return None

    @classmethod
    def _disputed_price_indices(
        cls, text: str, amount_matches: list[re.Match[str]]
    ) -> set[int]:
        disputed: set[int] = set()
        for index, amount_match in enumerate(amount_matches):
            sentence_start, sentence_end = cls._sentence_span(text, amount_match.start())
            before = text[sentence_start:amount_match.start()].casefold()
            after = text[amount_match.end():sentence_end].casefold()
            if re.search(r"\bnicht\s+mehr\s*$", before) or re.search(
                r"^\s*(?:,\s*)?(?:stimmt\s+nicht|war\s+falsch)\b",
                after,
            ):
                disputed.add(index)
        return disputed

    @staticmethod
    def _amount_index_at(
        amount_matches: list[re.Match[str]], position: int
    ) -> int | None:
        for index, amount_match in enumerate(amount_matches):
            if amount_match.start() <= position < amount_match.end():
                return index
        return None

    @classmethod
    def _contextual_price_revision(
        cls, request: AIRequest, amount_matches: list[re.Match[str]]
    ) -> dict[str, Any] | None:
        if len(amount_matches) != 1:
            return None
        correction_cues = (
            ("ich_meinte", r"\bich\s+meinte\b"),
            ("geirrt", r"\bich\s+habe\s+mich\s+geirrt\b"),
            ("das_war_falsch", r"\bdas\s+war\s+falsch\b"),
            ("stimmt_nicht", r"\bstimmt\s+nicht\b"),
            ("nicht_mehr", r"\bnicht\s+mehr\b"),
        )
        cue = next(
            (
                cue_name
                for cue_name, pattern in correction_cues
                if re.search(pattern, request.text, re.IGNORECASE)
            ),
            None,
        )
        if cue is None:
            return None

        previous = cls._contextual_price_candidate(request)
        if previous is None:
            return None
        previous_amount = str(previous["value"].get("amount", "")).replace(",", ".")
        new_amount = amount_matches[0].group("amount").replace(",", ".")
        if not previous_amount or previous_amount == new_amount:
            return None
        return {
            "new_index": 0,
            "record_id": str(previous["record_id"]),
            "value": previous["value"],
            "source_reference": previous.get("source_reference"),
            "cue": cue,
        }

    @staticmethod
    def _contextual_price_candidate(request: AIRequest) -> dict[str, Any] | None:
        recent_attributes = request.context.metadata.get("recent_attributes", [])
        if not isinstance(recent_attributes, list):
            return None
        price_candidates = [
            candidate
            for candidate in recent_attributes
            if isinstance(candidate, dict)
            and candidate.get("type_key") == "price"
            and isinstance(candidate.get("value"), dict)
            and candidate.get("record_id")
        ]
        return price_candidates[0] if len(price_candidates) == 1 else None

    @staticmethod
    def _sentence_span(text: str, position: int) -> tuple[int, int]:
        start = max(text.rfind(".", 0, position), text.rfind("!", 0, position), text.rfind("?", 0, position)) + 1
        while start < len(text) and text[start].isspace():
            start += 1
        endings = [index for separator in ".!?" if (index := text.find(separator, position)) >= 0]
        end = min(endings) + 1 if endings else len(text)
        return start, end

    @staticmethod
    def _clean_mention(value: str) -> str:
        return value.strip().strip(".,!?;:")

    @staticmethod
    def _display_title(value: str) -> str:
        clean_value = LocalDevelopmentAIProvider._clean_mention(value)
        return clean_value[:1].upper() + clean_value[1:] if clean_value else clean_value

    @staticmethod
    def _title_from_text(text: str) -> str:
        first_line = text.strip().splitlines()[0]
        return first_line if len(first_line) <= 80 else f"{first_line[:77]}..."

    @staticmethod
    def _to_action(item: AIExtractionItem) -> AIActionProposal:
        payload: dict[str, Any] = {
            "title": item.title,
            "content": item.content,
            "value": item.value,
            "source_local_id": item.source_local_id,
            "target_local_id": item.target_local_id,
            "metadata": item.metadata,
        }
        is_revision = item.metadata.get("revision_status") == "current_claim"
        revision_dependency = item.metadata.get("revises_local_id")
        return AIActionProposal(
            proposal_id=f"proposal_{item.local_id}",
            action="refine" if is_revision else "create",
            target_kind=item.kind,
            type_key=item.type_key,
            payload={key: value for key, value in payload.items() if value is not None},
            depends_on=[
                reference
                for reference in (
                    item.source_local_id,
                    item.target_local_id,
                    revision_dependency,
                )
                if reference is not None
            ],
            confidence=item.confidence,
            provenance=item.provenance,
            requires_user_confirmation=True,
        )
