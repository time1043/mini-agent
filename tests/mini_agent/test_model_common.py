import json

from mini_agent.adapters.models.common import (
    extract_json,
    parse_structured,
    structured_system,
)
from mini_agent.domain.roles import Decision
from mini_agent.domain.session import AssistantMessage


def test_native_output_keeps_instruction_unchanged():
    assert structured_system("干活", AssistantMessage) == "干活"


def test_structured_output_appends_json_shape_hint():
    system = structured_system("审查", Decision)

    assert system.startswith("审查")
    assert '"should_allow": "boolean"' in system
    assert '"reason": "string | null"' in system


def test_extract_json_handles_plain_and_fenced_text():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('前置说明 {"a": 1}') == {"a": 1}


def test_extract_json_rejects_text_without_object():
    import pytest

    with pytest.raises(ValueError):
        extract_json("no json here")


def test_parse_structured_builds_the_output_object():
    decision = parse_structured(
        json.dumps({"should_allow": False, "reason": "危险"}), Decision
    )
    assert decision == Decision(should_allow=False, reason="危险")
