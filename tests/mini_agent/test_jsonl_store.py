import pytest

from mini_agent.adapters.stores.jsonl import JsonlSessionStore, parse
from mini_agent.domain.session import (
    AssistantMessage,
    Session,
    ToolCall,
    ToolResult,
    UserMessage,
)


def a_session() -> Session:
    session = Session(id="20260101-000000-abcd")
    session.append(UserMessage(text="hi"))
    session.append(
        AssistantMessage(
            text="",
            tool_calls=(ToolCall(id="c1", tool_name="bash", arguments={"command": "ls"}),),
        )
    )
    session.append(ToolResult(tool_call_id="c1", content="exit_code: 0\n\n."))
    session.append(AssistantMessage(text="done"))
    return session


def test_save_then_load(tmp_path):
    store = JsonlSessionStore(tmp_path)

    store.save(a_session())

    assert store.load("20260101-000000-abcd") == a_session()


def test_list_sessions(tmp_path):
    store = JsonlSessionStore(tmp_path)
    store.save(Session(id="20260101-000000-aaaa"))
    store.save(Session(id="20260102-000000-bbbb"))
    store.save(Session(id="20260103-000000-cccc"))

    assert [s.id for s in store.list()] == [
        "20260101-000000-aaaa",
        "20260102-000000-bbbb",
        "20260103-000000-cccc",
    ]


def test_files_are_one_json_object_per_line(tmp_path):
    store = JsonlSessionStore(tmp_path)

    store.save(a_session())

    lines = store.files()[0].read_text(encoding="utf-8").splitlines()
    assert lines[0] == '{"id": "20260101-000000-abcd"}'
    assert len(lines) == 5


def test_load_missing_session_raises(tmp_path):
    store = JsonlSessionStore(tmp_path)

    with pytest.raises(FileNotFoundError):
        store.load("nope")


def test_parse_rejects_unknown_message_type():
    with pytest.raises(ValueError):
        parse('{"id": "s1"}\n{"type": "nope"}\n')
